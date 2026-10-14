import assert from "node:assert/strict";
import test, { describe } from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import { createRequest } from "../domain/sampo.js";
import { HttpError } from "../http/errors.js";
import { deliverPendingPush, pushMessage, removePushSubscription, savePushSubscription } from "./push.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const users = [];
const slots = [];
const config = {
  vapidPublicKey: "BTestPublicKey",
  vapidPrivateKey: "TestPrivateKey",
  vapidSubject: "mailto:admin@example.com",
};

function endpoint(name) {
  return `https://push.example.test/${name}/${crypto.randomUUID()}`;
}

async function makeUser(name) {
  const id = crypto.randomUUID();
  const login = `p${id.replaceAll("-", "").slice(0, 12)}`;
  await sql`INSERT INTO users (id, login, password_hash, display_name) VALUES (${id}, ${login}, 'x', ${name})`;
  users.push(id);
  return id;
}

async function makeSlot() {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO slots (id, starts_at, ends_at, place, capacity)
    VALUES (${id}, ${new Date("2026-12-15T14:00:00.000Z")}, ${new Date("2026-12-15T16:00:00.000Z")}, 'Hall', 4)
  `;
  slots.push(id);
  return id;
}

async function delivery(userId, type = "request_received") {
  const [row] = await sql`
    SELECT d.id, d.status, d.channel, d.attempts, d.last_error, d.notification_id, d.next_attempt_at
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${userId} AND n.type = ${type} AND d.channel = 'push'
    ORDER BY d.created_at DESC
    LIMIT 1
  `;
  return row;
}

test("an incoming request push carries confirm and decline actions", () => {
  const requestId = crypto.randomUUID();
  const incoming = pushMessage({
    id: "note-1",
    type: "request_received",
    payload: { text: "Миша приглашает вас на сампо 14 октября, 19:00, Hall", requestId },
  });
  assert.equal(incoming.data.url, `/requests/${requestId}`);
  assert.deepEqual(
    incoming.actions.map((action) => action.action),
    ["accept", "decline"],
  );

  const accepted = pushMessage({
    id: "note-2",
    type: "request_accepted",
    payload: { text: "подтвердил", requestId, slotId: "slot-1" },
  });
  assert.equal(accepted.actions, undefined);
  assert.equal(accepted.data.url, `/requests/${requestId}`);

  const reminder = pushMessage({
    id: "note-3",
    type: "slot_reminder",
    payload: { text: "Через час", slotId: "slot-9" },
  });
  assert.equal(reminder.data.url, "/slots/slot-9");

  const apple = pushMessage(
    { id: "note-4", type: "request_received", payload: { text: "приглашение", requestId } },
    { apple: true },
  );
  assert.equal(apple.actions, undefined);
  assert.equal(apple.data.url, `/requests/${requestId}`);
});

describe("push delivery", { concurrency: false }, () => {
  test("one browser endpoint belongs to the latest signed-in user", async () => {
    const first = await makeUser("Аня");
    const second = await makeUser("Боря");
    const url = endpoint("phone");
    const body = { endpoint: url, keys: { p256dh: "p256", auth: "auth" } };
    await savePushSubscription(sql, first, body);
    await savePushSubscription(sql, second, { ...body, keys: { p256dh: "next", auth: "secret" } });
    const rows = await sql`SELECT user_id, p256dh FROM push_subscriptions WHERE endpoint = ${url}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, second);
    assert.equal(rows[0].p256dh, "next");
    await removePushSubscription(sql, first, url);
    assert.equal((await sql`SELECT id FROM push_subscriptions WHERE endpoint = ${url}`).length, 1);
    await removePushSubscription(sql, second, url);
    assert.equal((await sql`SELECT id FROM push_subscriptions WHERE endpoint = ${url}`).length, 0);
    await assert.rejects(
      savePushSubscription(sql, first, { endpoint: "http://push.example.test/insecure", keys: { p256dh: "p", auth: "a" } }),
      (error) => error instanceof HttpError && error.code === "VALIDATION",
    );
  });

  test("a subscribed dancer gets a pending push and an unsubscribed one is skipped", async () => {
    const host = await makeUser("Вера");
    const guest = await makeUser("Глеб");
    const quiet = await makeUser("Дина");
    const slotId = await makeSlot();
    await sql`
      INSERT INTO availabilities (user_id, slot_id)
      VALUES (${guest}, ${slotId}), (${quiet}, ${slotId})
    `;
    await savePushSubscription(sql, guest, {
      endpoint: endpoint("guest"),
      keys: { p256dh: "guest-key", auth: "guest-auth" },
    });

    await createRequest(sql, host, slotId, guest);
    await createRequest(sql, host, slotId, quiet);
    const sentTo = [];
    const push = await delivery(guest);
    const skipped = await delivery(quiet);
    assert.equal(push.status, "pending");
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.last_error, "Нет подписки на уведомления");

    const [vk] = await sql`
      SELECT status, last_error
      FROM notification_deliveries
      WHERE notification_id = ${push.notification_id} AND channel = 'vk'
    `;
    assert.equal(vk.status, "skipped");

    const result = await deliverPendingPush(sql, config, {
      notificationIds: [push.notification_id],
      send: (subscription, body) => {
        sentTo.push({ subscription, body: JSON.parse(body) });
      },
    });
    assert.equal(result.sent, 1);
    assert.equal(sentTo.length, 1);
    assert.equal(sentTo[0].subscription.endpoint.includes("guest"), true);
    assert.equal(sentTo[0].body.data.requestId !== null, true);
    assert.ok(sentTo[0].body.actions);
    assert.deepEqual(
      sentTo[0].body.actions.map((action) => action.title),
      ["Подтвердить", "Отказать"],
    );
    assert.equal((await delivery(guest)).status, "sent");
  });

  test("an expired browser subscription is removed without another attempt", async () => {
    const user = await makeUser("Ева");
    const noteId = crypto.randomUUID();
    const url = endpoint("stale");
    await sql`
      INSERT INTO notifications (id, user_id, type, payload)
      VALUES (${noteId}, ${user}, 'request_accepted', ${sql.json({ text: "подтвердил", requestId: crypto.randomUUID() })})
    `;
    await sql`
      INSERT INTO notification_deliveries (id, notification_id, channel, status)
      VALUES (${crypto.randomUUID()}, ${noteId}, 'push', 'pending')
    `;
    await savePushSubscription(sql, user, { endpoint: url, keys: { p256dh: "old", auth: "old" } });
    const error = new Error("gone");
    error.statusCode = 410;
    await deliverPendingPush(sql, config, {
      notificationIds: [noteId],
      send: () => {
        throw error;
      },
    });
    const [row] = await sql`SELECT status, last_error FROM notification_deliveries WHERE notification_id = ${noteId}`;
    assert.equal(row.status, "skipped");
    assert.equal(row.last_error, "Подписка устарела");
    assert.equal((await sql`SELECT id FROM push_subscriptions WHERE endpoint = ${url}`).length, 0);
  });

  test("a failed send waits and stops after the fifth attempt", async () => {
    const user = await makeUser("Женя");
    const noteId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    await sql`
      INSERT INTO notifications (id, user_id, type, payload)
      VALUES (${noteId}, ${user}, 'slot_cancelled', ${sql.json({ text: "отменено", slotId: crypto.randomUUID() })})
    `;
    await sql`
      INSERT INTO notification_deliveries (id, notification_id, channel, status, attempts)
      VALUES (${deliveryId}, ${noteId}, 'push', 'pending', 0)
    `;
    await savePushSubscription(sql, user, { endpoint: endpoint("flaky"), keys: { p256dh: "k", auth: "a" } });
    const error = new Error("busy");
    error.statusCode = 503;
    await deliverPendingPush(sql, config, {
      notificationIds: [noteId],
      send: () => {
        throw error;
      },
    });
    const [waiting] = await sql`
      SELECT status, attempts, next_attempt_at FROM notification_deliveries WHERE id = ${deliveryId}
    `;
    assert.equal(waiting.status, "pending");
    assert.equal(waiting.attempts, 1);
    assert.ok(new Date(waiting.next_attempt_at).getTime() > Date.now() + 10_000);

    await sql`
      UPDATE notification_deliveries
      SET attempts = 4, next_attempt_at = now() - interval '1 minute'
      WHERE id = ${deliveryId}
    `;
    await deliverPendingPush(sql, config, {
      notificationIds: [noteId],
      send: () => {
        throw error;
      },
    });
    const [stopped] = await sql`SELECT status, attempts FROM notification_deliveries WHERE id = ${deliveryId}`;
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.attempts, 5);
  });

  test("a push scheduled for later is left untouched", async () => {
    const user = await makeUser("Зоя");
    const noteId = crypto.randomUUID();
    await sql`
      INSERT INTO notifications (id, user_id, type, payload)
      VALUES (${noteId}, ${user}, 'slot_reminder', ${sql.json({ text: "через час", slotId: crypto.randomUUID() })})
    `;
    await sql`
      INSERT INTO notification_deliveries (id, notification_id, channel, status, next_attempt_at)
      VALUES (${crypto.randomUUID()}, ${noteId}, 'push', 'pending', now() + interval '1 hour')
    `;
    const result = await deliverPendingPush(sql, config, {
      notificationIds: [noteId],
      send: () => {
        throw new Error("не должны отправлять");
      },
    });
    assert.equal(result.sent, 0);
    const [row] = await sql`SELECT status, attempts FROM notification_deliveries WHERE notification_id = ${noteId}`;
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 0);
  });
});

test.after(async () => {
  if (slots.length) await sql`DELETE FROM slots WHERE id IN ${sql(slots)}`;
  if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  await sql.end({ timeout: 5 });
});
