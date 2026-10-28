import { HttpError } from "../http/errors.js";
import { validateDisplayName } from "../auth/password.js";
import { studioParts } from "../slots/rules.js";
import { ACHIEVEMENTS, evaluateAchievements } from "../../../shared/achievements.js";
import { TIME_ZONE_OFFSET_MS } from "../../../shared/timezone.js";
import { parseBlockedLevels, parseDanceLevel } from "../../../shared/dance-levels.js";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

function personOf(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    danceLevel: row.dance_level,
  };
}

const LIST_MODES = ["black", "white"];

function parseListMode(value) {
  if (typeof value === "string" && LIST_MODES.includes(value)) return { ok: true, listMode: value };
  return { ok: false, message: "Выберите чёрный или белый список" };
}

function parsePersonIds(value, userId, message) {
  if (!Array.isArray(value)) return { ok: false, message };
  const ids = [];
  for (const id of value) {
    if (typeof id !== "string" || !USER_ID.test(id)) return { ok: false, message: "Выберите танцора" };
    if (id === userId) return { ok: false, message: "Нельзя добавить себя" };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}

async function namedList(sql, userId, kind) {
  const rows = kind === "white"
    ? await sql`
        SELECT u.id, u.display_name, u.dance_level
        FROM dancer_whitelist w
        JOIN users u ON u.id = w.allowed_user_id
        WHERE w.user_id = ${userId}
        ORDER BY u.display_name, u.id
      `
    : await sql`
        SELECT u.id, u.display_name, u.dance_level
        FROM dancer_blacklist b
        JOIN users u ON u.id = b.blocked_user_id
        WHERE b.user_id = ${userId}
        ORDER BY u.display_name, u.id
      `;
  return rows.map(personOf);
}

function parseFlag(value, message) {
  if (typeof value !== "boolean") return { ok: false, message };
  return { ok: true, value };
}

const SLOT_SCOPES = ["free", "all"];

function parseSlotScope(value) {
  if (typeof value === "string" && SLOT_SCOPES.includes(value)) return { ok: true, scope: value };
  return { ok: false, message: "Выберите, о каких новых слотах сообщать" };
}

function studioMonthRange(now) {
  const parts = studioParts(now);
  const start = new Date(Date.UTC(parts.year, parts.month - 1, 1) - TIME_ZONE_OFFSET_MS);
  const next = new Date(Date.UTC(parts.year, parts.month, 1) - TIME_ZONE_OFFSET_MS);
  return { start, next };
}

export async function deleteProfile(sql, userId) {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM pairs WHERE user_low_id = ${userId} OR user_high_id = ${userId}`;
    await tx`DELETE FROM sampo_requests WHERE from_user_id = ${userId} OR to_user_id = ${userId}`;
    const removed = await tx`DELETE FROM users WHERE id = ${userId} RETURNING id`;
    if (!removed.length) fail(404, "NOT_FOUND", "Профиль не найден");
  });
}

export async function requireExistingUser(sql, userId) {
  if (typeof userId !== "string" || !USER_ID.test(userId)) fail(400, "VALIDATION", "Выберите пользователя");
  const [user] = await sql`SELECT id, app_role FROM users WHERE id = ${userId}`;
  if (!user) fail(404, "NOT_FOUND", "Профиль не найден");
  return user;
}

export async function deleteOtherProfile(sql, actorId, userId) {
  const user = await requireExistingUser(sql, userId);
  if (user.id === actorId) fail(400, "VALIDATION", "Свой профиль удаляется в своих настройках");
  if (user.app_role === "admin") fail(403, "FORBIDDEN", "Нельзя удалить администратора");
  await deleteProfile(sql, userId);
}

const USERS_PAGE_SIZE = 10;

function accountPage(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, 100_000);
}

function accountMatch(sql, pattern) {
  return pattern
    ? sql`AND (display_name ILIKE ${pattern} OR login ILIKE ${pattern})`
    : sql``;
}

function presentAccount(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    danceLevel: row.dance_level,
    login: row.login,
  };
}

export async function searchAccounts(sql, actorId, q, page = 1) {
  const query = String(q ?? "").trim().slice(0, 80);
  const current = accountPage(page);
  const offset = (current - 1) * USERS_PAGE_SIZE;
  const pattern = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : null;
  const [counted, rows] = await Promise.all([
    sql`
      SELECT count(*)::int AS total
      FROM users
      WHERE id <> ${actorId}
      ${accountMatch(sql, pattern)}
    `,
    sql`
      SELECT id, display_name, dance_level, login
      FROM users
      WHERE id <> ${actorId}
      ${accountMatch(sql, pattern)}
      ORDER BY display_name, id
      LIMIT ${USERS_PAGE_SIZE}
      OFFSET ${offset}
    `,
  ]);
  return {
    users: rows.map(presentAccount),
    total: counted[0]?.total ?? 0,
    page: current,
    pageSize: USERS_PAGE_SIZE,
  };
}

export async function adminProfile(sql, userId, now = new Date()) {
  const [user] = await sql`
    SELECT id, login, vk_user_id, app_role
    FROM users
    WHERE id = ${userId}
  `;
  if (!user) fail(404, "NOT_FOUND", "Профиль не найден");
  const [settings, achievements] = await Promise.all([
    profileSettings(sql, userId, now),
    userAchievements(sql, userId, now),
  ]);
  return {
    ...settings,
    id: user.id,
    login: user.login,
    hasLogin: Boolean(user.login),
    vkLinked: user.vk_user_id != null,
    appRole: user.app_role,
    achievements,
  };
}

function shownCount(actual, adjust) {
  return Math.max(0, actual + adjust);
}

function studioMonthKey(date) {
  const parts = studioParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function monthAdjustOf(months, key) {
  const value = months?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

const SAMPO_TOTAL_MAX = 100_000;

export function parseSampoTotal(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > SAMPO_TOTAL_MAX) {
    return { ok: false, message: "Укажите количество сампо целым числом от 0 до 100000" };
  }
  return { ok: true, total: value };
}

export async function setSampoTotal(sql, userId, total, now = new Date()) {
  const parsed = parseSampoTotal(total);
  if (!parsed.ok) fail(400, "VALIDATION", parsed.message);
  const month = studioMonthRange(now);
  const monthKey = studioMonthKey(now);
  await sql.begin(async (tx) => {
    const [user] = await tx`
      SELECT sampo_adjust, sampo_months
      FROM users
      WHERE id = ${userId}
    `;
    if (!user) fail(404, "NOT_FOUND", "Профиль не найден");
    const [actual] = await tx`
      SELECT
        count(*) FILTER (
          WHERE s.status = 'open' AND s.ends_at <= ${now}
        )::int AS total_n,
        count(*) FILTER (
          WHERE s.status = 'open'
            AND s.ends_at <= ${now}
            AND s.starts_at >= ${month.start}
            AND s.starts_at < ${month.next}
        )::int AS month_n
      FROM attendances a
      JOIN slots s ON s.id = a.slot_id
      WHERE a.user_id = ${userId}
    `;
    const actualTotal = actual?.total_n ?? 0;
    const actualMonth = actual?.month_n ?? 0;
    const months = user.sampo_months && typeof user.sampo_months === "object" ? user.sampo_months : {};
    const shownTotal = shownCount(actualTotal, user.sampo_adjust);
    const shownMonth = shownCount(actualMonth, monthAdjustOf(months, monthKey));
    if (parsed.total === shownTotal) return;
    const delta = parsed.total - shownTotal;
    if (delta < 0 && -delta > shownMonth) {
      fail(400, "VALIDATION", "Нельзя уменьшить количество сампо больше, чем посещений в этом месяце");
    }
    const nextMonths = { ...months };
    const nextAmount = shownMonth + delta - actualMonth;
    if (nextAmount === 0) delete nextMonths[monthKey];
    else nextMonths[monthKey] = nextAmount;
    await tx`
      UPDATE users
      SET sampo_adjust = ${parsed.total - actualTotal},
          sampo_months = ${tx.json(nextMonths)}
      WHERE id = ${userId}
    `;
  });
}

export async function visitCounts(sql, userId, now = new Date()) {
  const month = studioMonthRange(now);
  const previous = studioMonthRange(new Date(month.start.getTime() - 1));
  const monthKey = studioMonthKey(now);
  const previousKey = studioMonthKey(previous.start);
  const [row] = await sql`
    SELECT
      count(*) FILTER (
        WHERE s.status = 'open' AND s.ends_at <= ${now}
      )::int AS actual,
      count(*) FILTER (
        WHERE s.status = 'open'
          AND s.ends_at <= ${now}
          AND s.starts_at >= ${month.start}
          AND s.starts_at < ${month.next}
      )::int AS month,
      count(*) FILTER (
        WHERE s.status = 'open'
          AND s.ends_at <= ${now}
          AND s.starts_at >= ${previous.start}
          AND s.starts_at < ${previous.next}
      )::int AS previous,
      coalesce((SELECT sampo_adjust FROM users WHERE id = ${userId}), 0)::int AS adjust,
      coalesce((SELECT sampo_months FROM users WHERE id = ${userId}), '{}'::jsonb) AS months
    FROM attendances a
    JOIN slots s ON s.id = a.slot_id
    WHERE a.user_id = ${userId}
  `;
  const months = row?.months && typeof row.months === "object" ? row.months : {};
  return {
    month: shownCount(row?.month ?? 0, monthAdjustOf(months, monthKey)),
    previous: shownCount(row?.previous ?? 0, monthAdjustOf(months, previousKey)),
    total: shownCount(row?.actual ?? 0, row?.adjust ?? 0),
    previousMonth: studioParts(previous.start).month,
  };
}

function leadersOf(rows) {
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    month: row.month,
    total: row.total,
  }));
}

function rankingQuery(sql, now) {
  const month = studioMonthRange(now);
  const monthKey = studioMonthKey(now);
  return sql`
    SELECT u.id, u.display_name,
      greatest(0, count(s.id) FILTER (
        WHERE s.status = 'open' AND s.ends_at <= ${now}
      )::int + u.sampo_adjust)::int AS total,
      greatest(0, count(s.id) FILTER (
        WHERE s.status = 'open'
          AND s.ends_at <= ${now}
          AND s.starts_at >= ${month.start}
          AND s.starts_at < ${month.next}
      )::int + coalesce((u.sampo_months->>${monthKey})::int, 0))::int AS month
    FROM users u
    LEFT JOIN attendances a ON a.user_id = u.id
    LEFT JOIN slots s ON s.id = a.slot_id
    WHERE u.app_role <> 'admin'
    GROUP BY u.id, u.sampo_adjust, u.sampo_months
  `;
}

async function ratingLeaders(sql, now, metric) {
  const ranked = rankingQuery(sql, now);
  const rows = metric === "month"
    ? await sql`
        SELECT id, display_name, month, total
        FROM (${ranked}) ranked
        WHERE month > 0
        ORDER BY month DESC, total DESC, display_name, id
        LIMIT 3
      `
    : await sql`
        SELECT id, display_name, month, total
        FROM (${ranked}) ranked
        WHERE total > 0
        ORDER BY total DESC, month DESC, display_name, id
        LIMIT 3
      `;
  return leadersOf(rows);
}

async function ratingPlace(sql, userId, now, metric) {
  const ranked = rankingQuery(sql, now);
  const [row] = metric === "month"
    ? await sql`
        SELECT place FROM (
          SELECT id, row_number() OVER (ORDER BY month DESC, total DESC, display_name, id) AS place
          FROM (${ranked}) ranked
          WHERE month > 0
        ) numbered
        WHERE id = ${userId}
      `
    : await sql`
        SELECT place FROM (
          SELECT id, row_number() OVER (ORDER BY total DESC, month DESC, display_name, id) AS place
          FROM (${ranked}) ranked
          WHERE total > 0
        ) numbered
        WHERE id = ${userId}
      `;
  return row?.place == null ? null : Number(row.place);
}

const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((item) => item.id));

function parseAchievementIds(value) {
  if (!Array.isArray(value)) return { ok: false, message: "Выберите ачивки" };
  const ids = [];
  for (const id of value) {
    if (typeof id !== "string" || !ACHIEVEMENT_IDS.has(id)) return { ok: false, message: "Выберите ачивку из списка" };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}

async function earnedFromVisits(sql, userId, now) {
  const [user] = await sql`SELECT created_at FROM users WHERE id = ${userId}`;
  const rows = await sql`
    SELECT s.starts_at, s.ends_at, s.place, a.guests, partner.partner_id
    FROM attendances a
    JOIN slots s ON s.id = a.slot_id
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN p.user_low_id = ${userId} THEN p.user_high_id
        ELSE p.user_low_id
      END AS partner_id
      FROM pairs p
      WHERE p.slot_id = s.id
        AND p.status = 'confirmed'
        AND (p.user_low_id = ${userId} OR p.user_high_id = ${userId})
      LIMIT 1
    ) partner ON true
    WHERE a.user_id = ${userId}
      AND s.status = 'open'
      AND s.ends_at <= ${now}
  `;
  return evaluateAchievements(rows.map((row) => ({
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    place: row.place,
    guest: row.guests === 1,
    partnerId: row.partner_id,
  })), { now, since: user?.created_at });
}

async function achievementOverrides(sql, userId) {
  const rows = await sql`
    SELECT achievement_id, granted
    FROM user_achievement_overrides
    WHERE user_id = ${userId}
  `;
  const granted = new Set();
  const revoked = new Set();
  for (const row of rows) {
    if (row.granted) granted.add(row.achievement_id);
    else revoked.add(row.achievement_id);
  }
  return { granted, revoked };
}

function applyAchievementOverrides(items, overrides) {
  return items.map((item) => ({
    ...item,
    earned: overrides.revoked.has(item.id) ? false : item.earned || overrides.granted.has(item.id),
  }));
}

function visibleAchievements(items, mode) {
  if (mode === "all") return items;
  if (mode === "earned") return items.filter((item) => !item.hidden || item.earned);
  return items.filter((item) => !item.hidden);
}

export async function userAchievements(sql, userId, now = new Date()) {
  const [items, overrides] = await Promise.all([
    earnedFromVisits(sql, userId, now),
    achievementOverrides(sql, userId),
  ]);
  return applyAchievementOverrides(items, overrides);
}

export async function publicAchievements(sql, userId, now = new Date()) {
  return visibleAchievements(await userAchievements(sql, userId, now), "earned");
}

export async function catalogueAchievements(sql, userId, now = new Date()) {
  return visibleAchievements(await userAchievements(sql, userId, now), "earned");
}

export async function setUserAchievements(sql, userId, ids, now = new Date()) {
  const parsed = parseAchievementIds(ids);
  if (!parsed.ok) fail(400, "VALIDATION", parsed.message);
  const natural = await earnedFromVisits(sql, userId, now);
  const wanted = new Set(parsed.ids);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM user_achievement_overrides WHERE user_id = ${userId}`;
    for (const item of natural) {
      if (wanted.has(item.id) === item.earned) continue;
      await tx`
        INSERT INTO user_achievement_overrides (user_id, achievement_id, granted)
        VALUES (${userId}, ${item.id}, ${wanted.has(item.id)})
      `;
    }
  });
  return adminProfile(sql, userId, now);
}

