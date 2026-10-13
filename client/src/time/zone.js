import { ru } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIME_ZONE } from "../../../shared/timezone.js";

export { TIME_ZONE };

export function studioDayKey(date) {
  return formatInTimeZone(date, TIME_ZONE, "yyyy-MM-dd");
}

export function startOfStudioDay(date) {
  return fromZonedTime(`${studioDayKey(date)}T00:00:00`, TIME_ZONE);
}

export function addStudioDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function calendarAnchor(weekOffset, now = new Date()) {
  return addStudioDays(startOfStudioDay(now), weekOffset * 7);
}

export function dayStarts(anchor, count) {
  return Array.from({ length: count }, (_, index) => addStudioDays(anchor, index));
}

export function formatDayTitle(date) {
  return formatInTimeZone(date, TIME_ZONE, "EEEE, d MMMM", { locale: ru });
}

export function formatRange(start, endExclusive) {
  const end = new Date(endExclusive.getTime() - 1);
  const sameMonth = formatInTimeZone(start, TIME_ZONE, "yyyy-MM") === formatInTimeZone(end, TIME_ZONE, "yyyy-MM");
  if (sameMonth) {
    return `${formatInTimeZone(start, TIME_ZONE, "d", { locale: ru })}–${formatInTimeZone(end, TIME_ZONE, "d MMMM", { locale: ru })}`;
  }
  return `${formatInTimeZone(start, TIME_ZONE, "d MMM", { locale: ru })} – ${formatInTimeZone(end, TIME_ZONE, "d MMM", { locale: ru })}`;
}

export function formatWeekday(date) {
  return formatInTimeZone(date, TIME_ZONE, "EEE", { locale: ru }).replace(".", "");
}

export function formatDayNumber(date) {
  return formatInTimeZone(date, TIME_ZONE, "d");
}

export function formatSlotTime(startsAt, endsAt) {
  const start = formatInTimeZone(new Date(startsAt), TIME_ZONE, "HH:mm");
  const end = formatInTimeZone(new Date(endsAt), TIME_ZONE, "HH:mm");
  return `${start}–${end}`;
}

export function studioWeekday(date) {
  return Number(formatInTimeZone(date, TIME_ZONE, "i"));
}

export function studioMinutes(date) {
  const [hour, minute] = formatInTimeZone(date, TIME_ZONE, "HH:mm").split(":").map(Number);
  return hour * 60 + minute;
}

export function studioLocalValue(dayKey, minutes) {
  if (minutes >= 24 * 60) {
    const nextMidnight = new Date(fromZonedTime(`${dayKey}T00:00:00`, TIME_ZONE).getTime() + 24 * 60 * 60 * 1000);
    return formatInTimeZone(nextMidnight, TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
  }
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${dayKey}T${hour}:${minute}`;
}

export function slotClock(startsAt, endsAt) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dayKey = studioDayKey(start);
  const startMin = studioMinutes(start);
  let endMin = studioMinutes(end);
  if (studioDayKey(end) !== dayKey) {
    if (endMin !== 0) return null;
    endMin = 24 * 60;
  }
  return { dayKey, startMin, endMin };
}
