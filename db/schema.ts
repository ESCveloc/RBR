import { pgTable, text, serial, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  firstName: text("first_name"),
  avatar: text("avatar"),
  preferredPlayTimes: jsonb("preferred_play_times").$type<string[]>().default([]),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  captainId: serial("captain_id").references(() => users.id).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  wins: integer("wins").default(0).notNull(),
  losses: integer("losses").default(0).notNull(),
  tags: jsonb("tags").$type<string[]>().default([]),
});

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: serial("team_id").references(() => teams.id).notNull(),
  userId: serial("user_id").references(() => users.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull()
});

// Game related types
export type ZoneConfig = {
  durationMinutes: number;
  radiusMultiplier: number;
  intervalMinutes: number;
};

export type GameBoundaries = {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  properties: Record<string, any>;
};

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["pending", "active", "completed"] }).default("pending").notNull(),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  gameLengthMinutes: integer("game_length_minutes").notNull().default(60),
  maxTeams: integer("max_teams").notNull().default(10),
  playersPerTeam: integer("players_per_team").notNull().default(4),
  boundaries: jsonb("boundaries").$type<GameBoundaries>().notNull(),
  zoneConfigs: jsonb("zone_configs").$type<ZoneConfig[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: serial("created_by").references(() => users.id).notNull()
});

export const gameParticipants = pgTable("game_participants", {
  id: serial("id").primaryKey(),
  gameId: serial("game_id").references(() => games.id).notNull(),
  teamId: serial("team_id").references(() => teams.id).notNull(),
  status: text("status", { enum: ["alive", "eliminated"] }).default("alive").notNull(),
  ready: boolean("ready").default(false).notNull(),
  eliminatedAt: timestamp("eliminated_at"),
  location: jsonb("location").$type<GeolocationCoordinates>(),
  startingLocation: jsonb("starting_location").$type<{
    position: number;
    coordinates: { lat: number; lng: number };
  }>(),
  startingLocationAssignedAt: timestamp("starting_location_assigned_at")
});

// Relations
export const userRelations = relations(users, ({ many }) => ({
  teams: many(teamMembers),
  createdGames: many(games)
}));

export const teamRelations = relations(teams, ({ many, one }) => ({
  members: many(teamMembers),
  captain: one(users, {
    fields: [teams.captainId],
    references: [users.id]
  }),
  games: many(gameParticipants)
}));

export const teamMemberRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id]
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id]
  })
}));

export const gameRelations = relations(games, ({ many, one }) => ({
  participants: many(gameParticipants),
  creator: one(users, {
    fields: [games.createdBy],
    references: [users.id]
  })
}));

// Validation schemas
export const zoneConfigSchema = z.object({
  durationMinutes: z.number().min(5).max(60),
  radiusMultiplier: z.number().min(0.1).max(1),
  intervalMinutes: z.number().min(5).max(60),
});

export const gameBoundariesSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.array(z.number())))
  }),
  properties: z.record(z.any())
});

// Base schemas
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertTeamSchema = createInsertSchema(teams);
export const selectTeamSchema = createSelectSchema(teams);
export const insertGameSchema = createInsertSchema(games);
export const selectGameSchema = createSelectSchema(games);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Game = typeof games.$inferSelect & {
  participants?: (typeof gameParticipants.$inferSelect)[];
};
export type GameParticipant = typeof gameParticipants.$inferSelect;