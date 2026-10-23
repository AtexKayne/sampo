import { TIME_ZONE_OFFSET_MS } from "./timezone.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ACHIEVEMENTS = [
  { id: "first-step", title: "Первый шаг", detail: "Одно завершённое сампо" },
  { id: "five", title: "Пятёрка", detail: "5 завершённых сампо" },
  { id: "ten", title: "Десятка", detail: "10 завершённых сампо" },
  { id: "fifty", title: "Полсотни", detail: "50 завершённых сампо" },
  { id: "hundred", title: "Сотня", detail: "100 завершённых сампо" },
  { id: "no-rest", title: "Ни дня без отдыха", detail: "7 сампо за одну неделю" },
  { id: "busy-month", title: "Плотный месяц", detail: "15 сампо за один месяц" },
  { id: "legendary-month", title: "Легендарный месяц", detail: "30 сампо за месяц" },
  { id: "impossible", title: "Невозможная ачивка", detail: "150 сампо за полгода" },
  { id: "two-a-day", title: "Двойная смена", detail: "2 сампо за один день" },
  { id: "weekend", title: "Выходной ритм", detail: "Сампо в субботу или воскресенье" },
  { id: "monday", title: "С понедельника", detail: "Сампо в понедельник" },
  { id: "early", title: "Жаворонок", detail: "Сампо с началом до 12:00" },
  { id: "late", title: "Сова", detail: "Сампо с началом в 21:00 или позже" },
  { id: "long-set", title: "Длинный сет", detail: "Сампо от трёх часов" },
  { id: "lone-wolf", title: "Одинокий волк", detail: "7 сампо за неделю в соло" },
  { id: "solo-fine", title: "И так хорошо", detail: "15 сампо за месяц в соло" },
  { id: "first-pair", title: "В паре", detail: "Сампо с партнёром" },
  { id: "circle", title: "Свой круг", detail: "5 разных партнёров за один месяц" },
  { id: "wide-circle", title: "Широкий круг", detail: "10 разных партнёров за один месяц" },
  { id: "loyal", title: "Постоянный партнёр", detail: "10 сампо с одним партнёром за месяц" },
  { id: "inseparable", title: "Не разлей вода", detail: "15 сампо за месяц с одним партнёром" },
  { id: "three-weeks", title: "Три в ряд", detail: "Сампо каждую неделю три недели подряд" },
  { id: "two-months", title: "Два месяца подряд", detail: "Сампо в двух месяцах подряд" },
  { id: "dance-master", title: "Танцмастер", detail: "Сампо в шести месяцах подряд" },
  { id: "sloth", title: "Ленивец", detail: "Ни одного сампо за неделю" },
  { id: "grand-sloth", title: "Грандленивец", detail: "Ни одного сампо за месяц" },
];

