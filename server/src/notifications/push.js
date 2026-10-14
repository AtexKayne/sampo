import { readFileSync, writeFileSync } from "node:fs";
import webpush from "web-push";
import { HttpError } from "../http/errors.js";
import { requireDancer, requireUser } from "../auth/access.js";

const BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000];

export function vapidReady(config) {
  return Boolean(config?.vapidPublicKey && config?.vapidPrivateKey);
}

export function prepareVapid(config) {
  if (vapidReady(config)) return { generated: false, saved: true };
  const keys = webpush.generateVAPIDKeys();
  config.vapidPublicKey = keys.publicKey;
  config.vapidPrivateKey = keys.privateKey;
  config.vapidSubject = pushSubject(config);
  return { generated: true, saved: persistVapid(keys) };
}

export function pushSubject(config) {
  const subject = (config?.vapidSubject || "").trim();
  if (appleAcceptsSubject(subject)) return subject;
  return publicHttpsOrigin(config?.appOrigin) || subject || "mailto:admin@example.com";
}

function appleAcceptsSubject(subject) {
  let url;
  try {
    url = new URL(subject);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return publicHost(url.hostname);
  if (url.protocol !== "mailto:") return false;
  const at = subject.lastIndexOf("@");
  return at > "mailto:".length && publicHost(subject.slice(at + 1));
}

function publicHttpsOrigin(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol === "https:" && publicHost(url.hostname)) return url.origin;
  } catch {
    return "";
  }
  return "";
}

function publicHost(host) {
  const name = String(host || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!name || name === "localhost" || name.endsWith(".localhost")) return false;
  if (name === "example.com" || name.endsWith(".example.com")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(":")) return false;
  return name.includes(".");
}

export function pushMessage(note, options = {}) {
  const payload = note?.payload && typeof note.payload === "object" ? note.payload : {};
  const requestId = payload.requestId || null;
  const slotId = payload.slotId || null;
  const url = payload.url || (requestId ? `/requests/${requestId}` : slotId ? `/slots/${slotId}` : "/calendar");
  const text = typeof payload.text === "string" && payload.text.trim() ? payload.text : "Новое уведомление";
  const message = {
    title: text,
    body: "",
    tag: note?.id,
    data: { url, requestId },
  };
  if (!options.apple && note?.type === "request_received" && requestId) {
    message.actions = [
      { action: "accept", title: "Подтвердить" },
      { action: "decline", title: "Отказать" },
    ];
  }
  return message;
}

export function registerPushRoutes(app, { db, sql, config }) {
  app.get("/api/push/public-key", async () => {
    if (!vapidReady(config)) throw new HttpError(503, "UNAVAILABLE", "Уведомления на телефон не настроены");
    return { publicKey: config.vapidPublicKey };
  });

  app.post("/api/me/push-subscriptions", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    await savePushSubscription(sql, user.id, request.body);
    if (request.body?.confirm !== true) return { ok: true, delivered: true };
    return confirmPush(sql, config, request.body);
  });

  app.delete("/api/me/push-subscriptions", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    await removePushSubscription(sql, user.id, request.body?.endpoint);
    return { ok: true };
  });
}

export async function savePushSubscription(sql, userId, body) {
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!validEndpoint(endpoint) || !validKey(p256dh) || !validKey(auth)) {
    throw new HttpError(400, "VALIDATION", "Некорректная подписка на уведомления");
  }
  await sql`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
    VALUES (${crypto.randomUUID()}, ${userId}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `;
}

export async function removePushSubscription(sql, userId, endpoint) {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    throw new HttpError(400, "VALIDATION", "Укажите подписку, которую нужно удалить");
  }
  await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint.trim()}`;
}

export async function deliverPendingPush(sql, config, options = {}) {
  if (!vapidReady(config)) return { configured: false, sent: 0 };
  const send = options.send ?? ((subscription, body) => sendWebPush(config, subscription, body));
  const only = Array.isArray(options.notificationIds) ? options.notificationIds : null;
  const claimed = await sql.begin(async (tx) => {
    const scope = only?.length ? tx`AND d.notification_id IN ${tx(only)}` : tx``;
    const picked = await tx`
      SELECT d.id
      FROM notification_deliveries d
      WHERE d.channel = 'push'
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
    if (await deliverOne(sql, row, send)) sent += 1;
  }
  return { configured: true, sent };
}

