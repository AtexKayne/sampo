import { GRID_END_MINUTES } from "../../../shared/calendar-grid.js";
import { HttpError } from "../http/errors.js";
import { blockedTargets, invitationDenied, inviteListHides, listMembership, publicAchievements, visitCounts } from "./profile.js";
import { endsOnSameStudioDay, parseStudioLocal, studioDayKey, studioParts, studioWeekday } from "../slots/rules.js";

const WEEKDAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

function slotOf(row) {
  return {
    id: row.id,
    startsAt: new Date(row.startsAt ?? row.starts_at),
    endsAt: new Date(row.endsAt ?? row.ends_at),
    place: row.place,
    capacity: row.capacity,
    description: row.description ?? null,
    responsibleUserId: row.responsibleUserId ?? row.responsible_user_id ?? null,
    status: row.status,
    seriesId: row.seriesId ?? row.series_id ?? null,
  };
}

function formatWhen(date) {
  const parts = studioParts(new Date(date));
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${parts.day} ${MONTHS[parts.month - 1]}, ${hour}:${minute}`;
}

function clockMinutes(value) {
  const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function slotStartMinutes(slot) {
  const parts = studioParts(slot.startsAt);
  return parts.hour * 60 + parts.minute;
}

function slotEndMinutes(slot) {
  const end = studioParts(slot.endsAt);
  if (studioDayKey(slot.startsAt) !== studioDayKey(slot.endsAt) && end.hour === 0 && end.minute === 0) return 24 * 60;
  return end.hour * 60 + end.minute;
}

function rangeEndMinutes(startsAt, endsAt) {
  const end = studioParts(endsAt);
  if (studioDayKey(startsAt) !== studioDayKey(endsAt) && end.hour === 0 && end.minute === 0) return 24 * 60;
  return end.hour * 60 + end.minute;
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return new Date(leftStart) < new Date(rightEnd) && new Date(rightStart) < new Date(leftEnd);
}

function localOverlap(row, slot) {
  const start = clockMinutes(row.local_start);
  const end = clockMinutes(row.local_end);
  return slotStartMinutes(slot) < end && start < slotEndMinutes(slot);
}

function anchorKey(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function daySpan(fromKey, toKey) {
  const [fromYear, fromMonth, fromDay] = fromKey.split("-").map(Number);
  const [toYear, toMonth, toDay] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / (24 * 60 * 60 * 1000));
}

function skipDatesOf(row) {
  const value = row.skip_dates ?? row.skipDates ?? [];
  if (!Array.isArray(value)) return [];
  return value.map((item) => anchorKey(item)).filter(Boolean);
}

function windowMatches(row, slot) {
  if (skipDatesOf(row).includes(studioDayKey(slot.startsAt))) return false;
  if (row.kind === "once") return overlaps(row.starts_at, row.ends_at, slot.startsAt, slot.endsAt);
  if (!row.local_start || !row.local_end || !localOverlap(row, slot)) return false;
  if (row.kind === "weekly") return studioWeekday(slot.startsAt) === row.weekday;
  if (row.kind === "daily") return true;
  if (row.kind === "weekdays") {
    const weekday = studioWeekday(slot.startsAt);
    return weekday >= 1 && weekday <= 5;
  }
  if (row.kind === "weekends") {
    const weekday = studioWeekday(slot.startsAt);
    return weekday === 6 || weekday === 7;
  }
  if (row.kind === "interval") {
    const anchor = anchorKey(row.anchor_date);
    const step = Number(row.interval_days);
    if (!anchor || !Number.isInteger(step) || step < 1) return false;
    const span = daySpan(anchor, studioDayKey(slot.startsAt));
    return span >= 0 && span % step === 0;
  }
  return false;
}

function daysWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

function windowLabel(row) {
  const text = describeWindow(row);
  return row.blocked ? `Недоступен: ${text}` : text;
}

function describeWindow(row) {
  const range = row.local_start && row.local_end ? `${String(row.local_start).slice(0, 5)}–${String(row.local_end).slice(0, 5)}` : "";
  if (row.kind === "weekly") return `каждый ${WEEKDAYS[row.weekday]}, ${range}`;
  if (row.kind === "daily") return `каждый день, ${range}`;
  if (row.kind === "weekdays") return `по будням, ${range}`;
  if (row.kind === "weekends") return `по выходным, ${range}`;
  if (row.kind === "interval") {
    const count = Number(row.interval_days);
    const anchor = anchorKey(row.anchor_date);
    const [, month, day] = anchor ? anchor.split("-").map(Number) : [];
    const from = anchor ? ` с ${day} ${MONTHS[month - 1]}` : "";
    return `каждые ${count} ${daysWord(count)}${from}, ${range}`;
  }
  const end = studioParts(new Date(row.ends_at));
  const endText = `${String(end.hour).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}`;
  return `${formatWhen(row.starts_at)}–${endText}`;
}

function orderedPair(left, right) {
  return left < right ? [left, right] : [right, left];
}

const INVITE_NOTICE = new Set([
  "request_received",
  "request_accepted",
  "request_declined",
  "request_withdrawn",
  "request_expired",
  "request_superseded",
]);

async function notify(tx, userId, type, payload) {
  const [user] = await tx`SELECT app_role, notify_invites, notify_new_slots, vk_user_id FROM users WHERE id = ${userId}`;
  if (user?.app_role === "admin") return;
  if (INVITE_NOTICE.has(type) && user?.notify_invites === false) return;
  if (type === "slot_opened" && user?.notify_new_slots !== true) return;
  const id = crypto.randomUUID();
  await tx`INSERT INTO notifications (id, user_id, type, payload) VALUES (${id}, ${userId}, ${type}, ${tx.json(payload)})`;
  const event = JSON.stringify({
    userId,
    notification: {
      id,
      type,
      text: payload?.text ?? "",
      requestId: payload?.requestId ?? null,
      slotId: payload?.slotId ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  });
  if (Buffer.byteLength(event) <= 7500) await tx`SELECT pg_notify('sampo_notification', ${event})`;
  const [subscription] = await tx`SELECT id FROM push_subscriptions WHERE user_id = ${userId} LIMIT 1`;
  await tx`
    INSERT INTO notification_deliveries (id, notification_id, channel, status, last_error)
    VALUES (
      ${crypto.randomUUID()},
      ${id},
      'push',
      ${subscription ? "pending" : "skipped"},
      ${subscription ? null : "Нет подписки на уведомления"}
    )
  `;
  await tx`
    INSERT INTO notification_deliveries (id, notification_id, channel, status, last_error)
    VALUES (
      ${crypto.randomUUID()},
      ${id},
      'vk',
      'skipped',
      ${user?.vk_user_id == null ? "Нет привязки ВК" : "Сообщения ВК ещё не подключены"}
    )
  `;
}

async function displayName(tx, userId) {
  const [row] = await tx`SELECT display_name FROM users WHERE id = ${userId}`;
  return row?.display_name ?? "";
}

async function requestView(tx, row, actorId) {
  const otherId = row.from_user_id === actorId ? row.to_user_id : row.from_user_id;
  const [slot] = await tx`SELECT starts_at, ends_at, place FROM slots WHERE id = ${row.slot_id}`;
  return {
    id: row.id,
    slotId: row.slot_id,
    status: row.status,
    cancelReason: row.cancel_reason,
    cancelNote: row.cancel_note ?? null,
    direction: row.to_user_id === actorId ? "incoming" : "outgoing",
    otherId,
    otherName: await displayName(tx, otherId),
    startsAt: new Date(slot.starts_at).toISOString(),
    endsAt: new Date(slot.ends_at).toISOString(),
    place: slot.place,
  };
}

async function loadRequest(tx, requestId) {
  const [row] = await tx`SELECT * FROM sampo_requests WHERE id = ${requestId} FOR UPDATE`;
  if (!row) fail(404, "NOT_FOUND", "Запрос не найден");
  return row;
}

function ensureParticipant(row, actorId) {
  if (row.from_user_id !== actorId && row.to_user_id !== actorId) fail(403, "FORBIDDEN", "Недостаточно прав");
}

async function releasePairVisit(tx, slotId, userA, userB) {
  await tx`DELETE FROM attendances WHERE slot_id = ${slotId} AND user_id IN ${tx([userA, userB])}`;
  await tx`DELETE FROM availability_exceptions WHERE slot_id = ${slotId} AND user_id IN ${tx([userA, userB])}`;
  await tx`
    INSERT INTO availabilities (user_id, slot_id)
    VALUES (${userA}, ${slotId}), (${userB}, ${slotId})
    ON CONFLICT DO NOTHING
  `;
}

async function conflicting(tx, userId, slot) {
  const [attendance] = await tx`
    SELECT 1 FROM attendances a
    JOIN slots s ON s.id = a.slot_id
    WHERE a.user_id = ${userId} AND s.id <> ${slot.id}
      AND s.starts_at < ${slot.endsAt} AND s.ends_at > ${slot.startsAt}
  `;
  if (attendance) return "attendance";
  const [pair] = await tx`
    SELECT 1 FROM pairs p
    JOIN slots s ON s.id = p.slot_id
    WHERE p.status = 'confirmed'
      AND (p.user_low_id = ${userId} OR p.user_high_id = ${userId})
      AND s.starts_at < ${slot.endsAt} AND s.ends_at > ${slot.startsAt}
  `;
  return pair ? "pair" : null;
}

function availabilityState(windows, explicit, blockedByException, slot) {
  if (explicit) return { open: true, source: "explicit", label: null, unavailable: false };
  const match = resolvedOpen(windows, slot.startsAt, slot.endsAt);
  if (blockedByException) return { open: false, source: null, label: match ? windowLabel(match) : null, unavailable: false };
  if (!match) return { open: false, source: null, label: null, unavailable: false };
  return { open: true, source: "window", label: windowLabel(match), unavailable: false };
}

async function availabilityOf(tx, userId, slot) {
  const [exception] = await tx`SELECT 1 FROM availability_exceptions WHERE user_id = ${userId} AND slot_id = ${slot.id}`;
  const [mark] = await tx`SELECT 1 FROM availabilities WHERE user_id = ${userId} AND slot_id = ${slot.id}`;
  const windows = await loadWindows(tx, userId);
  const state = availabilityState(windows, Boolean(mark), Boolean(exception), slot);
  return { open: state.open, source: state.source, label: state.label };
}

function canInvite(slot, conflict, availability) {
  return slot.status === "open" && slot.startsAt > new Date() && !conflict && availability.open;
}

async function comingAlone(tx, userId, slotId) {
  const [row] = await tx`
    SELECT 1 FROM attendances a
    WHERE a.user_id = ${userId} AND a.slot_id = ${slotId} AND a.guests = 0
      AND NOT EXISTS (
        SELECT 1 FROM pairs p
        WHERE p.slot_id = a.slot_id AND p.status = 'confirmed'
          AND (p.user_low_id = a.user_id OR p.user_high_id = a.user_id)
      )
  `;
  return Boolean(row);
}

async function seatsTaken(tx, slotId) {
  const [{ count }] = await tx`
    SELECT coalesce(sum(1 + guests), 0)::int AS count FROM attendances WHERE slot_id = ${slotId}
  `;
  return count;
}

export async function attend(sql, userId, slotId, withPartner = false) {
  const guests = withPartner ? 1 : 0;
  return sql.begin(async (tx) => {
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${slotId} FOR UPDATE`;
    if (!raw) fail(404, "NOT_FOUND", "Слот не найден");
    const slot = slotOf(raw);
    if (slot.status !== "open") fail(409, "SLOT_NOT_OPEN", "Слот уже отменён");
    if (slot.startsAt <= new Date()) fail(409, "SLOT_STARTED", "Слот уже начался");
    const [existing] = await tx`SELECT guests FROM attendances WHERE user_id = ${userId} AND slot_id = ${slotId}`;
    if (existing) {
      if (existing.guests !== guests) {
        const next = (await seatsTaken(tx, slotId)) - existing.guests + guests;
        if (next > slot.capacity) fail(409, "CAPACITY", "Свободных мест нет");
        await tx`UPDATE attendances SET guests = ${guests} WHERE user_id = ${userId} AND slot_id = ${slotId}`;
      }
    } else {
      if ((await conflicting(tx, userId, slot)) === "attendance") fail(409, "CONFLICT", "Это время уже занято");
      if ((await seatsTaken(tx, slotId)) + 1 + guests > slot.capacity) fail(409, "CAPACITY", "Свободных мест нет");
      await tx`INSERT INTO attendances (user_id, slot_id, guests) VALUES (${userId}, ${slotId}, ${guests})`;
    }
    await withdrawSent(tx, userId, slot);
    return { ok: true };
  });
}

