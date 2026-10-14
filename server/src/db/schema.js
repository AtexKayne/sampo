import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  login: text("login").unique(),
  passwordHash: text("password_hash"),
  vkUserId: bigint("vk_user_id", { mode: "number" }).unique(),
  displayName: text("display_name").notNull(),
  danceLevel: text("dance_level"),
  inviteList: text("invite_list").notNull().default("black"),
  notifyInvites: boolean("notify_invites").notNull().default(false),
  notifyHourBefore: boolean("notify_hour_before").notNull().default(false),
  notifyNewSlots: boolean("notify_new_slots").notNull().default(false),
  notifyNewSlotsScope: text("notify_new_slots_scope").notNull().default("free"),
  shareAvailability: boolean("share_availability").notNull().default(false),
  appRole: text("app_role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshSessions = pgTable("refresh_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  loginUserId: uuid("login_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const slots = pgTable("slots", {
  id: uuid("id").primaryKey(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  place: text("place").notNull(),
  capacity: integer("capacity").notNull(),
  description: text("description"),
  responsibleUserId: uuid("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("open"),
  seriesId: uuid("series_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
