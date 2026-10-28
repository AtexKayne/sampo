import assert from "node:assert/strict";
import test from "node:test";
import { ACHIEVEMENTS, evaluateAchievements } from "../../../shared/achievements.js";

function visit(startsAt, endsAt, extra = {}) {
  return {
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt ?? new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000)),
    place: "Зал",
    partnerId: null,
    guest: false,
    ...extra,
  };
}

function earnedIds(visits, options) {
  return new Set(evaluateAchievements(visits, options).filter((item) => item.earned).map((item) => item.id));
}

test("the catalogue has at least twenty achievements and none are earned without sampo", () => {
  assert.equal(ACHIEVEMENTS.length >= 20, true);
  assert.equal(evaluateAchievements([]).every((item) => item.earned === false), true);
  const fromText = evaluateAchievements([{
    startsAt: "2026-10-05 10:00:00+05",
    endsAt: "2026-10-05 12:00:00+05",
    place: "Зал",
    partnerId: null,
    guest: false,
  }]);
  assert.equal(fromText.find((item) => item.id === "monday").earned, true);
  assert.equal(fromText.find((item) => item.id === "early").earned, true);
  assert.equal(fromText.find((item) => item.id === "cunning-carburetor").hidden, true);
  assert.equal(fromText.find((item) => item.id === "cunning-carburetor").earned, false);
});

test("visit counts, a full week and a dense month open their achievements", () => {
  const one = earnedIds([visit("2026-10-05T05:00:00.000Z")]);
  assert.equal(one.has("first-step"), true);
  assert.equal(one.has("five"), false);
  assert.equal(one.has("monday"), true);
  assert.equal(one.has("early"), true);

  const week = [];
  for (let day = 5; day <= 11; day += 1) {
    week.push(visit(`2026-10-${String(day).padStart(2, "0")}T05:00:00.000Z`));
  }
  const six = earnedIds(week.slice(0, 6));
  assert.equal(six.has("no-rest"), false);
  assert.equal(six.has("weekend"), true);
  const seven = earnedIds(week);
  assert.equal(seven.has("no-rest"), true);
  const nextMonday = earnedIds([
    ...week.slice(0, 6),
    visit("2026-10-11T19:30:00.000Z"),
  ]);
  assert.equal(nextMonday.has("no-rest"), false);

  const month = [];
  for (let day = 1; day <= 15; day += 1) {
    month.push(visit(`2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`));
  }
  assert.equal(earnedIds(month.slice(0, 14)).has("busy-month"), false);
  assert.equal(earnedIds(month).has("busy-month"), true);
  assert.equal(earnedIds(month).has("ten"), true);
});

test("clock, length, place and partner rules stay on the studio calendar", () => {
  const early = earnedIds([visit("2026-10-05T03:00:00.000Z", "2026-10-05T05:00:00.000Z")]);
  assert.equal(early.has("early"), true);
  assert.equal(early.has("long-set"), false);
  const noon = earnedIds([visit("2026-10-05T07:00:00.000Z")]);
  assert.equal(noon.has("early"), false);
  const evening = earnedIds([visit("2026-10-05T14:00:00.000Z", "2026-10-05T17:00:00.000Z")]);
  assert.equal(evening.has("late"), false);
  assert.equal(evening.has("long-set"), true);
  const late = earnedIds([visit("2026-10-05T16:00:00.000Z", "2026-10-05T18:00:00.000Z")]);
  assert.equal(late.has("late"), true);

  const sameDay = earnedIds([
    visit("2026-10-05T05:00:00.000Z", "2026-10-05T07:00:00.000Z"),
    visit("2026-10-05T09:00:00.000Z", "2026-10-05T11:00:00.000Z"),
  ]);
  assert.equal(sameDay.has("two-a-day"), true);

  const guest = earnedIds([visit("2026-10-05T05:00:00.000Z", null, { guest: true })]);
  assert.equal(guest.has("first-pair"), true);
  assert.equal(guest.has("circle"), false);
  const partners = ["a", "b", "c", "d", "e"];
  const circle = earnedIds(partners.map((partnerId, index) => (
    visit(`2026-10-${String(index + 1).padStart(2, "0")}T05:00:00.000Z`, null, { partnerId })
  )));
  assert.equal(circle.has("circle"), true);
  assert.equal(circle.has("wide-circle"), false);
  const split = earnedIds([
    ...["a", "b", "c"].map((partnerId, index) => visit(`2026-10-0${index + 1}T05:00:00.000Z`, null, { partnerId })),
    ...["d", "e"].map((partnerId, index) => visit(`2026-11-0${index + 1}T05:00:00.000Z`, null, { partnerId })),
  ]);
  assert.equal(split.has("circle"), false);
  const wide = earnedIds(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((partnerId, index) => (
    visit(`2026-10-${String(index + 1).padStart(2, "0")}T05:00:00.000Z`, null, { partnerId })
  )));
  assert.equal(wide.has("wide-circle"), true);
  const loyal = earnedIds(Array.from({ length: 10 }, (_, index) => (
    visit(`2026-10-${String(index + 1).padStart(2, "0")}T05:00:00.000Z`, null, { partnerId: "same" })
  )));
  assert.equal(loyal.has("loyal"), true);
  assert.equal(earnedIds(loyalVisits(9)).has("loyal"), false);
});