async function withdrawSent(tx, userId, slot) {
  const rows = await tx`
    SELECT r.* FROM sampo_requests r
    JOIN slots s ON s.id = r.slot_id
    WHERE r.from_user_id = ${userId} AND r.status = 'pending'
      AND s.starts_at < ${slot.endsAt} AND s.ends_at > ${slot.startsAt}
    FOR UPDATE OF r
  `;
  if (!rows.length) return;
  const name = await displayName(tx, userId);
  for (const row of rows) {
    await closeRequest(tx, row, "cancelled", "withdrawn");
    const [target] = await tx`SELECT starts_at FROM slots WHERE id = ${row.slot_id}`;
    await notify(tx, row.to_user_id, "request_withdrawn", {
      text: `${name} отозвал запрос на сампо ${formatWhen(target.starts_at)}`,
      requestId: row.id,
      slotId: row.slot_id,
      name,
      startsAt: new Date(target.starts_at).toISOString(),
    });
  }
}

export async function leave(sql, userId, slotId) {
  return sql.begin(async (tx) => {
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${slotId} FOR UPDATE`;
    if (!raw) fail(404, "NOT_FOUND", "Слот не найден");
    const slot = slotOf(raw);
    if (slot.startsAt <= new Date()) fail(409, "SLOT_STARTED", "Слот уже начался");
    const [pair] = await tx`
      SELECT 1 FROM pairs
      WHERE slot_id = ${slotId} AND status = 'confirmed'
        AND (user_low_id = ${userId} OR user_high_id = ${userId})
    `;
    if (pair) fail(409, "PAIR_ACTIVE", "Сначала отмените пару");
    await tx`DELETE FROM attendances WHERE user_id = ${userId} AND slot_id = ${slotId}`;
    return { ok: true };
  });
}

export async function setAvailability(sql, userId, slotId, open) {
  return sql.begin(async (tx) => {
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${slotId} FOR UPDATE`;
    if (!raw) fail(404, "NOT_FOUND", "Слот не найден");
    const slot = slotOf(raw);
    if (open) {
      if (slot.status !== "open" || slot.startsAt <= new Date()) {
        fail(409, "NOT_AVAILABLE", "На этот слот нельзя отметиться свободным");
      }
      if (await conflicting(tx, userId, slot)) fail(409, "NOT_AVAILABLE", "Сейчас вас нельзя пригласить на этот слот");
      await tx`DELETE FROM availability_exceptions WHERE user_id = ${userId} AND slot_id = ${slotId}`;
      await tx`
        INSERT INTO availabilities (user_id, slot_id) VALUES (${userId}, ${slotId})
        ON CONFLICT DO NOTHING
      `;
      await placeFreeOnceIn(tx, userId, slot.startsAt, slot.endsAt);
    } else {
      await tx`DELETE FROM availabilities WHERE user_id = ${userId} AND slot_id = ${slotId}`;
      await carveFreeIn(tx, userId, slot.startsAt, slot.endsAt);
      await tx`
        INSERT INTO availability_exceptions (user_id, slot_id) VALUES (${userId}, ${slotId})
        ON CONFLICT DO NOTHING
      `;
    }
    return { ok: true };
  });
}

function localSpan(body) {
  if (!/^\d{2}:\d{2}$/.test(body?.localStart ?? "") || !/^\d{2}:\d{2}$/.test(body?.localEnd ?? "")) return null;
  const start = clockMinutes(body.localStart);
  const end = clockMinutes(body.localEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return end - start;
}

function parseAnchorDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return value;
}

const STEP_MS = 30 * 60 * 1000;

function coversWeekday(pattern, weekday) {
  if (pattern.kind === "daily") return true;
  if (pattern.kind === "weekdays") return weekday >= 1 && weekday <= 5;
  if (pattern.kind === "weekends") return weekday >= 6;
  if (pattern.kind === "weekly") return Number(pattern.weekday) === weekday;
  return false;
}

function weekdayOfKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function addDays(dayKey, days) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const monthText = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dayText = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${monthText}-${dayText}`;
}

function patternHitsDay(pattern, dayKey, weekday) {
  if (pattern.kind === "interval") {
    const anchor = anchorKey(pattern.anchorDate);
    const step = Number(pattern.intervalDays);
    if (!anchor || !Number.isInteger(step) || step < 1) return false;
    const span = daySpan(anchor, dayKey);
    return span >= 0 && span % step === 0;
  }
  return coversWeekday(pattern, weekday);
}

function oncePattern(row) {
  const start = studioParts(new Date(row.starts_at));
  const end = studioParts(new Date(row.ends_at));
  const startMin = start.hour * 60 + start.minute;
  let endMin = end.hour * 60 + end.minute;
  if (endMin <= startMin) endMin = 24 * 60;
  return { startMin, endMin, kind: "weekly", weekday: studioWeekday(new Date(row.starts_at)) };
}

function freePattern(row) {
  if (row.kind === "once") return oncePattern(row);
  return {
    startMin: clockMinutes(row.local_start),
    endMin: clockMinutes(row.local_end),
    kind: row.kind,
    weekday: row.weekday,
    intervalDays: row.interval_days,
    anchorDate: anchorKey(row.anchor_date),
  };
}

function studioStamp(dayKey, minutes) {
  if (minutes >= 24 * 60) {
    const [year, month, day] = dayKey.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const monthText = String(next.getUTCMonth() + 1).padStart(2, "0");
    const dayText = String(next.getUTCDate()).padStart(2, "0");
    return parseStudioLocal(`${next.getUTCFullYear()}-${monthText}-${dayText}T00:00`);
  }
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return parseStudioLocal(`${dayKey}T${hour}:${minute}`);
}

async function loadWindows(db, userId) {
  return db`
    SELECT w.*,
      COALESCE(
        (SELECT array_agg(s.studio_date ORDER BY s.studio_date) FROM availability_window_skips s WHERE s.window_id = w.id),
        ARRAY[]::date[]
      ) AS skip_dates
    FROM availability_windows w
    WHERE w.user_id = ${userId}
    ORDER BY w.created_at
  `;
}

function sameClock(left, right) {
  return left.startMin != null && right.startMin != null && left.startMin < right.endMin && right.startMin < left.endMin;
}

async function releaseCoveredOnce(tx, userId, next, ignoreId = null) {
  const windows = await tx`
    SELECT * FROM availability_windows
    WHERE user_id = ${userId} AND blocked = false AND kind = 'once'
    FOR UPDATE
  `;
  const startMin = clockMinutes(next.localStart);
  const endMin = clockMinutes(next.localEnd);
  for (const row of windows) {
    if (row.id === ignoreId) continue;
    const local = oncePattern(row);
    if (!sameClock(local, { startMin, endMin })) continue;
    const dayKey = studioDayKey(new Date(row.starts_at));
    if (!patternHitsDay(next, dayKey, local.weekday)) continue;
    await tx`DELETE FROM availability_windows WHERE id = ${row.id}`;
    const pieces = [];
    if (local.startMin < startMin && startMin - local.startMin >= 30) pieces.push([local.startMin, startMin]);
    if (endMin < local.endMin && local.endMin - endMin >= 30) pieces.push([endMin, local.endMin]);
    for (const [from, to] of pieces) {
      const startsAt = studioStamp(dayKey, from);
      const endsAt = studioStamp(dayKey, to);
      if (!startsAt || !endsAt) continue;
      const [{ count }] = await tx`SELECT count(*)::int AS count FROM availability_windows WHERE user_id = ${userId}`;
      if (count >= 30) fail(400, "VALIDATION", "Не больше 30 окон");
      await tx`
        INSERT INTO availability_windows (id, user_id, kind, starts_at, ends_at, blocked, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'once', ${startsAt}, ${endsAt}, false, ${row.created_at})
      `;
    }
  }
}

function clockContained(outer, inner) {
  return Number.isInteger(inner.startMin) && Number.isInteger(outer.startMin) && inner.startMin >= outer.startMin && inner.endMin <= outer.endMin;
}

function intervalContainsInterval(outer, inner) {
  const outerAnchor = anchorKey(outer.anchorDate);
  const innerAnchor = anchorKey(inner.anchorDate);
  const outerStep = Number(outer.intervalDays);
  const innerStep = Number(inner.intervalDays);
  if (!outerAnchor || !innerAnchor || !Number.isInteger(outerStep) || !Number.isInteger(innerStep) || outerStep < 1 || innerStep < 1) return false;
  if (innerStep % outerStep !== 0) return false;
  const span = daySpan(outerAnchor, innerAnchor);
  return span >= 0 && span % outerStep === 0;
}

function intervalStaysInside(interval, covers) {
  const anchor = anchorKey(interval.anchorDate);
  const step = Number(interval.intervalDays);
  if (!anchor || !Number.isInteger(step) || step < 1) return false;
  for (let index = 0; index < 7; index += 1) {
    if (!covers(weekdayOfKey(addDays(anchor, index * step)))) return false;
  }
  return true;
}

function patternContainsDays(outer, inner) {
  if (outer.kind === "daily") return true;
  if (inner.kind === "daily") return false;
  if (inner.kind === "weekdays") return outer.kind === "weekdays";
  if (inner.kind === "weekends") return outer.kind === "weekends";
  if (inner.kind === "weekly") {
    const weekday = Number(inner.weekday);
    if (outer.kind === "weekly") return Number(outer.weekday) === weekday;
    if (outer.kind === "weekdays") return weekday >= 1 && weekday <= 5;
    if (outer.kind === "weekends") return weekday >= 6;
    return false;
  }
  if (inner.kind === "interval") {
    if (outer.kind === "interval") return intervalContainsInterval(outer, inner);
    return intervalStaysInside(inner, (weekday) => coversWeekday(outer, weekday));
  }
  return false;
}

async function absorbContainedWindows(tx, userId, next, ignoreId = null) {
  const windows = await loadWindows(tx, userId);
  const outer = {
    startMin: clockMinutes(next.localStart),
    endMin: clockMinutes(next.localEnd),
    kind: next.kind,
    weekday: Number(next.weekday),
    intervalDays: Number(next.intervalDays),
    anchorDate: next.anchorDate,
  };
  for (const row of windows) {
    if (row.blocked || row.kind === "once" || row.id === ignoreId) continue;
    const inner = freePattern(row);
    if (!clockContained(outer, inner) || !patternContainsDays(outer, inner)) continue;
    await tx`DELETE FROM availability_windows WHERE id = ${row.id}`;
  }
}

function clocksJoin(left, right) {
  return left.startMin <= right.endMin && right.startMin <= left.endMin;
}

function sameOccurrence(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "weekly") return Number(left.weekday) === Number(right.weekday);
  if (left.kind === "interval") {
    const step = Number(left.intervalDays);
    const other = Number(right.intervalDays);
    const from = anchorKey(left.anchorDate);
    const to = anchorKey(right.anchorDate);
    if (step !== other || step < 1 || !from || !to) return false;
    return daySpan(from, to) % step === 0;
  }
  return left.kind === "daily" || left.kind === "weekdays" || left.kind === "weekends";
}

function earlierAnchor(left, right) {
  const from = anchorKey(left);
  const to = anchorKey(right);
  if (!from) return to;
  if (!to) return from;
  return daySpan(from, to) >= 0 ? from : to;
}

async function mergeSamePattern(tx, userId, pattern, ignoreId = null) {
  const windows = await loadWindows(tx, userId);
  let startMin = clockMinutes(pattern.localStart);
  let endMin = clockMinutes(pattern.localEnd);
  let anchorDate = pattern.anchorDate;
  const taken = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of windows) {
      if (row.blocked || row.kind === "once" || row.id === ignoreId || taken.includes(row.id)) continue;
      const inner = freePattern(row);
      const outer = {
        startMin,
        endMin,
        kind: pattern.kind,
        weekday: Number(pattern.weekday),
        intervalDays: Number(pattern.intervalDays),
        anchorDate,
      };
      if (!sameOccurrence(outer, inner) || !clocksJoin(outer, inner)) continue;
      if (inner.startMin < startMin || inner.endMin > endMin) grew = true;
      startMin = Math.min(startMin, inner.startMin);
      endMin = Math.max(endMin, inner.endMin);
      if (pattern.kind === "interval") anchorDate = earlierAnchor(anchorDate, inner.anchorDate);
      taken.push(row.id);
    }
  }
  for (const id of taken) await tx`DELETE FROM availability_windows WHERE id = ${id}`;
  return { ...pattern, localStart: clockLabel(startMin), localEnd: clockLabel(endMin), anchorDate };
}

function layerStamp(row) {
  const time = new Date(row.created_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function newerLayer(left, right) {
  const delta = layerStamp(left) - layerStamp(right);
  if (delta !== 0) return delta > 0;
  return String(left.id) > String(right.id);
}

function patternOnDay(row, dayKey) {
  if (skipDatesOf(row).includes(dayKey)) return false;
  if (row.kind === "once") return studioDayKey(new Date(row.starts_at)) === dayKey;
  if (row.kind === "weekly") return weekdayOfKey(dayKey) === row.weekday;
  if (row.kind === "daily") return true;
  if (row.kind === "weekdays") {
    const weekday = weekdayOfKey(dayKey);
    return weekday >= 1 && weekday <= 5;
  }
  if (row.kind === "weekends") {
    const weekday = weekdayOfKey(dayKey);
    return weekday === 6 || weekday === 7;
  }
  if (row.kind === "interval") {
    return patternHitsDay(
      { kind: "interval", intervalDays: row.interval_days, anchorDate: row.anchor_date },
      dayKey,
      weekdayOfKey(dayKey),
    );
  }
  return false;
}

function coversInstant(row, instant) {
  if (row.kind === "once") {
    const time = instant.getTime();
    return new Date(row.starts_at).getTime() <= time && time < new Date(row.ends_at).getTime();
  }
  const dayKey = studioDayKey(instant);
  if (!patternOnDay(row, dayKey) || !row.local_start || !row.local_end) return false;
  const minutes = studioParts(instant).hour * 60 + studioParts(instant).minute;
  return minutes >= clockMinutes(row.local_start) && minutes < clockMinutes(row.local_end);
}

function pushEdge(edges, startMs, endMs, edge) {
  if (edge > startMs && edge < endMs) edges.push(edge);
}

function edgesInRange(row, startMs, endMs) {
  const edges = [];
  if (row.kind === "once") {
    pushEdge(edges, startMs, endMs, new Date(row.starts_at).getTime());
    pushEdge(edges, startMs, endMs, new Date(row.ends_at).getTime());
    return edges;
  }
  if (!row.local_start || !row.local_end) return edges;
  let day = studioDayKey(new Date(startMs));
  const last = studioDayKey(new Date(endMs - 1));
  while (day <= last) {
    if (patternOnDay(row, day)) {
      const from = studioStamp(day, clockMinutes(row.local_start));
      const to = studioStamp(day, clockMinutes(row.local_end));
      if (from) pushEdge(edges, startMs, endMs, from.getTime());
      if (to) pushEdge(edges, startMs, endMs, to.getTime());
    }
    day = addDays(day, 1);
  }
  return edges;
}

function rangePoints(windows, startMs, endMs) {
  const points = [startMs, endMs];
  for (const row of windows) points.push(...edgesInRange(row, startMs, endMs));
  points.sort((left, right) => left - right);
  return points;
}

function newestCovering(windows, instant) {
  let best = null;
  for (const row of windows) {
    if (!coversInstant(row, instant)) continue;
    if (!best || newerLayer(row, best)) best = row;
  }
  return best;
}

function resolvedOpen(windows, rangeStart, rangeEnd) {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  if (!(endMs > startMs)) return null;
  let previous = null;
  for (const point of rangePoints(windows, startMs, endMs)) {
    if (previous != null && point > previous) {
      const winner = newestCovering(windows, new Date(previous + (point - previous) / 2));
      if (winner && !winner.blocked) return winner;
    }
    previous = point;
  }
  return null;
}

function fullyResolvedFree(windows, rangeStart, rangeEnd) {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  if (!(endMs > startMs)) return false;
  let previous = null;
  let saw = false;
  for (const point of rangePoints(windows, startMs, endMs)) {
    if (previous != null && point > previous) {
      saw = true;
      const winner = newestCovering(windows, new Date(previous + (point - previous) / 2));
      if (!winner || winner.blocked) return false;
    }
    previous = point;
  }
  return saw;
}

function coveredByFree(windows, start, end) {
  return fullyResolvedFree(windows, start, end);
}

function blockHits(blocks, startMs, endMs) {
  return blocks.some((row) => new Date(row.starts_at).getTime() < endMs && startMs < new Date(row.ends_at).getTime());
}

async function deleteContainedBlocks(tx, userId, startsAt, endsAt, keepId = null) {
  const blocks = await tx`
    SELECT id, starts_at, ends_at FROM availability_windows
    WHERE user_id = ${userId} AND blocked = true
  `;
  for (const block of blocks) {
    if (block.id === keepId) continue;
    const from = new Date(block.starts_at).getTime();
    const to = new Date(block.ends_at).getTime();
    if (startsAt.getTime() <= from && to <= endsAt.getTime()) await tx`DELETE FROM availability_windows WHERE id = ${block.id}`;
  }
}

async function deleteBlocksUnder(tx, userId, row) {
  const blocks = await tx`SELECT * FROM availability_windows WHERE user_id = ${userId} AND blocked = true`;
  for (const block of blocks) {
    if (!newerLayer(row, block)) continue;
    if (!fullyResolvedFree([row], new Date(block.starts_at), new Date(block.ends_at))) continue;
    await tx`DELETE FROM availability_windows WHERE id = ${block.id}`;
  }
}

async function pruneBlocks(tx, userId) {
  const windows = await loadWindows(tx, userId);
  for (const block of windows) {
    if (!block.blocked) continue;
    const older = windows.filter((row) => row.id !== block.id && !row.blocked && newerLayer(block, row));
    if (resolvedOpen(older, new Date(block.starts_at), new Date(block.ends_at))) continue;
    await tx`DELETE FROM availability_windows WHERE id = ${block.id}`;
  }
}

function openSteps(windows, startsAt, endsAt) {
  const steps = [];
  for (let time = startsAt.getTime(); time + STEP_MS <= endsAt.getTime(); time += STEP_MS) {
    const start = new Date(time);
    const end = new Date(time + STEP_MS);
    if (!coveredByFree(windows, start, end)) steps.push({ start, end });
  }
  const spans = [];
  for (const step of steps) {
    const last = spans[spans.length - 1];
    if (last && last.end.getTime() === step.start.getTime()) last.end = step.end;
    else spans.push({ start: step.start, end: step.end });
  }
  return spans;
}

async function insertFreeOnce(tx, userId, startMs, endMs, createdAt = null) {
  const duration = endMs - startMs;
  if (duration < STEP_MS || duration > 15 * 60 * 60 * 1000) {
    fail(400, "VALIDATION", "Длительность окна от 30 минут до 15 часов");
  }
  const [{ count }] = await tx`SELECT count(*)::int AS count FROM availability_windows WHERE user_id = ${userId}`;
  if (count >= 30) fail(400, "VALIDATION", "Не больше 30 окон");
  const [row] = createdAt
    ? await tx`
        INSERT INTO availability_windows (id, user_id, kind, starts_at, ends_at, blocked, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'once', ${new Date(startMs)}, ${new Date(endMs)}, false, ${createdAt})
        RETURNING *
      `
    : await tx`
        INSERT INTO availability_windows (id, user_id, kind, starts_at, ends_at, blocked, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'once', ${new Date(startMs)}, ${new Date(endMs)}, false, clock_timestamp())
        RETURNING *
      `;
  return row;
}

function onceSpan(row) {
  return { start: new Date(row.starts_at).getTime(), end: new Date(row.ends_at).getTime() };
}

async function joinClearOnces(tx, userId, startsAt, endsAt) {
  const windows = await loadWindows(tx, userId);
  const dayKey = studioDayKey(startsAt);
  const blocks = windows.filter((row) => row.blocked);
  const onces = windows.filter((row) => !row.blocked && row.kind === "once" && studioDayKey(new Date(row.starts_at)) === dayKey);
  let start = startsAt.getTime();
  let end = endsAt.getTime();
  const taken = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of onces) {
      if (taken.includes(row.id)) continue;
      const span = onceSpan(row);
      if (!(span.start <= end && start <= span.end)) continue;
      const nextStart = Math.min(start, span.start);
      const nextEnd = Math.max(end, span.end);
      if (blockHits(blocks, nextStart, nextEnd)) continue;
      if (span.start < start || span.end > end) grew = true;
      start = nextStart;
      end = nextEnd;
      taken.push(row.id);
    }
  }
  if (taken.length === 1) {
    const row = onces.find((item) => item.id === taken[0]);
    const span = onceSpan(row);
    if (span.start === start && span.end === end) return publicWindow(row);
    const [updated] = await tx`
      UPDATE availability_windows
      SET starts_at = ${new Date(start)}, ends_at = ${new Date(end)}
      WHERE id = ${row.id}
      RETURNING *
    `;
    return publicWindow(updated);
  }
  if (taken.length > 1) {
    const rows = onces.filter((row) => taken.includes(row.id));
    const earliest = rows.reduce((best, row) => (!best || layerStamp(row) < layerStamp(best) ? row : best), null);
    for (const id of taken) await tx`DELETE FROM availability_windows WHERE id = ${id}`;
    return publicWindow(await insertFreeOnce(tx, userId, start, end, earliest.created_at));
  }
  const cover = resolvedOpen(windows, startsAt, endsAt);
  return cover ? publicWindow(cover) : null;
}

async function restoreCoveredSkips(tx, userId, dayKey) {
  const windows = await loadWindows(tx, userId);
  for (const row of windows) {
    if (row.blocked || row.kind === "once" || !skipDatesOf(row).includes(dayKey)) continue;
    const startMin = clockMinutes(row.local_start);
    const endMin = clockMinutes(row.local_end);
    const startsAt = studioStamp(dayKey, startMin);
    const endsAt = studioStamp(dayKey, endMin);
    if (!startsAt || !endsAt) continue;
    const others = windows.filter((item) => item.id !== row.id);
    if (openSteps(others, startsAt, endsAt).length) continue;
    await tx`DELETE FROM availability_window_skips WHERE window_id = ${row.id} AND studio_date = ${dayKey}`;
    for (const other of others) {
      if (other.blocked || other.kind !== "once" || studioDayKey(new Date(other.starts_at)) !== dayKey) continue;
      const local = oncePattern(other);
      if (local.startMin < startMin || local.endMin > endMin) continue;
      await tx`DELETE FROM availability_windows WHERE id = ${other.id}`;
    }
  }
}

async function placeFreeOnceIn(tx, userId, startsAt, endsAt) {
  const dayKey = studioDayKey(startsAt);
  const windows = await loadWindows(tx, userId);
  if (fullyResolvedFree(windows, startsAt, endsAt)) {
    const joined = await joinClearOnces(tx, userId, startsAt, endsAt);
    await restoreCoveredSkips(tx, userId, dayKey);
    return joined;
  }
  const created = await insertFreeOnce(tx, userId, startsAt.getTime(), endsAt.getTime());
  await deleteContainedBlocks(tx, userId, startsAt, endsAt);
  const others = (await loadWindows(tx, userId)).filter((row) => row.id !== created.id);
  if (fullyResolvedFree(others, startsAt, endsAt)) {
    await tx`DELETE FROM availability_windows WHERE id = ${created.id}`;
    const cover = await joinClearOnces(tx, userId, startsAt, endsAt);
    await pruneBlocks(tx, userId);
    await restoreCoveredSkips(tx, userId, dayKey);
    return cover;
  }
  const merged = await joinClearOnces(tx, userId, startsAt, endsAt);
  await pruneBlocks(tx, userId);
  await restoreCoveredSkips(tx, userId, dayKey);
  return merged ?? publicWindow(created);
}

async function placeFreeOnce(sql, userId, startsAt, endsAt) {
  return sql.begin((tx) => placeFreeOnceIn(tx, userId, startsAt, endsAt));
}

async function carveFreeIn(tx, userId, startsAt, endsAt) {
  const windows = await tx`SELECT * FROM availability_windows WHERE user_id = ${userId} FOR UPDATE`;
  if (!resolvedOpen(windows, startsAt, endsAt)) return { ok: true };
  const [{ count }] = await tx`SELECT count(*)::int AS count FROM availability_windows WHERE user_id = ${userId}`;
  if (count >= 30) fail(400, "VALIDATION", "Не больше 30 окон");
  const [created] = await tx`
    INSERT INTO availability_windows (id, user_id, kind, starts_at, ends_at, blocked, created_at)
    VALUES (${crypto.randomUUID()}, ${userId}, 'once', ${startsAt}, ${endsAt}, true, clock_timestamp())
    RETURNING *
  `;
  await deleteContainedBlocks(tx, userId, startsAt, endsAt, created.id);
  return { ok: true };
}

async function carveFree(sql, userId, startsAt, endsAt) {
  return sql.begin((tx) => carveFreeIn(tx, userId, startsAt, endsAt));
}

export async function createWindow(sql, userId, body) {
  const kind = body?.kind;
  const known = new Set(["once", "weekly", "daily", "weekdays", "weekends", "interval"]);
  if (!known.has(kind)) fail(400, "VALIDATION", "Укажите, как повторяется окно");
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM availability_windows WHERE user_id = ${userId}`;
  if (count >= 30 && (body?.blocked === true || kind !== "once")) fail(400, "VALIDATION", "Не больше 30 окон");
  const blocked = body?.blocked === true;
  if (kind === "once") {
    const startsAt = parseStudioLocal(body.startsAtLocal);
    const endsAt = parseStudioLocal(body.endsAtLocal);
    if (!startsAt || !endsAt) fail(400, "VALIDATION", "Укажите дату и время окна");
    const duration = endsAt.getTime() - startsAt.getTime();
    if (duration < 30 * 60 * 1000 || duration > 15 * 60 * 60 * 1000) {
      fail(400, "VALIDATION", "Длительность окна от 30 минут до 15 часов");
    }
    if (!endsOnSameStudioDay(startsAt, endsAt)) {
      fail(400, "VALIDATION", "Окно должно начаться и закончиться в один день по времени Тюмени");
    }
    if (rangeEndMinutes(startsAt, endsAt) > GRID_END_MINUTES) fail(400, "VALIDATION", "Окно можно отметить до 23:30");
    if (!blocked) return placeFreeOnce(sql, userId, startsAt, endsAt);
    return carveFree(sql, userId, startsAt, endsAt);
  }
  const duration = localSpan(body);
  if (duration == null) fail(400, "VALIDATION", "Укажите время окна");
  if (duration < 30) fail(400, "VALIDATION", "Повторяющееся окно — не короче 30 минут");
  if (clockMinutes(body.localEnd) > GRID_END_MINUTES) fail(400, "VALIDATION", "Повтор можно отметить до 23:30");
  const weekday = Number(body.weekday);
  if (kind === "weekly" && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
    fail(400, "VALIDATION", "Укажите день недели и время окна");
  }
  const intervalDays = Number(body.intervalDays);
  const anchorDate = parseAnchorDate(body.anchorDate);
  if (kind === "interval") {
    if (!Number.isInteger(intervalDays) || intervalDays < 2 || intervalDays > 30) {
      fail(400, "VALIDATION", "Интервал — от 2 до 30 дней");
    }
    if (!anchorDate) fail(400, "VALIDATION", "Укажите дату начала");
  }
  const pattern = {
    kind,
    localStart: body.localStart,
    localEnd: body.localEnd,
    weekday,
    intervalDays,
    anchorDate,
  };
  return sql.begin(async (tx) => {
    await releaseCoveredOnce(tx, userId, pattern);
    await absorbContainedWindows(tx, userId, pattern);
    const merged = await mergeSamePattern(tx, userId, pattern);
    let row;
    if (kind === "weekly") {
      [row] = await tx`
        INSERT INTO availability_windows (id, user_id, kind, weekday, local_start, local_end, blocked)
        VALUES (${crypto.randomUUID()}, ${userId}, 'weekly', ${weekday}, ${merged.localStart}, ${merged.localEnd}, false)
        RETURNING *
      `;
    } else if (kind === "interval") {
      [row] = await tx`
        INSERT INTO availability_windows (id, user_id, kind, local_start, local_end, interval_days, anchor_date, blocked)
        VALUES (${crypto.randomUUID()}, ${userId}, 'interval', ${merged.localStart}, ${merged.localEnd}, ${intervalDays}, ${merged.anchorDate}, false)
        RETURNING *
      `;
    } else {
      [row] = await tx`
        INSERT INTO availability_windows (id, user_id, kind, local_start, local_end, blocked)
        VALUES (${crypto.randomUUID()}, ${userId}, ${kind}, ${merged.localStart}, ${merged.localEnd}, false)
        RETURNING *
      `;
    }
    await deleteBlocksUnder(tx, userId, row);
    return publicWindow(row);
  });
}

