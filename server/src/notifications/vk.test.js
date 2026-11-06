import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import { createRequest } from "../domain/sampo.js";
import { deliverPendingVk, handleVkCallback, vkMessage, vkRandomId } from "./vk.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const users = [];
const slots = [];
const config = {
  appOrigin: "https://vparaplane.ru",
  vkCommunityToken: "community-token",
  vkCommunityId: "242279722",
  vkCallbackSecret: "callback-secret",
  vkCallbackConfirmation: "confirm-me",
};

function vkId() {
  return 700_000_000 + Math.floor(Math.random() * 200_000_000);
}

async function makeUser(name, options = {}) {
  const id = crypto.randomUUID();
  const login = `v${id.replaceAll("-", "").slice(0, 12)}`;
  await sql`
    INSERT INTO users (id, login, password_hash, display_name, vk_user_id, notify_channel, notify_invites)
    VALUES (
      ${id},
      ${login},
      'x',
      ${name},
      ${options.vkUserId ?? null},
      ${options.channel ?? "push"},
      ${options.invites ?? false}
    )
  `;
  users.push(id);
  return id;
}

async function makeSlot(start = "2026-12-16T14:00:00.000Z") {
  const id = crypto.randomUUID();
  const startsAt = new Date(start);
  await sql`
    INSERT INTO slots (id, starts_at, ends_at, place, capacity)
    VALUES (${id}, ${startsAt}, ${new Date(startsAt.getTime() + 2 * 60 * 60 * 1000)}, 'Зал', 4)
  `;
  slots.push(id);
  return id;
}

test("an incoming request message carries confirm and decline buttons", () => {
  const requestId = crypto.randomUUID();
  const incoming = vkMessage({
    type: "request_received",
    payload: { text: "У вас новое приглашение от Миша", requestId },
  }, "https://vparaplane.ru");
  const keyboard = JSON.parse(incoming.keyboard);
  assert.equal(incoming.message, "У вас новое приглашение от Миша");
  assert.equal(keyboard.inline, true);
  assert.deepEqual(
    keyboard.buttons[0].map((item) => item.action.label),
    ["Подтвердить", "Отказать"],
  );
  assert.deepEqual(JSON.parse(keyboard.buttons[0][0].action.payload), { requestId, action: "accept" });
  assert.equal(vkRandomId(requestId), vkRandomId(requestId));

  const accepted = vkMessage({
    type: "request_accepted",
    payload: { text: "Миша подтвердил сампо", requestId },
  }, "https://vparaplane.ru");
  assert.equal(accepted.keyboard, null);
  assert.equal(accepted.message, `Миша подтвердил сампо\nhttps://vparaplane.ru/requests/${requestId}`);
});

test("the community confirmation answers with the configured string", async () => {
  const ok = await handleVkCallback(sql, config, { type: "confirmation", group_id: 242279722 });
  assert.deepEqual(ok, { status: 200, text: "confirm-me" });
  const foreign = await handleVkCallback(sql, config, { type: "confirmation", group_id: 1 });
  assert.equal(foreign.status, 403);
  const unsigned = await handleVkCallback(sql, config, { type: "message_event", group_id: 242279722, secret: "other" });
  assert.equal(unsigned.status, 403);
});

test("a dancer who chose VK gets a community message, and a phone choice skips it", async () => {
  const host = await makeUser("Вера");
  const guestVk = vkId();
  const guest = await makeUser("Глеб", { vkUserId: guestVk, channel: "vk", invites: true });
  const phone = await makeUser("Дина", { vkUserId: vkId(), channel: "push", invites: true });
  const slotId = await makeSlot();
  await sql`
    INSERT INTO availabilities (user_id, slot_id)
    VALUES (${guest}, ${slotId}), (${phone}, ${slotId})
  `;
  const request = await createRequest(sql, host, slotId, guest);
  await createRequest(sql, host, slotId, phone);

  const [vk] = await sql`
    SELECT d.id, d.status, d.notification_id
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${guest} AND d.channel = 'vk'
  `;
  const [push] = await sql`
    SELECT status, last_error
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${guest} AND d.channel = 'push'
  `;
  const [phoneVk] = await sql`
    SELECT status, last_error
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${phone} AND d.channel = 'vk'
  `;
  assert.equal(vk.status, "pending");
  assert.equal(push.status, "skipped");
  assert.equal(push.last_error, "Выбраны сообщения ВК");
  assert.equal(phoneVk.status, "skipped");
  assert.equal(phoneVk.last_error, "Выбраны уведомления на телефон");

  const sent = [];
  const result = await deliverPendingVk(sql, config, {
    notificationIds: [vk.notification_id],
    send: (payload) => {
      sent.push(payload);
    },
  });
  assert.equal(result.sent, 1);
  assert.equal(sent[0].peerId, guestVk);
  assert.equal(sent[0].randomId, vkRandomId(vk.id));
  assert.match(sent[0].keyboard, /Подтвердить/);
  const [after] = await sql`SELECT status FROM notification_deliveries WHERE id = ${vk.id}`;
  assert.equal(after.status, "sent");

  const denied = new Error("denied");
  denied.code = 901;
  const quiet = await makeUser("Ева", { vkUserId: vkId(), channel: "vk", invites: true });
  const otherSlot = await makeSlot("2026-12-17T14:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${quiet}, ${otherSlot})`;
  await createRequest(sql, host, otherSlot, quiet);
  const [blocked] = await sql`
    SELECT d.notification_id
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${quiet} AND d.channel = 'vk'
  `;
  await deliverPendingVk(sql, config, {
    notificationIds: [blocked.notification_id],
    send: () => {
      throw denied;
    },
  });
  const [failed] = await sql`
    SELECT status, last_error, attempts
    FROM notification_deliveries
    WHERE notification_id = ${blocked.notification_id} AND channel = 'vk'
  `;
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error, "Пользователь не разрешил сообщения сообщества");

  const first = await handleVkCallback(sql, config, {
    type: "message_event",
    group_id: "242279722",
    secret: config.vkCallbackSecret,
    object: { user_id: guestVk, payload: { requestId: request.id, action: "accept" } },
  });
  assert.equal(first.json.response.text, "Сампо подтверждено");
  const [{ pairs }] = await sql`SELECT count(*)::int AS pairs FROM pairs WHERE request_id = ${request.id}`;
  assert.equal(pairs, 1);
  const second = await handleVkCallback(sql, config, {
    type: "message_event",
    group_id: 242279722,
    secret: config.vkCallbackSecret,
    object: { user_id: guestVk, payload: JSON.stringify({ requestId: request.id, action: "accept" }) },
  });
  assert.equal(second.json.response.text, "Сампо подтверждено");
  const [{ pairs: still }] = await sql`SELECT count(*)::int AS pairs FROM pairs WHERE request_id = ${request.id}`;
  assert.equal(still, 1);

  const stranger = await handleVkCallback(sql, config, {
    type: "message_event",
    group_id: 242279722,
    secret: config.vkCallbackSecret,
    object: { user_id: vkId(), payload: { requestId: request.id, action: "decline" } },
  });
  assert.equal(stranger.json.response.text, "Запрос уже закрыт");
  const [{ status }] = await sql`SELECT status FROM sampo_requests WHERE id = ${request.id}`;
  assert.equal(status, "accepted");
});

test.after(async () => {
  if (slots.length) await sql`DELETE FROM slots WHERE id IN ${sql(slots)}`;
  if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  await sql.end({ timeout: 5 });
});
