import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../http/errors.js";
import { hashPassword, normalizeLogin, validateDisplayName, verifyPassword } from "./password.js";
import {
  presentUser,
  issueRefreshSession,
  revokeRefreshSession,
  rotateRefreshSession,
  findRefreshSession,
  switchRefreshAccount,
  REFRESH_COOKIE,
} from "./sessions.js";
import { closeSession, closeUser } from "../notifications/live.js";
import { createPasswordUser, setLoginPassword } from "../domain/credentials.js";
import { adminProfile, deleteOtherProfile, deleteProfile, parseSampoTotal, requireExistingUser, saveProfile, searchAccounts, setSampoTotal, setUserAchievements } from "../domain/profile.js";
import { requireAdmin, requireDancer, requireUser } from "./access.js";
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

async function sendAuth(reply, db, config, accessToken, user, refresh, loginUserId = user.id) {
  reply.setCookie(COOKIE, refresh.token, cookieOptions(config, refresh.expiresAt));
  return { accessToken, user: await presentUser(db, user, loginUserId) };
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
  if (existing) return { user: existing, created: false };
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
    return { user: created, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [again] = await db.select().from(users).where(eq(users.vkUserId, vkUserId));
    if (again) return { user: again, created: false };
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
    return sendAuth(reply, db, config, accessToken, user, refresh, user.id);
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    requireDatabase(db);
    requireJwt(config);
    const rotated = await rotateRefreshSession(db, request.cookies?.[COOKIE]);
    if (!rotated) throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
    const accessToken = signAccessToken(rotated.user, config.jwtAccessSecret);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    return sendAuth(reply, db, config, accessToken, rotated.user, { token: rotated.token, expiresAt }, rotated.loginUserId);
  });

  app.post("/api/auth/switch", async (request, reply) => {
    requireDatabase(db);
    requireJwt(config);
    const switched = await switchRefreshAccount(db, request.cookies?.[COOKIE]);
    if (switched.status === "unauthorized") throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
    if (switched.status !== "ok") throw new HttpError(403, "FORBIDDEN", "Переключение аккаунта недоступно");
    const accessToken = signAccessToken(switched.user, config.jwtAccessSecret);
    return sendAuth(
      reply,
      db,
      config,
      accessToken,
      switched.user,
      { token: request.cookies[COOKIE], expiresAt: switched.expiresAt },
      switched.loginUserId,
    );
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
    requireDancer(user);
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

    const { user, created } = await findOrCreateVkUser(db, identity.userId, identity.displayName);
    const refresh = await issueRefreshSession(db, user.id);
    reply.setCookie(COOKIE, refresh.token, cookieOptions(config, refresh.expiresAt));
    return reply.redirect(created ? "/me" : "/calendar");
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
    return presentCurrent(request, user);
  });

  app.patch("/api/me", async (request) => {
    const current = await requireUser(request, db, config);
    requireDancer(current);
    const name = validateDisplayName(request.body?.displayName);
    if (!name.ok) throw new HttpError(400, "VALIDATION", name.message);
    const [user] = await db.update(users).set({ displayName: name.displayName }).where(eq(users.id, current.id)).returning();
    return presentCurrent(request, user);
  });

  async function presentCurrent(request, user) {
    const session = await findRefreshSession(db, request.cookies?.[COOKIE]);
    const loginUserId = session?.userId === user.id ? session.loginUserId : user.id;
    return presentUser(db, user, loginUserId);
  }

  app.post("/api/me/password", async (request) => {
    const current = await requireUser(request, db, config);
    requireDancer(current);
    return setLoginPassword(sql, current.id, request.body);
  });

  app.post("/api/admin/users", async (request) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    return createPasswordUser(sql, request.body);
  });

  app.get("/api/admin/users", async (request) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    const q = typeof request.query?.q === "string" ? request.query.q : "";
    const rawPage = request.query?.page;
    const page = Array.isArray(rawPage) ? rawPage[0] : rawPage;
    return searchAccounts(sql, current.id, q, page);
  });

  app.get("/api/admin/users/:id", async (request) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    const user = await requireExistingUser(sql, request.params.id);
    if (user.id === current.id) throw new HttpError(400, "VALIDATION", "Свой профиль открывается в своих настройках");
    return adminProfile(sql, user.id);
  });

  app.put("/api/admin/users/:id", async (request) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    const user = await requireExistingUser(sql, request.params.id);
    if (user.id === current.id) throw new HttpError(400, "VALIDATION", "Свой профиль меняется в своих настройках");
    const sampo = request.body && Object.hasOwn(request.body, "sampoTotal")
      ? parseSampoTotal(request.body.sampoTotal)
      : null;
    if (sampo && !sampo.ok) throw new HttpError(400, "VALIDATION", sampo.message);
    await saveProfile(sql, user.id, request.body);
    if (sampo?.ok) await setSampoTotal(sql, user.id, sampo.total);
    return adminProfile(sql, user.id);
  });

  app.put("/api/admin/users/:id/achievements", async (request) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    const user = await requireExistingUser(sql, request.params.id);
    if (user.id === current.id) throw new HttpError(400, "VALIDATION", "Свой профиль меняется в своих настройках");
    return setUserAchievements(sql, user.id, request.body?.achievementIds);
  });

  app.post("/api/admin/users/:id/password", async (request) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    const user = await requireExistingUser(sql, request.params.id);
    if (user.id === current.id) throw new HttpError(400, "VALIDATION", "Свой логин меняется в своём профиле");
    return setLoginPassword(sql, user.id, request.body);
  });

  app.delete("/api/admin/users/:id", async (request, reply) => {
    const current = await requireUser(request, db, config);
    requireAdmin(current);
    await deleteOtherProfile(sql, current.id, request.params.id);
    closeUser(request.params.id);
    return reply.code(204).send();
  });
}