export async function ratingSummary(sql, userId, now = new Date()) {
  const [visits, total, month, totalPlace, monthPlace, achievements] = await Promise.all([
    visitCounts(sql, userId, now),
    ratingLeaders(sql, now, "total"),
    ratingLeaders(sql, now, "month"),
    ratingPlace(sql, userId, now, "total"),
    ratingPlace(sql, userId, now, "month"),
    catalogueAchievements(sql, userId, now),
  ]);
  return {
    visits,
    leaders: { total, month },
    place: { total: totalPlace, month: monthPlace },
    achievements,
  };
}

export async function profileSettings(sql, userId, now = new Date()) {
  const [user] = await sql`
    SELECT display_name, dance_level, invite_list, notify_invites, notify_hour_before,
           notify_new_slots, notify_new_slots_scope, share_availability
    FROM users WHERE id = ${userId}
  `;
  const levels = await sql`SELECT level FROM invitation_blocks WHERE user_id = ${userId}`;
  const blocked = new Set(levels.map((row) => row.level));
  const parsed = parseBlockedLevels([...blocked]);
  return {
    displayName: user?.display_name ?? "",
    danceLevel: user?.dance_level ?? null,
    blockedLevels: parsed.ok ? parsed.levels : [],
    listMode: user?.invite_list === "white" ? "white" : "black",
    blacklist: await namedList(sql, userId, "black"),
    whitelist: await namedList(sql, userId, "white"),
    notifyInvites: user?.notify_invites === true,
    notifyHourBefore: user?.notify_hour_before === true,
    notifyNewSlots: user?.notify_new_slots === true,
    notifyNewSlotsScope: user?.notify_new_slots_scope === "all" ? "all" : "free",
    shareAvailability: user?.share_availability === true,
    visits: await visitCounts(sql, userId, now),
  };
}

