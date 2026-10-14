import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { findRefreshSession, refreshSessionAlive, REFRESH_COOKIE } from "../auth/sessions.js";

const CHANNEL = "sampo_notification";
const BEAT_MS = 25000;
const bySession = new Map();
const byUser = new Map();

export function registerNotificationStream(app, { db, config }) {
  app.get("/api/notifications/stream", { websocket: true }, (socket, request) => {
    let alive = true;
    let timer;
    socket.on("error", () => {});
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("close", () => {
      clearInterval(timer);
    });

    const origin = request.headers.origin;
    if (origin && origin !== config.appOrigin) {
      socket.close(4403, "Недостаточно прав");
      return;
    }

    findRefreshSession(db, request.cookies?.[REFRESH_COOKIE])
      .then(async (session) => {
        if (socket.readyState !== 1) return;
        if (!session) {
          socket.close(4401, "Нужно войти");
          return;
        }
        const [user] = await db.select({ appRole: users.appRole }).from(users).where(eq(users.id, session.userId));
        if (user?.appRole === "admin") {
          socket.close(4403, "Недостаточно прав");
          return;
        }
        add(bySession, session.id, socket);
        add(byUser, session.userId, socket);
        socket.on("close", () => {
          remove(bySession, session.id, socket);
          remove(byUser, session.userId, socket);
        });
        timer = setInterval(() => {
          beat(db, session.id, socket, () => alive, () => {
            alive = false;
          });
        }, BEAT_MS);
      })
      .catch(() => {
        if (socket.readyState === 1) socket.close(1011, "Не удалось подключиться");
      });
  });
}

export async function listenForNotifications(sql, log) {
  await sql.listen(CHANNEL, (payload) => {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (!event?.userId || !event.notification?.id) return;
    const message = JSON.stringify({ type: "notification", notification: event.notification });
    for (const socket of byUser.get(event.userId) ?? []) {
      if (socket.readyState === 1) socket.send(message);
    }
  });
  log?.info("Слушаем живые уведомления");
}

export function closeSession(sessionId) {
  closeAll(bySession.get(sessionId));
}

export function closeUser(userId) {
  closeAll(byUser.get(userId));
}

function closeAll(group) {
  if (!group) return;
  for (const socket of [...group]) {
    if (socket.readyState === 1) socket.close(4401, "Нужно войти");
  }
}

async function beat(db, sessionId, socket, isAlive, markWaiting) {
  if (socket.readyState !== 1) return;
  if (!isAlive()) {
    socket.terminate();
    return;
  }
  try {
    const alive = await refreshSessionAlive(db, sessionId);
    if (!alive) {
      socket.close(4401, "Нужно войти");
      return;
    }
  } catch {
    // The next beat checks the session again.
  }
  if (socket.readyState !== 1) return;
  markWaiting();
  socket.ping();
}

function add(map, key, socket) {
  const group = map.get(key) ?? new Set();
  group.add(socket);
  map.set(key, group);
}

function remove(map, key, socket) {
  const group = map.get(key);
  if (!group) return;
  group.delete(socket);
  if (group.size === 0) map.delete(key);
}
