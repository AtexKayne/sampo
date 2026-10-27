import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import {
  acceptRequest,
  announceNewSlots,
  attend,
  cancelAcceptedRequest,
  cancelPair,
  clearNotifications,
  createRequest,
  createWindow,
  declineRequest,
  setAvailability,
  deleteWindow,
  dancerProfile,
  freePeople,
  leave,
  listWindows,
  remindDue,
  updateWindow,
  withdrawRequest,
} from "./sampo.js";
import { addToBlacklist, addToWhitelist, deleteProfile, profileSettings, ratingSummary, removeFromBlacklist, saveProfile, searchDancers, setBlockedLevels, setDanceLevel } from "./profile.js";
import { HttpError } from "../http/errors.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const users = [];
const slots = [];

async function makeUser(name) {
  const id = crypto.randomUUID();
  const login = `u${id.replaceAll("-", "").slice(0, 12)}`;
  await sql`INSERT INTO users (id, login, password_hash, display_name) VALUES (${id}, ${login}, 'x', ${name})`;
  users.push(id);
  return id;
}

async function makeSlot(capacity, startsAt, endsAt) {
  const id = crypto.randomUUID();
  await sql`INSERT INTO slots (id, starts_at, ends_at, place, capacity) VALUES (${id}, ${new Date(startsAt)}, ${new Date(endsAt)}, 'Hall', ${capacity})`;
  slots.push(id);
  return id;
}

async function makeEndedSlots(count, startsAt) {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const rows = await sql`
    INSERT INTO slots (id, starts_at, ends_at, place, capacity)
    SELECT gen_random_uuid(), ${start}, ${end}, 'Hall', 4
    FROM generate_series(1, ${count})
    RETURNING id
  `;
  const ids = rows.map((row) => row.id);
  slots.push(...ids);
  return ids;
}

async function attendSlots(userId, slotIds) {
  await sql`
    INSERT INTO attendances (user_id, slot_id)
    SELECT ${userId}, id FROM slots WHERE id IN ${sql(slotIds)}
  `;
}

async function attendanceCount(userId, slotId) {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM attendances WHERE user_id = ${userId} AND slot_id = ${slotId}`;
  return count;
}

test.after(async () => {
  if (slots.length) await sql`DELETE FROM slots WHERE id IN ${sql(slots)}`;
  if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  await sql.end({ timeout: 5 });
});

test("accept creates one attendance each and a second accept changes nothing", async () => {
  const anna = await makeUser("Анна");
  const boris = await makeUser("Борис");
  const slotId = await makeSlot(4, "2026-10-20T14:00:00.000Z", "2026-10-20T16:00:00.000Z");
  await attend(sql, anna, slotId);
  await attend(sql, anna, slotId);
  assert.equal(await attendanceCount(anna, slotId), 1);
  await leave(sql, anna, slotId);
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${slotId})`;
  const request = await createRequest(sql, anna, slotId, boris);
  await sql`INSERT INTO attendances (user_id, slot_id) VALUES (${anna}, ${slotId})`;
  const accepted = await acceptRequest(sql, boris, request.id);
  assert.equal(accepted.status, "accepted");
  assert.equal(await attendanceCount(anna, slotId), 1);
  assert.equal(await attendanceCount(boris, slotId), 1);
  const again = await acceptRequest(sql, boris, request.id);
  assert.equal(again.status, "accepted");
  const [{ pairs }] = await sql`SELECT count(*)::int AS pairs FROM pairs WHERE request_id = ${request.id}`;
  assert.equal(pairs, 1);
  await assert.rejects(leave(sql, anna, slotId), (error) => error instanceof HttpError && error.code === "PAIR_ACTIVE");
  await cancelPair(sql, anna, (await sql`SELECT id FROM pairs WHERE request_id = ${request.id}`)[0].id);
  assert.equal(await attendanceCount(anna, slotId), 0);
  assert.equal(await attendanceCount(boris, slotId), 0);
  const repeat = await createRequest(sql, anna, slotId, boris);
  assert.equal(repeat.status, "pending");
});

test("decline, withdraw, capacity and overlap", async () => {
  const anna = await makeUser("Вера");
  const boris = await makeUser("Глеб");
  const vera = await makeUser("Дина");
  const full = await makeSlot(1, "2026-10-21T14:00:00.000Z", "2026-10-21T16:00:00.000Z");
  await attend(sql, vera, full);
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${full})`;
  const pending = await createRequest(sql, anna, full, boris);
  await assert.rejects(acceptRequest(sql, boris, pending.id), (error) => error instanceof HttpError && error.code === "CAPACITY");
  const [{ status }] = await sql`SELECT status FROM sampo_requests WHERE id = ${pending.id}`;
  assert.equal(status, "pending");
  const declined = await declineRequest(sql, boris, pending.id);
  assert.equal(declined.status, "declined");
  const [{ count: declinedNotes }] = await sql`
    SELECT count(*)::int AS count FROM notifications WHERE user_id = ${anna} AND type = 'request_declined'
  `;
  assert.equal(declinedNotes, 0);

  const other = await makeSlot(4, "2026-10-22T14:00:00.000Z", "2026-10-22T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${other})`;
  const outgoing = await createRequest(sql, anna, other, boris);
  const withdrawn = await withdrawRequest(sql, anna, outgoing.id);
  assert.equal(withdrawn.status, "cancelled");
  assert.equal(withdrawn.cancelReason, "withdrawn");

  const first = await makeSlot(4, "2026-10-23T13:00:00.000Z", "2026-10-23T15:00:00.000Z");
  const second = await makeSlot(4, "2026-10-23T14:00:00.000Z", "2026-10-23T16:00:00.000Z");
  await attend(sql, anna, first);
  await assert.rejects(attend(sql, anna, second), (error) => error instanceof HttpError && error.code === "CONFLICT");
});

test("clearing notifications removes only that user's notices", async () => {
  const owner = await makeUser("Тамара");
  const other = await makeUser("Устин");
  await sql`
    INSERT INTO notifications (id, user_id, type, payload)
    VALUES
      (${crypto.randomUUID()}, ${owner}, 'request_received', ${sql.json({ text: "первое" })}),
      (${crypto.randomUUID()}, ${owner}, 'request_received', ${sql.json({ text: "второе" })}),
      (${crypto.randomUUID()}, ${other}, 'request_received', ${sql.json({ text: "чужое" })})
  `;
  await clearNotifications(sql, owner);
  const left = await sql`SELECT user_id FROM notifications WHERE user_id IN ${sql([owner, other])}`;
  assert.deepEqual(left.map((row) => row.user_id), [other]);
});

test("one slot can hold many invitations until somebody accepts", async () => {
  const anna = await makeUser("Нина");
  const boris = await makeUser("Олег");
  const vera = await makeUser("Полина");
  const gleb = await makeUser("Роман");
  const dina = await makeUser("Софья");
  const slotId = await makeSlot(4, "2026-12-01T14:00:00.000Z", "2026-12-01T16:00:00.000Z");
  const other = await makeSlot(4, "2026-12-01T15:00:00.000Z", "2026-12-01T17:00:00.000Z");
  await sql`
    INSERT INTO availabilities (user_id, slot_id)
    VALUES (${boris}, ${slotId}), (${vera}, ${slotId}), (${anna}, ${other}), (${dina}, ${other})
  `;
  const toBoris = await createRequest(sql, anna, slotId, boris);
  const toVera = await createRequest(sql, anna, slotId, vera);
  const toAnna = await createRequest(sql, gleb, other, anna);
  const toDina = await createRequest(sql, boris, other, dina);
  await sql`UPDATE users SET notify_invites = true WHERE id IN ${sql([anna, vera])}`;
  await acceptRequest(sql, boris, toBoris.id);
  const rows = await sql`
    SELECT id, status, cancel_reason FROM sampo_requests
    WHERE id IN ${sql([toVera.id, toAnna.id, toDina.id])}
  `;
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.status, "cancelled");
    assert.equal(row.cancel_reason, "superseded");
  }
  const notices = await sql`
    SELECT user_id FROM notifications
    WHERE type = 'request_superseded' AND payload->>'requestId' = ${toVera.id}
  `;
  assert.deepEqual(notices.map((row) => row.user_id).sort(), [anna, vera].sort());
});

