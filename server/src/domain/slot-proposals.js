import { HttpError } from "../http/errors.js";
import { listSlotRequestRecipientIds } from "./admin-settings.js";
import { announceNewSlots } from "./sampo.js";
import { parseStudioLocal, validateCapacity, validateDescription, validateInterval, validatePlace } from "../slots/rules.js";

const DEFAULT_PLACE = "Зал 1";
const DEFAULT_CAPACITY = 20;

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

function presentProposal(row) {
  const place = String(row.place ?? "").trim();
  const responsibleId = row.responsible_user_id ?? row.user_id;
  return {
    id: row.id,
    kind: "proposal",
    proposalId: row.id,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    place,
    proposedPlace: place,
    capacity: 0,
    description: row.description ?? null,
    comment: row.description ?? null,
    status: "proposed",
    proposedBy: { id: row.user_id, displayName: row.display_name },
    responsible: { id: responsibleId, displayName: row.display_name },
    taken: 0,
    myAttendance: false,
    withPartner: false,
    myAvailability: false,
    availabilitySource: null,
    myPendingOutgoing: false,
    myPendingIncomingCount: 0,
    myPair: null,
  };
}

async function loadProposal(tx, id) {
  const [row] = await tx`
    SELECT p.*, u.display_name
    FROM slot_proposals p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ${id}
  `;
  return row ?? null;
}

export async function listPendingProposals(sql, from, to, viewer = null) {
  const rows =
    !viewer || viewer.appRole === "admin"
      ? await sql`
          SELECT p.*, u.display_name
          FROM slot_proposals p
          JOIN users u ON u.id = p.user_id
          WHERE p.status = 'pending' AND p.starts_at >= ${from} AND p.starts_at < ${to}
          ORDER BY p.starts_at, p.id
        `
      : await sql`
          SELECT p.*, u.display_name
          FROM slot_proposals p
          JOIN users u ON u.id = p.user_id
          WHERE p.status = 'pending'
            AND p.user_id = ${viewer.id}
            AND p.starts_at >= ${from} AND p.starts_at < ${to}
          ORDER BY p.starts_at, p.id
        `;
  return rows.map(presentProposal);
}

export async function getPendingProposal(sql, id) {
  const row = await loadProposal(sql, id);
  if (!row || row.status !== "pending") fail(404, "NOT_FOUND", "Предложение не найдено");
  return presentProposal(row);
}

async function canResolve(sql, userId) {
  const [user] = await sql`SELECT app_role FROM users WHERE id = ${userId}`;
  if (user?.app_role === "admin") return true;
  const ids = await listSlotRequestRecipientIds(sql);
  return ids.includes(userId);
}

async function notifyForcedVk(tx, userId, type, payload) {
  const [user] = await tx`SELECT app_role, vk_user_id FROM users WHERE id = ${userId}`;
  if (!user) return;
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
      proposalId: payload?.proposalId ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  });
  if (user.app_role !== "admin" && Buffer.byteLength(event) <= 7500) {
    await tx`SELECT pg_notify('sampo_notification', ${event})`;
  }
  await tx`
    INSERT INTO notification_deliveries (id, notification_id, channel, status, last_error)
    VALUES (${crypto.randomUUID()}, ${id}, 'push', 'skipped', 'Заявка на слот уходит в ВК')
  `;
  await tx`
    INSERT INTO notification_deliveries (id, notification_id, channel, status, last_error)
    VALUES (
      ${crypto.randomUUID()},
      ${id},
      'vk',
      ${user.vk_user_id != null ? "pending" : "skipped"},
      ${user.vk_user_id != null ? null : "Нет привязки ВК"}
    )
  `;
}