function loyalVisits(count) {
  return Array.from({ length: count }, (_, index) => (
    visit(`2026-10-${String(index + 1).padStart(2, "0")}T05:00:00.000Z`, null, { partnerId: "same" })
  ));
}

test("larger totals cross the later count marks", () => {
  const visits = Array.from({ length: 100 }, (_, index) => visit(new Date(Date.UTC(2026, 0, 1, 5) + index * 24 * 60 * 60 * 1000).toISOString()));
  const got = earnedIds(visits);
  assert.equal(got.has("fifty"), true);
  assert.equal(got.has("hundred"), true);
  assert.equal(earnedIds(visits.slice(0, 49)).has("fifty"), false);
  assert.equal(earnedIds(visits.slice(0, 99)).has("hundred"), false);
});

test("streaks need neighbouring weeks and months", () => {
  const weekDays = [5, 6, 7, 12, 13, 14, 19, 20, 21];
  const weeks = earnedIds(weekDays.map((day) => visit(`2026-10-${String(day).padStart(2, "0")}T05:00:00.000Z`)));
  assert.equal(weeks.has("three-weeks"), true);
  const thin = earnedIds([
    visit("2026-10-05T05:00:00.000Z"),
    visit("2026-10-12T05:00:00.000Z"),
    visit("2026-10-19T05:00:00.000Z"),
  ]);
  assert.equal(thin.has("three-weeks"), false);
  const shortLast = earnedIds(
    [5, 6, 7, 12, 13, 14, 19, 20].map((day) => visit(`2026-10-${String(day).padStart(2, "0")}T05:00:00.000Z`)),
  );
  assert.equal(shortLast.has("three-weeks"), false);
  const gap = earnedIds(
    [5, 6, 7, 19, 20, 21, 26, 27, 28].map((day) => visit(`2026-10-${String(day).padStart(2, "0")}T05:00:00.000Z`)),
  );
  assert.equal(gap.has("three-weeks"), false);
  const months = earnedIds([
    visit("2026-12-02T05:00:00.000Z"),
    visit("2027-01-04T05:00:00.000Z"),
  ]);
  assert.equal(months.has("two-months"), true);
  const monthGap = earnedIds([
    visit("2026-10-05T05:00:00.000Z"),
    visit("2026-12-02T05:00:00.000Z"),
  ]);
  assert.equal(monthGap.has("two-months"), false);
  assert.equal(ACHIEVEMENTS.find((item) => item.id === "three-weeks").title, "Три в ряд");
  const master = earnedIds([0, 1, 2, 3, 4, 5].map((month) => visit(new Date(Date.UTC(2026, month, 4, 5)).toISOString())));
  assert.equal(master.has("dance-master"), true);
  assert.equal(earnedIds([0, 1, 2, 3, 4].map((month) => visit(new Date(Date.UTC(2026, month, 4, 5)).toISOString()))).has("dance-master"), false);
});

