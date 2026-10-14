import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../http/errors.js";
import { verifyAccessToken } from "./tokens.js";

export async function requireUser(request, db, config) {
  if (!db) throw new HttpError(503, "UNAVAILABLE", "База данных не настроена");
  if (!config.jwtAccessSecret) throw new HttpError(503, "UNAVAILABLE", "Сервер не настроен для входа");
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyAccessToken(token, config.jwtAccessSecret);
  if (!payload) throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
  const [user] = await db.select().from(users).where(eq(users.id, payload.sub));
  if (!user) throw new HttpError(401, "AUTH_INVALID", "Нужно войти");
  return user;
}

export function requireAdmin(user) {
  if (user.appRole !== "admin") throw new HttpError(403, "FORBIDDEN", "Недостаточно прав");
}

export function requireDancer(user) {
  if (user.appRole === "admin") throw new HttpError(403, "FORBIDDEN", "Администратор не участвует в приглашениях");
}