function publicWindow(row) {
  return {
    id: row.id,
    kind: row.kind,
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    weekday: row.weekday,
    localStart: row.local_start ? String(row.local_start).slice(0, 5) : null,
    localEnd: row.local_end ? String(row.local_end).slice(0, 5) : null,
    intervalDays: row.interval_days ?? null,
    anchorDate: anchorKey(row.anchor_date),
    blocked: Boolean(row.blocked),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    skipDates: skipDatesOf(row),
    label: windowLabel(row),
  };
}

export async function listWindows(sql, userId) {
  const rows = await loadWindows(sql, userId);
  return rows.map(publicWindow);
}

function clockLabel(minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function occursOn(row, dayKey) {
  const startMin = clockMinutes(row.local_start);
  const endMin = clockMinutes(row.local_end);
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || endMin <= startMin) return false;
  const startsAt = parseStudioLocal(`${dayKey}T${clockLabel(startMin)}`);
  const endsAt = parseStudioLocal(`${dayKey}T${clockLabel(endMin)}`);
  if (!startsAt || !endsAt) return false;
  return windowMatches({ ...row, skip_dates: [] }, { startsAt, endsAt });
}

export async function updateWindow(sql, userId, windowId, body) {
  const kind = body?.kind;
  const known = new Set(["once", "weekly", "daily", "weekdays", "weekends", "interval"]);
  if (!known.has(kind)) fail(400, "VALIDATION", "Укажите, как повторяется окно");
  return sql.begin(async (tx) => {
    const [existing] = await tx`
      SELECT * FROM availability_windows WHERE id = ${windowId} AND user_id = ${userId} FOR UPDATE
    `;
    if (!existing) fail(404, "NOT_FOUND", "Окно не найдено");
    if (existing.blocked) fail(400, "VALIDATION", "Недоступный промежуток меняется новой отметкой");
    if (kind === "once") {
      const startsAt = parseStudioLocal(body.startsAtLocal);
      const endsAt = parseStudioLocal(body.endsAtLocal);
      if (!startsAt || !endsAt) fail(400, "VALIDATION", "Укажите дату и время окна");
      const duration = endsAt.getTime() - startsAt.getTime();
      if (duration < 30 * 60 * 1000 || duration > 15 * 60 * 60 * 1000) {
        fail(400, "VALIDATION", "Длительность окна от 30 минут до 15 часов");
      }
      if (!endsOnSameStudioDay(startsAt, endsAt)) {
        fail(400, "VALIDATION", "Окно должно начаться и закончиться в один день по времени Тюмени");
      }
      if (rangeEndMinutes(startsAt, endsAt) > GRID_END_MINUTES) fail(400, "VALIDATION", "Окно можно отметить до 23:30");
      await tx`DELETE FROM availability_windows WHERE id = ${windowId}`;
      return placeFreeOnceIn(tx, userId, startsAt, endsAt);
    }
    const duration = localSpan(body);
    if (duration == null) fail(400, "VALIDATION", "Укажите время окна");
    if (duration < 30) fail(400, "VALIDATION", "Повторяющееся окно — не короче 30 минут");
    if (clockMinutes(body.localEnd) > GRID_END_MINUTES) fail(400, "VALIDATION", "Повтор можно отметить до 23:30");
    const weekday = Number(body.weekday);
    if (kind === "weekly" && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
      fail(400, "VALIDATION", "Укажите день недели и время окна");
    }
    const intervalDays = Number(body.intervalDays);
    const anchorDate = parseAnchorDate(body.anchorDate);
    if (kind === "interval") {
      if (!Number.isInteger(intervalDays) || intervalDays < 2 || intervalDays > 30) {
        fail(400, "VALIDATION", "Интервал — от 2 до 30 дней");
      }
      if (!anchorDate) fail(400, "VALIDATION", "Укажите дату начала");
    }
    const pattern = {
      kind,
      localStart: body.localStart,
      localEnd: body.localEnd,
      weekday: body.weekday,
      intervalDays: body.intervalDays,
      anchorDate: body.anchorDate,
    };
    await releaseCoveredOnce(tx, userId, pattern, windowId);
    await absorbContainedWindows(tx, userId, pattern, windowId);
    const merged = await mergeSamePattern(tx, userId, pattern, windowId);
    const [row] = await tx`
      UPDATE availability_windows
      SET kind = ${kind},
          starts_at = NULL,
          ends_at = NULL,
          weekday = ${kind === "weekly" ? weekday : null},
          local_start = ${merged.localStart},
          local_end = ${merged.localEnd},
          interval_days = ${kind === "interval" ? intervalDays : null},
          anchor_date = ${kind === "interval" ? merged.anchorDate : null}
      WHERE id = ${windowId}
      RETURNING *
    `;
    await pruneBlocks(tx, userId);
    return publicWindow(row);
  });
}

