import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError, errorBody } from "../http/errors.js";
import { hashPassword, normalizeLogin, validateDisplayName, validateLogin, validatePassword, verifyPassword } from "./password.js";
import { publicUser, issueRefreshSession, revokeRefreshSession, rotateRefreshSession, findRefreshSession, REFRESH_COOKIE } from "./sessions.js";
import { closeSession, closeUser } from "../notifications/live.js";
import { deleteProfile } from "../domain/profile.js";
import { requireUser } from "./access.js";
import { signAccessToken, verifyAccessToken, REFRESH_TTL_MS } from "./tokens.js";

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

export function registerAuthRoutes(app, { db, sql, config, limiter }) {
  app.post("/api/auth/register", async (request, reply) => {
    const loginResult = validateLogin(request.body?.login);
    if (!loginResult.ok) throw new HttpError(400, "VALIDATION", loginResult.message);
    const passwordResult = validatePassword(request.body?.password);
    if (!passwordResult.ok) throw new HttpError(400, "VALIDATION", passwordResult.message);
    const nameResult = validateDisplayName(request.body?.displayName);
    if (!nameResult.ok) throw new HttpError(400, "VALIDATION", nameResult.message);
    requireDatabase(db);
    requireJwt(config);

    const passwordHash = await hashPassword(passwordResult.password);
    let created;
    try {
      [created] = await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          login: loginResult.login,
          passwordHash,
          displayName: nameResult.displayName,
          appRole: "user",
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "LOGIN_TAKEN", "Этот логин уже занят");
      }
      throw error;
    }

    const refresh = await issueRefreshSession(db, created.id);
    const accessToken = signAccessToken(created, config.jwtAccessSecret);
    return sendAuth(reply, config, accessToken, created, refresh);
  });

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
    const message = "Вход через ВКонтакте не настроен";
    if (request.headers.accept?.includes("application/json")) {
      return reply.code(503).send(errorBody("UNAVAILABLE", message));
    }
    return reply.code(503).type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Сампо</title>
</head>
<body style="margin:0;padding:24px;background:#f6f3ee;color:#1c1916;font-family:system-ui,'Segoe UI',sans-serif">
  <p>${message}.</p>
  <p><a href="/login">Вернуться ко входу</a></p>
</body>
</html>`);
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
}
