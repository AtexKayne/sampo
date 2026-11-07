import { createHash, timingSafeEqual } from "node:crypto";
import { acceptRequest, declineRequest } from "../domain/sampo.js";
import { HttpError } from "../http/errors.js";
import { studioParts } from "../slots/rules.js";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const API_VERSION = "5.199";
const BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000];
const PERMANENT_CODES = new Set([7, 15, 100, 900, 901, 902, 911, 912, 913, 914, 917, 936]);
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const VK_DIALOG_URL = "https://vk.me/vparaplane";

export function vkSendReady(config) {
  return Boolean(String(config?.vkCommunityToken || "").trim());
}

export function vkCallbackReady(config) {
  return Boolean(
    String(config?.vkCommunityId || "").trim()
    && String(config?.vkCallbackSecret || "").trim()
    && String(config?.vkCallbackConfirmation || "").trim(),
  );
}

export function vkRandomId(deliveryId) {
  return createHash("sha256").update(String(deliveryId)).digest().readUInt32BE(0) & 0x7fffffff;
}

export function vkMessage(note, origin) {
  const payload = note?.payload && typeof note.payload === "object" ? note.payload : {};
  const text = typeof payload.text === "string" && payload.text.trim() ? payload.text.trim() : "Новое уведомление";
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  const slotId = typeof payload.slotId === "string" ? payload.slotId : "";
  const path = requestId ? `/requests/${requestId}` : slotId ? `/slots/${slotId}` : "/calendar";
  const link = absoluteUrl(origin, path);
  const lines = [text];
  if (note?.type === "slot_opened" || note?.type === "request_received") {
    const where = slotWhere(payload);
    if (where && !text.includes(where)) lines.push(where);
  }
  const message = clip(lines.join("\n"));
  const look = link ? linkButton(link) : null;
  if (note?.type === "request_received" && REQUEST_ID.test(requestId)) {
    return { message, keyboard: requestKeyboard(requestId, look), link };
  }
  if (look) return { message, keyboard: JSON.stringify({ inline: true, buttons: [[look]] }), link };
  return { message, keyboard: null, link };
}

export function registerVkRoutes(app, { sql, config }) {
  app.post("/api/vk/callback", async (request, reply) => {
    const result = await handleVkCallback(sql, config, request.body);
    if (result.json) return reply.code(result.status).send(result.json);
    return reply.code(result.status).type("text/plain; charset=utf-8").send(result.text);
  });
}

export async function handleVkCallback(sql, config, body, options = {}) {
  if (!vkCallbackReady(config)) return { status: 503, text: "unavailable" };
  const groupId = String(body?.group_id ?? "");
  if (groupId !== String(config.vkCommunityId).trim()) return { status: 403, text: "forbidden" };
  if (body?.type === "confirmation") return { status: 200, text: String(config.vkCallbackConfirmation) };
  if (!sameSecret(body?.secret, config.vkCallbackSecret)) return { status: 403, text: "forbidden" };
  if (body?.type !== "message_event") return { status: 200, text: "ok" };
  if (!sql) return { status: 503, text: "unavailable" };
  const object = body.object && typeof body.object === "object" ? body.object : {};
  const text = await answerMessageEvent(sql, object);
  const answer = options.answerEvent ?? ((payload) => sendVkEventAnswer(config, payload));
  try {
    await answer({
      eventId: object.event_id,
      userId: object.user_id,
      peerId: object.peer_id ?? object.user_id,
      text,
    });
  } catch {
    // Запрос уже обработан, всплывающая подсказка необязательна.
  }
  return { status: 200, text: "ok" };
}