export async function saveProfile(sql, userId, body) {
  const name = validateDisplayName(body?.displayName);
  if (!name.ok) fail(400, "VALIDATION", name.message);
  const level = parseDanceLevel(body?.danceLevel);
  if (!level.ok) fail(400, "VALIDATION", level.message);
  const blocked = parseBlockedLevels(body?.blockedLevels);
  if (!blocked.ok) fail(400, "VALIDATION", blocked.message);
  const mode = parseListMode(body?.listMode);
  if (!mode.ok) fail(400, "VALIDATION", mode.message);
  const blacklist = parsePersonIds(body?.blacklist, userId, "Укажите чёрный список");
  if (!blacklist.ok) fail(400, "VALIDATION", blacklist.message);
  const whitelist = parsePersonIds(body?.whitelist, userId, "Укажите белый список");
  if (!whitelist.ok) fail(400, "VALIDATION", whitelist.message);
  const notifyInvites = parseFlag(body?.notifyInvites, "Укажите, присылать ли уведомления о приглашениях");
  if (!notifyInvites.ok) fail(400, "VALIDATION", notifyInvites.message);
  const notifyHourBefore = parseFlag(body?.notifyHourBefore, "Укажите, присылать ли уведомления за час до сампо");
  if (!notifyHourBefore.ok) fail(400, "VALIDATION", notifyHourBefore.message);
  const notifyNewSlots = parseFlag(body?.notifyNewSlots, "Укажите, присылать ли уведомления о новых слотах");
  if (!notifyNewSlots.ok) fail(400, "VALIDATION", notifyNewSlots.message);
  const notifyNewSlotsScope = parseSlotScope(body?.notifyNewSlotsScope);
  if (!notifyNewSlotsScope.ok) fail(400, "VALIDATION", notifyNewSlotsScope.message);
  const shareAvailability = parseFlag(body?.shareAvailability, "Укажите, делиться ли свободным временем");
  if (!shareAvailability.ok) fail(400, "VALIDATION", shareAvailability.message);
  const listed = [...new Set([...blacklist.ids, ...whitelist.ids])];
  await sql.begin(async (tx) => {
    if (listed.length) {
      const found = await tx`SELECT id FROM users WHERE id IN ${tx(listed)}`;
      if (found.length !== listed.length) fail(404, "NOT_FOUND", "Танцор не найден");
    }
    await tx`
      UPDATE users
      SET display_name = ${name.displayName},
          dance_level = ${level.danceLevel},
          invite_list = ${mode.listMode},
          notify_invites = ${notifyInvites.value},
          notify_hour_before = ${notifyHourBefore.value},
          notify_new_slots = ${notifyNewSlots.value},
          notify_new_slots_scope = ${notifyNewSlotsScope.scope},
          share_availability = ${shareAvailability.value}
      WHERE id = ${userId}
    `;
    await tx`DELETE FROM invitation_blocks WHERE user_id = ${userId}`;
    for (const code of blocked.levels) {
      await tx`INSERT INTO invitation_blocks (user_id, level) VALUES (${userId}, ${code})`;
    }
    await tx`DELETE FROM dancer_blacklist WHERE user_id = ${userId}`;
    for (const id of blacklist.ids) {
      await tx`INSERT INTO dancer_blacklist (user_id, blocked_user_id) VALUES (${userId}, ${id})`;
    }
    await tx`DELETE FROM dancer_whitelist WHERE user_id = ${userId}`;
    for (const id of whitelist.ids) {
      await tx`INSERT INTO dancer_whitelist (user_id, allowed_user_id) VALUES (${userId}, ${id})`;
    }
  });
  return profileSettings(sql, userId);
}