test("an empty finished week or month after registration is a sloth", () => {
  const since = new Date("2026-08-31T19:00:00.000Z");
  const now = new Date("2026-10-13T08:00:00.000Z");
  const idle = earnedIds([], { since, now });
  assert.equal(idle.has("sloth"), true);
  assert.equal(idle.has("grand-sloth"), true);
  const kept = earnedIds([
    visit("2026-09-07T05:00:00.000Z"),
    visit("2026-09-14T05:00:00.000Z"),
    visit("2026-09-21T05:00:00.000Z"),
    visit("2026-09-28T05:00:00.000Z"),
    visit("2026-10-05T05:00:00.000Z"),
  ], { since, now });
  assert.equal(kept.has("sloth"), false);
  assert.equal(kept.has("grand-sloth"), false);
  const skippedWeek = earnedIds([
    visit("2026-09-07T05:00:00.000Z"),
    visit("2026-09-21T05:00:00.000Z"),
    visit("2026-09-28T05:00:00.000Z"),
    visit("2026-10-05T05:00:00.000Z"),
  ], { since, now });
  assert.equal(skippedWeek.has("sloth"), true);
  assert.equal(skippedWeek.has("grand-sloth"), false);
  assert.equal(earnedIds([], { since: now, now }).has("sloth"), false);
});

test("solo, a close partner, a legendary month and half a year", () => {
  const wolf = [5, 6, 7, 8, 9, 10, 11].map((day) => visit(`2026-10-${String(day).padStart(2, "0")}T05:00:00.000Z`));
  assert.equal(earnedIds(wolf).has("lone-wolf"), true);
  assert.equal(earnedIds(wolf.slice(0, 6)).has("lone-wolf"), false);
  assert.equal(earnedIds([...wolf.slice(0, 6), visit("2026-10-11T05:00:00.000Z", null, { partnerId: "a" })]).has("lone-wolf"), false);

  const soloMonth = Array.from({ length: 15 }, (_, index) => visit(`2026-10-${String(index + 1).padStart(2, "0")}T05:00:00.000Z`));
  assert.equal(earnedIds(soloMonth).has("solo-fine"), true);
  assert.equal(earnedIds(soloMonth.slice(0, 14)).has("solo-fine"), false);
  const withGuest = soloMonth.slice(0, 14).concat(visit("2026-10-15T05:00:00.000Z", null, { guest: true }));
  assert.equal(earnedIds(withGuest).has("solo-fine"), false);

  const close = Array.from({ length: 15 }, (_, index) => (
    visit(`2026-10-${String(index + 1).padStart(2, "0")}T05:00:00.000Z`, null, { partnerId: "same" })
  ));
  assert.equal(earnedIds(close).has("inseparable"), true);
  assert.equal(earnedIds(close).has("loyal"), true);
  assert.equal(earnedIds(close.slice(0, 14)).has("inseparable"), false);

  const legendary = Array.from({ length: 30 }, (_, index) => visit(`2026-10-${String((index % 28) + 1).padStart(2, "0")}T${String(5 + Math.floor(index / 28)).padStart(2, "0")}:00:00.000Z`));
  assert.equal(earnedIds(legendary).has("legendary-month"), true);
  assert.equal(earnedIds(legendary.slice(0, 29)).has("legendary-month"), false);

  const half = Array.from({ length: 150 }, (_, index) => visit(new Date(Date.UTC(2026, index % 6, (index % 27) + 1, 5, index % 60)).toISOString()));
  assert.equal(earnedIds(half).has("impossible"), true);
  assert.equal(earnedIds(half.slice(0, 149)).has("impossible"), false);
  const spread = Array.from({ length: 144 }, (_, index) => visit(new Date(Date.UTC(2026, index % 7, (index % 27) + 1, 5, index % 60)).toISOString()));
  assert.equal(earnedIds(spread).has("impossible"), false);
});
