import assert from "node:assert/strict";
import test from "node:test";
import { BCRYPT_COST, hashPassword, normalizeLogin, validateDisplayName, validateLogin, validatePassword, verifyPassword } from "./password.js";
import { getRounds } from "bcryptjs";

test("login is trimmed and lowercased", () => {
  assert.equal(normalizeLogin("  Anna_1 "), "anna_1");
  assert.equal(validateLogin("ab").ok, false);
  assert.equal(validateLogin("User_2").login, "user_2");
});

test("password and display name limits", () => {
  assert.equal(validatePassword("short").ok, false);
  assert.equal(validatePassword("long-enough").ok, true);
  assert.equal(validateDisplayName("   ").ok, false);
  assert.equal(validateDisplayName("  Маша ").displayName, "Маша");
});

test("password hash uses bcrypt cost 12", async () => {
  const hashed = await hashPassword("long-enough");
  assert.equal(getRounds(hashed), BCRYPT_COST);
  assert.equal(await verifyPassword("long-enough", hashed), true);
  assert.equal(await verifyPassword("other-password", hashed), false);
});
