import { HttpError } from "../http/errors.js";
import { requireUser } from "../auth/access.js";
import {
  acceptRequest,
  attend,
  cancelAcceptedRequest,
  cancelPair,
  clearNotifications,
  createRequest,
  createWindow,
  declineRequest,
  deleteWindow,
  dancerProfile,
  freePeople,
  getRequest,
  leave,
  listNotifications,
  listRequests,
  listWindows,
  updateWindow,
  markNotificationRead,
  setAvailability,
  withdrawRequest,
} from "../domain/sampo.js";
import {
  addToBlacklist,
  addToWhitelist,
  profileSettings,
  removeFromBlacklist,
  removeFromWhitelist,
  saveProfile,
  searchDancers,
  setBlockedLevels,
  setDanceLevel,
} from "../domain/profile.js";

export function registerUserRoutes(app, { db, sql, config }) {
  app.post("/api/slots/:id/attendance", async (request) => {
    const user = await requireUser(request, db, config);
    return attend(sql, user.id, request.params.id, request.body?.withPartner === true);
  });

  app.delete("/api/slots/:id/attendance", async (request) => {
    const user = await requireUser(request, db, config);
    return leave(sql, user.id, request.params.id);
  });

  app.put("/api/slots/:id/availability", async (request) => {
    const user = await requireUser(request, db, config);
    if (typeof request.body?.open !== "boolean") {
      throw new HttpError(400, "VALIDATION", "Укажите, свободны ли вы");
    }
    return setAvailability(sql, user.id, request.params.id, request.body.open);
  });

  app.get("/api/slots/:id/free", async (request) => {
    const user = await requireUser(request, db, config);
    return { users: await freePeople(sql, request.params.id, user.id, request.query?.q) };
  });

  app.post("/api/slots/:id/requests", async (request) => {
    const user = await requireUser(request, db, config);
    return createRequest(sql, user.id, request.params.id, request.body?.toUserId);
  });

  app.get("/api/me/windows", async (request) => {
    const user = await requireUser(request, db, config);
    return { windows: await listWindows(sql, user.id) };
  });

  app.post("/api/me/windows", async (request) => {
    const user = await requireUser(request, db, config);
    return createWindow(sql, user.id, request.body);
  });

  app.patch("/api/me/windows/:id", async (request) => {
    const user = await requireUser(request, db, config);
    return updateWindow(sql, user.id, request.params.id, request.body);
  });

  app.delete("/api/me/windows/:id", async (request) => {
    const user = await requireUser(request, db, config);
    const scope = request.query?.scope === "one" ? "one" : "series";
    const day = typeof request.query?.day === "string" ? request.query.day : "";
    return deleteWindow(sql, user.id, request.params.id, scope, day);
  });

  app.get("/api/requests", async (request) => {
    const user = await requireUser(request, db, config);
    const box = request.query?.box === "outgoing" ? "outgoing" : "incoming";
    const status = typeof request.query?.status === "string" ? request.query.status : "";
    return { requests: await listRequests(sql, user.id, box, status) };
  });

  app.get("/api/requests/:id", async (request) => {
    const user = await requireUser(request, db, config);
    return getRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/accept", async (request) => {
    const user = await requireUser(request, db, config);
    return acceptRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/decline", async (request) => {
    const user = await requireUser(request, db, config);
    return declineRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/cancel", async (request) => {
    const user = await requireUser(request, db, config);
    return withdrawRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/cancel-confirmation", async (request) => {
    const user = await requireUser(request, db, config);
    return cancelAcceptedRequest(sql, user.id, request.params.id, request.body?.reason);
  });

  app.post("/api/pairs/:id/cancel", async (request) => {
    const user = await requireUser(request, db, config);
    return cancelPair(sql, user.id, request.params.id);
  });

  app.get("/api/me/settings", async (request) => {
    const user = await requireUser(request, db, config);
    return profileSettings(sql, user.id);
  });

  app.put("/api/me/settings", async (request) => {
    const user = await requireUser(request, db, config);
    return saveProfile(sql, user.id, request.body);
  });

  app.patch("/api/me/level", async (request) => {
    const user = await requireUser(request, db, config);
    if (!request.body || !("danceLevel" in request.body)) {
      throw new HttpError(400, "VALIDATION", "Укажите уровень");
    }
    return setDanceLevel(sql, user.id, request.body.danceLevel);
  });

  app.put("/api/me/blocked-levels", async (request) => {
    const user = await requireUser(request, db, config);
    return setBlockedLevels(sql, user.id, request.body?.levels);
  });

  app.get("/api/dancers/:id", async (request) => {
    const user = await requireUser(request, db, config);
    return dancerProfile(sql, user.id, request.params.id);
  });

  app.get("/api/dancers", async (request) => {
    const user = await requireUser(request, db, config);
    const q = typeof request.query?.q === "string" ? request.query.q : "";
    const includeSelf = request.query?.includeSelf === "1";
    return { users: await searchDancers(sql, user.id, q, { includeSelf }) };
  });

  app.post("/api/me/blacklist", async (request) => {
    const user = await requireUser(request, db, config);
    return addToBlacklist(sql, user.id, request.body?.userId);
  });

  app.delete("/api/me/blacklist/:id", async (request) => {
    const user = await requireUser(request, db, config);
    return removeFromBlacklist(sql, user.id, request.params.id);
  });

  app.post("/api/me/whitelist", async (request) => {
    const user = await requireUser(request, db, config);
    return addToWhitelist(sql, user.id, request.body?.userId);
  });

  app.delete("/api/me/whitelist/:id", async (request) => {
    const user = await requireUser(request, db, config);
    return removeFromWhitelist(sql, user.id, request.params.id);
  });

  app.get("/api/notifications", async (request) => {
    const user = await requireUser(request, db, config);
    return { notifications: await listNotifications(sql, user.id) };
  });

  app.delete("/api/notifications", async (request) => {
    const user = await requireUser(request, db, config);
    return clearNotifications(sql, user.id);
  });

  app.post("/api/notifications/:id/read", async (request) => {
    const user = await requireUser(request, db, config);
    return markNotificationRead(sql, user.id, request.params.id);
  });
}
