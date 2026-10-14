import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../db/schema.js";
import * as schema from "../db/schema.js";
import { migrate } from "../db/migrate.js";
import {
  ACCOUNT_SWITCH_USER_ID,
  issueRefreshSession,
  presentUser,
  rotateRefreshSession,
  switchRefreshAccount,
  switchTargetId,
} from "./sessions.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);
const db = drizzle(sql, { schema });

const created = [];
let createdSwitchUser = false;

function vkId(id) {
  return Number(BigInt(`0x${id.replaceAll("-", "").slice(0, 12)}`));
}

async function makeUser(name, role = "user") {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO users (id, vk_user_id, display_name, app_role)
    VALUES (${id}, ${vkId(id)}, ${name}, ${role})
  `;
  created.push(id);
  return id;
}

test.after(async () => {
  if (createdSwitchUser) await sql`DELETE FROM users WHERE id = ${ACCOUNT_SWITCH_USER_ID}`;
  if (created.length) await sql`DELETE FROM users WHERE id IN ${sql(created)}`;
  await sql.end({ timeout: 5 });
});

test("only the account that logged in can switch to the admin and back", () => {
  const userId = "user";
  const adminId = "admin";
  assert.equal(
    switchTargetId({ loginUserId: userId, activeUserId: userId, adminId, allowedUserId: userId }),
    adminId,
  );
  assert.equal(
    switchTargetId({ loginUserId: userId, activeUserId: adminId, adminId, allowedUserId: userId }),
    userId,
  );
  assert.equal(
    switchTargetId({ loginUserId: adminId, activeUserId: adminId, adminId, allowedUserId: userId }),
    null,
  );
  assert.equal(
    switchTargetId({ loginUserId: "other", activeUserId: "other", adminId, allowedUserId: userId }),
    null,
  );
  assert.equal(
    switchTargetId({ loginUserId: userId, activeUserId: userId, adminId: null, allowedUserId: userId }),
    null,
  );
});

test("refresh keeps the login account, and switch follows it", async () => {
  const userId = await makeUser("Участник");
  const adminId = await makeUser("Админ теста", "admin");
  const otherId = await makeUser("Другой");
  const options = { allowedUserId: userId, adminId };

  const issued = await issueRefreshSession(db, userId);
  const rotated = await rotateRefreshSession(db, issued.token);
  assert.equal(rotated.loginUserId, userId);
  assert.equal(rotated.user.id, userId);

  const switched = await switchRefreshAccount(db, rotated.token, options);
  assert.equal(switched.status, "ok");
  assert.equal(switched.user.id, adminId);
  assert.equal(switched.user.appRole, "admin");
  assert.equal(switched.loginUserId, userId);

  const back = await switchRefreshAccount(db, rotated.token, options);
  assert.equal(back.status, "ok");
  assert.equal(back.user.id, userId);
  assert.equal(back.loginUserId, userId);

  const again = await rotateRefreshSession(db, rotated.token);
  assert.equal(again.user.id, userId);
  assert.equal(again.loginUserId, userId);

  const adminSession = await issueRefreshSession(db, adminId);
  assert.equal((await switchRefreshAccount(db, adminSession.token, options)).status, "forbidden");
  const [adminRow] = await sql`SELECT user_id FROM refresh_sessions WHERE user_id = ${adminId}`;
  assert.equal(adminRow.user_id, adminId);

  const otherSession = await issueRefreshSession(db, otherId);
  assert.equal((await switchRefreshAccount(db, otherSession.token, options)).status, "forbidden");
});

test("the chosen profile is offered a switch and an admin login is not", async () => {
  const [existing] = await sql`SELECT id FROM users WHERE id = ${ACCOUNT_SWITCH_USER_ID}`;
  if (!existing) {
    await sql`
      INSERT INTO users (id, vk_user_id, display_name)
      VALUES (${ACCOUNT_SWITCH_USER_ID}, ${vkId(ACCOUNT_SWITCH_USER_ID)}, 'Алексей Кремлев')
    `;
    createdSwitchUser = true;
  }

  const [person] = await db.select().from(users).where(eq(users.id, ACCOUNT_SWITCH_USER_ID));
  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.appRole, "admin"))
    .orderBy(users.createdAt)
    .limit(1);

  const asSelf = await presentUser(db, person, person.id);
  assert.equal(asSelf.accountSwitch?.to, "admin");
  assert.equal(asSelf.accountSwitch.displayName, admin.displayName);
  assert.equal(asSelf.appRole, person.appRole);

  const asAdmin = await presentUser(db, admin, admin.id);
  assert.equal(asAdmin.accountSwitch, undefined);

  const acting = await presentUser(db, admin, ACCOUNT_SWITCH_USER_ID);
  assert.equal(acting.id, admin.id);
  assert.equal(acting.appRole, "admin");
  assert.equal(acting.accountSwitch?.to, "user");
  assert.equal(acting.accountSwitch.displayName, person.displayName);
});
