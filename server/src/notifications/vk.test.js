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
    payload: {
      text: "У вас новое приглашение от Миша",
      requestId,
      place: "Зал",
      startsAt: "2026-10-14T14:00:00.000Z",
    },
  }, "https://vparaplane.ru");
  const keyboard = JSON.parse(incoming.keyboard);
  assert.equal(incoming.message, "У вас новое приглашение от Миша\n14 октября, 19:00, Зал");
  assert.equal(keyboard.inline, true);
  assert.deepEqual(
    keyboard.buttons[0].map((item) => item.action.label),
    ["Принять", "Отказать"],
  );
  assert.deepEqual(keyboard.buttons[1][0].action, {
    type: "open_link",
    label: "Посмотреть",
    link: `https://vparaplane.ru/requests/${requestId}`,
  });
  assert.deepEqual(JSON.parse(keyboard.buttons[0][0].action.payload), { requestId, action: "accept" });
  assert.equal(vkRandomId(requestId), vkRandomId(requestId));

  const accepted = vkMessage({
    type: "request_accepted",
    payload: { text: "Миша подтвердил сампо", requestId },
  }, "https://vparaplane.ru");
  assert.equal(accepted.message, "Миша подтвердил сампо");
  assert.deepEqual(JSON.parse(accepted.keyboard).buttons[0][0].action, {
    type: "open_link",
    label: "Посмотреть",
    link: `https://vparaplane.ru/requests/${requestId}`,
  });

  const slotId = crypto.randomUUID();
  const opened = vkMessage({
    type: "slot_opened",
    payload: {
      text: "Появился новый слот сампо",
      slotId,
      place: "Зал 1",
      startsAt: "2026-10-14T14:00:00.000Z",
    },
  }, "https://vparaplane.ru");
  assert.equal(opened.message, "Появился новый слот сампо\n14 октября, 19:00, Зал 1");
  assert.deepEqual(JSON.parse(opened.keyboard).buttons[0][0].action, {
    type: "open_link",
    label: "Посмотреть",
    link: `https://vparaplane.ru/slots/${slotId}`,
  });
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
  assert.match(sent[0].keyboard, /Принять/);
  const [after] = await sql`SELECT status FROM notification_deliveries WHERE id = ${vk.id}`;
  assert.equal(after.status, "sent");

  const blockedButtons = new Error("This is a chat bot feature, change this status in settings: Chat bot feature");
  blockedButtons.code = 912;
  const fallbackUser = await makeUser("Юля", { vkUserId: vkId(), channel: "vk", invites: true });
  const fallbackSlot = await makeSlot("2026-12-18T14:00:00.000Z");
  await sql`INSERT INTO availabilities (user_id, slot_id) VALUES (${fallbackUser}, ${fallbackSlot})`;
  await createRequest(sql, host, fallbackSlot, fallbackUser);
  const [fallback] = await sql`
    SELECT d.id, d.notification_id
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${fallbackUser} AND d.channel = 'vk'
  `;
  const fallbackSent = [];
  await deliverPendingVk(sql, config, {
    notificationIds: [fallback.notification_id],
    send: (payload) => {
      fallbackSent.push(payload);
      if (payload.keyboard) throw blockedButtons;
    },
  });
  assert.equal(fallbackSent.length, 2);
  assert.equal(Boolean(fallbackSent[0].keyboard), true);
  assert.equal(fallbackSent[1].keyboard, null);
  const [fallbackRow] = await sql`SELECT status FROM notification_deliveries WHERE id = ${fallback.id}`;
  assert.equal(fallbackRow.status, "sent");

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

  const answers = [];
  const first = await handleVkCallback(sql, config, {
    type: "message_event",
    group_id: "242279722",
    secret: config.vkCallbackSecret,
    object: {
      user_id: guestVk,
      peer_id: guestVk,
      event_id: "evt-1",
      payload: { requestId: request.id, action: "accept" },
    },
  }, { answerEvent: (payload) => answers.push(payload) });
  assert.equal(first.text, "ok");
  assert.deepEqual(answers[0], { eventId: "evt-1", userId: guestVk, peerId: guestVk, text: "Сампо подтверждено" });
  const [{ pairs }] = await sql`SELECT count(*)::int AS pairs FROM pairs WHERE request_id = ${request.id}`;
  assert.equal(pairs, 1);
  const second = await handleVkCallback(sql, config, {
    type: "message_event",
    group_id: 242279722,
    secret: config.vkCallbackSecret,
    object: { user_id: guestVk, payload: JSON.stringify({ requestId: request.id, action: "accept" }) },
  }, { answerEvent: () => {} });
  assert.equal(second.text, "ok");
  const [{ pairs: still }] = await sql`SELECT count(*)::int AS pairs FROM pairs WHERE request_id = ${request.id}`;
  assert.equal(still, 1);

  const stranger = await handleVkCallback(sql, config, {
    type: "message_event",
    group_id: 242279722,
    secret: config.vkCallbackSecret,
    object: { user_id: vkId(), payload: { requestId: request.id, action: "decline" } },
  }, { answerEvent: () => {} });
  assert.equal(stranger.text, "ok");
  const [{ status }] = await sql`SELECT status FROM sampo_requests WHERE id = ${request.id}`;
  assert.equal(status, "accepted");
});

test.after(async () => {
  if (slots.length) await sql`DELETE FROM slots WHERE id IN ${sql(slots)}`;
  if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  await sql.end({ timeout: 5 });
});
