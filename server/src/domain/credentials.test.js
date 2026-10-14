import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { verifyPassword } from "../auth/password.js";
import { migrate } from "../db/migrate.js";
import { HttpError } from "../http/errors.js";
import { createPasswordUser, setLoginPassword } from "./credentials.js";
import { adminProfile, deleteOtherProfile, saveProfile, searchAccounts } from "./profile.js";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await migrate(sql);

const users = [];

async function makeVkUser(name) {
  const id = crypto.randomUUID();
  const vkUserId = Number(BigInt(`0x${id.replaceAll("-", "").slice(0, 12)}`));
  await sql`INSERT INTO users (id, vk_user_id, display_name) VALUES (${id}, ${vkUserId}, ${name})`;
  users.push(id);
  return id;
}

test.after(async () => {
  if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  await sql.end({ timeout: 5 });
});

test("vk user can set login and password, then change login without a new password", async () => {
  const id = await makeVkUser("Аня");
  const created = await setLoginPassword(sql, id, { login: "Anya_1", password: "long-enough" });
  assert.equal(created.login, "anya_1");
  assert.equal(created.hasLogin, true);
  assert.equal(created.vkLinked, true);
  const [row] = await sql`SELECT password_hash FROM users WHERE id = ${id}`;
  assert.equal(await verifyPassword("long-enough", row.password_hash), true);

  const renamed = await setLoginPassword(sql, id, { login: "anya_2", password: "" });
  assert.equal(renamed.login, "anya_2");
  const [again] = await sql`SELECT password_hash FROM users WHERE id = ${id}`;
  assert.equal(await verifyPassword("long-enough", again.password_hash), true);

  await setLoginPassword(sql, id, { login: "anya_2", password: "another-password" });
  const [changed] = await sql`SELECT password_hash FROM users WHERE id = ${id}`;
  assert.equal(await verifyPassword("another-password", changed.password_hash), true);
});

test("login and password are required until both exist, and a taken login is rejected", async () => {
  const first = await makeVkUser("Боря");
  const second = await makeVkUser("Вера");
  await assert.rejects(
    setLoginPassword(sql, first, { login: "no", password: "long-enough" }),
    (error) => error instanceof HttpError && error.code === "VALIDATION",
  );
  await assert.rejects(
    setLoginPassword(sql, first, { login: "boris_1", password: "" }),
    (error) => error instanceof HttpError && error.code === "VALIDATION",
  );
  await setLoginPassword(sql, first, { login: "boris_1", password: "long-enough" });
  await assert.rejects(
    setLoginPassword(sql, second, { login: "boris_1", password: "long-enough" }),
    (error) => error instanceof HttpError && error.code === "LOGIN_TAKEN",
  );
});

test("password registration creates a user who can sign in with that login", async () => {
  const created = await createPasswordUser(sql, {
    login: "Galya_9",
    password: "long-enough",
    displayName: "  Галя ",
  });
  users.push(created.id);
  assert.equal(created.login, "galya_9");
  assert.equal(created.displayName, "Галя");
  assert.equal(created.appRole, "user");
  assert.equal(created.hasLogin, true);
  assert.equal(created.vkLinked, false);
  const [row] = await sql`SELECT password_hash FROM users WHERE id = ${created.id}`;
  assert.equal(await verifyPassword("long-enough", row.password_hash), true);
  await assert.rejects(
    createPasswordUser(sql, { login: "galya_9", password: "long-enough", displayName: "Другая" }),
    (error) => error instanceof HttpError && error.code === "LOGIN_TAKEN",
  );
});

test("admin can find and edit another profile, and cannot delete an admin", async () => {
  const adminId = crypto.randomUUID();
  const adminLogin = `adm${adminId.replaceAll("-", "").slice(0, 8)}`;
  await sql`
    INSERT INTO users (id, login, password_hash, display_name, app_role)
    VALUES (${adminId}, ${adminLogin}, 'x', 'Админ', 'admin')
  `;
  users.push(adminId);
  const created = await createPasswordUser(sql, {
    login: `edit${adminId.replaceAll("-", "").slice(0, 8)}`,
    password: "long-enough",
    displayName: "Редактор",
  });
  users.push(created.id);

  const byName = await searchAccounts(sql, adminId, "редакт");
  assert.equal(byName.some((person) => person.id === created.id), true);
  const hidden = await searchAccounts(sql, adminId, adminLogin);
  assert.equal(hidden.some((person) => person.id === adminId), false);

  await saveProfile(sql, created.id, {
    displayName: "Редактор два",
    danceLevel: null,
    blockedLevels: [],
    listMode: "black",
    blacklist: [],
    whitelist: [],
    notifyInvites: true,
    notifyHourBefore: false,
    shareAvailability: true,
  });
  const profile = await adminProfile(sql, created.id);
  assert.equal(profile.displayName, "Редактор два");
  assert.equal(profile.login, created.login);
  assert.equal(profile.notifyHourBefore, false);
  assert.equal(profile.shareAvailability, true);

  await assert.rejects(
    deleteOtherProfile(sql, adminId, adminId),
    (error) => error instanceof HttpError && error.code === "VALIDATION",
  );
  await assert.rejects(
    deleteOtherProfile(sql, created.id, adminId),
    (error) => error instanceof HttpError && error.code === "FORBIDDEN",
  );
  await deleteOtherProfile(sql, adminId, created.id);
  const [gone] = await sql`SELECT id FROM users WHERE id = ${created.id}`;
  assert.equal(gone, undefined);
});
