import { HttpError } from "../http/errors.js";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

export function parseVisibility(value) {
  if (value === undefined || value === null || value === "") return { ok: true, visibility: "open" };
  if (value === "open" || value === "closed") return { ok: true, visibility: value };
  return { ok: false, code: "VALIDATION", statusCode: 400, message: "Выберите открытый или закрытый слот" };
}

export function parseAudienceUserIds(value) {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, code: "VALIDATION", statusCode: 400, message: "Выберите участников" };
  const ids = [];
  for (const id of value) {
    if (typeof id !== "string" || !USER_ID.test(id)) {
      return { ok: false, code: "VALIDATION", statusCode: 400, message: "Выберите участников" };
    }
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > 200) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "В списке не больше 200 человек" };
  }
  return { ok: true, ids };
}

export function parseAudienceListName(value) {
  const name = String(value ?? "").trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, code: "VALIDATION", statusCode: 400, message: "Название списка — от 1 до 80 символов" };
  }
  return { ok: true, name };
}

export async function resolveAudienceMembers(sql, ids) {
  if (!ids.length) return [];
  const rows = await sql`
    SELECT id, display_name FROM users
    WHERE id IN ${sql(ids)} AND app_role <> 'admin'
  `;
  if (rows.length !== ids.length) fail(400, "VALIDATION", "Выберите участников");
  const names = new Map(rows.map((row) => [row.id, row.display_name]));
  return ids.map((id) => ({ id, displayName: names.get(id) }));
}

export async function replaceSlotAudience(sql, slotIds, userIds) {
  if (!slotIds.length) return;
  await sql`DELETE FROM slot_audience WHERE slot_id IN ${sql(slotIds)}`;
  for (const slotId of slotIds) {
    for (const userId of userIds) {
      await sql`INSERT INTO slot_audience (slot_id, user_id) VALUES (${slotId}, ${userId})`;
    }
  }
}

function peopleOf(members, names) {
  return members.map((row) => ({
    id: row.user_id,
    displayName: names.get(row.user_id) ?? "",
  }));
}

export async function listAudienceLists(sql) {
  const lists = await sql`SELECT id, name, created_at FROM audience_lists ORDER BY lower(name), id`;
  if (!lists.length) return [];
  const members = await sql`
    SELECT list_id, user_id FROM audience_list_members
    WHERE list_id IN ${sql(lists.map((row) => row.id))}
  `;
  const userIds = [...new Set(members.map((row) => row.user_id))];
  const names = userIds.length
    ? new Map((await sql`SELECT id, display_name FROM users WHERE id IN ${sql(userIds)}`).map((row) => [row.id, row.display_name]))
    : new Map();
  const byList = new Map(lists.map((row) => [row.id, []]));
  for (const row of members) byList.get(row.list_id)?.push(row);
  return lists.map((row) => ({
    id: row.id,
    name: row.name,
    members: peopleOf(byList.get(row.id) ?? [], names).sort((left, right) => left.displayName.localeCompare(right.displayName, "ru")),
  }));
}

async function writeListMembers(sql, listId, userIds) {
  await sql`DELETE FROM audience_list_members WHERE list_id = ${listId}`;
  for (const userId of userIds) {
    await sql`INSERT INTO audience_list_members (list_id, user_id) VALUES (${listId}, ${userId})`;
  }
}

export async function createAudienceList(sql, name, userIds) {
  const parsed = parseAudienceListName(name);
  if (!parsed.ok) fail(parsed.statusCode, parsed.code, parsed.message);
  const members = parseAudienceUserIds(userIds);
  if (!members.ok) fail(members.statusCode, members.code, members.message);
  await resolveAudienceMembers(sql, members.ids);
  const id = crypto.randomUUID();
  try {
    await sql`INSERT INTO audience_lists (id, name) VALUES (${id}, ${parsed.name})`;
  } catch (error) {
    if (error?.code === "23505") fail(409, "CONFLICT", "Список с таким названием уже есть");
    throw error;
  }
  await writeListMembers(sql, id, members.ids);
  const [list] = (await listAudienceLists(sql)).filter((item) => item.id === id);
  return list;
}

