import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../http/errors.js";
import { hashPassword, normalizeLogin, validateDisplayName, verifyPassword } from "./password.js";
import { publicUser, issueRefreshSession, revokeRefreshSession, rotateRefreshSession, findRefreshSession, REFRESH_COOKIE } from "./sessions.js";
import { closeSession, closeUser } from "../notifications/live.js";
import { setLoginPassword } from "../domain/credentials.js";
import { deleteProfile } from "../domain/profile.js";
import { requireUser } from "./access.js";
import { signAccessToken, verifyAccessToken, REFRESH_TTL_MS } from "./tokens.js";
import {
  VK_COOKIE,
  VK_COOKIE_MS,
  createPkce,
  decodeVkState,
  encodeVkState,
  fetchVkIdentity,
  sameSecret,
  vkAuthorizeUrl,
  vkCallbackQuery,
  vkReady,
} from "./vk.js";

const COOKIE = REFRESH_COOKIE;
let dummyPasswordHash;

async function unknownUserHash() {
  dummyPasswordHash ??= await hashPassword("not-a-real-password");
  return dummyPasswordHash;
}

function cookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.secureCookies,
    expires: expiresAt,
  };
}

function sendAuth(reply, config, accessToken, user, refresh) {
  reply.setCookie(COOKIE, refresh.token, cookieOptions(config, refresh.expiresAt));
  return { accessToken, user: publicUser(user) };
}

function requireDatabase(db) {
  if (!db) {
    throw new HttpError(503, "UNAVAILABLE", "База данных не настроена");
  }
}

function requireJwt(config) {
  if (!config.jwtAccessSecret) {
    throw new HttpError(503, "UNAVAILABLE", "Сервер не настроен для входа");
  }
}

function isUniqueViolation(error) {
  return error?.code === "23505" || error?.cause?.code === "23505";
}

async function findOrCreateVkUser(db, vkUserId, displayName) {
  const [existing] = await db.select().from(users).where(eq(users.vkUserId, vkUserId));
  if (existing) return existing;
  try {
    const [created] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        vkUserId,
        displayName,
        appRole: "user",
      })
      .returning();
    return created;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [again] = await db.select().from(users).where(eq(users.vkUserId, vkUserId));
    if (again) return again;
    throw error;
  }
}

export function registerAuthRoutes(app, { db, sql, config, limiter }) {
  app.post("/api/auth/login", async (request, reply) => {
    requireDatabase(db);
    requireJwt(config);
    const login = normalizeLogin(request.body?.login);
    const password = String(request.body?.password ?? "");
    const ip = request.ip || "unknown";
    if (limiter.tooMany(login, ip)) {
      throw new HttpError(429, "RATE_LIMIT", "Слишком много попыток входа. Попробуйте позже.");
    }

    const [user] = login ? await db.select().from(users).where(eq(users.login, login)) : [];
    const passwordHash = user?.passwordHash || (await unknownUserHash());
    const matches = await verifyPassword(password, passwordHash);
    if (!user?.passwordHash || !matches) {
      limiter.recordFailure(login, ip);
      throw new HttpError(401, "AUTH_INVALID", "Неверный логин или пароль");
    }

    const refresh = await issueRefreshSession(db, user.id);
    const accessToken = signAccessToken(user, config.jwtAccessSecret);
    return sendAuth(reply, config, accessToken, user, refresh);
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    requireDatabase(db);
    requireJwt(config);
    const rotated = await rotateRefreshSession(db, request.cookies?.[COOKIE]);
    if (!rotated) throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
    const accessToken = signAccessToken(rotated.user, config.jwtAccessSecret);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    return sendAuth(reply, config, accessToken, rotated.user, { token: rotated.token, expiresAt });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies?.[COOKIE];
    const session = db ? await findRefreshSession(db, token) : null;
    if (db) await revokeRefreshSession(db, token);
    if (session) closeSession(session.id);
    reply.clearCookie(COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.delete("/api/me", async (request, reply) => {
    const user = await requireUser(request, db, config);
    await deleteProfile(sql, user.id);
    closeUser(user.id);
    reply.clearCookie(COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/auth/vk", async (request, reply) => {
    if (!vkReady(config) || !db || !config.jwtAccessSecret) return reply.redirect("/login?vk=unavailable");
    const pkce = createPkce();
    reply.setCookie(
      VK_COOKIE,
      encodeVkState({ state: pkce.state, verifier: pkce.verifier, purpose: "login" }),
      cookieOptions(config, new Date(Date.now() + VK_COOKIE_MS)),
    );
    return reply.redirect(
      vkAuthorizeUrl({
        clientId: config.vkClientId,
        redirectUri: config.vkRedirectUri,
        state: pkce.state,
        codeChallenge: pkce.challenge,
      }),
    );
  });

  app.get("/api/auth/vk/callback", async (request, reply) => {
    const saved = decodeVkState(request.cookies?.[VK_COOKIE]);
    reply.clearCookie(VK_COOKIE, { path: "/" });
    const fail = (code) => reply.redirect(`/login?vk=${code}`);
    if (!vkReady(config)) return fail("unavailable");

    const query = vkCallbackQuery(request.query);
    if (query.error === "access_denied") return fail("denied");
    if (query.error || !query.code || !query.device_id) return fail("failed");
    if (!saved || !sameSecret(saved.state, query.state)) return fail("state");
    if (!db || !config.jwtAccessSecret) return fail("unavailable");

    let identity;
    try {
      identity = await fetchVkIdentity({
        clientId: config.vkClientId,
        serviceKey: config.vkServiceKey,
        redirectUri: config.vkRedirectUri,
        code: String(query.code),
        verifier: saved.verifier,
        deviceId: String(query.device_id),
        state: saved.state,
      });
    } catch (error) {
      request.log.warn({ vkError: error?.code || "failed" }, "vk login failed");
      return fail("failed");
    }

    const user = await findOrCreateVkUser(db, identity.userId, identity.displayName);
    const refresh = await issueRefreshSession(db, user.id);
    reply.setCookie(COOKIE, refresh.token, cookieOptions(config, refresh.expiresAt));
    return reply.redirect("/calendar");
  });

  app.get("/api/me", async (request) => {
    requireDatabase(db);
    requireJwt(config);
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = verifyAccessToken(token, config.jwtAccessSecret);
    if (!payload) throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub));
    if (!user) throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
    return publicUser(user);
  });

  app.patch("/api/me", async (request) => {
    const current = await requireUser(request, db, config);
    const name = validateDisplayName(request.body?.displayName);
    if (!name.ok) throw new HttpError(400, "VALIDATION", name.message);
    const [user] = await db.update(users).set({ displayName: name.displayName }).where(eq(users.id, current.id)).returning();
    return publicUser(user);
  });

  app.post("/api/me/password", async (request) => {
    const current = await requireUser(request, db, config);
    return setLoginPassword(sql, current.id, request.body);
  });
}
