import { compare, hash } from "bcryptjs";

export const BCRYPT_COST = 12;
const LOGIN_PATTERN = /^[a-z0-9_]{3,32}$/;

export function normalizeLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateLogin(value) {
  const login = normalizeLogin(value);
  if (!LOGIN_PATTERN.test(login)) {
    return { ok: false, message: "Введите логин из 3–32 символов: латиница, цифры и _" };
  }
  return { ok: true, login };
}

export function validatePassword(value) {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 128) {
    return { ok: false, message: "Пароль должен быть от 8 до 128 символов" };
  }
  return { ok: true, password };
}

export function validateDisplayName(value) {
  const displayName = String(value ?? "").trim();
  if (displayName.length < 1) {
    return { ok: false, message: "Введите имя" };
  }
  if (displayName.length > 80) {
    return { ok: false, message: "Имя не длиннее 80 символов" };
  }
  return { ok: true, displayName };
}

export function hashPassword(password, cost = BCRYPT_COST) {
  return hash(password, cost);
}

export function verifyPassword(password, passwordHash) {
  return compare(password, passwordHash);
}