export async function updateAudienceList(sql, listId, body) {
  const [existing] = await sql`SELECT id FROM audience_lists WHERE id = ${listId}`;
  if (!existing) fail(404, "NOT_FOUND", "Список не найден");
  if (body?.name !== undefined) {
    const parsed = parseAudienceListName(body.name);
    if (!parsed.ok) fail(parsed.statusCode, parsed.code, parsed.message);
    try {
      await sql`UPDATE audience_lists SET name = ${parsed.name} WHERE id = ${listId}`;
    } catch (error) {
      if (error?.code === "23505") fail(409, "CONFLICT", "Список с таким названием уже есть");
      throw error;
    }
  }
  if (body?.userIds !== undefined) {
    const members = parseAudienceUserIds(body.userIds);
    if (!members.ok) fail(members.statusCode, members.code, members.message);
    await resolveAudienceMembers(sql, members.ids);
    await writeListMembers(sql, listId, members.ids);
  }
  const [list] = (await listAudienceLists(sql)).filter((item) => item.id === listId);
  return list;
}

export async function deleteAudienceList(sql, listId) {
  const deleted = await sql`DELETE FROM audience_lists WHERE id = ${listId} RETURNING id`;
  if (!deleted.length) fail(404, "NOT_FOUND", "Список не найден");
  return { ok: true };
}

function parseAudienceListId(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) fail(400, "VALIDATION", "Выберите список");
    return null;
  }
  if (typeof value !== "string" || !USER_ID.test(value)) fail(400, "VALIDATION", "Выберите список");
  return value;
}

async function membersOfList(sql, listId) {
  const [list] = await sql`SELECT id FROM audience_lists WHERE id = ${listId}`;
  if (!list) fail(400, "VALIDATION", "Список не найден");
  const rows = await sql`SELECT user_id FROM audience_list_members WHERE list_id = ${listId}`;
  return rows.map((row) => row.user_id);
}

export async function resolveAudienceForCreate(sql, body) {
  const parsed = parseVisibility(body?.visibility);
  if (!parsed.ok) fail(parsed.statusCode, parsed.code, parsed.message);
  if (parsed.visibility === "open") return { visibility: "open", audienceListId: null, userIds: [] };
  const ids = parseAudienceUserIds(body?.audienceUserIds);
  if (!ids.ok) fail(ids.statusCode, ids.code, ids.message);
  const listId = parseAudienceListId(body?.audienceListId);
  let userIds = ids.ids;
  if (!userIds.length && listId) userIds = await membersOfList(sql, listId);
  else if (listId) await membersOfList(sql, listId);
  await resolveAudienceMembers(sql, userIds);
  if (!userIds.length) fail(400, "VALIDATION", "Добавьте хотя бы одного участника");
  return { visibility: "closed", audienceListId: listId, userIds };
}

export async function resolveAudienceForPatch(sql, slot, body) {
  const hasVisibility = body?.visibility !== undefined && body?.visibility !== null && body?.visibility !== "";
  const parsed = hasVisibility ? parseVisibility(body.visibility) : { ok: true, visibility: slot.visibility === "closed" ? "closed" : "open" };
  if (!parsed.ok) fail(parsed.statusCode, parsed.code, parsed.message);
  if (parsed.visibility === "open") return { visibility: "open", audienceListId: null, userIds: [], replaceAudience: true };

  const hasIds = body?.audienceUserIds !== undefined;
  const hasList = body?.audienceListId !== undefined;
  let listId = slot.audienceListId ?? null;
  if (hasList) listId = parseAudienceListId(body.audienceListId);
  if (listId) await membersOfList(sql, listId);

  if (hasIds) {
    const ids = parseAudienceUserIds(body.audienceUserIds);
    if (!ids.ok) fail(ids.statusCode, ids.code, ids.message);
    await resolveAudienceMembers(sql, ids.ids);
    if (!ids.ids.length) fail(400, "VALIDATION", "Добавьте хотя бы одного участника");
    return { visibility: "closed", audienceListId: listId, userIds: ids.ids, replaceAudience: true };
  }

  if (hasList && listId) {
    const userIds = await membersOfList(sql, listId);
    if (!userIds.length) fail(400, "VALIDATION", "Добавьте хотя бы одного участника");
    return { visibility: "closed", audienceListId: listId, userIds, replaceAudience: true };
  }

  if (slot.visibility !== "closed") fail(400, "VALIDATION", "Добавьте хотя бы одного участника");
  return { visibility: "closed", audienceListId: listId, userIds: [], replaceAudience: false };
}
