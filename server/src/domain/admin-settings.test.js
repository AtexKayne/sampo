import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import { HttpError } from "../http/errors.js";
import { getAdminSettings, listLinkedUserIds, saveAdminSettings } from "./admin-settings.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const created = [];

function vkId(id) {
  return Number(BigInt(`0x${id.replaceAll("-", "").slice(0, 12)}`));
}

async function makeUser(name) {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO users (id, vk_user_id, display_name)
    VALUES (${id}, ${vkId(id)}, ${name})
  `;
  created.push(id);
  return id;
}

test.after(async () => {
  if (created.length) {
    await sql`DELETE FROM admin_setting_users WHERE user_id IN ${sql(created)}`;
    await sql`DELETE FROM users WHERE id IN ${sql(created)}`;
  }
  await sql.end({ timeout: 5 });
});

test("admin settings keep linked users and slot request recipients", async () => {
  const first = await makeUser("Первый связанный");
  const second = await makeUser("Второй связанный");
  const recipient = await makeUser("Получатель запросов");
  const previous = await getAdminSettings(sql);
  const previousLinked = previous.linkedUsers.map((person) => person.id);
  const previousRecipients = previous.slotRequestRecipients.map((person) => person.id);

  try {
    const saved = await saveAdminSettings(sql, {
      linkedUserIds: [...previousLinked, second, first],
      slotRequestRecipientIds: [...previousRecipients, recipient],
    });
    assert.equal(saved.linkedUsers.some((person) => person.id === first), true);
    assert.equal(saved.linkedUsers.some((person) => person.id === second), true);
    assert.equal(saved.slotRequestRecipients.some((person) => person.id === recipient), true);
    assert.equal((await listLinkedUserIds(sql)).includes(first), true);

    const emptied = await saveAdminSettings(sql, { slotRequestRecipientIds: [] });
    assert.deepEqual(emptied.slotRequestRecipients, []);
    assert.equal(emptied.linkedUsers.some((person) => person.id === first), true);
  } finally {
    await saveAdminSettings(sql, {
      linkedUserIds: previousLinked,
      slotRequestRecipientIds: previousRecipients,
    });
  }
});

test("admin settings reject the administrator", async () => {
  const [admin] = await sql`SELECT id FROM users WHERE app_role = 'admin' ORDER BY created_at LIMIT 1`;
  await assert.rejects(
    () => saveAdminSettings(sql, { linkedUserIds: [admin.id] }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});
