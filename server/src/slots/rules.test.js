import assert from "node:assert/strict";
import test from "node:test";
import { addWeeks, parseStudioLocal, validateDescription, validateInterval, validateResponsible } from "./rules.js";

const now = new Date("2026-10-12T12:00:00.000Z");

test("tyumen local time converts to UTC", () => {
  const startsAt = parseStudioLocal("2026-10-14T19:00");
  const endsAt = parseStudioLocal("2026-10-14T21:00");
  assert.equal(startsAt.toISOString(), "2026-10-14T14:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(validateInterval(startsAt, endsAt, now).ok, true);
});

test("rejects a past slot, a short slot, and a slot across midnight", () => {
  const past = validateInterval(parseStudioLocal("2026-10-01T19:00"), parseStudioLocal("2026-10-01T21:00"), now);
  assert.equal(past.code, "SLOT_STARTED");
  const short = validateInterval(parseStudioLocal("2026-10-14T19:00"), parseStudioLocal("2026-10-14T19:20"), now);
  assert.equal(short.code, "VALIDATION");
  const overnight = validateInterval(parseStudioLocal("2026-10-14T22:00"), parseStudioLocal("2026-10-15T00:30"), now);
  assert.match(overnight.message, /один день/);
  assert.equal(parseStudioLocal("2026-02-31T19:00"), null);
});

test("a slot may end at 23:30 and not at midnight", () => {
  const startsAt = parseStudioLocal("2026-10-14T23:00");
  assert.equal(validateInterval(startsAt, parseStudioLocal("2026-10-14T23:30"), now).ok, true);
  const midnight = validateInterval(startsAt, parseStudioLocal("2026-10-15T00:00"), now);
  assert.equal(midnight.ok, false);
  assert.match(midnight.message, /23:30/);
});

test("slot description is optional and limited to 1000 characters", () => {
  assert.equal(validateDescription(undefined).description, null);
  assert.equal(validateDescription("  ").description, null);
  assert.equal(validateDescription("  зал на втором этаже  ").description, "зал на втором этаже");
  assert.equal(validateDescription("а".repeat(1000)).ok, true);
  assert.equal(validateDescription("а".repeat(1001)).code, "VALIDATION");
});

test("responsible person is an optional user id", () => {
  assert.equal(validateResponsible(undefined).responsibleUserId, null);
  assert.equal(validateResponsible("").responsibleUserId, null);
  assert.equal(validateResponsible("not-a-user").code, "VALIDATION");
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(validateResponsible(id).responsibleUserId, id);
});

test("weekly repeat keeps the tyumen clock time", () => {
  const next = addWeeks(parseStudioLocal("2026-10-14T19:00"), 1);
  assert.equal(next.toISOString(), "2026-10-21T14:00:00.000Z");
});
