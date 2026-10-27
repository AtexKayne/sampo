import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import { listSlotDescriptions } from "./descriptions.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const created = [];

test.after(async () => {
  if (created.length) await sql`DELETE FROM slots WHERE id IN ${sql(created)}`;
  await sql.end({ timeout: 5 });
});

async function insertSlot(description, createdAt) {
  const id = crypto.randomUUID();
  const starts = new Date("2099-01-01T10:00:00.000Z");
  const ends = new Date("2099-01-01T12:00:00.000Z");
  await sql`
    INSERT INTO slots (id, starts_at, ends_at, place, capacity, description, created_at)
    VALUES (${id}, ${starts}, ${ends}, 'Hall', 4, ${description}, ${createdAt})
  `;
  created.push(id);
  return id;
}

test("slot description hints are distinct existing texts, newest reuse first", async () => {
  const token = crypto.randomUUID();
  const older = `зал на втором этаже ${token}`;
  const newer = `без обуви ${token}`;
  await insertSlot(older, new Date("2098-01-01T00:00:00.000Z"));
  await insertSlot(newer, new Date("2098-06-01T00:00:00.000Z"));
  await insertSlot(null, new Date("2099-01-01T00:00:00.000Z"));
  await insertSlot(older, new Date("2098-12-01T00:00:00.000Z"));

  const hints = (await listSlotDescriptions(sql)).filter((text) => text.includes(token));
  assert.deepEqual(hints, [older, newer]);
});
