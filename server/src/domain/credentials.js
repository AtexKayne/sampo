import { HttpError } from "../http/errors.js";
import { hashPassword, validateDisplayName, validateLogin, validatePassword } from "../auth/password.js";

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

function isUniqueViolation(error) {
  return error?.code === "23505" || error?.cause?.code === "23505";
}

function publicCredentials(row) {
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name,
    appRole: row.app_role,
    hasLogin: Boolean(row.login),
    vkLinked: row.vk_user_id != null,
  };
}

export async function setLoginPassword(sql, userId, body) {
  const login = validateLogin(body?.login);
  if (!login.ok) fail(400, "VALIDATION", login.message);

  const rawPassword = body?.password;
  const passwordProvided = typeof rawPassword === "string" && rawPassword.length > 0;
  const [current] = await sql`
    SELECT login, password_hash IS NOT NULL AS has_password
    FROM users
    WHERE id = ${userId}
  `;
  if (!current) fail(404, "NOT_FOUND", "Профиль не найден");
  if (!current.has_password && !passwordProvided) fail(400, "VALIDATION", "Введите пароль");

  let passwordHash = null;
  if (passwordProvided) {
    const password = validatePassword(rawPassword);
    if (!password.ok) fail(400, "VALIDATION", password.message);
    passwordHash = await hashPassword(password.password);
  }

  try {
    const [updated] = passwordHash
      ? await sql`
          UPDATE users
          SET login = ${login.login}, password_hash = ${passwordHash}
          WHERE id = ${userId}
          RETURNING id, login, display_name, app_role, vk_user_id
        `
      : await sql`
          UPDATE users
          SET login = ${login.login}
          WHERE id = ${userId}
          RETURNING id, login, display_name, app_role, vk_user_id
        `;
    if (!updated) fail(404, "NOT_FOUND", "Профиль не найден");
    return publicCredentials(updated);
  } catch (error) {
    if (isUniqueViolation(error)) fail(409, "LOGIN_TAKEN", "Этот логин уже занят");
    throw error;
  }
}

export async function createPasswordUser(sql, body) {
  const login = validateLogin(body?.login);
  if (!login.ok) fail(400, "VALIDATION", login.message);
  const password = validatePassword(body?.password);
  if (!password.ok) fail(400, "VALIDATION", password.message);
  const name = validateDisplayName(body?.displayName);
  if (!name.ok) fail(400, "VALIDATION", name.message);
  const passwordHash = await hashPassword(password.password);
  try {
    const [created] = await sql`
      INSERT INTO users (id, login, password_hash, display_name, app_role)
      VALUES (${crypto.randomUUID()}, ${login.login}, ${passwordHash}, ${name.displayName}, 'user')
      RETURNING id, login, display_name, app_role, vk_user_id
    `;
    return publicCredentials(created);
  } catch (error) {
    if (isUniqueViolation(error)) fail(409, "LOGIN_TAKEN", "Этот логин уже занят");
    throw error;
  }
}