test("the second overlapping invitation is superseded", async () => {
  const host = await makeUser("Ева");
  const one = await makeUser("Женя");
  const two = await makeUser("Зоя");
  const slotId = await makeSlot(4, "2026-10-27T14:00:00.000Z", "2026-10-27T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${host}, ${slotId})`;
  const first = await createRequest(sql, one, slotId, host);
  const second = await createRequest(sql, two, slotId, host);
  await acceptRequest(sql, host, first.id);
  const [{ status, cancel_reason: reason }] = await sql`SELECT status, cancel_reason FROM sampo_requests WHERE id = ${second.id}`;
  assert.equal(status, "cancelled");
  assert.equal(reason, "superseded");
});

test("an admin cannot be invited to a slot", async () => {
  const host = await makeUser("Приглашающий");
  const admin = await makeUser("Неприглашаемый");
  const guest = await makeUser("Приглашаемый");
  await sql`UPDATE users SET app_role = 'admin' WHERE id = ${admin}`;
  const slotId = await makeSlot(4, "2026-11-03T14:00:00.000Z", "2026-11-03T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${admin}, ${slotId}), (${guest}, ${slotId})`;
  await assert.rejects(() => createRequest(sql, host, slotId, admin), (error) => error instanceof HttpError && error.statusCode === 409);
  await assert.rejects(
    () => createRequest(sql, admin, slotId, guest),
    (error) => error instanceof HttpError && error.code === "FORBIDDEN",
  );
  assert.deepEqual((await freePeople(sql, slotId, host, "Приглашаемый")).map((person) => person.id), [guest]);
  assert.deepEqual(await freePeople(sql, slotId, host, "Неприглашаемый"), []);
  assert.deepEqual(await searchDancers(sql, host, "Неприглашаемый"), []);
});

test("a weekly window makes a person free for a covered slot", async () => {
  const host = await makeUser("Ира");
  const guest = await makeUser("Кира");
  const slotId = await makeSlot(4, "2026-10-20T14:00:00.000Z", "2026-10-20T16:00:00.000Z");
  await createWindow(sql, guest, { kind: "weekly", weekday: 2, localStart: "18:00", localEnd: "22:00" });
  const people = await freePeople(sql, slotId, host, "Кира");
  assert.deepEqual(people.map((person) => person.id), [guest]);
});

test("daily, weekday, weekend and interval windows follow the studio calendar", async () => {
  const host = await makeUser("Яков");
  const daily = await makeUser("Яна");
  const office = await makeUser("Федя");
  const rest = await makeUser("Шура");
  const every = await makeUser("Эля");
  const tuesday = await makeSlot(4, "2026-10-20T14:00:00.000Z", "2026-10-20T16:00:00.000Z");
  const wednesday = await makeSlot(4, "2026-10-21T14:00:00.000Z", "2026-10-21T16:00:00.000Z");
  const friday = await makeSlot(4, "2026-10-23T14:00:00.000Z", "2026-10-23T16:00:00.000Z");
  const saturday = await makeSlot(4, "2026-10-24T14:00:00.000Z", "2026-10-24T16:00:00.000Z");
  const early = await makeSlot(4, "2026-10-20T05:00:00.000Z", "2026-10-20T06:00:00.000Z");
  await createWindow(sql, daily, { kind: "daily", localStart: "18:00", localEnd: "22:00" });
  await createWindow(sql, office, { kind: "weekdays", localStart: "18:00", localEnd: "22:00" });
  await createWindow(sql, rest, { kind: "weekends", localStart: "18:00", localEnd: "22:00" });
  const created = await createWindow(sql, every, {
    kind: "interval",
    intervalDays: 3,
    anchorDate: "2026-10-20",
    localStart: "18:00",
    localEnd: "22:00",
  });
  assert.equal(created.label, "каждые 3 дня с 20 октября, 18:00–22:00");

  assert.deepEqual((await freePeople(sql, tuesday, host, "Яна")).map((person) => person.id), [daily]);
  assert.deepEqual((await freePeople(sql, saturday, host, "Яна")).map((person) => person.id), [daily]);
  assert.deepEqual(await freePeople(sql, early, host, "Яна"), []);
  assert.deepEqual((await freePeople(sql, tuesday, host, "Федя")).map((person) => person.id), [office]);
  assert.deepEqual(await freePeople(sql, saturday, host, "Федя"), []);
  assert.deepEqual((await freePeople(sql, saturday, host, "Шура")).map((person) => person.id), [rest]);
  assert.deepEqual(await freePeople(sql, tuesday, host, "Шура"), []);
  assert.deepEqual((await freePeople(sql, tuesday, host, "Эля")).map((person) => person.id), [every]);
  assert.deepEqual(await freePeople(sql, wednesday, host, "Эля"), []);
  assert.deepEqual((await freePeople(sql, friday, host, "Эля")).map((person) => person.id), [every]);
  await assert.rejects(
    createWindow(sql, every, { kind: "interval", intervalDays: 1, anchorDate: "2026-10-20", localStart: "18:00", localEnd: "22:00" }),
    (error) => error instanceof HttpError && error.code === "VALIDATION",
  );
});

test("either partner can cancel a confirmed request with a reason", async () => {
  const anna = await makeUser("Нина");
  const boris = await makeUser("Олег");
  const slotId = await makeSlot(4, "2026-11-10T14:00:00.000Z", "2026-11-10T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${slotId})`;
  const request = await createRequest(sql, anna, slotId, boris);
  await acceptRequest(sql, boris, request.id);
  const cancelled = await cancelAcceptedRequest(sql, anna, request.id, "Не смогу прийти");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelReason, "partner_cancelled");
  assert.equal(cancelled.cancelNote, "Не смогу прийти");
  const [{ status }] = await sql`SELECT status FROM pairs WHERE request_id = ${request.id}`;
  assert.equal(status, "cancelled");
  assert.equal(await attendanceCount(anna, slotId), 0);
  assert.equal(await attendanceCount(boris, slotId), 0);
  const next = await makeUser("Яна");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${next}, ${slotId})`;
  const again = await createRequest(sql, boris, slotId, next);
  assert.equal(again.status, "pending");
  const [{ text }] = await sql`
    SELECT payload->>'text' AS text FROM notifications WHERE user_id = ${boris} ORDER BY created_at DESC LIMIT 1
  `;
  assert.equal(text, "Нина отменил ваше сампо");
  const repeat = await createRequest(sql, anna, slotId, boris);
  assert.equal(repeat.status, "pending");
});

test("a confirmed request can be cancelled without a reason", async () => {
  const anna = await makeUser("Кира");
  const boris = await makeUser("Лев");
  const slotId = await makeSlot(4, "2026-11-11T14:00:00.000Z", "2026-11-11T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${slotId})`;
  const request = await createRequest(sql, anna, slotId, boris);
  await acceptRequest(sql, boris, request.id);
  const cancelled = await cancelAcceptedRequest(sql, anna, request.id, "  ");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelNote, null);
  const [{ text }] = await sql`
    SELECT payload->>'text' AS text FROM notifications WHERE user_id = ${boris} ORDER BY created_at DESC LIMIT 1
  `;
  assert.equal(text, "Кира отменил ваше сампо");
});

test("a stored notification is published for live delivery", async () => {
  const anna = await makeUser("Миша");
  const boris = await makeUser("Соня");
  const slotId = await makeSlot(4, "2026-11-12T14:00:00.000Z", "2026-11-12T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${slotId})`;
  await sql`UPDATE users SET notify_invites = true WHERE id = ${boris}`;
  let resolveNote;
  const received = new Promise((resolve) => {
    resolveNote = resolve;
  });
  const { unlisten } = await sql.listen("sampo_notification", (payload) => {
    const event = JSON.parse(payload);
    if (event.userId === boris) resolveNote(event);
  });
  try {
    const request = await createRequest(sql, anna, slotId, boris);
    const event = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error("уведомление не пришло")), 3000)),
    ]);
    assert.equal(event.notification.type, "request_received");
    assert.equal(event.notification.requestId, request.id);
    assert.equal(event.notification.slotId, slotId);
    assert.match(event.notification.text, /Миша/);
  } finally {
    await unlisten();
  }
});

