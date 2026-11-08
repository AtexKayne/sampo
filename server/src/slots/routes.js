import { eq } from "drizzle-orm";
import { slots, users } from "../db/schema.js";
import { HttpError } from "../http/errors.js";
import { requireAdmin, requireUser } from "../auth/access.js";
import {
  addWeeks,
  parseStudioLocal,
  validateCapacity,
  validateDescription,
  validateInterval,
  validatePlace,
  validateRepeat,
  validateResponsible,
} from "./rules.js";
import {
  announceNewSlots,
  assertCapacity,
  assertTimeEditable,
  cancelSlot,
  deleteAdminSlot,
  getVisibleSlot,
  listSlotsForUser,
  presentSlot,
} from "../domain/sampo.js";
import {
  acceptSlotProposal,
  declineSlotProposal,
  getPendingProposal,
  listPendingProposals,
} from "../domain/slot-proposals.js";
import {
  createAudienceList,
  deleteAudienceList,
  listAudienceLists,
  replaceSlotAudience,
  resolveAudienceForCreate,
  resolveAudienceForPatch,
  updateAudienceList,
} from "../domain/audience.js";
import { listSlotDescriptions } from "./descriptions.js";

function fail(result) {
  throw new HttpError(result.statusCode, result.code, result.message);
}

export function toSlot(row) {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    place: row.place,
    capacity: row.capacity,
    description: row.description ?? null,
    responsibleUserId: row.responsibleUserId ?? null,
    status: row.status,
    visibility: row.visibility === "closed" ? "closed" : "open",
    seriesId: row.seriesId,
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

function parseRange(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new HttpError(400, "VALIDATION", `Укажите ${label}`);
  }
  return date;
}

async function resolveResponsible(db, value) {
  const parsed = validateResponsible(value);
  if (!parsed.ok) fail(parsed);
  if (!parsed.responsibleUserId) return null;
  const [person] = await db.select({ id: users.id }).from(users).where(eq(users.id, parsed.responsibleUserId));
  if (!person) throw new HttpError(400, "VALIDATION", "Пользователь не найден");
  return person.id;
}

async function loadSlot(db, id) {
  const [slot] = await db.select().from(slots).where(eq(slots.id, id));
  if (!slot) throw new HttpError(404, "NOT_FOUND", "Слот не найден");
  return slot;
}