export async function deliverPendingVk(sql, config, options = {}) {
  if (!vkSendReady(config)) return { configured: false, sent: 0 };
  const send = options.send ?? ((payload) => sendVkMessage(config, payload));
  const only = Array.isArray(options.notificationIds) ? options.notificationIds : null;
  const claimed = await sql.begin(async (tx) => {
    const scope = only?.length ? tx`AND d.notification_id IN ${tx(only)}` : tx``;
    const picked = await tx`
      SELECT d.id
      FROM notification_deliveries d
      WHERE d.channel = 'vk'
        AND d.status = 'pending'
        AND d.next_attempt_at <= now()
        ${scope}
      ORDER BY d.created_at
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    `;
    if (picked.length === 0) return [];
    return tx`
      UPDATE notification_deliveries
      SET attempts = attempts + 1,
          next_attempt_at = now() + interval '2 minutes'
      WHERE id IN ${tx(picked.map((row) => row.id))}
      RETURNING id, notification_id, attempts
    `;
  });

  let sent = 0;
  for (const row of claimed) {
    if (await deliverOne(sql, config, row, send)) sent += 1;
  }
  return { configured: true, sent };
}

async function deliverOne(sql, config, row, send) {
  const [note] = await sql`
    SELECT n.id, n.type, n.payload, u.vk_user_id
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    WHERE n.id = ${row.notification_id}
  `;
  if (!note) {
    await finish(sql, row.id, "skipped", "Уведомление удалено");
    return false;
  }
  if (note.vk_user_id == null) {
    await finish(sql, row.id, "skipped", "Нет привязки ВК");
    return false;
  }
  const message = vkMessage(note, config.appOrigin);
  const payload = {
    peerId: Number(note.vk_user_id),
    randomId: vkRandomId(row.id),
    message: message.message,
    keyboard: message.keyboard,
  };
  try {
    await send(payload);
    await finish(sql, row.id, "sent", null);
    return true;
  } catch (error) {
    if (payload.keyboard && keyboardRejected(error)) {
      try {
        const fallback = message.link && !payload.message.includes(message.link)
          ? `${payload.message}\n${message.link}`
          : payload.message;
        await send({ ...payload, keyboard: null, message: fallback });
        await finish(sql, row.id, "sent", "Кнопки ВК недоступны, отправлен текст");
        return true;
      } catch (retryError) {
        error = retryError;
      }
    }
    const attempts = Number(row.attempts);
    const permanent = PERMANENT_CODES.has(Number(error?.code));
    if (permanent || attempts >= 5) {
      await finish(sql, row.id, "failed", vkErrorText(error));
      return false;
    }
    const next = new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS.at(-1)));
    await sql`
      UPDATE notification_deliveries
      SET status = 'pending', last_error = ${vkErrorText(error)}, next_attempt_at = ${next}
      WHERE id = ${row.id}
    `;
    return false;
  }
}

async function answerMessageEvent(sql, object) {
  const vkUserId = Number(object?.user_id);
  const payload = readPayload(object?.payload);
  if (!Number.isSafeInteger(vkUserId) || vkUserId <= 0 || !payload) return "Запрос уже закрыт";
  const [user] = await sql`SELECT id FROM users WHERE vk_user_id = ${vkUserId}`;
  if (!user) return "Запрос уже закрыт";
  try {
    const view = payload.action === "accept"
      ? await acceptRequest(sql, user.id, payload.requestId)
      : await declineRequest(sql, user.id, payload.requestId);
    if (view.status === "accepted") return "Сампо подтверждено";
    if (view.status === "declined") return "Вы отказали";
    return "Запрос уже закрыт";
  } catch (error) {
    if (error instanceof HttpError && (error.code === "CAPACITY" || error.code === "CONFLICT" || error.code === "SLOT_NOT_OPEN" || error.code === "SLOT_STARTED")) {
      return clip(error.message, 90);
    }
    if (error instanceof HttpError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN" || error.code === "VALIDATION")) {
      return "Запрос уже закрыт";
    }
    throw error;
  }
}

function readPayload(value) {
  let payload = value;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.action !== "accept" && payload.action !== "decline") return null;
  if (!REQUEST_ID.test(String(payload.requestId || ""))) return null;
  return { action: payload.action, requestId: String(payload.requestId) };
}

