import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import postgres from "postgres";
import { verifyPassword } from "../auth/password.js";
import { migrate } from "../db/migrate.js";
import { HttpError } from "../http/errors.js";
import { setLoginPassword } from "./credentials.js";

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