export async function deleteWindow(sql, userId, windowId, scope = "series", dayKey = "") {
  const [row] = await sql`SELECT * FROM availability_windows WHERE id = ${windowId} AND user_id = ${userId}`;
  if (!row) fail(404, "NOT_FOUND", "Окно не найдено");
  if (scope !== "one" || row.kind === "once" || row.blocked) {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM availability_windows WHERE id = ${windowId} AND user_id = ${userId}`;
      await pruneBlocks(tx, userId);
    });
    return { ok: true };
  }
  const day = parseAnchorDate(dayKey);
  if (!day) fail(400, "VALIDATION", "Укажите день");
  const current = (await loadWindows(sql, userId)).find((item) => item.id === windowId);
  if (!current || !occursOn(current, day)) fail(400, "VALIDATION", "В этот день окно не повторяется");
  await sql`
    INSERT INTO availability_window_skips (window_id, studio_date)
    VALUES (${windowId}, ${day})
    ON CONFLICT DO NOTHING
  `;
  return { ok: true };
}

export async function createRequest(sql, actorId, slotId, toUserId) {
  if (actorId === toUserId) fail(400, "VALIDATION", "Нельзя пригласить себя");
  return sql.begin(async (tx) => {
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${slotId} FOR UPDATE`;
    if (!raw) fail(404, "NOT_FOUND", "Слот не найден");
    const slot = slotOf(raw);
    if (slot.status !== "open") fail(409, "SLOT_NOT_OPEN", "Слот уже отменён");
    if (slot.startsAt <= new Date()) fail(409, "SLOT_STARTED", "Слот уже начался");
    const [actor] = await tx`SELECT app_role FROM users WHERE id = ${actorId}`;
    if (actor?.app_role === "admin") fail(403, "FORBIDDEN", "Администратор не участвует в приглашениях");
    const [target] = await tx`SELECT id, app_role FROM users WHERE id = ${toUserId}`;
    if (!target) fail(404, "NOT_FOUND", "Участник не найден");
    if (target.app_role === "admin") fail(409, "NOT_AVAILABLE", "Этого человека нельзя пригласить");
    if (await invitationDenied(tx, actorId, toUserId)) fail(403, "INVITE_BLOCKED", "Этот человек не принимает ваши приглашения");
    if (await comingAlone(tx, toUserId, slotId)) fail(409, "NOT_AVAILABLE", "Этот человек придёт один");
    const targetConflict = await conflicting(tx, toUserId, slot);
    const targetAvailability = await availabilityOf(tx, toUserId, slot);
    if (!canInvite(slot, targetConflict, targetAvailability)) fail(409, "NOT_AVAILABLE", "Этого человека нельзя пригласить");
    const actorConflict = await conflicting(tx, actorId, slot);
    if (actorConflict === "attendance") fail(409, "CONFLICT", "Это время уже занято");
    if (actorConflict === "pair") fail(409, "CONFLICT", "У вас уже есть пара на это время");
    const [chosen] = await tx`SELECT 1 FROM attendances WHERE user_id = ${actorId} AND slot_id = ${slotId}`;
    if (chosen) fail(409, "CONFLICT", "Сначала отмените выбор");
    const outgoing = await tx`
      SELECT s.starts_at, s.ends_at FROM sampo_requests r
      JOIN slots s ON s.id = r.slot_id
      WHERE r.from_user_id = ${actorId} AND r.status = 'pending' AND r.slot_id <> ${slotId}
    `;
    if (outgoing.some((row) => overlaps(row.starts_at, row.ends_at, slot.startsAt, slot.endsAt))) {
      fail(409, "CONFLICT", "Уже есть запрос на пересекающееся время");
    }
    const [duplicate] = await tx`
      SELECT 1 FROM sampo_requests
      WHERE slot_id = ${slotId} AND from_user_id = ${actorId} AND to_user_id = ${toUserId} AND status = 'pending'
    `;
    if (duplicate) fail(409, "REQUEST_EXISTS", "Такой запрос уже отправлен");
    const [{ count }] = await tx`
      SELECT count(*)::int AS count FROM sampo_requests
      WHERE from_user_id = ${actorId} AND created_at > now() - interval '1 hour'
    `;
    if (count >= 10) fail(429, "RATE_LIMIT", "Слишком много запросов, попробуйте позже");
    const id = crypto.randomUUID();
    const [row] = await tx`
      INSERT INTO sampo_requests (id, slot_id, from_user_id, to_user_id, status)
      VALUES (${id}, ${slotId}, ${actorId}, ${toUserId}, 'pending')
      RETURNING *
    `;
    const name = await displayName(tx, actorId);
    await notify(tx, toUserId, "request_received", {
      text: `У вас новое приглашение от ${name}`,
      requestId: id,
      slotId,
      name,
      place: slot.place,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    });
    return requestView(tx, row, actorId);
  });
}