async function notifyProposer(tx, userId, type, payload) {
  const [user] = await tx`
    SELECT app_role, notify_channel, vk_user_id FROM users WHERE id = ${userId}
  `;
  if (!user || user.app_role === "admin") return;
  const id = crypto.randomUUID();
  await tx`INSERT INTO notifications (id, user_id, type, payload) VALUES (${id}, ${userId}, ${type}, ${tx.json(payload)})`;
  const event = JSON.stringify({
    userId,
    notification: {
      id,
      type,
      text: payload?.text ?? "",
      requestId: null,
      slotId: payload?.slotId ?? null,
      proposalId: payload?.proposalId ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  });
  if (Buffer.byteLength(event) <= 7500) await tx`SELECT pg_notify('sampo_notification', ${event})`;
  const vk = user.notify_channel === "vk" && user.vk_user_id != null;
  const [subscription] = vk ? [] : await tx`SELECT id FROM push_subscriptions WHERE user_id = ${userId} LIMIT 1`;
  await tx`
    INSERT INTO notification_deliveries (id, notification_id, channel, status, last_error)
    VALUES (
      ${crypto.randomUUID()}, ${id}, 'push',
      ${!vk && subscription ? "pending" : "skipped"},
      ${vk ? "Выбраны сообщения ВК" : subscription ? null : "Нет подписки на уведомления"}
    )
  `;
  await tx`
    INSERT INTO notification_deliveries (id, notification_id, channel, status, last_error)
    VALUES (
      ${crypto.randomUUID()}, ${id}, 'vk',
      ${vk ? "pending" : "skipped"},
      ${vk ? null : "Выбраны уведомления на телефон"}
    )
  `;
}

export async function createSlotProposal(sql, userId, body) {
  const startsAt = parseStudioLocal(body?.startsAtLocal);
  const endsAt = parseStudioLocal(body?.endsAtLocal);
  if (!startsAt || !endsAt) fail(400, "VALIDATION", "Укажите дату и время слота");
  const interval = validateInterval(startsAt, endsAt);
  if (!interval.ok) fail(interval.statusCode, interval.code, interval.message);
  const place = validatePlace(body?.place);
  if (!place.ok) fail(place.statusCode, place.code, place.message);
  const description = validateDescription(body?.description ?? body?.comment);
  if (!description.ok) fail(description.statusCode, description.code, description.message);

  return sql.begin(async (tx) => {
    const [{ count }] = await tx`
      SELECT count(*)::int AS count FROM slot_proposals
      WHERE user_id = ${userId} AND created_at > now() - interval '1 hour'
    `;
    if (count >= 10) fail(429, "RATE_LIMIT", "Слишком много запросов, попробуйте позже");
    const id = crypto.randomUUID();
    await tx`
      INSERT INTO slot_proposals (id, user_id, responsible_user_id, starts_at, ends_at, place, description)
      VALUES (${id}, ${userId}, ${userId}, ${startsAt}, ${endsAt}, ${place.place}, ${description.description})
    `;
    const [person] = await tx`SELECT display_name FROM users WHERE id = ${userId}`;
    const name = person?.display_name ?? "";
    const recipients = await listSlotRequestRecipientIds(tx);
    for (const recipientId of recipients) {
      if (recipientId === userId) continue;
      await notifyForcedVk(tx, recipientId, "slot_proposed", {
        text: `${name} предлагает слот сампо`,
        proposalId: id,
        place: place.place,
        description: description.description,
        fromName: name,
        responsibleName: name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
    }
    const [row] = await tx`
      SELECT p.*, u.display_name
      FROM slot_proposals p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ${id}
    `;
    return presentProposal(row);
  });
}

export async function acceptSlotProposal(sql, actorId, proposalId, body = {}) {
  if (!(await canResolve(sql, actorId))) fail(403, "FORBIDDEN", "Недостаточно прав");
  const created = await sql.begin(async (tx) => {
    const [row] = await tx`SELECT * FROM slot_proposals WHERE id = ${proposalId} FOR UPDATE`;
    if (!row) fail(404, "NOT_FOUND", "Предложение не найдено");
    if (row.status !== "pending") fail(409, "CONFLICT", "Предложение уже закрыто");
    const startsAt = new Date(row.starts_at);
    const endsAt = new Date(row.ends_at);
    const interval = validateInterval(startsAt, endsAt);
    if (!interval.ok) fail(interval.statusCode, interval.code, interval.message);
    const placeValue = body?.place !== undefined ? body.place : row.place;
    const place = validatePlace(placeValue);
    if (!place.ok) fail(place.statusCode, place.code, place.message);
    const description = validateDescription(body?.description !== undefined ? body.description : row.description);
    if (!description.ok) fail(description.statusCode, description.code, description.message);
    const capacity = body?.capacity !== undefined ? validateCapacity(body.capacity) : { ok: true, capacity: DEFAULT_CAPACITY };
    if (!capacity.ok) fail(capacity.statusCode, capacity.code, capacity.message);
    const responsibleUserId = row.responsible_user_id ?? row.user_id;
    const slotId = crypto.randomUUID();
    const [slot] = await tx`
      INSERT INTO slots (id, starts_at, ends_at, place, capacity, description, responsible_user_id, status, visibility)
      VALUES (${slotId}, ${startsAt}, ${endsAt}, ${place.place}, ${capacity.capacity}, ${description.description}, ${responsibleUserId}, 'open', 'open')
      RETURNING *
    `;
    await tx`
      UPDATE slot_proposals
      SET status = 'accepted', slot_id = ${slotId}, resolved_by = ${actorId}, resolved_at = now()
      WHERE id = ${proposalId}
    `;
    await notifyProposer(tx, row.user_id, "slot_proposal_accepted", {
      text: "Администратор подтвердил ваш слот",
      proposalId,
      slotId,
      place: place.place,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    return slot;
  });
  await announceNewSlots(sql, [created]);
  return {
    proposalId,
    slot: {
      id: created.id,
      startsAt: new Date(created.starts_at).toISOString(),
      endsAt: new Date(created.ends_at).toISOString(),
      place: created.place,
      capacity: created.capacity,
      status: created.status,
    },
  };
}

export async function declineSlotProposal(sql, actorId, proposalId) {
  if (!(await canResolve(sql, actorId))) fail(403, "FORBIDDEN", "Недостаточно прав");
  return sql.begin(async (tx) => {
    const [row] = await tx`SELECT * FROM slot_proposals WHERE id = ${proposalId} FOR UPDATE`;
    if (!row) fail(404, "NOT_FOUND", "Предложение не найдено");
    if (row.status !== "pending") fail(409, "CONFLICT", "Предложение уже закрыто");
    await tx`
      UPDATE slot_proposals
      SET status = 'declined', resolved_by = ${actorId}, resolved_at = now()
      WHERE id = ${proposalId}
    `;
    await notifyProposer(tx, row.user_id, "slot_proposal_declined", {
      text: "Предложение слота отклонено",
      proposalId,
      place: row.place,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
    });
    return { ok: true };
  });
}

export async function expireSlotProposals(sql, now = new Date()) {
  await sql`
    UPDATE slot_proposals
    SET status = 'expired', resolved_at = ${now}
    WHERE status = 'pending' AND starts_at <= ${now}
  `;
}

export { DEFAULT_PLACE, DEFAULT_CAPACITY };