export async function setDanceLevel(sql, userId, danceLevel) {
  const parsed = parseDanceLevel(danceLevel);
  if (!parsed.ok) fail(400, "VALIDATION", parsed.message);
  await sql`UPDATE users SET dance_level = ${parsed.danceLevel} WHERE id = ${userId}`;
  return profileSettings(sql, userId);
}

export async function setBlockedLevels(sql, userId, levels) {
  const parsed = parseBlockedLevels(levels);
  if (!parsed.ok) fail(400, "VALIDATION", parsed.message);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM invitation_blocks WHERE user_id = ${userId}`;
    for (const level of parsed.levels) {
      await tx`INSERT INTO invitation_blocks (user_id, level) VALUES (${userId}, ${level})`;
    }
  });
  return profileSettings(sql, userId);
}

export async function searchDancers(sql, actorId, q, options = {}) {
  const query = String(q ?? "").trim().slice(0, 80);
  if (!query) return [];
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = options.includeSelf
    ? await sql`
        SELECT id, display_name, dance_level FROM users
        WHERE app_role <> 'admin' AND display_name ILIKE ${pattern}
        ORDER BY display_name, id
        LIMIT 20
      `
    : await sql`
        SELECT id, display_name, dance_level FROM users
        WHERE id <> ${actorId} AND app_role <> 'admin' AND display_name ILIKE ${pattern}
        ORDER BY display_name, id
        LIMIT 20
      `;
  return rows.map(personOf);
}

async function rememberDancer(sql, userId, otherId) {
  if (typeof otherId !== "string" || !USER_ID.test(otherId)) fail(400, "VALIDATION", "Выберите танцора");
  if (otherId === userId) fail(400, "VALIDATION", "Нельзя добавить себя");
  const [person] = await sql`SELECT id, app_role FROM users WHERE id = ${otherId}`;
  if (!person || person.app_role === "admin") fail(404, "NOT_FOUND", "Танцор не найден");
}

export async function addToBlacklist(sql, userId, blockedUserId) {
  await rememberDancer(sql, userId, blockedUserId);
  await sql`
    INSERT INTO dancer_blacklist (user_id, blocked_user_id)
    VALUES (${userId}, ${blockedUserId})
    ON CONFLICT DO NOTHING
  `;
  return profileSettings(sql, userId);
}

export async function removeFromBlacklist(sql, userId, blockedUserId) {
  if (typeof blockedUserId !== "string" || !USER_ID.test(blockedUserId)) fail(400, "VALIDATION", "Выберите танцора");
  await sql`DELETE FROM dancer_blacklist WHERE user_id = ${userId} AND blocked_user_id = ${blockedUserId}`;
  return profileSettings(sql, userId);
}

export async function addToWhitelist(sql, userId, allowedUserId) {
  await rememberDancer(sql, userId, allowedUserId);
  await sql`
    INSERT INTO dancer_whitelist (user_id, allowed_user_id)
    VALUES (${userId}, ${allowedUserId})
    ON CONFLICT DO NOTHING
  `;
  return profileSettings(sql, userId);
}

export async function removeFromWhitelist(sql, userId, allowedUserId) {
  if (typeof allowedUserId !== "string" || !USER_ID.test(allowedUserId)) fail(400, "VALIDATION", "Выберите танцора");
  await sql`DELETE FROM dancer_whitelist WHERE user_id = ${userId} AND allowed_user_id = ${allowedUserId}`;
  return profileSettings(sql, userId);
}

export async function listMembership(sql, ownerId, otherId) {
  const [black] = await sql`
    SELECT 1 FROM dancer_blacklist WHERE user_id = ${ownerId} AND blocked_user_id = ${otherId}
  `;
  const [white] = await sql`
    SELECT 1 FROM dancer_whitelist WHERE user_id = ${ownerId} AND allowed_user_id = ${otherId}
  `;
  return { blacklisted: Boolean(black), whitelisted: Boolean(white) };
}

export async function inviteListHides(sql, ownerId, viewerId) {
  const [owner] = await sql`SELECT invite_list FROM users WHERE id = ${ownerId}`;
  if (owner?.invite_list === "white") {
    const [row] = await sql`
      SELECT 1 FROM dancer_whitelist WHERE user_id = ${ownerId} AND allowed_user_id = ${viewerId}
    `;
    return !row;
  }
  const [row] = await sql`
    SELECT 1 FROM dancer_blacklist WHERE user_id = ${ownerId} AND blocked_user_id = ${viewerId}
  `;
  return Boolean(row);
}

export async function invitationDenied(tx, fromUserId, toUserId) {
  const [row] = await tx`
    SELECT 1
    WHERE EXISTS (
      SELECT 1
      FROM invitation_blocks ib
      JOIN users actor ON actor.id = ${fromUserId}
      WHERE ib.user_id = ${toUserId}
        AND actor.dance_level IS NOT NULL
        AND ib.level = actor.dance_level
    )
    OR EXISTS (
      SELECT 1 FROM users owner
      WHERE owner.id = ${toUserId}
        AND (
          (
            owner.invite_list = 'black'
            AND EXISTS (
              SELECT 1 FROM dancer_blacklist
              WHERE user_id = owner.id AND blocked_user_id = ${fromUserId}
            )
          )
          OR (
            owner.invite_list = 'white'
            AND NOT EXISTS (
              SELECT 1 FROM dancer_whitelist
              WHERE user_id = owner.id AND allowed_user_id = ${fromUserId}
            )
          )
        )
    )
  `;
  return Boolean(row);
}

export async function blockedTargets(tx, actorId, targetIds) {
  if (!targetIds.length) return new Set();
  const rows = await tx`
    SELECT u.id
    FROM users u
    WHERE u.id IN ${tx(targetIds)}
      AND (
        (
          u.invite_list = 'black'
          AND EXISTS (
            SELECT 1 FROM dancer_blacklist b
            WHERE b.user_id = u.id AND b.blocked_user_id = ${actorId}
          )
        )
        OR (
          u.invite_list = 'white'
          AND NOT EXISTS (
            SELECT 1 FROM dancer_whitelist w
            WHERE w.user_id = u.id AND w.allowed_user_id = ${actorId}
          )
        )
        OR EXISTS (
          SELECT 1
          FROM invitation_blocks ib
          JOIN users actor ON actor.id = ${actorId}
          WHERE ib.user_id = u.id
            AND actor.dance_level IS NOT NULL
            AND ib.level = actor.dance_level
        )
      )
  `;
  return new Set(rows.map((row) => row.id));
}
