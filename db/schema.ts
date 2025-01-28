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

// Event related types
export type ZoneConfig = {
  durationMinutes: number;
  radiusMultiplier: number;
  intervalMinutes: number;
};

export type EventBoundaries = {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  properties: Record<string, any>;
  center?: {
    lat: number;
    lng: number;
  };
};

export const events = pgTable("games", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["pending", "active", "completed"] }).default("pending").notNull(),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  eventLengthMinutes: integer("game_length_minutes").notNull().default(60),
  maxTeams: integer("max_teams").notNull().default(10),
  playersPerTeam: integer("players_per_team").notNull().default(4),
  boundaries: jsonb("boundaries").$type<EventBoundaries>().notNull(),
  zoneConfigs: jsonb("zone_configs").$type<ZoneConfig[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: serial("created_by").references(() => users.id).notNull()
});

export const eventParticipants = pgTable("game_participants", {
  id: serial("id").primaryKey(),
  eventId: serial("game_id").references(() => events.id).notNull(),
  teamId: serial("team_id").references(() => teams.id).notNull(),
  status: text("status", { enum: ["active", "eliminated"] }).default("active").notNull(),
  eliminatedAt: timestamp("eliminated_at"),
  location: jsonb("location").$type<GeolocationCoordinates>()
});

export const startingPositions = pgTable("starting_positions", {
  id: serial("id").primaryKey(),
  eventId: serial("event_id").references(() => events.id).notNull(),
  positionNumber: integer("position_number").notNull(),
  coordinates: jsonb("coordinates").$type<{lat: number, lng: number}>().notNull(),
  assignedTeamId: serial("assigned_team_id").references(() => teams.id),
  staffAssignedId: serial("staff_assigned_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

// Relations
export const userRelations = relations(users, ({ many }) => ({
  teams: many(teamMembers),
  createdEvents: many(events)
}));

export const teamRelations = relations(teams, ({ many, one }) => ({
  members: many(teamMembers),
  captain: one(users, {
    fields: [teams.captainId],
    references: [users.id]
  }),
  events: many(eventParticipants)
}));

export const eventRelations = relations(events, ({ many, one }) => ({
  participants: many(eventParticipants),
  creator: one(users, {
    fields: [events.createdBy],
    references: [users.id]
  }),
  startingPositions: many(startingPositions)
}));

export const startingPositionRelations = relations(startingPositions, ({ one }) => ({
  event: one(events, {
    fields: [startingPositions.eventId],
    references: [events.id]
  }),
  assignedTeam: one(teams, {
    fields: [startingPositions.assignedTeamId],
    references: [teams.id]
  }),
  staffAssigned: one(users, {
    fields: [startingPositions.staffAssignedId],
    references: [users.id]
  })
}));


// Validation schemas
export const zoneConfigSchema = z.object({
  durationMinutes: z.number().min(5).max(60),
  radiusMultiplier: z.number().min(0.1).max(1),
  intervalMinutes: z.number().min(5).max(60),
});

export const eventBoundariesSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.array(z.number())))
  }),
  properties: z.record(z.any()),
  center: z.object({
    lat: z.number(),
    lng: z.number()
  }).optional()
});

// Base schemas
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertTeamSchema = createInsertSchema(teams);
export const selectTeamSchema = createSelectSchema(teams);
export const insertEventSchema = createInsertSchema(events);
export const selectEventSchema = createSelectSchema(events);
export const insertStartingPositionSchema = createInsertSchema(startingPositions);
export const selectStartingPositionSchema = createSelectSchema(startingPositions);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type Event = typeof events.$inferSelect & {
  participants?: EventParticipant[];
  boundaries: EventBoundaries;
};
export type EventParticipant = typeof eventParticipants.$inferSelect & {
  team?: Team;
};
export type StartingPosition = typeof startingPositions.$inferSelect;
export type InsertStartingPosition = typeof startingPositions.$inferInsert;

//This type is updated with more comprehensive geolocation data.
export type GeolocationCoordinates = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp?: number;
};