async function closeRequest(tx, row, status, reason) {
  const [updated] = await tx`
    UPDATE sampo_requests
    SET status = ${status}, cancel_reason = ${reason}, responded_at = now()
    WHERE id = ${row.id}
    RETURNING *
  `;
  return updated;
}

export async function acceptRequest(sql, actorId, requestId) {
  return sql.begin(async (tx) => {
    const row = await loadRequest(tx, requestId);
    if (row.to_user_id !== actorId) fail(403, "FORBIDDEN", "Недостаточно прав");
    if (row.status !== "pending") return requestView(tx, row, actorId);
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${row.slot_id} FOR UPDATE`;
    const slot = slotOf(raw);
    if (slot.status !== "open") {
      const updated = await closeRequest(tx, row, "cancelled", "slot_cancelled");
      return requestView(tx, updated, actorId);
    }
    if (slot.startsAt <= new Date()) {
      const updated = await closeRequest(tx, row, "expired", null);
      const when = formatWhen(slot.startsAt);
      const text = `Запрос на сампо ${when} истёк`;
      await notify(tx, row.from_user_id, "request_expired", { text, requestId, slotId: slot.id, place: slot.place, startsAt: slot.startsAt.toISOString() });
      await notify(tx, row.to_user_id, "request_expired", { text, requestId, slotId: slot.id, place: slot.place, startsAt: slot.startsAt.toISOString() });
      return requestView(tx, updated, actorId);
    }
    const [low, high] = orderedPair(row.from_user_id, row.to_user_id);
    await tx`SELECT id FROM users WHERE id IN ${tx([low, high])} ORDER BY id FOR UPDATE`;
    if ((await conflicting(tx, row.from_user_id, slot)) || (await conflicting(tx, row.to_user_id, slot))) {
      fail(409, "CONFLICT", "Это время уже занято");
    }
    const existing = await tx`
      SELECT user_id FROM attendances WHERE slot_id = ${slot.id} AND user_id IN ${tx([row.from_user_id, row.to_user_id])}
    `;
    const have = new Set(existing.map((item) => item.user_id));
    const missing = [row.from_user_id, row.to_user_id].filter((id) => !have.has(id));
    if ((await seatsTaken(tx, slot.id)) + missing.length > slot.capacity) fail(409, "CAPACITY", "Свободных мест нет");
    for (const id of missing) {
      await tx`INSERT INTO attendances (user_id, slot_id) VALUES (${id}, ${slot.id})`;
    }
    const pairId = crypto.randomUUID();
    await tx`
      INSERT INTO pairs (id, slot_id, user_low_id, user_high_id, request_id, status)
      VALUES (${pairId}, ${slot.id}, ${low}, ${high}, ${row.id}, 'confirmed')
    `;
    const accepted = await closeRequest(tx, row, "accepted", null);
    await tx`DELETE FROM availabilities WHERE slot_id = ${slot.id} AND user_id IN ${tx([row.from_user_id, row.to_user_id])}`;
    await tx`
      INSERT INTO availability_exceptions (user_id, slot_id) VALUES (${row.from_user_id}, ${slot.id}), (${row.to_user_id}, ${slot.id})
      ON CONFLICT DO NOTHING
    `;
    await supersedeOthers(tx, row, slot);
    const accepter = await displayName(tx, row.to_user_id);
    await notify(tx, row.from_user_id, "request_accepted", {
      text: `${accepter} подтвердил сампо ${formatWhen(slot.startsAt)}, ${slot.place}`,
      requestId,
      slotId: slot.id,
      name: accepter,
      place: slot.place,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    });
    return requestView(tx, accepted, actorId);
  });
}

async function supersedeOthers(tx, accepted, slot) {
  const pair = new Set([accepted.from_user_id, accepted.to_user_id]);
  const others = await tx`
    SELECT * FROM sampo_requests
    WHERE status = 'pending' AND id <> ${accepted.id}
      AND (from_user_id IN ${tx([...pair])} OR to_user_id IN ${tx([...pair])})
    FOR UPDATE
  `;
  if (!others.length) return;
  const slotIds = [...new Set(others.map((item) => item.slot_id))];
  const slots = await tx`SELECT id, starts_at, ends_at, place FROM slots WHERE id IN ${tx(slotIds)}`;
  const byId = new Map(slots.map((item) => [item.id, item]));
  for (const item of others) {
    const otherSlot = byId.get(item.slot_id);
    if (!otherSlot || !overlaps(otherSlot.starts_at, otherSlot.ends_at, slot.startsAt, slot.endsAt)) continue;
    await closeRequest(tx, item, "cancelled", "superseded");
    const when = formatWhen(otherSlot.starts_at);
    const text = `Запрос на сампо ${when} снят: время уже занято`;
    const payload = {
      text,
      requestId: item.id,
      slotId: item.slot_id,
      place: otherSlot.place,
      startsAt: new Date(otherSlot.starts_at).toISOString(),
    };
    await notify(tx, item.from_user_id, "request_superseded", payload);
    await notify(tx, item.to_user_id, "request_superseded", payload);
  }
}

export async function declineRequest(sql, actorId, requestId) {
  return sql.begin(async (tx) => {
    const row = await loadRequest(tx, requestId);
    if (row.to_user_id !== actorId) fail(403, "FORBIDDEN", "Недостаточно прав");
    if (row.status !== "pending") return requestView(tx, row, actorId);
    const updated = await closeRequest(tx, row, "declined", null);
    return requestView(tx, updated, actorId);
  });
}

export async function withdrawRequest(sql, actorId, requestId) {
  return sql.begin(async (tx) => {
    const row = await loadRequest(tx, requestId);
    if (row.from_user_id !== actorId) fail(403, "FORBIDDEN", "Недостаточно прав");
    if (row.status !== "pending") return requestView(tx, row, actorId);
    const updated = await closeRequest(tx, row, "cancelled", "withdrawn");
    const [slot] = await tx`SELECT * FROM slots WHERE id = ${row.slot_id}`;
    const name = await displayName(tx, actorId);
    await notify(tx, row.to_user_id, "request_withdrawn", {
      text: `${name} отозвал запрос на сампо ${formatWhen(slot.starts_at)}`,
      requestId,
      slotId: slot.id,
      name,
      startsAt: new Date(slot.starts_at).toISOString(),
    });
    return requestView(tx, updated, actorId);
  });
}

export async function cancelAcceptedRequest(sql, actorId, requestId, reason) {
  const note = typeof reason === "string" ? reason.trim() : "";
  if (note.length > 300) fail(400, "VALIDATION", "Причина не длиннее 300 символов");
  const stored = note || null;
  return sql.begin(async (tx) => {
    const row = await loadRequest(tx, requestId);
    ensureParticipant(row, actorId);
    if (row.status !== "accepted") return requestView(tx, row, actorId);
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${row.slot_id} FOR UPDATE`;
    const slot = slotOf(raw);
    if (slot.startsAt <= new Date()) fail(409, "SLOT_STARTED", "Нельзя отменить после начала слота");
    const [pair] = await tx`SELECT * FROM pairs WHERE request_id = ${row.id} AND status = 'confirmed' FOR UPDATE`;
    if (pair) await tx`UPDATE pairs SET status = 'cancelled', cancelled_at = now() WHERE id = ${pair.id}`;
    await releasePairVisit(tx, slot.id, row.from_user_id, row.to_user_id);
    const [updated] = await tx`
      UPDATE sampo_requests
      SET status = 'cancelled', cancel_reason = 'partner_cancelled', cancel_note = ${stored}, responded_at = now()
      WHERE id = ${row.id}
      RETURNING *
    `;
    const otherId = row.from_user_id === actorId ? row.to_user_id : row.from_user_id;
    const name = await displayName(tx, actorId);
    await notify(tx, otherId, "pair_cancelled", {
      text: `${name} отменил ваше сампо`,
      requestId: row.id,
      pairId: pair?.id ?? null,
      slotId: slot.id,
      name,
      place: slot.place,
      reason: stored,
      startsAt: slot.startsAt.toISOString(),
    });
    return requestView(tx, updated, actorId);
  });
}