function requestKeyboard(requestId, look) {
  const rows = [[
    button("Принять", "positive", { requestId, action: "accept" }),
    button("Отказать", "negative", { requestId, action: "decline" }),
  ]];
  if (look) rows.push([look]);
  return JSON.stringify({ inline: true, buttons: rows });
}

function linkButton(url) {
  return {
    action: { type: "open_link", label: "Посмотреть", link: url },
  };
}

function button(label, color, payload) {
  return {
    action: { type: "callback", label, payload: JSON.stringify(payload) },
    color,
  };
}

export async function sendVkMessage(config, { peerId, randomId, message, keyboard }) {
  const fields = {
    peer_id: String(peerId),
    random_id: String(randomId),
    message,
  };
  if (keyboard) fields.keyboard = keyboard;
  return vkMethod(config, "messages.send", fields);
}

export async function sendVkEventAnswer(config, { eventId, userId, peerId, text }) {
  if (!eventId || userId == null || peerId == null) return null;
  return vkMethod(config, "messages.sendMessageEventAnswer", {
    event_id: String(eventId),
    user_id: String(userId),
    peer_id: String(peerId),
    event_data: JSON.stringify({ type: "show_snackbar", text: clip(text, 90) }),
  });
}

async function vkMethod(config, method, fields) {
  const params = new URLSearchParams({
    access_token: String(config.vkCommunityToken),
    v: API_VERSION,
    ...fields,
  });
  let response;
  try {
    response = await fetch(`https://api.vk.ru/method/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const wrapped = new Error("ВК не ответил");
    wrapped.code = 10;
    wrapped.cause = error;
    throw wrapped;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error("ВК ответил не JSON");
    error.code = 10;
    throw error;
  }
  if (data?.error) {
    const error = new Error(data.error.error_msg || "ВК не принял сообщение");
    error.code = Number(data.error.error_code);
    throw error;
  }
  if (!response.ok || data?.response == null) {
    const error = new Error("ВК не принял сообщение");
    error.code = 10;
    throw error;
  }
  return data.response;
}

async function finish(sql, id, status, lastError) {
  await sql`
    UPDATE notification_deliveries
    SET status = ${status}, last_error = ${lastError}
    WHERE id = ${id}
  `;
}

function keyboardRejected(error) {
  const code = Number(error?.code);
  if (code === 911 || code === 912 || code === 917) return true;
  return /chat bot/i.test(String(error?.message || ""));
}

function vkErrorText(error) {
  const code = Number(error?.code);
  if (code === 901 || code === 902) return "Пользователь не разрешил сообщения сообщества";
  if (code === 911 || code === 912 || code === 917 || /chat bot/i.test(String(error?.message || ""))) {
    return "В сообществе не включены возможности бота";
  }
  if (code === 6 || code === 9) return "ВК ограничил частоту отправки";
  const text = String(error?.message || "Не удалось отправить сообщение ВК");
  return text.slice(0, 500);
}

function slotWhere(payload) {
  const when = formatWhen(payload?.startsAt);
  const place = typeof payload?.place === "string" ? payload.place.trim() : "";
  if (when && place) return `${when}, ${place}`;
  return when || place;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = studioParts(date);
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${parts.day} ${MONTHS[parts.month - 1]}, ${hour}:${minute}`;
}

function absoluteUrl(origin, path) {
  try {
    return new URL(path, origin || "https://vparaplane.ru").toString();
  } catch {
    return "";
  }
}

function clip(text, limit = 4000) {
  const value = String(text || "");
  return value.length > limit ? value.slice(0, limit) : value;
}

function sameSecret(left, right) {
  const a = createHash("sha256").update(String(left ?? "")).digest();
  const b = createHash("sha256").update(String(right ?? "")).digest();
  return timingSafeEqual(a, b);
}
