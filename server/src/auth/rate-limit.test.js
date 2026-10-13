import assert from "node:assert/strict";
import test from "node:test";
import { createLoginLimiter } from "./rate-limit.js";

test("ten failures lock the login and the address for 15 minutes", () => {
  let now = 0;
  const limiter = createLoginLimiter({ now: () => now });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(limiter.tooMany("anna", "10.0.0.1"), false);
    limiter.recordFailure("anna", "10.0.0.1");
  }
  assert.equal(limiter.tooMany("anna", "10.0.0.2"), true);
  assert.equal(limiter.tooMany("boris", "10.0.0.1"), true);
  now = 15 * 60 * 1000;
  assert.equal(limiter.tooMany("anna", "10.0.0.1"), false);
});
