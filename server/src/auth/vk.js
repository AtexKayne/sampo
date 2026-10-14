import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { validateDisplayName } from "./password.js";

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const AUTHORIZE_URL = "https://id.vk.ru/authorize";
const TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const USER_INFO_URL = "https://id.vk.ru/oauth2/user_info";

export const VK_COOKIE = "sampo_vk";
export const VK_COOKIE_MS = 10 * 60 * 1000;

export function vkReady(config) {
  return Boolean(config.vkClientId && config.vkRedirectUri);
}

export function createPkce() {
  const verifier = randomToken(64);
  return { state: randomToken(64), verifier, challenge: codeChallenge(verifier) };
}

export function codeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function vkAuthorizeUrl({ clientId, redirectUri, state, codeChallenge: challenge }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function encodeVkState(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeVkState(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value ?? ""), "base64url").toString("utf8"));
    if (!parsed || parsed.purpose !== "login") return null;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string") return null;
    if (!parsed.state || !parsed.verifier) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sameSecret(left, right) {
  const actual = Buffer.from(String(left ?? ""));
  const expected = Buffer.from(String(right ?? ""));
  if (actual.length === 0 || actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function vkCallbackQuery(query) {
  const source = query ?? {};
  if (source.code || source.error || source.device_id) return source;
  if (typeof source.payload !== "string") return source;
  try {
    const parsed = JSON.parse(source.payload);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return source;
  }
  return source;
}

export function vkDisplayName(profile) {
  const raw = [profile?.first_name, profile?.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 80)
    .trim();
  const result = validateDisplayName(raw);
  return result.ok ? result.displayName : "Участник";
}

export function parseVkUserId(value) {
  const id = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

export class VkExchangeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function fetchVkIdentity({
  clientId,
  serviceKey,
  redirectUri,
  code,
  verifier,
  deviceId,
  state,
  fetchImpl = globalThis.fetch,
}) {
  const tokenParams = {
    grant_type: "authorization_code",
    code_verifier: verifier,
    redirect_uri: redirectUri,
    code,
    client_id: clientId,
    device_id: deviceId,
    state,
  };
  if (serviceKey) tokenParams.service_token = serviceKey;

  const token = await postForm(TOKEN_URL, tokenParams, fetchImpl);
  const userId = parseVkUserId(token.user_id);
  if (!userId || !token.access_token) throw new VkExchangeError("invalid_token");
  if (token.state && !sameSecret(token.state, state)) throw new VkExchangeError("state");

  const profile = await postForm(
    USER_INFO_URL,
    { client_id: clientId, access_token: token.access_token },
    fetchImpl,
  );
  const profileId = parseVkUserId(profile.user?.user_id);
  if (profileId && profileId !== userId) throw new VkExchangeError("invalid_token");

  return { userId, displayName: vkDisplayName(profile.user) };
}

function randomToken(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += VERIFIER_CHARS[byte % VERIFIER_CHARS.length];
  return out;
}

async function postForm(url, params, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new VkExchangeError("network");
  }
  if (!response || response.status !== 200) throw new VkExchangeError("failed");
  const data = await response.json().catch(() => null);
  if (!data || data.error) throw new VkExchangeError(data?.error || "failed");
  return data;
}