export async function cancelPair(sql, actorId, pairId) {
  return sql.begin(async (tx) => {
    const [pair] = await tx`SELECT * FROM pairs WHERE id = ${pairId} FOR UPDATE`;
    if (!pair) fail(404, "NOT_FOUND", "Пара не найдена");
    if (pair.user_low_id !== actorId && pair.user_high_id !== actorId) fail(403, "FORBIDDEN", "Недостаточно прав");
    if (pair.status !== "confirmed") return { ok: true };
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${pair.slot_id} FOR UPDATE`;
    const slot = slotOf(raw);
    if (slot.startsAt <= new Date()) fail(409, "SLOT_STARTED", "Нельзя отменить пару после начала слота");
    await tx`UPDATE pairs SET status = 'cancelled', cancelled_at = now() WHERE id = ${pairId}`;
    await tx`
      UPDATE sampo_requests
      SET status = 'cancelled', cancel_reason = 'partner_cancelled', responded_at = now()
      WHERE id = ${pair.request_id} AND status = 'accepted'
    `;
    await releasePairVisit(tx, slot.id, pair.user_low_id, pair.user_high_id);
    const otherId = pair.user_low_id === actorId ? pair.user_high_id : pair.user_low_id;
    const name = await displayName(tx, actorId);
    await notify(tx, otherId, "pair_cancelled", {
      text: `${name} отменил ваше сампо`,
      pairId,
      slotId: slot.id,
      name,
      place: slot.place,
      startsAt: slot.startsAt.toISOString(),
    });
    return { ok: true };
  });
}

export async function cancelSlot(sql, slotId) {
  return sql.begin(async (tx) => {
    const [raw] = await tx`SELECT * FROM slots WHERE id = ${slotId} FOR UPDATE`;
    if (!raw) fail(404, "NOT_FOUND", "Слот не найден");
    const slot = slotOf(raw);
    if (slot.status === "cancelled") return { ok: true };
    if (slot.startsAt <= new Date()) fail(409, "SLOT_STARTED", "Нельзя отменить начавшийся слот");
    const attendances = await tx`SELECT user_id FROM attendances WHERE slot_id = ${slotId}`;
    const pending = await tx`SELECT from_user_id, to_user_id FROM sampo_requests WHERE slot_id = ${slotId} AND status = 'pending'`;
    const recipients = new Set([
      ...attendances.map((row) => row.user_id),
      ...pending.flatMap((row) => [row.from_user_id, row.to_user_id]),
    ]);
    await tx`UPDATE pairs SET status = 'cancelled', cancelled_at = now() WHERE slot_id = ${slotId} AND status = 'confirmed'`;
    await tx`
      UPDATE sampo_requests
      SET status = 'cancelled', cancel_reason = 'slot_cancelled', responded_at = now()
      WHERE slot_id = ${slotId} AND status = 'pending'
    `;
    await tx`DELETE FROM attendances WHERE slot_id = ${slotId}`;
    await tx`DELETE FROM availabilities WHERE slot_id = ${slotId}`;
    await tx`DELETE FROM availability_exceptions WHERE slot_id = ${slotId}`;
    await tx`UPDATE slots SET status = 'cancelled' WHERE id = ${slotId}`;
    const text = `Сампо ${formatWhen(slot.startsAt)}, ${slot.place} отменено студией`;
    for (const userId of recipients) {
      await notify(tx, userId, "slot_cancelled", {
        text,
        slotId,
        place: slot.place,
        startsAt: slot.startsAt.toISOString(),
      });
    }
    return { ok: true };
  });
}

export async function announceNewSlots(sql, rows, now = new Date()) {
  const fresh = rows.map(slotOf).filter((slot) => slot.status === "open" && slot.startsAt > now);
  if (!fresh.length) return;
  await sql.begin(async (tx) => {
    const listeners = await tx`
      SELECT id, notify_new_slots_scope
      FROM users
      WHERE notify_new_slots AND app_role <> 'admin'
    `;
    for (const listener of listeners) {
      const windows = listener.notify_new_slots_scope === "all" ? null : await loadWindows(tx, listener.id);
      for (const slot of fresh) {
        if (windows && !fullyResolvedFree(windows, slot.startsAt, slot.endsAt)) continue;
        await notify(tx, listener.id, "slot_opened", {
          text: "Появился новый слот сампо",
          slotId: slot.id,
          place: slot.place,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
        });
      }
    }
  });
}

export async function remindDue(sql) {
  const due = await sql`
    SELECT a.user_id, s.id
    FROM attendances a
    JOIN slots s ON s.id = a.slot_id
    JOIN users u ON u.id = a.user_id
    WHERE u.notify_hour_before
      AND u.app_role <> 'admin'
      AND s.status = 'open'
      AND s.starts_at > now()
      AND s.starts_at <= now() + interval '1 hour'
      AND NOT EXISTS (
        SELECT 1 FROM slot_reminders r
        WHERE r.user_id = a.user_id AND r.slot_id = s.id
      )
  `;
  for (const row of due) {
    await sql.begin(async (tx) => {
      const inserted = await tx`
        INSERT INTO slot_reminders (user_id, slot_id)
        VALUES (${row.user_id}, ${row.id})
        ON CONFLICT DO NOTHING
        RETURNING user_id
      `;
      if (!inserted.length) return;
      const [ready] = await tx`
        SELECT s.starts_at, s.ends_at, s.place
        FROM attendances a
        JOIN slots s ON s.id = a.slot_id
        JOIN users u ON u.id = a.user_id
        WHERE a.user_id = ${row.user_id}
          AND a.slot_id = ${row.id}
          AND u.notify_hour_before
          AND u.app_role <> 'admin'
          AND s.status = 'open'
          AND s.starts_at > now()
          AND s.starts_at <= now() + interval '1 hour'
      `;
      if (!ready) {
        await tx`DELETE FROM slot_reminders WHERE user_id = ${row.user_id} AND slot_id = ${row.id}`;
        return;
      }
      await notify(tx, row.user_id, "slot_reminder", {
        text: "Вы просили напомнить, что через час начнется сампо",
        slotId: row.id,
        place: ready.place,
        startsAt: new Date(ready.starts_at).toISOString(),
        endsAt: new Date(ready.ends_at).toISOString(),
      });
    });
  }
}

export async function expireDue(sql) {
  const rows = await sql`
    SELECT r.id FROM sampo_requests r
    JOIN slots s ON s.id = r.slot_id
    WHERE r.status = 'pending' AND s.starts_at <= now()
  `;
  for (const row of rows) {
    await sql.begin(async (tx) => {
      const [request] = await tx`SELECT * FROM sampo_requests WHERE id = ${row.id} FOR UPDATE`;
      if (!request || request.status !== "pending") return;
      const [slot] = await tx`SELECT * FROM slots WHERE id = ${request.slot_id}`;
      if (new Date(slot.starts_at) > new Date()) return;
      const updated = await closeRequest(tx, request, "expired", null);
      const text = `Запрос на сампо ${formatWhen(slot.starts_at)} истёк`;
      const payload = { text, requestId: updated.id, slotId: slot.id, place: slot.place, startsAt: new Date(slot.starts_at).toISOString() };
      await notify(tx, request.from_user_id, "request_expired", payload);
      await notify(tx, request.to_user_id, "request_expired", payload);
    });
  }
}

export async function listRequests(sql, userId, box, status) {
  const known = new Set(["pending", "accepted", "declined", "cancelled", "expired"]);
  const direction = box === "outgoing" ? sql`r.from_user_id = ${userId}` : sql`r.to_user_id = ${userId}`;
  const statusClause = known.has(status) ? sql`AND r.status = ${status}` : sql``;
  const rows = await sql`
    SELECT r.* FROM sampo_requests r
    WHERE ${direction} ${statusClause}
    ORDER BY r.created_at DESC
  `;
  const views = [];
  for (const row of rows) views.push(await requestView(sql, row, userId));
  return views;
}

export async function getRequest(sql, userId, requestId) {
  const [row] = await sql`SELECT * FROM sampo_requests WHERE id = ${requestId}`;
  if (!row) fail(404, "NOT_FOUND", "Запрос не найден");
  ensureParticipant(row, userId);
  return requestView(sql, row, userId);
}

export async function listNotifications(sql, userId) {
  const rows = await sql`
    SELECT id, type, payload, read_at, created_at
    FROM notifications WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    text: row.payload?.text ?? "",
    requestId: row.payload?.requestId ?? null,
    slotId: row.payload?.slotId ?? null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function clearNotifications(sql, userId) {
  await sql`DELETE FROM notifications WHERE user_id = ${userId}`;
  return { ok: true };
}

export async function markNotificationRead(sql, userId, notificationId) {
  const updated = await sql`
    UPDATE notifications SET read_at = coalesce(read_at, now())
    WHERE id = ${notificationId} AND user_id = ${userId}
    RETURNING id
  `;
  if (!updated.length) fail(404, "NOT_FOUND", "Уведомление не найдено");
  return { ok: true };
}

export async function presentSlots(sql, rawSlots, userId) {
  const slots = rawSlots.map(slotOf);
  if (!slots.length) return [];
  const ids = slots.map((slot) => slot.id);
  const responsibleIds = [...new Set(slots.map((slot) => slot.responsibleUserId).filter(Boolean))];
  const [attendanceRows, markRows, exceptionRows, windows, pairRows, requestRows, myAttendanceRows, myPairRows, responsibleRows] = await Promise.all([
    sql`SELECT slot_id, user_id, guests FROM attendances WHERE slot_id IN ${sql(ids)}`,
    sql`SELECT slot_id FROM availabilities WHERE user_id = ${userId} AND slot_id IN ${sql(ids)}`,
    sql`SELECT slot_id FROM availability_exceptions WHERE user_id = ${userId} AND slot_id IN ${sql(ids)}`,
    loadWindows(sql, userId),
    sql`
      SELECT id, slot_id, user_low_id, user_high_id FROM pairs
      WHERE status = 'confirmed' AND slot_id IN ${sql(ids)}
        AND (user_low_id = ${userId} OR user_high_id = ${userId})
    `,
    sql`
      SELECT slot_id, from_user_id, to_user_id FROM sampo_requests
      WHERE status = 'pending' AND slot_id IN ${sql(ids)}
        AND (from_user_id = ${userId} OR to_user_id = ${userId})
    `,
    sql`
      SELECT s.id, s.starts_at, s.ends_at FROM attendances a
      JOIN slots s ON s.id = a.slot_id
      WHERE a.user_id = ${userId}
    `,
    sql`
      SELECT s.id, s.starts_at, s.ends_at FROM pairs p
      JOIN slots s ON s.id = p.slot_id
      WHERE p.status = 'confirmed' AND (p.user_low_id = ${userId} OR p.user_high_id = ${userId})
    `,
    responsibleIds.length ? sql`SELECT id, display_name FROM users WHERE id IN ${sql(responsibleIds)}` : [],
  ]);
  const partnerIds = pairRows.map((row) => (row.user_low_id === userId ? row.user_high_id : row.user_low_id));
  const partners = partnerIds.length
    ? await sql`SELECT id, display_name FROM users WHERE id IN ${sql(partnerIds)}`
    : [];
  const partnerName = new Map(partners.map((row) => [row.id, row.display_name]));
  const responsibleName = new Map(responsibleRows.map((row) => [row.id, row.display_name]));
  const marks = new Set(markRows.map((row) => row.slot_id));
  const exceptions = new Set(exceptionRows.map((row) => row.slot_id));
  return slots.map((slot) => {
    const mine = attendanceRows.find((row) => row.slot_id === slot.id && row.user_id === userId);
    const taken = attendanceRows
      .filter((row) => row.slot_id === slot.id)
      .reduce((sum, row) => sum + 1 + Number(row.guests), 0);
    const myAttendance = Boolean(mine);
    const withPartner = Boolean(mine && Number(mine.guests) > 0);
    const explicit = marks.has(slot.id);
    const state = availabilityState(windows, explicit, exceptions.has(slot.id), slot);
    const conflict = myAttendanceRows.some((row) => row.id !== slot.id && overlaps(row.starts_at, row.ends_at, slot.startsAt, slot.endsAt))
      || myPairRows.some((row) => overlaps(row.starts_at, row.ends_at, slot.startsAt, slot.endsAt));
    const myAvailability = state.open;
    const pair = pairRows.find((row) => row.slot_id === slot.id);
    const comingAlone = myAttendance && !withPartner && !pair;
    const free = !comingAlone && canInvite(slot, conflict, { open: state.open });
    const partnerId = pair ? (pair.user_low_id === userId ? pair.user_high_id : pair.user_low_id) : null;
    const incoming = requestRows.filter((row) => row.slot_id === slot.id && row.to_user_id === userId);
    const outgoing = requestRows.some((row) => row.slot_id === slot.id && row.from_user_id === userId);
    return {
      id: slot.id,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      place: slot.place,
      capacity: slot.capacity,
      description: slot.description,
      responsible: responsibleName.has(slot.responsibleUserId)
        ? { id: slot.responsibleUserId, displayName: responsibleName.get(slot.responsibleUserId) }
        : null,
      status: slot.status,
      seriesId: slot.seriesId,
      taken,
      myAttendance,
      withPartner,
      myAvailability,
      availabilitySource: state.source,
      windowLabel: state.label,
      unavailable: state.unavailable,
      free,
      myPendingOutgoing: outgoing,
      myPendingIncomingCount: incoming.length,
      myPair: pair
        ? { id: pair.id, partnerId, partnerName: partnerName.get(partnerId) ?? "" }
        : null,
    };
  });
}

export async function presentSlot(sql, raw, userId) {
  const [slot] = await presentSlots(sql, [raw], userId);
  const requests = await sql`
    SELECT * FROM sampo_requests
    WHERE slot_id = ${slot.id} AND (from_user_id = ${userId} OR to_user_id = ${userId})
    ORDER BY created_at DESC
  `;
  const views = [];
  for (const row of requests) views.push(await requestView(sql, row, userId));
  const model = slotOf(raw);
  const conflict = await conflicting(sql, userId, model);
  let inviteBlocked = null;
  if (conflict === "attendance") inviteBlocked = "Вы записаны на другое время";
  else if (conflict === "pair") inviteBlocked = "У вас уже есть пара на это время";
  else {
    const outgoing = await sql`
      SELECT s.starts_at, s.ends_at FROM sampo_requests r
      JOIN slots s ON s.id = r.slot_id
      WHERE r.from_user_id = ${userId} AND r.status = 'pending' AND r.slot_id <> ${slot.id}
    `;
    if (outgoing.some((row) => overlaps(row.starts_at, row.ends_at, model.startsAt, model.endsAt))) {
      inviteBlocked = "Уже есть запрос на пересекающееся время";
    }
  }
  if (!inviteBlocked && slot.myAttendance) inviteBlocked = "Сначала отмените выбор";
  return { ...slot, requests: views, inviteBlocked };
}

async function nearestFreeSlots(sql, userId, limit = 3) {
  const rows = await sql`
    SELECT * FROM slots
    WHERE status = 'open' AND starts_at > now()
    ORDER BY starts_at
  `;
  const free = [];
  for (const raw of rows) {
    if (free.length >= limit) break;
    const slot = slotOf(raw);
    const [going] = await sql`
      SELECT 1 FROM attendances WHERE user_id = ${userId} AND slot_id = ${slot.id}
    `;
    if (going) continue;
    const [paired] = await sql`
      SELECT 1 FROM pairs
      WHERE slot_id = ${slot.id} AND status = 'confirmed'
        AND (user_low_id = ${userId} OR user_high_id = ${userId})
    `;
    if (paired) continue;
    const conflict = await conflicting(sql, userId, slot);
    const availability = await availabilityOf(sql, userId, slot);
    if (!canInvite(slot, conflict, availability)) continue;
    free.push({
      id: slot.id,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      place: slot.place,
    });
  }
  return free;
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_KEY = /^[a-z0-9_]{3,32}$/;

export async function dancerProfile(sql, viewerId, subjectKey) {
  const raw = typeof subjectKey === "string" ? subjectKey.trim() : "";
  const byId = USER_ID.test(raw);
  const loginKey = raw.toLowerCase();
  if (!byId && !LOGIN_KEY.test(loginKey)) fail(404, "NOT_FOUND", "Танцор не найден");
  const [user] = byId
    ? await sql`
        SELECT id, login, display_name, dance_level, share_availability, app_role
        FROM users WHERE id = ${raw}
      `
    : await sql`
        SELECT id, login, display_name, dance_level, share_availability, app_role
        FROM users WHERE login = ${loginKey}
      `;
  if (!user || user.app_role === "admin") fail(404, "NOT_FOUND", "Танцор не найден");
  if (viewerId === user.id) fail(400, "VALIDATION", "Это ваш профиль");
  const [lists, hidden, visits, achievements] = await Promise.all([
    listMembership(sql, viewerId, user.id),
    inviteListHides(sql, user.id, viewerId),
    visitCounts(sql, user.id),
    publicAchievements(sql, user.id),
  ]);
  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    danceLevel: user.dance_level,
    visits,
    achievements,
    blacklisted: lists.blacklisted,
    whitelisted: lists.whitelisted,
    slots: user.share_availability && !hidden ? await nearestFreeSlots(sql, user.id) : null,
  };
}

export async function freePeople(sql, slotId, actorId, q) {
  const [raw] = await sql`SELECT * FROM slots WHERE id = ${slotId}`;
  if (!raw) fail(404, "NOT_FOUND", "Слот не найден");
  const slot = slotOf(raw);
  if (slot.status !== "open" || slot.startsAt <= new Date()) return [];
  const query = String(q ?? "").trim().slice(0, 80);
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const [people, requestRows, aloneRows] = await Promise.all([
    sql`
      SELECT id, display_name FROM users
      WHERE id <> ${actorId} AND app_role <> 'admin' AND display_name ILIKE ${pattern}
      ORDER BY display_name
    `,
    sql`
      SELECT from_user_id, to_user_id, status FROM sampo_requests
      WHERE slot_id = ${slotId} AND (from_user_id = ${actorId} OR to_user_id = ${actorId})
      ORDER BY created_at DESC
    `,
    sql`
      SELECT a.user_id FROM attendances a
      WHERE a.slot_id = ${slotId} AND a.guests = 0
        AND NOT EXISTS (
          SELECT 1 FROM pairs p
          WHERE p.slot_id = a.slot_id AND p.status = 'confirmed'
            AND (p.user_low_id = a.user_id OR p.user_high_id = a.user_id)
        )
    `,
  ]);
  const requestStatus = new Map();
  for (const row of requestRows) {
    const otherId = row.from_user_id === actorId ? row.to_user_id : row.from_user_id;
    if (!requestStatus.has(otherId)) requestStatus.set(otherId, row.status);
  }
  const denied = await blockedTargets(sql, actorId, people.map((person) => person.id));
  const alone = new Set(aloneRows.map((row) => row.user_id));
  const result = [];
  for (const person of people) {
    const conflict = await conflicting(sql, person.id, slot);
    const availability = await availabilityOf(sql, person.id, slot);
    const status = requestStatus.get(person.id) ?? null;
    const canAsk = !alone.has(person.id) && canInvite(slot, conflict, availability) && status !== "pending" && status !== "accepted" && !denied.has(person.id);
    if (!canAsk && !status) continue;
    result.push({ id: person.id, displayName: person.display_name, requestStatus: status, canInvite: canAsk });
  }
  return result;
}

export async function assertCapacity(sql, slotId, capacity) {
  if (capacity < (await seatsTaken(sql, slotId))) fail(409, "CAPACITY", "Вместимость меньше числа записей");
}

export async function assertTimeEditable(sql, slotId) {
  const [{ count }] = await sql`
    SELECT (
      (SELECT count(*) FROM attendances WHERE slot_id = ${slotId})
      + (SELECT count(*) FROM pairs WHERE slot_id = ${slotId} AND status = 'confirmed')
      + (SELECT count(*) FROM sampo_requests WHERE slot_id = ${slotId} AND status = 'pending')
    )::int AS count
  `;
  if (count > 0) fail(409, "CONFLICT", "Время можно менять, только пока нет записей и запросов");
}