async function deliverOne(sql, row, send) {
  const [note] = await sql`
    SELECT id, user_id, type, payload
    FROM notifications
    WHERE id = ${row.notification_id}
  `;
  if (!note) {
    await finish(sql, row.id, "skipped", "Уведомление удалено");
    return false;
  }
  const subscriptions = await sql`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE user_id = ${note.user_id}
  `;
  if (subscriptions.length === 0) {
    await finish(sql, row.id, "skipped", "Нет подписки на уведомления");
    return false;
  }

  let delivered = 0;
  let gone = 0;
  let lastError = "Не удалось отправить уведомление";
  for (const subscription of subscriptions) {
    const body = JSON.stringify(pushMessage(note, { apple: subscription.endpoint.includes("web.push.apple.com") }));
    try {
      await send(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        body,
      );
      delivered += 1;
    } catch (error) {
      const status = Number(error?.statusCode);
      if (status === 404 || status === 410) {
        gone += 1;
        await sql`DELETE FROM push_subscriptions WHERE id = ${subscription.id}`;
      } else {
        lastError = errorText(error);
      }
    }
  }

  if (delivered > 0) {
    await finish(sql, row.id, "sent", null);
    return true;
  }
  if (gone === subscriptions.length) {
    await finish(sql, row.id, "skipped", "Подписка устарела");
    return false;
  }
  const attempts = Number(row.attempts);
  if (attempts >= 5) {
    await finish(sql, row.id, "failed", lastError);
    return false;
  }
  const next = new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]));
  await sql`
    UPDATE notification_deliveries
    SET status = 'pending', last_error = ${lastError}, next_attempt_at = ${next}
    WHERE id = ${row.id}
  `;
  return false;
}

async function confirmPush(sql, config, body) {
  const endpoint = body.endpoint.trim();
  const subscription = { endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } };
  const message = pushMessage(
    {
      id: "push-enabled",
      type: "push_enabled",
      payload: { text: "Уведомления на этот телефон включены", url: "/calendar" },
    },
    { apple: endpoint.includes("web.push.apple.com") },
  );
  try {
    await sendWebPush(config, subscription, JSON.stringify(message));
    return { ok: true, delivered: true };
  } catch (error) {
    const status = Number(error?.statusCode);
    if (status === 404 || status === 410) await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    return { ok: true, delivered: false, error: pushFailureText(error) };
  }
}

function pushFailureText(error) {
  const status = Number(error?.statusCode);
  const detail = errorText(error);
  if (detail.includes("BadJwtToken")) return "Сервер не смог подписать уведомление";
  if (status === 404 || status === 410) return "Подписка телефона устарела. Включите уведомления ещё раз";
  if (status) return `Телефон не принял уведомление (${status})`;
  return "Телефон не принял уведомление";
}

function sendWebPush(config, subscription, body) {
  webpush.setVapidDetails(pushSubject(config), config.vapidPublicKey, config.vapidPrivateKey);
  return webpush.sendNotification(subscription, body, { TTL: 12 * 60 * 60, urgency: "high" });
}

async function finish(sql, id, status, lastError) {
  await sql`
    UPDATE notification_deliveries
    SET status = ${status}, last_error = ${lastError}
    WHERE id = ${id}
  `;
}

function validEndpoint(value) {
  if (!value || value.length > 4000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function errorText(error) {
  const raw = error?.body ?? error?.message ?? "Не удалось отправить уведомление";
  const text = typeof raw === "string" ? raw : String(raw);
  return text.slice(0, 500);
}

function persistVapid(keys) {
  let text;
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    return false;
  }
  const next = replaceEmpty(replaceEmpty(text, "VAPID_PUBLIC_KEY", keys.publicKey), "VAPID_PRIVATE_KEY", keys.privateKey);
  if (next === text) return false;
  try {
    writeFileSync(".env", next);
  } catch {
    return false;
  }
  return true;
}

function replaceEmpty(text, name, value) {
  const lines = text.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!line.startsWith(`${name}=`)) return line;
    found = true;
    const current = line.slice(name.length + 1).trim().replace(/^"|"$/g, "");
    if (current) return line;
    return `${name}=${value}`;
  });
  if (!found) next.push(`${name}=${value}`);
  return `${next.join("\n").replace(/\n*$/, "")}\n`;
}
