import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { users } from "./schema.js";
import { migrate } from "./migrate.js";
import { hashPassword, validateLogin, validatePassword } from "../auth/password.js";

export async function openDatabase(config, log) {
  if (!config.databaseUrl) {
    log.warn("DATABASE_URL не задан: регистрация и вход недоступны");
    return null;
  }

  const sql = postgres(config.databaseUrl, { max: 10 });
  await migrate(sql);
  const db = drizzle(sql, { schema });
  restoreRawSerializers(sql);
  await seedAdmin(db, config, log);
  return { db, sql };
}

function restoreRawSerializers(sql) {
  const time = (value) => (value instanceof Date ? value.toISOString() : `${value}`);
  for (const type of ["1184", "1114", "1082", "1083", "1182"]) sql.options.serializers[type] = time;
  const json = (value) => (typeof value === "string" ? value : JSON.stringify(value));
  sql.options.serializers["114"] = json;
  sql.options.serializers["3802"] = json;
}

async function seedAdmin(db, config, log) {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) return;

  const loginResult = validateLogin(config.seedAdminLogin);
  const passwordResult = validatePassword(config.seedAdminPassword);
  if (!loginResult.ok || !passwordResult.ok) {
    log.warn("Первый администратор не создан: задайте SEED_ADMIN_LOGIN и SEED_ADMIN_PASSWORD");
    return;
  }

  try {
    await db.insert(users).values({
      id: crypto.randomUUID(),
      login: loginResult.login,
      passwordHash: await hashPassword(passwordResult.password),
      displayName: "Администратор",
      appRole: "admin",
    });
    log.info({ login: loginResult.login }, "Создан первый администратор");
  } catch (error) {
    if (error?.code === "23505" || error?.cause?.code === "23505") return;
    throw error;
  }
}
