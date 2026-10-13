import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { openDatabase } from "./db/index.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerSlotRoutes } from "./slots/routes.js";
import { registerUserRoutes } from "./user/routes.js";
import { expireDue, remindDue } from "./domain/sampo.js";
import { listenForNotifications, registerNotificationStream } from "./notifications/live.js";
import { createLoginLimiter } from "./auth/rate-limit.js";
import { HttpError, errorBody } from "./http/errors.js";

const app = Fastify({ logger: true, trustProxy: "loopback" });
const database = await openDatabase(config, app.log);
const db = database?.db ?? null;
const sql = database?.sql ?? null;

await app.register(cookie);
await app.register(websocket);
registerAuthRoutes(app, { db, sql, config, limiter: createLoginLimiter() });
registerSlotRoutes(app, { db, sql, config });
registerUserRoutes(app, { db, sql, config });
registerNotificationStream(app, { db, config });

if (sql) {
  await listenForNotifications(sql, app.log);
  setInterval(() => {
    expireDue(sql).catch((error) => app.log.error(error));
    remindDue(sql).catch((error) => app.log.error(error));
  }, 15000);
}

app.get("/api/health", async () => ({ ok: true }));

app.setErrorHandler((error, request, reply) => {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send(errorBody(error.code, error.message));
  }
  if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
    return reply.code(400).send(errorBody("VALIDATION", "Некорректный запрос"));
  }
  request.log.error(error);
  return reply.code(500).send(errorBody("INTERNAL", "Не удалось выполнить запрос"));
});

try {
  await app.listen({ port: config.port, host: "127.0.0.1" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
