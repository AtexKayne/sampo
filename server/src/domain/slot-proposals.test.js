import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import { HttpError } from "../http/errors.js";
import { TIME_ZONE_OFFSET_MS } from "../../../shared/timezone.js";
import { saveAdminSettings } from "./admin-settings.js";
import { acceptSlotProposal, createSlotProposal, declineSlotProposal, listPendingProposals, withdrawSlotProposal } from "./slot-proposals.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const users = [];
const slots = [];
const proposals = [];
let previousRecipients = [];

function localValue(date) {
  const shifted = new Date(date.getTime() + TIME_ZONE_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function futureRange(daysAhead = 0) {
  const start = new Date(Date.UTC(2026, 11, 20, 14, 0) - TIME_ZONE_OFFSET_MS + daysAhead * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start, end, startsAtLocal: localValue(start), endsAtLocal: localValue(end) };
}

async function makeUser(name, role = "user") {
  const id = crypto.randomUUID();
  const login = `p${id.replaceAll("-", "").slice(0, 12)}`;
  await sql`
    INSERT INTO users (id, login, password_hash, display_name, app_role, vk_user_id)
    VALUES (${id}, ${login}, 'x', ${name}, ${role}, ${Number(BigInt(`0x${id.replaceAll("-", "").slice(0, 12)}`))})
  `;
  users.push(id);
  return id;
}

test.before(async () => {
  previousRecipients = (await sql`SELECT user_id FROM admin_setting_users WHERE kind = 'slot_request'`).map((row) => row.user_id);
});

test.after(async () => {
  await saveAdminSettings(sql, { slotRequestRecipientIds: previousRecipients });
  if (proposals.length) await sql`DELETE FROM slot_proposals WHERE id IN ${sql(proposals)}`;
  if (slots.length) await sql`DELETE FROM slots WHERE id IN ${sql(slots)}`;
  if (users.length) {
    await sql`DELETE FROM admin_setting_users WHERE user_id IN ${sql(users)}`;
    await sql`DELETE FROM notifications WHERE user_id IN ${sql(users)}`;
    await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  }
  await sql.end({ timeout: 5 });
});

test("a dancer proposes a slot and staff can accept it into a real slot", async () => {
  const dancer = await makeUser("Предлагающий");
  const staff = await makeUser("Получатель заявок");
  await saveAdminSettings(sql, { slotRequestRecipientIds: [...previousRecipients, staff] });
  const range = futureRange();

  const proposal = await createSlotProposal(sql, dancer, {
    startsAtLocal: range.startsAtLocal,
    endsAtLocal: range.endsAtLocal,
    place: "Зал 2",
    description: "После занятия",
  });
  proposals.push(proposal.id);
  assert.equal(proposal.kind, "proposal");
  assert.equal(proposal.place, "Зал 2");
  assert.equal(proposal.proposedBy.displayName, "Предлагающий");
  assert.equal(proposal.description, "После занятия");
  assert.equal(proposal.responsible.id, dancer);

  await assert.rejects(
    () => createSlotProposal(sql, dancer, {
      startsAtLocal: range.startsAtLocal,
      endsAtLocal: range.endsAtLocal,
    }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );

  const listed = await listPendingProposals(sql, range.start, new Date(range.end.getTime() + 1));
  assert.equal(listed.some((item) => item.id === proposal.id), true);
  const own = await listPendingProposals(sql, range.start, new Date(range.end.getTime() + 1), { id: dancer, appRole: "user" });
  assert.equal(own.some((item) => item.id === proposal.id), true);
  const others = await listPendingProposals(sql, range.start, new Date(range.end.getTime() + 1), { id: staff, appRole: "user" });
  assert.equal(others.some((item) => item.id === proposal.id), false);

  const [note] = await sql`
    SELECT payload FROM notifications
    WHERE user_id = ${staff} AND type = 'slot_proposed'
    ORDER BY created_at DESC LIMIT 1
  `;
  assert.equal(note.payload.proposalId, proposal.id);
  const [vk] = await sql`
    SELECT d.status
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.user_id = ${staff} AND n.type = 'slot_proposed' AND d.channel = 'vk'
    ORDER BY n.created_at DESC LIMIT 1
  `;
  assert.equal(vk.status, "pending");

  await assert.rejects(
    () => acceptSlotProposal(sql, dancer, proposal.id),
    (error) => error instanceof HttpError && error.code === "FORBIDDEN",
  );

  const accepted = await acceptSlotProposal(sql, staff, proposal.id, { description: "После пары" });
  slots.push(accepted.slot.id);
  assert.equal(accepted.slot.place, "Зал 2");
  assert.equal(accepted.slot.capacity, 20);
  const [created] = await sql`SELECT description, responsible_user_id FROM slots WHERE id = ${accepted.slot.id}`;
  assert.equal(created.description, "После пары");
  assert.equal(created.responsible_user_id, dancer);
  const hidden = await listPendingProposals(sql, range.start, new Date(range.end.getTime() + 1));
  assert.equal(hidden.some((item) => item.id === proposal.id), false);

  const [toDancer] = await sql`
    SELECT payload FROM notifications
    WHERE user_id = ${dancer} AND type = 'slot_proposal_accepted'
  `;
  assert.equal(toDancer.payload.slotId, accepted.slot.id);
});

test("a proposal notifies every slot-request recipient over VK", async () => {
  const dancer = await makeUser("Автор рассылки");
  const first = await makeUser("Первый из списка");
  const second = await makeUser("Второй из списка");
  await saveAdminSettings(sql, { slotRequestRecipientIds: [first, second] });
  const range = futureRange(2);
  const proposal = await createSlotProposal(sql, dancer, {
    startsAtLocal: range.startsAtLocal,
    endsAtLocal: range.endsAtLocal,
    place: "Зал 3",
    description: "Разбор фигур",
  });
  proposals.push(proposal.id);
  const notes = await sql`
    SELECT n.user_id, n.payload, d.status
    FROM notifications n
    JOIN notification_deliveries d ON d.notification_id = n.id AND d.channel = 'vk'
    WHERE n.type = 'slot_proposed' AND n.payload->>'proposalId' = ${proposal.id}
  `;
  assert.equal(notes.length, 2);
  assert.deepEqual(new Set(notes.map((row) => row.user_id)), new Set([first, second]));
  assert.equal(notes.every((row) => row.status === "pending"), true);
  assert.equal(notes[0].payload.place, "Зал 3");
  assert.equal(notes[0].payload.description, "Разбор фигур");
  assert.equal(notes[0].payload.responsibleName, "Автор рассылки");
  assert.ok(notes[0].payload.startsAt);
  assert.ok(notes[0].payload.endsAt);
});

test("a pending proposal can be declined and does not become a slot", async () => {
  const dancer = await makeUser("Второй предлагающий");
  const staff = await makeUser("Второй получатель");
  await saveAdminSettings(sql, { slotRequestRecipientIds: [...previousRecipients, staff, dancer] });
  const range = futureRange(1);
  const proposal = await createSlotProposal(sql, dancer, {
    startsAtLocal: range.startsAtLocal,
    endsAtLocal: range.endsAtLocal,
    place: "Зал 1",
  });
  proposals.push(proposal.id);
  assert.equal(proposal.place, "Зал 1");
  await declineSlotProposal(sql, staff, proposal.id);
  const [{ to_staff: toStaff }] = await sql`
    SELECT count(*)::int AS to_staff FROM notifications
    WHERE user_id = ${staff} AND type = 'slot_proposal_declined'
  `;
  assert.equal(toStaff, 0);
  const [{ to_author: toAuthor }] = await sql`
    SELECT count(*)::int AS to_author FROM notifications
    WHERE user_id = ${dancer} AND type = 'slot_proposal_declined'
  `;
  assert.equal(toAuthor, 1);
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM slots WHERE id = (SELECT slot_id FROM slot_proposals WHERE id = ${proposal.id})`;
  assert.equal(count, 0);
  await assert.rejects(
    () => declineSlotProposal(sql, staff, proposal.id),
    (error) => error instanceof HttpError && error.code === "CONFLICT",
  );
});

test("the author can withdraw a pending proposal", async () => {
  const dancer = await makeUser("Отзывающий");
  const other = await makeUser("Чужой автор");
  const staff = await makeUser("Получатель отзыва");
  await saveAdminSettings(sql, { slotRequestRecipientIds: [staff] });
  const range = futureRange(3);
  const proposal = await createSlotProposal(sql, dancer, {
    startsAtLocal: range.startsAtLocal,
    endsAtLocal: range.endsAtLocal,
    place: "Зал 1",
  });
  proposals.push(proposal.id);
  await assert.rejects(
    () => withdrawSlotProposal(sql, other, proposal.id),
    (error) => error instanceof HttpError && error.code === "FORBIDDEN",
  );
  await assert.rejects(
    () => withdrawSlotProposal(sql, staff, proposal.id),
    (error) => error instanceof HttpError && error.code === "FORBIDDEN",
  );
  const withdrawn = await withdrawSlotProposal(sql, dancer, proposal.id);
  assert.equal(withdrawn.ok, true);
  const listed = await listPendingProposals(sql, range.start, new Date(range.end.getTime() + 1), { id: dancer, appRole: "user" });
  assert.equal(listed.some((item) => item.id === proposal.id), false);
  const [status] = await sql`SELECT status FROM slot_proposals WHERE id = ${proposal.id}`;
  assert.equal(status.status, "withdrawn");
  const [note] = await sql`
    SELECT payload FROM notifications
    WHERE user_id = ${staff} AND type = 'slot_proposal_withdrawn'
    ORDER BY created_at DESC LIMIT 1
  `;
  assert.equal(note.payload.proposalId, proposal.id);
  const [{ pending_proposed }] = await sql`
    SELECT count(*)::int AS pending_proposed
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE n.type = 'slot_proposed' AND n.payload->>'proposalId' = ${proposal.id} AND d.status = 'pending'
  `;
  assert.equal(pending_proposed, 0);
  await assert.rejects(
    () => withdrawSlotProposal(sql, dancer, proposal.id),
    (error) => error instanceof HttpError && error.code === "CONFLICT",
  );
  await assert.rejects(
    () => acceptSlotProposal(sql, staff, proposal.id),
    (error) => error instanceof HttpError && error.code === "CONFLICT",
  );
});
