import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./schema/index.js";

export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  passwordHash: text("password_hash").notNull(),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdx: index("auth_sessions_user_idx").on(table.userId, table.expiresAt),
  activeIdx: index("auth_sessions_active_idx").on(table.tokenHash, table.expiresAt)
}));

export type UserCredentials = typeof userCredentials.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
