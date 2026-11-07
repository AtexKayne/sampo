import { HttpError } from "../http/errors.js";
import { parseAudienceUserIds, resolveAudienceMembers } from "./audience.js";

export const LINKED_KIND = "linked";
export const SLOT_REQUEST_KIND = "slot_request";

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

function peopleOf(rows) {
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

async function peopleOfKind(sql, kind) {
  const rows = await sql`
    SELECT u.id, u.display_name
    FROM admin_setting_users s
    JOIN users u ON u.id = s.user_id
    WHERE s.kind = ${kind}
    ORDER BY u.display_name, u.id
  `;
  return peopleOf(rows);
}

export async function listLinkedUserIds(sql) {
  if (!sql) return [];
  const rows = await sql`SELECT user_id FROM admin_setting_users WHERE kind = ${LINKED_KIND}`;
  return rows.map((row) => row.user_id);
}

export async function listSlotRequestRecipientIds(sql) {
  if (!sql) return [];
  const rows = await sql`SELECT user_id FROM admin_setting_users WHERE kind = ${SLOT_REQUEST_KIND}`;
  return rows.map((row) => row.user_id);
}

export async function getAdminSettings(sql) {
  return {
    linkedUsers: await peopleOfKind(sql, LINKED_KIND),
    slotRequestRecipients: await peopleOfKind(sql, SLOT_REQUEST_KIND),
  };
}

async function replaceKind(sql, kind, ids) {
  const members = parseAudienceUserIds(ids);
  if (!members.ok) fail(members.statusCode, members.code, members.message);
  await resolveAudienceMembers(sql, members.ids);
  await sql`DELETE FROM admin_setting_users WHERE kind = ${kind}`;
  for (const userId of members.ids) {
    await sql`INSERT INTO admin_setting_users (kind, user_id) VALUES (${kind}, ${userId})`;
  }
}

export async function saveAdminSettings(sql, body) {
  if (!body || typeof body !== "object") fail(400, "VALIDATION", "Укажите настройки");
  if (body.linkedUserIds !== undefined) await replaceKind(sql, LINKED_KIND, body.linkedUserIds);
  if (body.slotRequestRecipientIds !== undefined) {
    await replaceKind(sql, SLOT_REQUEST_KIND, body.slotRequestRecipientIds);
  }
  return getAdminSettings(sql);
}
