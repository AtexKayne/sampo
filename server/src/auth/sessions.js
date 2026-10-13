import { and, eq, gt } from "drizzle-orm";
import { refreshSessions, users } from "../db/schema.js";
import { hashRefreshToken, newRefreshToken, REFRESH_TTL_MS } from "./tokens.js";

export const REFRESH_COOKIE = "sampo_refresh";

export function publicUser(row) {
  return {
    id: row.id,
    login: row.login,
    displayName: row.displayName,
    appRole: row.appRole,
    hasLogin: Boolean(row.login),
    vkLinked: row.vkUserId != null,
  };
}

export async function issueRefreshSession(db, userId, now = new Date()) {
  const token = newRefreshToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
  await db.insert(refreshSessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashRefreshToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

const REUSE_MS = 15_000;
const recentRotations = new Map();
const rotationsInFlight = new Map();

function freshRotation(tokenHash) {
  const found = recentRotations.get(tokenHash);
  if (!found) return null;
  if (Date.now() - found.at > REUSE_MS) {
    recentRotations.delete(tokenHash);
    return null;
  }
  return found.rotated;
}

function rememberRotation(tokenHash, rotated) {
  recentRotations.set(tokenHash, { rotated, at: Date.now() });
  if (recentRotations.size < 50) return;
  const cutoff = Date.now() - REUSE_MS;
  for (const [key, value] of recentRotations) {
    if (value.at < cutoff) recentRotations.delete(key);
  }
}

export async function rotateRefreshSession(db, token, now = new Date()) {
  if (!token) return null;
  const tokenHash = hashRefreshToken(token);
  const again = freshRotation(tokenHash);
  if (again) return again;
  const inflight = rotationsInFlight.get(tokenHash);
  if (inflight) {
    await inflight.catch(() => {});
    return freshRotation(tokenHash);
  }
  const run = rotateOnce(db, tokenHash, now);
  rotationsInFlight.set(tokenHash, run);
  try {
    return await run;
  } finally {
    rotationsInFlight.delete(tokenHash);
  }
}

async function rotateOnce(db, tokenHash, now) {
  const rotated = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        sessionId: refreshSessions.id,
        userId: users.id,
        login: users.login,
        displayName: users.displayName,
        appRole: users.appRole,
        vkUserId: users.vkUserId,
      })
      .from(refreshSessions)
      .innerJoin(users, eq(users.id, refreshSessions.userId))
      .where(and(eq(refreshSessions.tokenHash, tokenHash), gt(refreshSessions.expiresAt, now)));

    if (!row) return null;

    const deleted = await tx
      .delete(refreshSessions)
      .where(eq(refreshSessions.id, row.sessionId))
      .returning({ id: refreshSessions.id });
    if (deleted.length === 0) return null;

    const next = newRefreshToken();
    await tx.insert(refreshSessions).values({
      id: crypto.randomUUID(),
      userId: row.userId,
      tokenHash: hashRefreshToken(next),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    });

    return {
      token: next,
      user: {
        id: row.userId,
        login: row.login,
        displayName: row.displayName,
        appRole: row.appRole,
        vkUserId: row.vkUserId,
      },
    };
  });
  if (rotated) rememberRotation(tokenHash, rotated);
  return rotated ?? freshRotation(tokenHash);
}

export async function findRefreshSession(db, token, now = new Date()) {
  if (!db || !token) return null;
  const [row] = await db
    .select({ id: refreshSessions.id, userId: refreshSessions.userId })
    .from(refreshSessions)
    .where(and(eq(refreshSessions.tokenHash, hashRefreshToken(token)), gt(refreshSessions.expiresAt, now)));
  return row ?? null;
}

export async function refreshSessionAlive(db, sessionId, now = new Date()) {
  if (!db || !sessionId) return false;
  const [row] = await db
    .select({ id: refreshSessions.id })
    .from(refreshSessions)
    .where(and(eq(refreshSessions.id, sessionId), gt(refreshSessions.expiresAt, now)));
  return Boolean(row);
}

export async function revokeRefreshSession(db, token) {
  if (!token) return;
  await db.delete(refreshSessions).where(eq(refreshSessions.tokenHash, hashRefreshToken(token)));
}
