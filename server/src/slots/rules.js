import { GRID_END_MINUTES } from "../../../shared/calendar-grid.js";
import { TIME_ZONE_OFFSET_MS } from "../../../shared/timezone.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 30 * 60 * 1000;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export function studioParts(date) {
  const shifted = new Date(date.getTime() + TIME_ZONE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function studioWeekday(date) {
  const parts = studioParts(date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function studioDayKey(date) {
  const parts = studioParts(date);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function parseStudioLocal(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const result = new Date(Date.UTC(year, month - 1, day, hour, minute) - TIME_ZONE_OFFSET_MS);
  const parts = studioParts(result);
  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== hour || parts.minute !== minute) {
    return null;
  }
  return result;
}

export function validatePlace(value) {
  const place = String(value ?? "").trim();
  if (place.length < 1 || place.length > 80) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Укажите зал, до 80 символов" };
  }
  return { ok: true, place };
}

export function validateCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Вместимость — целое число от 1 до 200" };
  }
  return { ok: true, capacity };
}

export function validateDescription(value) {
  if (value === undefined || value === null) return { ok: true, description: null };
  const description = String(value).trim();
  if (!description) return { ok: true, description: null };
  if (description.length > 1000) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Описание — до 1000 символов" };
  }
  return { ok: true, description };
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateResponsible(value) {
  if (value === undefined || value === null || value === "") return { ok: true, responsibleUserId: null };
  if (typeof value !== "string" || !USER_ID.test(value)) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Выберите ответственного" };
  }
  return { ok: true, responsibleUserId: value };
}

export function validateRepeat(value) {
  const repeatWeekly = value === undefined || value === null ? 0 : Number(value);
  if (!Number.isInteger(repeatWeekly) || repeatWeekly < 0 || repeatWeekly > 12) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Повтор — от 0 до 12 недель" };
  }
  return { ok: true, repeatWeekly };
}

export function validateInterval(startsAt, endsAt, now = new Date()) {
  if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Укажите дату и время слота" };
  }
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Длительность слота от 30 минут до 6 часов" };
  }
  if (!endsOnSameStudioDay(startsAt, endsAt)) {
    return {
      ok: false,
      code: "VALIDATION",
      statusCode: 400,
      message: "Слот должен начаться и закончиться в один день по времени Тюмени",
    };
  }
  const endParts = studioParts(endsAt);
  const endMinutes = studioDayKey(startsAt) === studioDayKey(endsAt) ? endParts.hour * 60 + endParts.minute : 24 * 60;
  if (endMinutes > GRID_END_MINUTES) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Слот можно поставить до 23:30" };
  }
  if (startsAt.getTime() <= now.getTime()) {
    return { ok: false, code: "SLOT_STARTED", statusCode: 409, message: "Нельзя создать слот в прошлом" };
  }
  return { ok: true };
}

export function endsOnSameStudioDay(startsAt, endsAt) {
  if (studioDayKey(startsAt) === studioDayKey(endsAt)) return true;
  const end = studioParts(endsAt);
  if (end.hour !== 0 || end.minute !== 0) return false;
  return studioDayKey(startsAt) === studioDayKey(new Date(endsAt.getTime() - 1000));
}

export function addWeeks(date, weeks) {
  return new Date(date.getTime() + weeks * 7 * DAY_MS);
}
