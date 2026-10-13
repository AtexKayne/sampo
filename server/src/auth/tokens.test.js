import assert from "node:assert/strict";
import test from "node:test";
import { hashRefreshToken, signAccessToken, verifyAccessToken } from "./tokens.js";

const secret = "test-secret-that-is-at-least-32-chars";

test("access token roundtrip expires after 15 minutes", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  const token = signAccessToken({ id: "user-1", appRole: "user" }, secret, now);
  assert.deepEqual(verifyAccessToken(token, secret, now + 14 * 60 * 1000), {
    sub: "user-1",
    role: "user",
  });
  assert.equal(verifyAccessToken(token, secret, now + 16 * 60 * 1000), null);
  assert.equal(verifyAccessToken(token, "another-secret-that-is-at-least-32", now), null);
  assert.equal(verifyAccessToken(`${token}x`, secret, now), null);
});

test("refresh token hash does not keep the raw token", () => {
  const hash = hashRefreshToken("raw-token");
  assert.notEqual(hash, "raw-token");
  assert.equal(hash, hashRefreshToken("raw-token"));
});
