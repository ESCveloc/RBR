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
  name: text("name").notNull(),
  captainId: serial("captain_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  active: boolean("active").default(true)
});

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: serial("team_id").references(() => teams.id).notNull(),
  userId: serial("user_id").references(() => users.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull()
});

// Zone configuration type for the games table
export type ZoneConfig = {
  durationMinutes: number;
  radiusMultiplier: number;
  intervalMinutes: number;
};

// Game boundaries type
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
  boundaries: jsonb("boundaries").notNull(),
  zoneConfigs: jsonb("zone_configs").$type<ZoneConfig[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: serial("created_by").references(() => users.id).notNull()
});

export const gameParticipants = pgTable("game_participants", {
  id: serial("id").primaryKey(),
  gameId: serial("game_id").references(() => games.id).notNull(),
  teamId: serial("team_id").references(() => teams.id).notNull(),
  status: text("status", { enum: ["alive", "eliminated"] }).default("alive").notNull(),
  eliminatedAt: timestamp("eliminated_at"),
  location: jsonb("location") // Current location during game
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

export const gameRelations = relations(games, ({ many, one }) => ({
  participants: many(gameParticipants),
  creator: one(users, {
    fields: [games.createdBy],
    references: [users.id]
  })
}));

// Schema for validating zone configurations
export const zoneConfigSchema = z.object({
  durationMinutes: z.number().min(5).max(60),
  radiusMultiplier: z.number().min(0.1).max(1),
  intervalMinutes: z.number().min(5).max(60),
});

// Game boundaries schema
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

// Game schemas with proper validation
export const insertGameSchema = z.object({
  name: z.string().min(1, "Game name is required"),
  gameLengthMinutes: z.number().min(10).max(180),
  maxTeams: z.number().min(2).max(50),
  playersPerTeam: z.number().min(1).max(10),
  boundaries: gameBoundariesSchema,
  zoneConfigs: z.array(zoneConfigSchema).min(1)
});

export const selectGameSchema = createSelectSchema(games);

// Types for TypeScript
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GameParticipant = typeof gameParticipants.$inferSelect;