test("a partner outside the system takes a second seat", async () => {
  const anna = await makeUser("Пётр");
  const boris = await makeUser("Рома");
  const full = await makeSlot(2, "2026-10-28T14:00:00.000Z", "2026-10-28T16:00:00.000Z");
  await attend(sql, anna, full, true);
  await assert.rejects(attend(sql, boris, full), (error) => error instanceof HttpError && error.code === "CAPACITY");
  const [{ guests }] = await sql`SELECT guests FROM attendances WHERE user_id = ${anna} AND slot_id = ${full}`;
  assert.equal(guests, 1);

  const room = await makeSlot(3, "2026-10-29T14:00:00.000Z", "2026-10-29T16:00:00.000Z");
  await attend(sql, anna, room, true);
  await attend(sql, boris, room);
  assert.equal(await attendanceCount(boris, room), 1);
});

test("attending withdraws outgoing requests for that time", async () => {
  const anna = await makeUser("Сева");
  const boris = await makeUser("Тима");
  const vera = await makeUser("Уля");
  const slotId = await makeSlot(4, "2026-11-02T14:00:00.000Z", "2026-11-02T16:00:00.000Z");
  const later = await makeSlot(4, "2026-11-03T14:00:00.000Z", "2026-11-03T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${slotId}), (${boris}, ${later}), (${anna}, ${slotId})`;
  const sent = await createRequest(sql, anna, slotId, boris);
  const kept = await createRequest(sql, anna, later, boris);
  const incoming = await createRequest(sql, vera, slotId, anna);
  await attend(sql, anna, slotId, true);
  const [{ status, cancel_reason: reason }] = await sql`SELECT status, cancel_reason FROM sampo_requests WHERE id = ${sent.id}`;
  assert.equal(status, "cancelled");
  assert.equal(reason, "withdrawn");
  const [{ status: keptStatus }] = await sql`SELECT status FROM sampo_requests WHERE id = ${kept.id}`;
  assert.equal(keptStatus, "pending");
  const [{ status: incomingStatus }] = await sql`SELECT status FROM sampo_requests WHERE id = ${incoming.id}`;
  assert.equal(incomingStatus, "pending");
});

test("a chosen visit blocks invitations until it is cancelled", async () => {
  const anna = await makeUser("Федя");
  const boris = await makeUser("Гена");
  const slotId = await makeSlot(4, "2026-11-04T14:00:00.000Z", "2026-11-04T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${boris}, ${slotId})`;
  await attend(sql, anna, slotId, true);
  await assert.rejects(createRequest(sql, anna, slotId, boris), (error) => error instanceof HttpError && error.code === "CONFLICT");
  await leave(sql, anna, slotId);
  const request = await createRequest(sql, anna, slotId, boris);
  assert.equal(request.status, "pending");
});

test("coming alone hides the person from invitations on that slot", async () => {
  const host = await makeUser("Зоя");
  const guest = await makeUser("Игнат");
  const slotId = await makeSlot(4, "2026-12-16T14:00:00.000Z", "2026-12-16T16:00:00.000Z");
  const other = await makeSlot(4, "2026-12-17T14:00:00.000Z", "2026-12-17T16:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${guest}, ${slotId}), (${guest}, ${other})`;
  await attend(sql, guest, slotId);
  await assert.rejects(
    createRequest(sql, host, slotId, guest),
    (error) => error instanceof HttpError && error.code === "NOT_AVAILABLE" && error.message === "Этот человек придёт один",
  );
  assert.deepEqual(await freePeople(sql, slotId, host, "Игнат"), []);
  assert.deepEqual((await freePeople(sql, other, host, "Игнат")).map((person) => person.id), [guest]);
  await leave(sql, guest, slotId);
  const request = await createRequest(sql, host, slotId, guest);
  assert.equal(request.status, "pending");
});

test("a slot switch marks that slot free or unavailable", async () => {
  const host = await makeUser("Яша");
  const guest = await makeUser("Эля");
  const chosen = await makeSlot(4, "2026-12-08T14:00:00.000Z", "2026-12-08T15:00:00.000Z");
  const kept = await makeSlot(4, "2026-12-08T15:30:00.000Z", "2026-12-08T16:30:00.000Z");
  const alone = await makeSlot(4, "2026-12-09T09:00:00.000Z", "2026-12-09T11:00:00.000Z");
  const later = await makeSlot(4, "2026-12-09T12:00:00.000Z", "2026-12-09T13:00:00.000Z");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-08T09:00", endsAtLocal: "2026-12-08T23:00" });

  await setAvailability(sql, guest, chosen, false);
  assert.deepEqual(await freePeople(sql, chosen, host, "Эля"), []);
  assert.deepEqual((await freePeople(sql, kept, host, "Эля")).map((person) => person.id), [guest]);

  await setAvailability(sql, guest, chosen, true);
  assert.deepEqual((await freePeople(sql, chosen, host, "Эля")).map((person) => person.id), [guest]);
  assert.deepEqual((await freePeople(sql, kept, host, "Эля")).map((person) => person.id), [guest]);

  assert.deepEqual(await freePeople(sql, alone, host, "Эля"), []);
  await setAvailability(sql, guest, alone, true);
  assert.deepEqual((await freePeople(sql, alone, host, "Эля")).map((person) => person.id), [guest]);
  assert.deepEqual(await freePeople(sql, later, host, "Эля"), []);
  await setAvailability(sql, guest, alone, false);
  assert.deepEqual(await freePeople(sql, alone, host, "Эля"), []);
});

test("a gap inside a free day is the time that was not kept", async () => {
  const host = await makeUser("Боря");
  const guest = await makeUser("Варя");
  const inside = await makeSlot(4, "2026-10-20T14:00:00.000Z", "2026-10-20T15:00:00.000Z");
  const beside = await makeSlot(4, "2026-10-20T15:30:00.000Z", "2026-10-20T16:30:00.000Z");
  const otherDay = await makeSlot(4, "2026-10-21T14:00:00.000Z", "2026-10-21T16:00:00.000Z");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-10-20T09:00", endsAtLocal: "2026-10-20T23:30" });
  const carved = await createWindow(sql, guest, {
    kind: "once",
    blocked: true,
    startsAtLocal: "2026-10-20T19:00",
    endsAtLocal: "2026-10-20T20:30",
  });
  assert.deepEqual(carved, { ok: true });
  assert.deepEqual(await freePeople(sql, inside, host, "Варя"), []);
  assert.deepEqual((await freePeople(sql, beside, host, "Варя")).map((person) => person.id), [guest]);
  assert.deepEqual(await freePeople(sql, otherDay, host, "Варя"), []);
  const [{ blocked }] = await sql`SELECT count(*)::int AS blocked FROM availability_windows WHERE user_id = ${guest} AND blocked = true`;
  const [{ free }] = await sql`SELECT count(*)::int AS free FROM availability_windows WHERE user_id = ${guest} AND blocked = false`;
  assert.equal(blocked, 1);
  assert.equal(free, 1);
});

test("overlapping free ranges become one window", async () => {
  const guest = await makeUser("Мила");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-01T10:00", endsAtLocal: "2026-12-01T12:00" });
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-01T11:00", endsAtLocal: "2026-12-01T13:00" });
  const rows = await sql`
    SELECT starts_at, ends_at FROM availability_windows
    WHERE user_id = ${guest} AND blocked = false
    ORDER BY starts_at
  `;
  assert.equal(rows.length, 1);
  assert.equal(new Date(rows[0].starts_at).toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal(new Date(rows[0].ends_at).toISOString(), "2026-12-01T08:00:00.000Z");
});

test("a free mark inside an existing free range keeps that range", async () => {
  const guest = await makeUser("Кира");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-01T10:00", endsAtLocal: "2026-12-01T14:00" });
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-01T11:00", endsAtLocal: "2026-12-01T12:00" });
  const rows = await sql`
    SELECT starts_at, ends_at FROM availability_windows WHERE user_id = ${guest}
  `;
  assert.equal(rows.length, 1);
  assert.equal(new Date(rows[0].starts_at).toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal(new Date(rows[0].ends_at).toISOString(), "2026-12-01T09:00:00.000Z");
});

test("marking a hole free removes the unavailable block", async () => {
  const host = await makeUser("Ника");
  const guest = await makeUser("Олег");
  const slotId = await makeSlot(4, "2026-12-02T07:00:00.000Z", "2026-12-02T08:00:00.000Z");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-02T09:00", endsAtLocal: "2026-12-02T18:00" });
  await createWindow(sql, guest, {
    kind: "once",
    blocked: true,
    startsAtLocal: "2026-12-02T12:00",
    endsAtLocal: "2026-12-02T14:00",
  });
  assert.deepEqual(await freePeople(sql, slotId, host, "Олег"), []);
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-02T12:00", endsAtLocal: "2026-12-02T14:00" });
  assert.deepEqual((await freePeople(sql, slotId, host, "Олег")).map((person) => person.id), [guest]);
  const [{ blocked }] = await sql`SELECT count(*)::int AS blocked FROM availability_windows WHERE user_id = ${guest} AND blocked = true`;
  const [{ free }] = await sql`SELECT count(*)::int AS free FROM availability_windows WHERE user_id = ${guest} AND blocked = false`;
  assert.equal(blocked, 0);
  assert.equal(free, 1);
});

test("a shorter free mark fills only part of a gap", async () => {
  const host = await makeUser("Петя");
  const guest = await makeUser("Рая");
  const opened = await makeSlot(4, "2026-12-02T07:00:00.000Z", "2026-12-02T08:00:00.000Z");
  const stillClosed = await makeSlot(4, "2026-12-02T08:00:00.000Z", "2026-12-02T09:00:00.000Z");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-02T09:00", endsAtLocal: "2026-12-02T18:00" });
  await createWindow(sql, guest, {
    kind: "once",
    blocked: true,
    startsAtLocal: "2026-12-02T12:00",
    endsAtLocal: "2026-12-02T15:00",
  });
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-02T12:00", endsAtLocal: "2026-12-02T13:00" });
  assert.deepEqual((await freePeople(sql, opened, host, "Рая")).map((person) => person.id), [guest]);
  assert.deepEqual(await freePeople(sql, stillClosed, host, "Рая"), []);
  const [{ blocked }] = await sql`SELECT count(*)::int AS blocked FROM availability_windows WHERE user_id = ${guest} AND blocked = true`;
  const [{ free }] = await sql`SELECT count(*)::int AS free FROM availability_windows WHERE user_id = ${guest} AND blocked = false`;
  assert.equal(blocked, 1);
  assert.equal(free, 2);
});

test("a repeat includes the day it was chosen", async () => {
  const host = await makeUser("Зоя");
  const guest = await makeUser("Ира");
  const first = await makeSlot(4, "2026-12-14T13:00:00.000Z", "2026-12-14T14:00:00.000Z");
  const later = await makeSlot(4, "2026-12-16T13:00:00.000Z", "2026-12-16T14:00:00.000Z");
  const between = await makeSlot(4, "2026-12-15T13:00:00.000Z", "2026-12-15T14:00:00.000Z");
  await createWindow(sql, guest, {
    kind: "interval",
    localStart: "18:00",
    localEnd: "20:00",
    intervalDays: 2,
    anchorDate: "2026-12-14",
  });
  assert.deepEqual((await freePeople(sql, first, host, "Ира")).map((person) => person.id), [guest]);
  assert.deepEqual((await freePeople(sql, later, host, "Ира")).map((person) => person.id), [guest]);
  assert.equal((await freePeople(sql, between, host, "Ира")).some((person) => person.id === guest), false);
});

test("marking a hole free again restores that day of the repeat", async () => {
  const host = await makeUser("Тема");
  const guest = await makeUser("Нюра");
  const hole = await makeSlot(4, "2026-11-14T16:00:00.000Z", "2026-11-14T17:00:00.000Z");
  const edge = await makeSlot(4, "2026-11-14T17:30:00.000Z", "2026-11-14T18:00:00.000Z");
  const nextDay = await makeSlot(4, "2026-11-15T16:00:00.000Z", "2026-11-15T17:00:00.000Z");
  await createWindow(sql, guest, { kind: "daily", localStart: "20:30", localEnd: "23:30" });
  await createWindow(sql, guest, {
    kind: "once",
    blocked: true,
    startsAtLocal: "2026-11-14T20:30",
    endsAtLocal: "2026-11-14T22:30",
  });
  assert.deepEqual(await freePeople(sql, hole, host, "Нюра"), []);
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-11-14T20:30", endsAtLocal: "2026-11-14T22:30" });
  assert.equal((await freePeople(sql, hole, host, "Нюра")).some((person) => person.id === guest), true);
  assert.equal((await freePeople(sql, edge, host, "Нюра")).some((person) => person.id === guest), true);
  assert.equal((await freePeople(sql, nextDay, host, "Нюра")).some((person) => person.id === guest), true);
  const rows = await sql`SELECT kind FROM availability_windows WHERE user_id = ${guest} ORDER BY kind`;
  assert.deepEqual(rows.map((row) => row.kind), ["daily"]);
  const [listed] = await listWindows(sql, guest);
  assert.deepEqual(listed.skipDates, []);
});

test("a gap in one day of a repeat leaves the other days free", async () => {
  const host = await makeUser("Лада");
  const guest = await makeUser("Мира");
  const cut = await makeSlot(4, "2026-12-14T07:00:00.000Z", "2026-12-14T08:00:00.000Z");
  const kept = await makeSlot(4, "2026-12-14T05:00:00.000Z", "2026-12-14T06:00:00.000Z");
  const nextDay = await makeSlot(4, "2026-12-15T07:00:00.000Z", "2026-12-15T08:00:00.000Z");
  await createWindow(sql, guest, { kind: "daily", localStart: "09:00", localEnd: "18:00" });
  await createWindow(sql, guest, {
    kind: "once",
    blocked: true,
    startsAtLocal: "2026-12-14T12:00",
    endsAtLocal: "2026-12-14T14:00",
  });
  assert.deepEqual(await freePeople(sql, cut, host, "Мира"), []);
  assert.deepEqual((await freePeople(sql, kept, host, "Мира")).map((person) => person.id), [guest]);
  assert.deepEqual((await freePeople(sql, nextDay, host, "Мира")).map((person) => person.id), [guest]);
});

test("a repeating window cannot cover time that is already free", async () => {
  const daily = await makeUser("Соня");
  await createWindow(sql, daily, { kind: "daily", localStart: "18:00", localEnd: "20:00" });
  await createWindow(sql, daily, { kind: "once", startsAtLocal: "2026-12-03T18:00", endsAtLocal: "2026-12-03T19:00" });
  const dailyRows = await sql`SELECT kind FROM availability_windows WHERE user_id = ${daily}`;
  assert.deepEqual(dailyRows.map((row) => row.kind), ["daily"]);
  const weekly = await makeUser("Тая");
  await createWindow(sql, weekly, { kind: "once", startsAtLocal: "2026-12-04T18:00", endsAtLocal: "2026-12-04T20:00" });
  await createWindow(sql, weekly, { kind: "weekly", weekday: 5, localStart: "18:00", localEnd: "20:00" });
  const rows = await sql`SELECT kind FROM availability_windows WHERE user_id = ${weekly}`;
  assert.deepEqual(rows.map((row) => row.kind), ["weekly"]);
});

test("a one-day mark does not block a repeat on other days", async () => {
  const guest = await makeUser("Уля");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-07T18:00", endsAtLocal: "2026-12-07T20:00" });
  await createWindow(sql, guest, {
    kind: "interval",
    localStart: "18:00",
    localEnd: "20:00",
    intervalDays: 2,
    anchorDate: "2026-12-08",
  });
  await createWindow(sql, guest, {
    kind: "interval",
    localStart: "18:00",
    localEnd: "20:00",
    intervalDays: 2,
    anchorDate: "2026-12-09",
  });
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM availability_windows WHERE user_id = ${guest}`;
  assert.equal(count, 3);
});

test("a repeat takes a one-day mark that falls on the same hours", async () => {
  const guest = await makeUser("Федя");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-08T18:00", endsAtLocal: "2026-12-08T22:00" });
  await createWindow(sql, guest, { kind: "daily", localStart: "20:00", localEnd: "21:00" });
  const rows = await sql`
    SELECT kind, starts_at, ends_at FROM availability_windows
    WHERE user_id = ${guest} AND kind = 'once'
    ORDER BY starts_at
  `;
  assert.equal(rows.length, 2);
  assert.equal(new Date(rows[0].starts_at).toISOString(), "2026-12-08T13:00:00.000Z");
  assert.equal(new Date(rows[0].ends_at).toISOString(), "2026-12-08T15:00:00.000Z");
  assert.equal(new Date(rows[1].starts_at).toISOString(), "2026-12-08T16:00:00.000Z");
  assert.equal(new Date(rows[1].ends_at).toISOString(), "2026-12-08T17:00:00.000Z");
});

test("a repeat can cover the whole studio day", async () => {
  const guest = await makeUser("Зоя");
  const created = await createWindow(sql, guest, { kind: "daily", localStart: "09:00", localEnd: "23:30" });
  assert.equal(created.kind, "daily");
  assert.equal(created.localStart, "09:00");
  assert.equal(created.localEnd, "23:30");
});

test("a wider free repeat replaces a narrower one it contains", async () => {
  const guest = await makeUser("Яна");
  await createWindow(sql, guest, { kind: "daily", localStart: "20:30", localEnd: "23:30" });
  await createWindow(sql, guest, { kind: "daily", localStart: "18:00", localEnd: "23:30" });
  const rows = await sql`
    SELECT kind, local_start, local_end FROM availability_windows
    WHERE user_id = ${guest} AND blocked = false
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "daily");
  assert.equal(String(rows[0].local_start).slice(0, 5), "18:00");
  assert.equal(String(rows[0].local_end).slice(0, 5), "23:30");
});

test("a repeat that covers more days replaces a smaller repeat on the same hours", async () => {
  const guest = await makeUser("Глеб");
  await createWindow(sql, guest, { kind: "weekdays", localStart: "20:30", localEnd: "23:30" });
  await createWindow(sql, guest, { kind: "daily", localStart: "20:30", localEnd: "23:30" });
  const rows = await sql`SELECT kind FROM availability_windows WHERE user_id = ${guest}`;
  assert.deepEqual(rows.map((row) => row.kind), ["daily"]);
});

test("one weekday inside a wider weekday repeat is replaced", async () => {
  const guest = await makeUser("Юра");
  await createWindow(sql, guest, { kind: "weekly", weekday: 5, localStart: "20:00", localEnd: "21:00" });
  await createWindow(sql, guest, { kind: "weekdays", localStart: "18:00", localEnd: "22:00" });
  const rows = await sql`SELECT kind FROM availability_windows WHERE user_id = ${guest}`;
  assert.deepEqual(rows.map((row) => row.kind), ["weekdays"]);
});

test("a repeat on fewer days keeps a repeat that also falls on other days", async () => {
  const host = await makeUser("Эля");
  const guest = await makeUser("Женя");
  const weekend = await makeSlot(4, "2026-12-05T13:00:00.000Z", "2026-12-05T14:00:00.000Z");
  const lateWeekday = await makeSlot(4, "2026-12-07T16:00:00.000Z", "2026-12-07T17:00:00.000Z");
  await createWindow(sql, guest, { kind: "daily", localStart: "18:00", localEnd: "20:00" });
  await createWindow(sql, guest, { kind: "weekdays", localStart: "18:00", localEnd: "22:00" });
  const rows = await sql`SELECT kind FROM availability_windows WHERE user_id = ${guest} ORDER BY kind`;
  assert.deepEqual(rows.map((row) => row.kind), ["daily", "weekdays"]);
  assert.deepEqual((await freePeople(sql, weekend, host, "Женя")).map((person) => person.id), [guest]);
  assert.deepEqual((await freePeople(sql, lateWeekday, host, "Женя")).map((person) => person.id), [guest]);
});

test("overlapping repeats of the same days join their hours", async () => {
  const guest = await makeUser("Шура");
  await createWindow(sql, guest, {
    kind: "interval",
    localStart: "18:00",
    localEnd: "20:00",
    intervalDays: 2,
    anchorDate: "2026-12-08",
  });
  await createWindow(sql, guest, {
    kind: "interval",
    localStart: "19:00",
    localEnd: "21:00",
    intervalDays: 2,
    anchorDate: "2026-12-10",
  });
  const rows = await sql`
    SELECT local_start, local_end, anchor_date FROM availability_windows WHERE user_id = ${guest}
  `;
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].local_start).slice(0, 5), "18:00");
  assert.equal(String(rows[0].local_end).slice(0, 5), "21:00");
  assert.equal(new Date(rows[0].anchor_date).toISOString().slice(0, 10), "2026-12-08");
});

test("one day of a free series can be removed", async () => {
  const host = await makeUser("Лёва");
  const guest = await makeUser("Маша");
  const skipped = await makeSlot(4, "2026-12-08T13:00:00.000Z", "2026-12-08T14:00:00.000Z");
  const kept = await makeSlot(4, "2026-12-09T13:00:00.000Z", "2026-12-09T14:00:00.000Z");
  const created = await createWindow(sql, guest, { kind: "daily", localStart: "18:00", localEnd: "20:00" });
  await deleteWindow(sql, guest, created.id, "one", "2026-12-08");
  assert.deepEqual(await freePeople(sql, skipped, host, "Маша"), []);
  assert.deepEqual((await freePeople(sql, kept, host, "Маша")).map((person) => person.id), [guest]);
  const [listed] = await listWindows(sql, guest);
  assert.deepEqual(listed.skipDates, ["2026-12-08"]);
});

test("deleting a free series removes every day", async () => {
  const host = await makeUser("Нина");
  const guest = await makeUser("Олег");
  const first = await makeSlot(4, "2026-12-10T13:00:00.000Z", "2026-12-10T14:00:00.000Z");
  const second = await makeSlot(4, "2026-12-11T13:00:00.000Z", "2026-12-11T14:00:00.000Z");
  const created = await createWindow(sql, guest, { kind: "daily", localStart: "18:00", localEnd: "20:00" });
  await deleteWindow(sql, guest, created.id, "series");
  assert.deepEqual(await freePeople(sql, first, host, "Олег"), []);
  assert.deepEqual(await freePeople(sql, second, host, "Олег"), []);
});

test("editing a free window moves its time", async () => {
  const host = await makeUser("Паша");
  const guest = await makeUser("Рита");
  const before = await makeSlot(4, "2026-12-12T05:00:00.000Z", "2026-12-12T06:00:00.000Z");
  const after = await makeSlot(4, "2026-12-12T09:00:00.000Z", "2026-12-12T10:00:00.000Z");
  const created = await createWindow(sql, guest, {
    kind: "once",
    startsAtLocal: "2026-12-12T10:00",
    endsAtLocal: "2026-12-12T12:00",
  });
  await updateWindow(sql, guest, created.id, {
    kind: "once",
    startsAtLocal: "2026-12-12T14:00",
    endsAtLocal: "2026-12-12T16:00",
  });
  assert.deepEqual(await freePeople(sql, before, host, "Рита"), []);
  assert.deepEqual((await freePeople(sql, after, host, "Рита")).map((person) => person.id), [guest]);
});

test("moving a free window onto free time joins the ranges", async () => {
  const guest = await makeUser("Сева");
  await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-13T10:00", endsAtLocal: "2026-12-13T12:00" });
  const later = await createWindow(sql, guest, { kind: "once", startsAtLocal: "2026-12-13T14:00", endsAtLocal: "2026-12-13T16:00" });
  await updateWindow(sql, guest, later.id, {
    kind: "once",
    startsAtLocal: "2026-12-13T11:00",
    endsAtLocal: "2026-12-13T13:00",
  });
  const rows = await sql`
    SELECT starts_at, ends_at FROM availability_windows WHERE user_id = ${guest} ORDER BY starts_at
  `;
  assert.equal(rows.length, 1);
  assert.equal(new Date(rows[0].starts_at).toISOString(), "2026-12-13T05:00:00.000Z");
  assert.equal(new Date(rows[0].ends_at).toISOString(), "2026-12-13T08:00:00.000Z");
});

test("a weekly window matches a slot that only partly overlaps it", async () => {
  const host = await makeUser("Оля");
  const guest = await makeUser("Нина");
  const partialId = await makeSlot(4, "2026-10-20T12:00:00.000Z", "2026-10-20T14:00:00.000Z");
  const outsideId = await makeSlot(4, "2026-10-20T05:00:00.000Z", "2026-10-20T06:00:00.000Z");
  await createWindow(sql, guest, { kind: "weekly", weekday: 2, localStart: "18:00", localEnd: "22:00" });
  assert.deepEqual((await freePeople(sql, partialId, host, "Нина")).map((person) => person.id), [guest]);
  assert.deepEqual(await freePeople(sql, outsideId, host, "Нина"), []);
});

test("blocked levels and blacklisted names cannot send invitations", async () => {
  const host = await makeUser("Клава");
  const beginner = await makeUser("Прохор");
  const star = await makeUser("Устина");
  const named = await makeUser("Фрол");
  const unset = await makeUser("Харлам");
  const slotId = await makeSlot(8, "2026-12-20T10:00:00.000Z", "2026-12-20T12:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${host}, ${slotId}), (${beginner}, ${slotId})`;
  assert.equal((await setDanceLevel(sql, beginner, "BG")).danceLevel, "BG");
  await setDanceLevel(sql, star, "S");
  assert.deepEqual((await setBlockedLevels(sql, host, ["RS", "BG"])).blockedLevels, ["BG", "RS"]);

  await assert.rejects(createRequest(sql, beginner, slotId, host), (error) => error instanceof HttpError && error.code === "INVITE_BLOCKED");
  assert.deepEqual(await freePeople(sql, slotId, beginner, "Клава"), []);
  const back = await createRequest(sql, host, slotId, beginner);
  assert.equal(back.status, "pending");
  assert.equal((await createRequest(sql, star, slotId, host)).status, "pending");
  assert.equal((await createRequest(sql, unset, slotId, host)).status, "pending");
  assert.equal((await freePeople(sql, slotId, host, "Прохор"))[0].id, beginner);

  await setDanceLevel(sql, beginner, null);
  assert.equal((await createRequest(sql, beginner, slotId, host)).status, "pending");

  const listed = await addToBlacklist(sql, host, named);
  assert.equal(listed.blacklist[0].displayName, "Фрол");
  await assert.rejects(createRequest(sql, named, slotId, host), (error) => error instanceof HttpError && error.code === "INVITE_BLOCKED");
  assert.deepEqual(await freePeople(sql, slotId, named, "Клава"), []);
  assert.deepEqual((await removeFromBlacklist(sql, host, named)).blacklist, []);
  assert.equal((await createRequest(sql, named, slotId, host)).status, "pending");

  assert.deepEqual((await searchDancers(sql, host, "Харлам")).map((person) => person.id), [unset]);
  assert.deepEqual(await searchDancers(sql, unset, "Харлам"), []);
  await assert.rejects(setDanceLevel(sql, host, "BG "), (error) => error instanceof HttpError && error.code === "VALIDATION");
  await assert.rejects(addToBlacklist(sql, host, host), (error) => error instanceof HttpError && error.code === "VALIDATION");
});

test("profile changes are stored together and a blank name keeps the previous profile", async () => {
  const host = await makeUser("Платон");
  const other = await makeUser("Рената");
  const saved = await saveProfile(sql, host, {
    displayName: "  Платон П. ",
    danceLevel: "S",
    blockedLevels: ["CH", "BG"],
    listMode: "black",
    blacklist: [other],
    whitelist: [],
    notifyInvites: false,
    notifyHourBefore: false,
    notifyNewSlots: true,
    notifyNewSlotsScope: "all",
    shareAvailability: true,
  });
  assert.equal(saved.notifyInvites, false);
  assert.equal(saved.notifyHourBefore, false);
  assert.equal(saved.notifyNewSlots, true);
  assert.equal(saved.notifyNewSlotsScope, "all");
  assert.equal(saved.shareAvailability, true);
  assert.equal(saved.displayName, "Платон П.");
  assert.equal(saved.danceLevel, "S");
  assert.deepEqual(saved.blockedLevels, ["BG", "CH"]);
  assert.equal(saved.listMode, "black");
  assert.deepEqual(saved.blacklist.map((person) => person.id), [other]);
  assert.deepEqual(saved.whitelist, []);
  await assert.rejects(
    saveProfile(sql, host, { displayName: "   ", danceLevel: null, blockedLevels: [], blacklist: [] }),
    (error) => error instanceof HttpError && error.code === "VALIDATION",
  );
  const kept = await profileSettings(sql, host);
  assert.equal(kept.displayName, "Платон П.");
  assert.equal(kept.danceLevel, "S");
  assert.deepEqual(kept.blockedLevels, ["BG", "CH"]);
  assert.deepEqual(kept.blacklist.map((person) => person.id), [other]);
  assert.equal(kept.listMode, "black");
});

test("the active list decides who can send an invitation", async () => {
  const host = await makeUser("Савва");
  const allowed = await makeUser("Сима");
  const other = await makeUser("Тихон");
  const slotId = await makeSlot(8, "2026-12-21T10:00:00.000Z", "2026-12-21T12:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${host}, ${slotId})`;
  await saveProfile(sql, host, {
    displayName: "Савва",
    danceLevel: null,
    blockedLevels: [],
    listMode: "white",
    blacklist: [other],
    whitelist: [allowed],
    notifyInvites: true,
    notifyHourBefore: true,
    notifyNewSlots: false,
    notifyNewSlotsScope: "free",
    shareAvailability: false,
  });
  assert.equal((await createRequest(sql, allowed, slotId, host)).status, "pending");
  await assert.rejects(createRequest(sql, other, slotId, host), (error) => error instanceof HttpError && error.code === "INVITE_BLOCKED");
  assert.deepEqual(await freePeople(sql, slotId, other, "Савва"), []);

  await saveProfile(sql, host, {
    displayName: "Савва",
    danceLevel: null,
    blockedLevels: [],
    listMode: "black",
    blacklist: [other],
    whitelist: [allowed],
    notifyInvites: true,
    notifyHourBefore: true,
    notifyNewSlots: false,
    notifyNewSlotsScope: "free",
    shareAvailability: false,
  });
  const outsider = await makeUser("Фаина");
  assert.equal((await createRequest(sql, outsider, slotId, host)).status, "pending");
  await assert.rejects(createRequest(sql, other, slotId, host), (error) => error instanceof HttpError && error.code === "INVITE_BLOCKED");
});

test("visited sampo count after they end, for this studio month and in total", async () => {
  const user = await makeUser("Мирон");
  const october = await makeSlot(4, "2026-10-02T10:00:00.000Z", "2026-10-02T12:00:00.000Z");
  const september = await makeSlot(4, "2026-09-02T10:00:00.000Z", "2026-09-02T12:00:00.000Z");
  const later = await makeSlot(4, "2026-10-20T10:00:00.000Z", "2026-10-20T12:00:00.000Z");
  const cancelled = await makeSlot(4, "2026-10-03T10:00:00.000Z", "2026-10-03T12:00:00.000Z");
  await sql`UPDATE slots SET status = 'cancelled' WHERE id = ${cancelled}`;
  await sql`
    INSERT INTO attendances (user_id, slot_id)
    VALUES (${user}, ${october}), (${user}, ${september}), (${user}, ${later}), (${user}, ${cancelled})
  `;
  const settings = await profileSettings(sql, user, new Date("2026-10-13T08:00:00.000Z"));
  assert.equal(settings.visits.month, 1);
  assert.equal(settings.visits.previous, 1);
  assert.equal(settings.visits.previousMonth, 9);
  assert.equal(settings.visits.total, 2);

  const december = await makeSlot(4, "2026-12-02T10:00:00.000Z", "2026-12-02T12:00:00.000Z");
  await sql`INSERT INTO attendances (user_id, slot_id) VALUES (${user}, ${december})`;
  const summary = await ratingSummary(sql, user, new Date("2027-01-15T08:00:00.000Z"));
  assert.equal(summary.visits.month, 0);
  assert.equal(summary.visits.previous, 1);
  assert.equal(summary.visits.previousMonth, 12);
  assert.equal(summary.visits.total, 4);
});

test("rating lists the three dancers with the most sampo, by total and by month", async () => {
  const now = new Date("2026-10-13T08:00:00.000Z");
  const monthStart = new Date("2026-09-30T19:00:00.000Z");
  const monthNext = new Date("2026-10-31T19:00:00.000Z");
  const [counts] = await sql`
    SELECT coalesce(max(total), 0)::int AS total, coalesce(max(month), 0)::int AS month
    FROM (
      SELECT
        count(*) FILTER (WHERE s.status = 'open' AND s.ends_at <= ${now})::int AS total,
        count(*) FILTER (
          WHERE s.status = 'open' AND s.ends_at <= ${now}
            AND s.starts_at >= ${monthStart} AND s.starts_at < ${monthNext}
        )::int AS month
      FROM attendances a
      JOIN slots s ON s.id = a.slot_id
      GROUP BY a.user_id
    ) ranked
  `;
  const septemberCount = Math.max(counts.total, counts.month) + 10;
  const octoberCount = counts.month + 3;
  const september = await makeEndedSlots(septemberCount, "2026-09-02T10:00:00.000Z");
  const october = await makeEndedSlots(octoberCount, "2026-10-02T10:00:00.000Z");
  const later = await makeEndedSlots(1, "2026-10-20T10:00:00.000Z");
  const cancelled = await makeEndedSlots(1, "2026-10-04T10:00:00.000Z");
  await sql`UPDATE slots SET status = 'cancelled' WHERE id = ${cancelled[0]}`;

  const byTotal = await makeUser("Яна рейтинг");
  const byMonth = await makeUser("Анна рейтинг");
  const absent = await makeUser("Нуль рейтинг");
  const admin = await makeUser("Админ рейтинг");
  await sql`UPDATE users SET app_role = 'admin' WHERE id = ${admin}`;
  await attendSlots(byTotal, [...september, october[0], later[0], cancelled[0]]);
  await attendSlots(byMonth, october);
  await attendSlots(admin, [...september, ...october]);

  const summary = await ratingSummary(sql, byTotal, now);
  assert.equal(summary.leaders.total.length <= 3, true);
  assert.equal(summary.leaders.month.length <= 3, true);
  assert.equal(summary.place.total, 1);
  assert.equal(summary.leaders.total[0].id, byTotal);
  assert.equal(summary.leaders.total[0].displayName, "Яна рейтинг");
  assert.equal(summary.leaders.total[0].total, septemberCount + 1);
  assert.equal(summary.leaders.total[0].month, 1);
  assert.equal(summary.leaders.month[0].id, byMonth);
  assert.equal(summary.leaders.month[0].month, octoberCount);
  assert.equal(summary.leaders.month[0].total, octoberCount);
  const monthSummary = await ratingSummary(sql, byMonth, now);
  assert.equal(monthSummary.place.month, 1);
  for (const list of [summary.leaders.total, summary.leaders.month]) {
    assert.equal(list.some((person) => person.id === admin || person.id === absent), false);
  }
});

test("a finished sampo with a partner is an achievement on the rating and the dancer page", async () => {
  const user = await makeUser("Ачивка");
  const partner = await makeUser("Пара ачивки");
  const slotId = await makeSlot(4, "2026-10-05T05:00:00.000Z", "2026-10-05T08:00:00.000Z");
  const cancelled = await makeSlot(4, "2026-10-06T05:00:00.000Z", "2026-10-06T07:00:00.000Z");
  const future = await makeSlot(4, "2026-10-20T05:00:00.000Z", "2026-10-20T07:00:00.000Z");
  await sql`UPDATE slots SET status = 'cancelled' WHERE id = ${cancelled}`;
  await sql`
    INSERT INTO attendances (user_id, slot_id)
    VALUES (${user}, ${slotId}), (${user}, ${cancelled}), (${user}, ${future})
  `;
  const requestId = crypto.randomUUID();
  await sql`
    INSERT INTO sampo_requests (id, slot_id, from_user_id, to_user_id, status)
    VALUES (${requestId}, ${slotId}, ${user}, ${partner}, 'accepted')
  `;
  await sql`
    INSERT INTO pairs (id, slot_id, user_low_id, user_high_id, request_id, status)
    SELECT ${crypto.randomUUID()}, ${slotId}, least(${user}::uuid, ${partner}::uuid), greatest(${user}::uuid, ${partner}::uuid), ${requestId}, 'confirmed'
  `;
  const now = new Date("2026-10-13T08:00:00.000Z");
  const summary = await ratingSummary(sql, user, now);
  const earned = new Set(summary.achievements.filter((item) => item.earned).map((item) => item.id));
  assert.equal(summary.achievements.length >= 20, true);
  assert.equal(earned.has("first-step"), true);
  assert.equal(earned.has("first-pair"), true);
  assert.equal(earned.has("monday"), true);
  assert.equal(earned.has("long-set"), true);
  assert.equal(earned.has("five"), false);
  const viewer = await makeUser("Зритель ачивки");
  const profile = await dancerProfile(sql, viewer, user);
  assert.equal(profile.achievements.find((item) => item.id === "first-pair").earned, true);
  assert.equal(profile.achievements.find((item) => item.id === "hundred").earned, false);
});

test("invitation notices follow the profile switch and the hour reminder is sent once", async () => {
  const host = await makeUser("Настя");
  const guest = await makeUser("Осип");
  const quiet = await makeUser("Рада");
  const loud = await makeUser("Семён");
  const slotId = await makeSlot(4, "2026-12-22T10:00:00.000Z", "2026-12-22T12:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${host}, ${slotId})`;
  await sql`UPDATE users SET notify_invites = false WHERE id = ${host}`;
  await createRequest(sql, guest, slotId, host);
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM notifications WHERE user_id = ${host}`;
  assert.equal(count, 0);

  const start = new Date(Date.now() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const soon = await makeSlot(4, start.toISOString(), end.toISOString());
  await sql`INSERT INTO attendances (user_id, slot_id) VALUES (${quiet}, ${soon}), (${loud}, ${soon})`;
  await sql`UPDATE users SET notify_hour_before = false WHERE id = ${quiet}`;
  await sql`UPDATE users SET notify_hour_before = true WHERE id = ${loud}`;
  await remindDue(sql);
  await remindDue(sql);
  const quietNotes = await sql`SELECT count(*)::int AS count FROM notifications WHERE user_id = ${quiet} AND type = 'slot_reminder'`;
  const loudNotes = await sql`SELECT count(*)::int AS count FROM notifications WHERE user_id = ${loud} AND type = 'slot_reminder'`;
  assert.equal(quietNotes[0].count, 0);
  assert.equal(loudNotes[0].count, 1);
});

test("a new user starts with notification switches off", async () => {
  const fresh = await profileSettings(sql, await makeUser("Глеб"));
  assert.equal(fresh.notifyInvites, false);
  assert.equal(fresh.notifyHourBefore, false);
  assert.equal(fresh.notifyNewSlots, false);
  assert.equal(fresh.notifyNewSlotsScope, "free");
});

test("new slot notices follow the free-window or all-slots choice", async () => {
  const quiet = await makeUser("Зоя");
  const freeUser = await makeUser("Илья");
  const allUser = await makeUser("Кира");
  const admin = await makeUser("Админ слотов");
  await createWindow(sql, freeUser, { kind: "once", startsAtLocal: "2026-12-10T17:00", endsAtLocal: "2026-12-10T21:00" });
  await sql`UPDATE users SET notify_new_slots = true, notify_new_slots_scope = 'free' WHERE id = ${freeUser}`;
  await sql`UPDATE users SET notify_new_slots = true, notify_new_slots_scope = 'all' WHERE id = ${allUser}`;
  await sql`UPDATE users SET notify_new_slots = true, notify_new_slots_scope = 'all', app_role = 'admin' WHERE id = ${admin}`;

  const inside = await makeSlot(4, "2026-12-10T13:00:00.000Z", "2026-12-10T15:00:00.000Z");
  const outside = await makeSlot(4, "2026-12-10T05:00:00.000Z", "2026-12-10T07:00:00.000Z");
  const partial = await makeSlot(4, "2026-12-10T15:30:00.000Z", "2026-12-10T17:00:00.000Z");
  const past = await makeSlot(4, "2026-01-10T13:00:00.000Z", "2026-01-10T15:00:00.000Z");
  const rows = await sql`SELECT * FROM slots WHERE id IN ${sql([inside, outside, partial, past])}`;
  await announceNewSlots(sql, rows);

  const freeNotes = await sql`SELECT payload->>'slotId' AS slot_id FROM notifications WHERE user_id = ${freeUser} AND type = 'slot_opened'`;
  const allNotes = await sql`SELECT payload->>'slotId' AS slot_id, payload->>'text' AS text FROM notifications WHERE user_id = ${allUser} AND type = 'slot_opened'`;
  const quietNotes = await sql`SELECT count(*)::int AS count FROM notifications WHERE user_id = ${quiet} AND type = 'slot_opened'`;
  const adminNotes = await sql`SELECT count(*)::int AS count FROM notifications WHERE user_id = ${admin} AND type = 'slot_opened'`;
  assert.deepEqual(freeNotes.map((row) => row.slot_id), [inside]);
  assert.deepEqual(allNotes.map((row) => row.slot_id).sort(), [inside, outside, partial].sort());
  assert.equal(allNotes[0].text, "Появился новый слот сампо");
  assert.equal(quietNotes[0].count, 0);
  assert.equal(adminNotes[0].count, 0);

  await assert.rejects(
    saveProfile(sql, freeUser, {
      displayName: "Илья",
      danceLevel: null,
      blockedLevels: [],
      listMode: "black",
      blacklist: [],
      whitelist: [],
      notifyInvites: false,
      notifyHourBefore: false,
      notifyNewSlots: true,
      notifyNewSlotsScope: "weekly",
      shareAvailability: false,
    }),
    (error) => error instanceof HttpError && error.code === "VALIDATION",
  );
});

test("a dancer profile shares the three nearest free slots only when the viewer is allowed", async () => {
  const viewer = await makeUser("Эдуард");
  const dancer = await makeUser("Карина");
  await sql`UPDATE users SET dance_level = 'RS' WHERE id = ${dancer}`;
  const ended = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const past = await makeSlot(4, ended.toISOString(), new Date(ended.getTime() + 2 * 60 * 60 * 1000).toISOString());
  await sql`INSERT INTO attendances (user_id, slot_id) VALUES (${dancer}, ${past})`;
  const ids = [];
  for (const day of [2, 3, 4, 5, 6]) {
    const start = new Date(Date.now() + day * 24 * 60 * 60 * 1000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    ids.push(await makeSlot(4, start.toISOString(), end.toISOString()));
  }
  await sql`
    INSERT INTO availabilities (user_id, slot_id)
    VALUES (${dancer}, ${ids[0]}), (${dancer}, ${ids[1]}), (${dancer}, ${ids[2]}), (${dancer}, ${ids[3]}), (${dancer}, ${ids[4]})
  `;
  await sql`INSERT INTO attendances (user_id, slot_id) VALUES (${dancer}, ${ids[1]})`;

  const closed = await dancerProfile(sql, viewer, dancer);
  assert.equal(closed.displayName, "Карина");
  assert.equal(closed.danceLevel, "RS");
  assert.equal(closed.visits.total, 1);
  assert.equal(closed.slots, null);

  await sql`UPDATE users SET share_availability = true WHERE id = ${dancer}`;
  assert.deepEqual((await dancerProfile(sql, viewer, dancer)).slots.map((slot) => slot.id), [ids[0], ids[2], ids[3]]);

  await addToBlacklist(sql, dancer, viewer);
  assert.equal((await dancerProfile(sql, viewer, dancer)).slots, null);
  await removeFromBlacklist(sql, dancer, viewer);
  await sql`UPDATE users SET invite_list = 'white' WHERE id = ${dancer}`;
  assert.equal((await dancerProfile(sql, viewer, dancer)).slots, null);
  await addToWhitelist(sql, dancer, viewer);
  assert.deepEqual((await dancerProfile(sql, viewer, dancer)).slots.map((slot) => slot.id), [ids[0], ids[2], ids[3]]);

  await addToBlacklist(sql, viewer, dancer);
  await addToWhitelist(sql, viewer, dancer);
  const listed = await dancerProfile(sql, viewer, dancer);
  assert.equal(listed.blacklisted, true);
  assert.equal(listed.whitelisted, true);
  await sql`UPDATE users SET dance_level = 'BG' WHERE id = ${viewer}`;
  await sql`INSERT INTO invitation_blocks (user_id, level) VALUES (${dancer}, 'BG')`;
  assert.equal((await dancerProfile(sql, viewer, dancer)).slots.length, 3);
  const [{ login }] = await sql`SELECT login FROM users WHERE id = ${dancer}`;
  const byLogin = await dancerProfile(sql, viewer, login.toUpperCase());
  assert.equal(byLogin.id, dancer);
  assert.equal(byLogin.login, login);
  await assert.rejects(dancerProfile(sql, viewer, "no-such"), (error) => error instanceof HttpError && error.code === "NOT_FOUND");
  await assert.rejects(dancerProfile(sql, dancer, dancer), (error) => error instanceof HttpError && error.code === "VALIDATION");
  await assert.rejects(dancerProfile(sql, dancer, login), (error) => error instanceof HttpError && error.code === "VALIDATION");
});

test("deleting a profile removes that dancer and keeps the partner's visit", async () => {
  const owner = await makeUser("Инга");
  const partner = await makeUser("Марк");
  const [{ login }] = await sql`SELECT login FROM users WHERE id = ${owner}`;
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const slotId = await makeSlot(4, start.toISOString(), new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString());
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${partner}, ${slotId})`;
  const request = await createRequest(sql, owner, slotId, partner);
  await acceptRequest(sql, partner, request.id);
  await addToBlacklist(sql, partner, owner);
  await sql`INSERT INTO invitation_blocks (user_id, level) VALUES (${owner}, 'M')`;
  await sql`
    INSERT INTO refresh_sessions (id, user_id, login_user_id, token_hash, expires_at)
    VALUES (${crypto.randomUUID()}, ${owner}, ${owner}, ${crypto.randomUUID()}, ${new Date(Date.now() + 60_000)})
  `;
  await sql`
    INSERT INTO notifications (id, user_id, type, payload)
    VALUES (${crypto.randomUUID()}, ${owner}, 'slot_reminder', ${sql.json({ text: "скоро" })})
  `;

  await deleteProfile(sql, owner);

  const [gone] = await sql`SELECT id FROM users WHERE id = ${owner} OR login = ${login}`;
  assert.equal(gone, undefined);
  const [still] = await sql`SELECT id FROM users WHERE id = ${partner}`;
  assert.equal(still.id, partner);
  assert.equal(await attendanceCount(partner, slotId), 1);
  assert.equal(await attendanceCount(owner, slotId), 0);
  const [blocked] = await sql`SELECT 1 FROM dancer_blacklist WHERE blocked_user_id = ${owner} OR user_id = ${owner}`;
  assert.equal(blocked, undefined);
  const [pair] = await sql`SELECT 1 FROM pairs WHERE user_low_id = ${owner} OR user_high_id = ${owner}`;
  assert.equal(pair, undefined);
  const [note] = await sql`SELECT 1 FROM notifications WHERE user_id = ${owner}`;
  assert.equal(note, undefined);
  const [session] = await sql`SELECT 1 FROM refresh_sessions WHERE user_id = ${owner}`;
  assert.equal(session, undefined);
  const [slot] = await sql`SELECT id FROM slots WHERE id = ${slotId}`;
  assert.equal(slot.id, slotId);
});
