import { HttpError } from "../http/errors.js";
import { requireDancer, requireUser } from "../auth/access.js";
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
    requireDancer(user);
    return attend(sql, user.id, request.params.id, request.body?.withPartner === true);
  });

  app.delete("/api/slots/:id/attendance", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return leave(sql, user.id, request.params.id);
  });

  app.put("/api/slots/:id/availability", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    if (typeof request.body?.open !== "boolean") {
      throw new HttpError(400, "VALIDATION", "Укажите, свободны ли вы");
    }
    return setAvailability(sql, user.id, request.params.id, request.body.open);
  });

  app.get("/api/slots/:id/free", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return { users: await freePeople(sql, request.params.id, user.id, request.query?.q) };
  });

  app.post("/api/slots/:id/requests", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return createRequest(sql, user.id, request.params.id, request.body?.toUserId);
  });

  app.get("/api/me/windows", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return { windows: await listWindows(sql, user.id) };
  });

  app.post("/api/me/windows", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return createWindow(sql, user.id, request.body);
  });

  app.patch("/api/me/windows/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return updateWindow(sql, user.id, request.params.id, request.body);
  });

  app.delete("/api/me/windows/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    const scope = request.query?.scope === "one" ? "one" : "series";
    const day = typeof request.query?.day === "string" ? request.query.day : "";
    return deleteWindow(sql, user.id, request.params.id, scope, day);
  });

  app.get("/api/requests", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    const box = request.query?.box === "outgoing" ? "outgoing" : "incoming";
    const status = typeof request.query?.status === "string" ? request.query.status : "";
    return { requests: await listRequests(sql, user.id, box, status) };
  });

  app.get("/api/requests/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return getRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/accept", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return acceptRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/decline", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return declineRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/cancel", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return withdrawRequest(sql, user.id, request.params.id);
  });

  app.post("/api/requests/:id/cancel-confirmation", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return cancelAcceptedRequest(sql, user.id, request.params.id, request.body?.reason);
  });

  app.post("/api/pairs/:id/cancel", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return cancelPair(sql, user.id, request.params.id);
  });

  app.get("/api/me/settings", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return profileSettings(sql, user.id);
  });

  app.put("/api/me/settings", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return saveProfile(sql, user.id, request.body);
  });

  app.patch("/api/me/level", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    if (!request.body || !("danceLevel" in request.body)) {
      throw new HttpError(400, "VALIDATION", "Укажите уровень");
    }
    return setDanceLevel(sql, user.id, request.body.danceLevel);
  });

  app.put("/api/me/blocked-levels", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
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
    requireDancer(user);
    return addToBlacklist(sql, user.id, request.body?.userId);
  });

  app.delete("/api/me/blacklist/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return removeFromBlacklist(sql, user.id, request.params.id);
  });

  app.post("/api/me/whitelist", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return addToWhitelist(sql, user.id, request.body?.userId);
  });

  app.delete("/api/me/whitelist/:id", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return removeFromWhitelist(sql, user.id, request.params.id);
  });

  app.get("/api/notifications", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return { notifications: await listNotifications(sql, user.id) };
  });

  app.delete("/api/notifications", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return clearNotifications(sql, user.id);
  });

  app.post("/api/notifications/:id/read", async (request) => {
    const user = await requireUser(request, db, config);
    requireDancer(user);
    return markNotificationRead(sql, user.id, request.params.id);
  });
}