export function registerSlotRoutes(app, { db, sql, config }) {
  app.get("/api/slots", async (request) => {
    const from = parseRange(request.query?.from, "начало интервала");
    const to = parseRange(request.query?.to, "конец интервала");
    if (to <= from) throw new HttpError(400, "VALIDATION", "Интервал календаря пустой");
    const user = await requireUser(request, db, config);
    const slots = await listSlotsForUser(sql, user, from, to);
    const proposals = await listPendingProposals(sql, from, to, user);
    return { slots: [...slots, ...proposals] };
  });

  app.get("/api/admin/slot-proposals/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return getPendingProposal(sql, request.params.id, user.id);
  });

  app.post("/api/admin/slot-proposals/:id/accept", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return acceptSlotProposal(sql, user.id, request.params.id, request.body);
  });

  app.post("/api/admin/slot-proposals/:id/decline", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return declineSlotProposal(sql, user.id, request.params.id);
  });

  app.get("/api/slots/:id", async (request) => {
    const user = await requireUser(request, db, config);
    return getVisibleSlot(sql, await loadSlot(db, request.params.id), user.id);
  });

  app.get("/api/admin/audience-lists", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return { lists: await listAudienceLists(sql) };
  });

  app.post("/api/admin/audience-lists", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return createAudienceList(sql, request.body?.name, request.body?.userIds);
  });

  app.patch("/api/admin/audience-lists/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return updateAudienceList(sql, request.params.id, request.body);
  });

  app.delete("/api/admin/audience-lists/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return deleteAudienceList(sql, request.params.id);
  });

  app.get("/api/admin/slot-descriptions", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    return { descriptions: await listSlotDescriptions(sql) };
  });

  app.post("/api/admin/slots", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    const startsAt = parseStudioLocal(request.body?.startsAtLocal);
    const endsAt = parseStudioLocal(request.body?.endsAtLocal);
    if (!startsAt || !endsAt) throw new HttpError(400, "VALIDATION", "Укажите дату и время слота");
    const interval = validateInterval(startsAt, endsAt);
    if (!interval.ok) fail(interval);
    const place = validatePlace(request.body?.place);
    if (!place.ok) fail(place);
    const capacity = validateCapacity(request.body?.capacity);
    if (!capacity.ok) fail(capacity);
    const repeat = validateRepeat(request.body?.repeatWeekly);
    if (!repeat.ok) fail(repeat);
    const description = validateDescription(request.body?.description);
    if (!description.ok) fail(description);
    const responsibleUserId = await resolveResponsible(db, request.body?.responsibleUserId);
    const audience = await resolveAudienceForCreate(sql, request.body);

    const seriesId = repeat.repeatWeekly > 0 ? crypto.randomUUID() : null;
    const rows = Array.from({ length: repeat.repeatWeekly + 1 }, (_, week) => ({
      id: crypto.randomUUID(),
      startsAt: addWeeks(startsAt, week),
      endsAt: addWeeks(endsAt, week),
      place: place.place,
      capacity: capacity.capacity,
      description: description.description,
      responsibleUserId,
      status: "open",
      visibility: audience.visibility,
      audienceListId: audience.audienceListId,
      seriesId,
    }));
    const created = await db.insert(slots).values(rows).returning();
    created.sort((left, right) => left.startsAt - right.startsAt);
    await replaceSlotAudience(
      sql,
      created.map((row) => row.id),
      audience.userIds,
    );
    await announceNewSlots(sql, created);
    return { slots: await Promise.all(created.map((row) => presentSlot(sql, row, user.id))) };
  });

  app.patch("/api/admin/slots/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    const slot = await loadSlot(db, request.params.id);
    if (slot.status !== "open") throw new HttpError(409, "SLOT_NOT_OPEN", "Слот уже отменён");
    if (slot.startsAt.getTime() <= Date.now()) {
      throw new HttpError(409, "SLOT_STARTED", "Нельзя изменить начавшийся слот");
    }

    const next = {
      place: slot.place,
      capacity: slot.capacity,
      description: slot.description,
      responsibleUserId: slot.responsibleUserId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      visibility: slot.visibility,
      audienceListId: slot.audienceListId,
    };
    if (request.body?.place !== undefined) {
      const place = validatePlace(request.body.place);
      if (!place.ok) fail(place);
      next.place = place.place;
    }
    if (request.body?.capacity !== undefined) {
      const capacity = validateCapacity(request.body.capacity);
      if (!capacity.ok) fail(capacity);
      await assertCapacity(sql, slot.id, capacity.capacity);
      next.capacity = capacity.capacity;
    }
    if (request.body?.description !== undefined) {
      const description = validateDescription(request.body.description);
      if (!description.ok) fail(description);
      next.description = description.description;
    }
    if (request.body?.responsibleUserId !== undefined) {
      next.responsibleUserId = await resolveResponsible(db, request.body.responsibleUserId);
    }
    if (request.body?.startsAtLocal !== undefined || request.body?.endsAtLocal !== undefined) {
      const startsAt = parseStudioLocal(request.body?.startsAtLocal);
      const endsAt = parseStudioLocal(request.body?.endsAtLocal);
      if (!startsAt || !endsAt) throw new HttpError(400, "VALIDATION", "Укажите дату и время слота");
      const interval = validateInterval(startsAt, endsAt);
      if (!interval.ok) fail(interval);
      await assertTimeEditable(sql, slot.id);
      next.startsAt = startsAt;
      next.endsAt = endsAt;
    }
    if (
      request.body?.visibility !== undefined ||
      request.body?.audienceUserIds !== undefined ||
      request.body?.audienceListId !== undefined
    ) {
      const audience = await resolveAudienceForPatch(sql, slot, request.body);
      next.visibility = audience.visibility;
      next.audienceListId = audience.audienceListId;
      if (audience.replaceAudience) await replaceSlotAudience(sql, [slot.id], audience.userIds);
    }

    const [updated] = await db.update(slots).set(next).where(eq(slots.id, slot.id)).returning();
    return presentSlot(sql, updated, user.id);
  });

  app.delete("/api/admin/slots/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    const scope = request.query?.scope === "series" ? "series" : "one";
    return deleteAdminSlot(sql, request.params.id, scope);
  });

  app.post("/api/admin/slots/:id/cancel", async (request) => {
    const user = await requireUser(request, db, config);
    requireAdmin(user);
    await cancelSlot(sql, request.params.id);
    return presentSlot(sql, await loadSlot(db, request.params.id), user.id);
  });
}
