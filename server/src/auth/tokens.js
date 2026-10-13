import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(data, secret) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signAccessToken(user, secret, now = Date.now()) {
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encode(
    JSON.stringify({
      sub: user.id,
      role: user.appRole,
      exp: Math.floor(now / 1000) + ACCESS_TTL_SECONDS,
    }),
  );
  const data = `${header}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

export function verifyAccessToken(token, secret, now = Date.now()) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const expected = sign(data, secret);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.sub || !payload.exp || payload.exp * 1000 <= now) return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function newRefreshToken() {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