function parts(date) {
  const shifted = new Date(date.getTime() + TIME_ZONE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function weekday(date) {
  const point = parts(date);
  const day = new Date(Date.UTC(point.year, point.month - 1, point.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function dayKey(date) {
  const point = parts(date);
  return Date.UTC(point.year, point.month - 1, point.day) / DAY_MS;
}

function weekIndex(date) {
  return dayKey(date) - (weekday(date) - 1);
}

function monthIndex(date) {
  const point = parts(date);
  return point.year * 12 + (point.month - 1);
}

function isSolo(visit) {
  return !visit.partnerId && !visit.guest;
}

function maxInMonthSpan(visits, span) {
  const counts = new Map();
  for (const visit of visits) {
    const month = monthIndex(visit.startsAt);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  if (!counts.size) return 0;
  const indexes = [...counts.keys()];
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  let best = 0;
  for (let start = first; start <= last; start += 1) {
    let sum = 0;
    for (let offset = 0; offset < span; offset += 1) sum += counts.get(start + offset) ?? 0;
    if (sum > best) best = sum;
  }
  return best;
}

function maxBy(visits, key) {
  const counts = new Map();
  for (const visit of visits) {
    const id = key(visit);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let max = 0;
  for (const count of counts.values()) if (count > max) max = count;
  return max;
}

function hasStepRun(values, step, length) {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  let run = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] === step) {
      run += 1;
      if (run >= length) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function weekStart(date) {
  const point = parts(date);
  const midnight = new Date(Date.UTC(point.year, point.month - 1, point.day) - TIME_ZONE_OFFSET_MS);
  return new Date(midnight.getTime() - (weekday(date) - 1) * DAY_MS);
}

function monthStart(date) {
  const point = parts(date);
  return new Date(Date.UTC(point.year, point.month - 1, 1) - TIME_ZONE_OFFSET_MS);
}

function nextMonthStart(date) {
  const point = parts(date);
  return new Date(Date.UTC(point.year, point.month, 1) - TIME_ZONE_OFFSET_MS);
}

function hasIdleWeeks(visits, since, now) {
  const occupied = new Set(visits.map((visit) => weekIndex(visit.startsAt)));
  let start = weekStart(since);
  if (start < since) start = new Date(start.getTime() + 7 * DAY_MS);
  while (start.getTime() + 7 * DAY_MS <= now.getTime()) {
    if (!occupied.has(weekIndex(start))) return true;
    start = new Date(start.getTime() + 7 * DAY_MS);
  }
  return false;
}

function hasIdleMonths(visits, since, now) {
  const occupied = new Set(visits.map((visit) => monthIndex(visit.startsAt)));
  let start = monthStart(since);
  if (start < since) start = nextMonthStart(start);
  while (nextMonthStart(start).getTime() <= now.getTime()) {
    if (!occupied.has(monthIndex(start))) return true;
    start = nextMonthStart(start);
  }
  return false;
}

function monthPartnerStats(visits) {
  const distinct = new Map();
  const repeats = new Map();
  for (const visit of visits) {
    if (!visit.partnerId) continue;
    const month = monthIndex(visit.startsAt);
    if (!distinct.has(month)) distinct.set(month, new Set());
    distinct.get(month).add(visit.partnerId);
    const key = `${month}:${visit.partnerId}`;
    repeats.set(key, (repeats.get(key) ?? 0) + 1);
  }
  let maxDistinct = 0;
  let maxRepeat = 0;
  for (const people of distinct.values()) if (people.size > maxDistinct) maxDistinct = people.size;
  for (const count of repeats.values()) if (count > maxRepeat) maxRepeat = count;
  return { maxDistinct, maxRepeat };
}

export function evaluateAchievements(visits, options = {}) {
  visits = visits.map((visit) => ({
    ...visit,
    startsAt: asDate(visit.startsAt),
    endsAt: asDate(visit.endsAt),
  }));
  const now = options.now ? asDate(options.now) : null;
  const since = options.since ? asDate(options.since) : null;
  const total = visits.length;
  const weekdays = new Set(visits.map((visit) => weekday(visit.startsAt)));
  let withPartner = false;
  for (const visit of visits) {
    if (visit.partnerId || visit.guest) withPartner = true;
  }
  const partners = monthPartnerStats(visits);
  const earned = new Set();
  if (total >= 1) earned.add("first-step");
  if (total >= 5) earned.add("five");
  if (total >= 10) earned.add("ten");
  if (total >= 50) earned.add("fifty");
  if (total >= 100) earned.add("hundred");
  if (maxBy(visits, (visit) => weekIndex(visit.startsAt)) >= 7) earned.add("no-rest");
  const solo = visits.filter(isSolo);
  if (maxBy(visits, (visit) => monthIndex(visit.startsAt)) >= 15) earned.add("busy-month");
  if (maxBy(visits, (visit) => monthIndex(visit.startsAt)) >= 30) earned.add("legendary-month");
  if (maxInMonthSpan(visits, 6) >= 150) earned.add("impossible");
  if (maxBy(solo, (visit) => weekIndex(visit.startsAt)) >= 7) earned.add("lone-wolf");
  if (maxBy(solo, (visit) => monthIndex(visit.startsAt)) >= 15) earned.add("solo-fine");
  if (maxBy(visits, (visit) => dayKey(visit.startsAt)) >= 2) earned.add("two-a-day");
  if ([...weekdays].some((day) => day >= 6)) earned.add("weekend");
  if (weekdays.has(1)) earned.add("monday");
  if (visits.some((visit) => parts(visit.startsAt).hour < 12)) earned.add("early");
  if (visits.some((visit) => parts(visit.startsAt).hour >= 21)) earned.add("late");
  if (visits.some((visit) => visit.endsAt - visit.startsAt >= 3 * HOUR_MS)) earned.add("long-set");
  if (withPartner) earned.add("first-pair");
  if (partners.maxDistinct >= 5) earned.add("circle");
  if (partners.maxDistinct >= 10) earned.add("wide-circle");
  if (partners.maxRepeat >= 10) earned.add("loyal");
  if (partners.maxRepeat >= 15) earned.add("inseparable");
  if (hasStepRun(visits.map((visit) => weekIndex(visit.startsAt)), 7, 3)) earned.add("three-weeks");
  if (hasStepRun(visits.map((visit) => monthIndex(visit.startsAt)), 1, 2)) earned.add("two-months");
  if (hasStepRun(visits.map((visit) => monthIndex(visit.startsAt)), 1, 6)) earned.add("dance-master");
  if (since && now && hasIdleWeeks(visits, since, now)) earned.add("sloth");
  if (since && now && hasIdleMonths(visits, since, now)) earned.add("grand-sloth");
  return ACHIEVEMENTS.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    earned: earned.has(item.id),
  }));
}
