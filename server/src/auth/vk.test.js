import assert from "node:assert/strict";
import test from "node:test";
import {
  codeChallenge,
  decodeVkState,
  encodeVkState,
  fetchVkIdentity,
  parseVkUserId,
  sameSecret,
  vkAuthorizeUrl,
  vkCallbackQuery,
  vkDisplayName,
} from "./vk.js";

test("pkce challenge matches the RFC 7636 vector", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(codeChallenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("authorize url carries the challenge and not the verifier", () => {
  const url = new URL(
    vkAuthorizeUrl({
      clientId: "54821929",
      redirectUri: "http://localhost/api/auth/vk/callback",
      state: "state-value",
      codeChallenge: "challenge-value",
    }),
  );
  assert.equal(url.origin + url.pathname, "https://id.vk.ru/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost/api/auth/vk/callback");
  assert.equal(url.searchParams.has("code_verifier"), false);
});

test("login state cookie roundtrips and rejects other purposes", () => {
  const encoded = encodeVkState({ state: "abc", verifier: "def", purpose: "login" });
  assert.deepEqual(decodeVkState(encoded), { state: "abc", verifier: "def", purpose: "login" });
  assert.equal(decodeVkState(encodeVkState({ state: "abc", verifier: "def", purpose: "link" })), null);
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
});

test("vk name and id", () => {
  assert.equal(vkDisplayName({ first_name: " Анна ", last_name: "Иванова" }), "Анна Иванова");
  assert.equal(vkDisplayName({}), "Участник");
  assert.equal(parseVkUserId("8800243"), 8800243);
  assert.equal(parseVkUserId("0"), null);
  assert.deepEqual(vkCallbackQuery({ payload: JSON.stringify({ code: "c", state: "s", device_id: "d" }) }), {
    code: "c",
    state: "s",
    device_id: "d",
  });
});

test("code exchange reads the profile and drops vk tokens", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: options.body.toString() });
    if (String(url).endsWith("/oauth2/auth")) {
      return json({
        access_token: "secret-access",
        refresh_token: "secret-refresh",
        user_id: 42,
        state: "state-value",
      });
    }
    return json({ user: { user_id: "42", first_name: "Маша", last_name: "Петрова" } });
  };

  const identity = await fetchVkIdentity({
    clientId: "54821929",
    serviceKey: "service-key",
    redirectUri: "http://localhost/api/auth/vk/callback",
    code: "auth-code",
    verifier: "verifier-value",
    deviceId: "device-1",
    state: "state-value",
    fetchImpl,
  });

  assert.deepEqual(identity, { userId: 42, displayName: "Маша Петрова" });
  assert.equal(JSON.stringify(identity).includes("secret"), false);
  const tokenBody = new URLSearchParams(calls[0].body);
  assert.equal(tokenBody.get("grant_type"), "authorization_code");
  assert.equal(tokenBody.get("service_token"), "service-key");
  assert.equal(tokenBody.get("code"), "auth-code");
  const profileBody = new URLSearchParams(calls[1].body);
  assert.equal(profileBody.get("access_token"), "secret-access");
});

test("public app exchange omits the service token", async () => {
  let tokenBody = "";
  const fetchImpl = async (url, options) => {
    if (String(url).endsWith("/oauth2/auth")) {
      tokenBody = options.body.toString();
      return json({ access_token: "a", user_id: 7, state: "s" });
    }
    return json({ user: { user_id: 7, first_name: "Ира" } });
  };
  await fetchVkIdentity({
    clientId: "1",
    serviceKey: "",
    redirectUri: "http://localhost/cb",
    code: "c",
    verifier: "v",
    deviceId: "d",
    state: "s",
    fetchImpl,
  });
  assert.equal(new URLSearchParams(tokenBody).has("service_token"), false);
});

function json(data) {
  return {
    status: 200,
    json: async () => data,
  };
}
