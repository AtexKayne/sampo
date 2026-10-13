import assert from "node:assert/strict";
import test from "node:test";
import { parseBlockedLevels, parseDanceLevel } from "../../../shared/dance-levels.js";

test("dance level is one of the five codes or empty", () => {
  assert.equal(parseDanceLevel("BG").danceLevel, "BG");
  assert.equal(parseDanceLevel("CH").danceLevel, "CH");
  assert.equal(parseDanceLevel(null).danceLevel, null);
  assert.equal(parseDanceLevel("").danceLevel, null);
  assert.equal(parseDanceLevel("bg").ok, false);
  assert.equal(parseDanceLevel(undefined).ok, false);
});

test("blocked levels keep the canonical order and drop duplicates", () => {
  assert.deepEqual(parseBlockedLevels(["CH", "BG", "BG"]).levels, ["BG", "CH"]);
  assert.deepEqual(parseBlockedLevels([]).levels, []);
  assert.equal(parseBlockedLevels("BG").ok, false);
  assert.equal(parseBlockedLevels(["M", "NO"]).ok, false);
});
