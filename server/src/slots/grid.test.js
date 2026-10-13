import assert from "node:assert/strict";
import test from "node:test";
import { assignLanes, formatMinutes, pastRowCount, resolveSelection, visibleSpan } from "../../../shared/calendar-grid.js";

test("click and drag resolve to 30-minute steps from 09:00 to midnight", () => {
  const click = resolveSelection(0, 0, 0);
  assert.equal(click.ok, true);
  assert.equal(formatMinutes(click.startMin), "09:00");
  assert.equal(formatMinutes(click.endMin), "09:30");

  const drag = resolveSelection(20, 23, 0);
  assert.equal(drag.ok, true);
  assert.equal(formatMinutes(drag.startMin), "19:00");
  assert.equal(formatMinutes(drag.endMin), "21:00");

  const untilMidnight = resolveSelection(29, 29, 0);
  assert.equal(untilMidnight.ok, true);
  assert.equal(formatMinutes(untilMidnight.endMin), "00:00");
});

test("selection rejects the past and a range longer than 6 hours", () => {
  const past = resolveSelection(0, 2, 4);
  assert.equal(past.ok, false);
  assert.match(past.message, /прошлом/);

  const clamped = resolveSelection(0, 8, 4);
  assert.equal(clamped.ok, true);
  assert.equal(formatMinutes(clamped.startMin), "11:00");

  const tooLong = resolveSelection(0, 12, 0);
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.message, /6 часов/);
});

test("past rows follow the studio clock and overlapping slots take lanes", () => {
  assert.equal(pastRowCount("2026-10-14", "2026-10-14", 16 * 60 + 10), 15);
  assert.equal(pastRowCount("2026-10-13", "2026-10-14", 12 * 60), 30);
  assert.equal(pastRowCount("2026-10-15", "2026-10-14", 12 * 60), 0);

  const lanes = assignLanes([
    { id: "a", startMin: 19 * 60, endMin: 21 * 60 },
    { id: "b", startMin: 20 * 60, endMin: 21 * 60 },
    { id: "c", startMin: 21 * 60, endMin: 22 * 60 },
  ]);
  const byId = Object.fromEntries(lanes.map((item) => [item.id, item]));
  assert.equal(byId.a.laneCount, 2);
  assert.notEqual(byId.a.lane, byId.b.lane);
  assert.equal(byId.c.lane, 0);
  assert.deepEqual(visibleSpan(8 * 60, 10 * 60), { startRow: 0, rows: 2 });
  assert.equal(visibleSpan(8 * 60, 8 * 60 + 30), null);
});
