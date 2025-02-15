import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { users, games, teams, teamMembers, gameParticipants } from "@db/schema";
import { eq, ilike, or, and, sql, exists, ne } from "drizzle-orm";
import { z } from "zod";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { parse as parseCookie } from "cookie";
import session from "express-session";
import MemoryStore from "memorystore";

const scryptAsync = promisify(scrypt);

const MemoryStoreSession = MemoryStore(session);
export const sessionStore = new MemoryStoreSession({
  checkPeriod: 86400000 // prune expired entries every 24h
});

const gameSchema = z.object({
  name: z.string().min(1, "Game name is required"),
  gameLengthMinutes: z.number().min(10).max(180),
  maxTeams: z.number().min(2).max(50),
  playersPerTeam: z.number().min(1).max(10),
  boundaries: z.any().optional(),
  zoneConfigs: z.array(z.object({
    durationMinutes: z.number().min(5).max(60),
    radiusMultiplier: z.number().min(0.1).max(1),
    intervalMinutes: z.number().min(5).max(60)
  })).optional()
});

export function registerRoutes(app: Express): Server {
  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'your-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    })
  );

  setupAuth(app);

  const httpServer = createServer(app);

  const wss = setupWebSocketServer(httpServer);

  app.put("/api/admin/settings", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const result = settingsSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid settings data",
          errors: result.error.issues,
        });
      }

      global.gameSettings = result.data;

      res.json({ message: "Settings updated successfully" });
    } catch (error) {
      console.error("Update settings error:", error);
      res.status(500).send("Failed to update settings");
    }
  });

  app.get("/api/admin/settings", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    const settings = global.gameSettings || {
      defaultCenter: {
        lat: 35.8462,
        lng: -86.3928,
      },
      defaultRadiusMiles: 1,
      zoneConfigs: [
        { durationMinutes: 15, radiusMultiplier: 0.85, intervalMinutes: 20 }, // More gradual first shrink
        { durationMinutes: 10, radiusMultiplier: 0.70, intervalMinutes: 15 }, // Second shrink
        { durationMinutes: 5, radiusMultiplier: 0.50, intervalMinutes: 10 },  // Final shrink
      ],
    };

    res.json(settings);
  });

  app.get("/api/health", async (req, res) => {
    try {
      await db.query.teams.findFirst();
      res.status(200).send("Database and API routes are working.");
    } catch (error) {
      console.error("Database connection error:", error);
      res.status(500).send("Database connection failed.");
    }
  });

  app.put("/api/user/profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    const { username, currentPassword, newPassword, firstName, preferredPlayTimes, avatar } = req.body;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const [hashedPassword, salt] = user.password.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(
      currentPassword,
      salt,
      64
    )) as Buffer;

    if (!timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf)) {
      return res.status(400).send("Current password is incorrect");
    }

    if (username !== user.username) {
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).send("Username already taken");
      }
    }

    const updateData: any = {
      username,
      firstName,
      preferredPlayTimes,
      avatar
    };

    if (newPassword) {
      const newSalt = randomBytes(16).toString("hex");
      const newHashedPasswordBuf = (await scryptAsync(
        newPassword,
        newSalt,
        64
      )) as Buffer;
      updateData.password = `${newHashedPasswordBuf.toString("hex")}.${newSalt}`;
    }

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, req.user.id))
      .returning();

    res.json({
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        firstName: updatedUser.firstName,
        avatar: updatedUser.avatar,
        preferredPlayTimes: updatedUser.preferredPlayTimes,
        role: updatedUser.role
      }
    });
  });

  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(users.createdAt);

      res.json(allUsers);
    } catch (error) {
      console.error("Fetch users error:", error);
      res.status(500).send("Failed to fetch users");
    }
  });

  app.patch("/api/admin/users/:userId/role", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    const userId = parseInt(req.params.userId);
    const { role } = req.body;

    if (isNaN(userId) || !["admin", "user"].includes(role)) {
      return res.status(400).send("Invalid user ID or role");
    }

    if (userId === req.user.id) {
      return res.status(400).send("Cannot modify your own role");
    }

    try {
      const [updatedUser] = await db
        .update(users)
        .set({ role })
        .where(eq(users.id, userId))
        .returning();

      res.json(updatedUser);
    } catch (error) {
      console.error("Update user role error:", error);
      res.status(500).send("Failed to update user role");
    }
  });

  app.post("/api/teams", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const { name, description } = req.body;

      if (!name || typeof name !== "string" || name.length < 3) {
        return res.status(400).send("Team name must be at least 3 characters long");
      }

      const [team] = await db
        .insert(teams)
        .values({
          name,
          description: description || null,
          captainId: req.user.id,
          active: true,
          wins: 0,
          losses: 0,
          tags: [],
          createdAt: new Date()
        })
        .returning();

      await db.insert(teamMembers).values({
        teamId: team.id,
        userId: req.user.id,
        joinedAt: new Date()
      });

      res.json(team);
    } catch (error: any) {
      console.error("Team creation error details:", {
        error: error.message,
        code: error.code,
        detail: error.detail,
        table: error.table,
        constraint: error.constraint
      });

      if (error.code === "23505") {
        return res.status(400).send("Team name already exists");
      }
      res.status(500).send("Failed to create team");
    }
  });

  app.get("/api/teams", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const userTeams = await db
        .select({
          teams: teams,
          team_members: sql<number>`count(DISTINCT ${teamMembers.userId})::int`.mapWith(Number).as('member_count')
        })
        .from(teams)
        .leftJoin(teamMembers, eq(teams.id, teamMembers.teamId))
        .where(
          or(
            eq(teams.captainId, (req.user as any).id),
            exists(
              db.select()
                .from(teamMembers)
                .where(and(
                  eq(teamMembers.teamId, teams.id),
                  eq(teamMembers.userId, (req.user as any).id)
                ))
            )
          )
        )
        .groupBy(teams.id);

      res.json(userTeams);
    } catch (error) {
      console.error("Teams fetch error:", error);
      res.status(500).send("Failed to fetch teams");
    }
  });

  app.get("/api/teams/:teamId/members", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      const members = await db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          avatar: users.avatar,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId));

      res.json(members);
    } catch (error) {
      console.error("Team members fetch error:", error);
      res.status(500).send("Failed to fetch team members");
    }
  });

  app.delete("/api/teams/:teamId/members/:userId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      const userId = parseInt(req.params.userId);

      if (isNaN(teamId) || isNaN(userId)) {
        return res.status(400).send("Invalid team ID or user ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.captainId !== req.user.id) {
        return res.status(403).send("Only team captain can remove members");
      }

      if (userId === team.captainId) {
        return res.status(400).send("Team captain cannot be removed");
      }

      await db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          )
        );

      res.json({ message: "Member removed successfully" });
    } catch (error) {
      console.error("Remove team member error:", error);
      res.status(500).send("Failed to remove team member");
    }
  });

  app.get("/api/users/search", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).send("Search query is required");
      }

      const searchResults = await db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          avatar: users.avatar,
        })
        .from(users)
        .where(ilike(users.username, `%${query}%`))
        .limit(10);

      res.json(searchResults);
    } catch (error) {
      console.error("User search error:", error);
      res.status(500).send("Failed to search users");
    }
  });

  app.post("/api/teams/:teamId/members", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      const { userId } = req.body;

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.captainId !== (req.user as any).id) {
        return res.status(403).send("Only team captain can add members");
      }

      const existingMember = await db
        .select()
        .from(teamMembers)
        .where(and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId)
        ))
        .limit(1)
        .then(results => results[0]);

      if (existingMember) {
        return res.status(400).send("User is already a team member");
      }

      await db.insert(teamMembers).values({
        teamId,
        userId,
      });

      res.json({ message: "Member added successfully" });
    } catch (error) {
      console.error("Add team member error:", error);
      res.status(500).send("Failed to add team member");
    }
  });

  app.patch("/api/teams/:teamId/captain", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      const { newCaptainId } = req.body;

      if (isNaN(teamId) || !newCaptainId) {
        return res.status(400).send("Invalid team ID or captain ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.captainId !== (req.user as any).id) {
        return res.status(403).send("Only the current captain can transfer leadership");
      }

      const isMemberQuery = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId))
        .where(eq(teamMembers.userId, newCaptainId));


      if (isMemberQuery.length === 0) {
        return res.status(400).send("New captain must be a team member");
      }

      const [updatedTeam] = await db
        .update(teams)
        .set({ captainId: newCaptainId })
        .where(eq(teams.id, teamId))
        .returning();

      res.json(updatedTeam);
    } catch (error) {
      console.error("Update team captain error:", error);
      res.status(500).send("Failed to update team captain");
    }
  });

  app.patch("/api/teams/:teamId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      const { name } = req.body;

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.captainId !== (req.user as any).id) {
        return res.status(403).send("Only team captain can update team details");
      }

      const updateData: any = {};
      if (name) {
        updateData.name = name;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).send("No valid fields to update");
      }

      const [updatedTeam] = await db
        .update(teams)
        .set(updateData)
        .where(eq(teams.id, teamId))
        .returning();

      res.json(updatedTeam);
    } catch (error) {
      console.error("Update team error:", error);
      res.status(500).send("Failed to update team");
    }
  });

  app.patch("/api/teams/:teamId/deactivate", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.captainId !== (req.user as any).id) {
        return res.status(403).send("Only team captain can deactivate the team");
      }

      const [updatedTeam] = await db
        .update(teams)
        .set({ active: false })
        .where(eq(teams.id, teamId))
        .returning();

      res.json(updatedTeam);
    } catch (error) {
      console.error("Deactivate team error:", error);
      res.status(500).send("Failed to deactivate team");
    }
  });

  app.patch("/api/teams/:teamId/reactivate", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.captainId !== (req.user as any).id) {
        return res.status(403).send("Only team captain can reactivate the team");
      }

      const [updatedTeam] = await db
        .update(teams)
        .set({ active: true })
        .where(eq(teams.id, teamId))
        .returning();

      res.json(updatedTeam);
    } catch (error) {
      console.error("Reactivate team error:", error);
      res.status(500).send("Failed to reactivate team");
    }
  });

  app.post("/api/teams/:teamId/ready", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      const { ready } = req.body;

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      const [isMember] = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, (req.user as any).id)
          )
        )
        .limit(1);

      if (!isMember) {
        return res.status(403).send("Only team members can update ready status");
      }

      res.json({ ready });
    } catch (error) {
      console.error("Update team ready status error:", error);
      res.status(500).send("Failed to update team ready status");
    }
  });

  app.post("/api/games/:gameId/team-ready", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId, ready } = req.body;

      if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
      }

      const [participant] = await db
        .select({
          id: gameParticipants.id,
          teamId: gameParticipants.teamId,
          team: teams
        })
        .from(gameParticipants)
        .innerJoin(teams, eq(gameParticipants.teamId, teams.id))
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .limit(1);

      if (!participant) {
        return res.status(404).send("Team is not participating in this game");
      }

      if (participant.team.captainId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).send("Only team captain or admin can update ready status");
      }

      const [updatedParticipant] = await db
        .update(gameParticipants)
        .set({ ready })
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .returning();

      res.json(updatedParticipant);
    } catch (error) {
      console.error("Update team ready status error:", error);
      res.status(500).send("Failed to update team ready status");
    }
  });

  app.post("/api/games/:gameId/leave", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId } = req.body;

      if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
      }

      const [participant] = await db
        .select({
          id: gameParticipants.id,
          teamId: gameParticipants.teamId,
          team: teams
        })
        .from(gameParticipants)
        .innerJoin(teams, eq(gameParticipants.teamId, teams.id))
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .limit(1);

      if (!participant) {
        return res.status(404).send("Team is not participating in this game");
      }

      if (participant.team.captainId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).send("Only team captain or admin can leave the game");
      }

      await db
        .delete(gameParticipants)
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        );

      res.json({ message: "Successfully left the game" });
    } catch (error) {
      console.error("Leave game error:", error);
      res.status(500).send("Failed to leave game");
    }
  });

  function assignRandomPosition(availablePositions: number[]): number {
    if (availablePositions.length === 0) {
      throw new Error("No available positions remaining");
    }
    const randomIndex = Math.floor(Math.random() * availablePositions.length);
    return availablePositions[randomIndex];
  }

  function checkTeamQualifications(game: any, participant: any) {
    if (!game || !participant) return false;

    const currentTeamCount = game.participants?.length || 0;

    const qualifications = {
      notExceedingMaxTeams: currentTeamCount <= game.maxTeams,
      isParticipating: Boolean(participant),
      validTeamSize: participant.team?.teamMembers?.length <= game.playersPerTeam,
      noPositionAssigned: !participant.startingLocation
    };

    return Object.values(qualifications).every(Boolean);
  }

  app.post("/api/games/:gameId/assign-position", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId, force = false, position = null } = req.body;

      if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      if (game.status !== "pending") {
        return res.status(400).send("Positions can only be assigned before the game starts");
      }

      if (force && req.user.role !== "admin") {
        return res.status(403).send("Only administrators can force position reassignment");
      }

      const [participant] = await db
        .select({
          participant: gameParticipants,
          team: teams
        })
        .from(gameParticipants)
        .innerJoin(teams, eq(gameParticipants.teamId, teams.id))
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .limit(1);

      if (!participant) {
        return res.status(404).send("Team is not participating in this game");
      }

      if (!force && !checkTeamQualifications(game, participant)) {
        return res.status(400).send("Team must meet all qualifications before being assigned a position");
      }

      const assignedPositions = await db
        .select({
          position: sql<number>`CAST((${gameParticipants.startingLocation}->>'position') AS INTEGER)`,
          teamId: gameParticipants.teamId
        })
        .from(gameParticipants)
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            ne(gameParticipants.teamId, teamId),
            sql`${gameParticipants.startingLocation} IS NOT NULL`
          )
        );

      const takenPositions = new Set(assignedPositions.map(p => p.position));

      const TOTAL_STARTING_POSITIONS = 10;
      const availablePositions = Array.from({ length: TOTAL_STARTING_POSITIONS }, (_, i) => i + 1)
        .filter(p => !takenPositions.has(p));

      let assignedPosition: number;
      if (force && position) {
        assignedPosition = position;
      } else {
        assignedPosition = assignRandomPosition(availablePositions);
      }

      if (!force && takenPositions.has(assignedPosition)) {
        return res.status(400).send("This position is already taken by another team");
      }

      const coordinates = game.boundaries.geometry.coordinates[0];
      const center = coordinates.reduce(
        (acc, [lng, lat]) => ({
          lat: acc.lat + lat / coordinates.length,
          lng: acc.lng + lng / coordinates.length
        }),
        { lat: 0, lng: 0 }
      );

      const radius = Math.max(...coordinates.map(([lng, lat]) => {
        const latDiff = center.lat - lat;
        const lngDiff = center.lng - lng;
        return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      }));

      const angle = (-1 * (assignedPosition - 1) * 2 * Math.PI / TOTAL_STARTING_POSITIONS) + (Math.PI / 2);
      const safetyFactor = 0.9;
      const x = center.lng + (radius * safetyFactor * Math.cos(angle));
      const y = center.lat + (radius * safetyFactor * Math.sin(angle));

      const [updatedParticipant] = await db
        .update(gameParticipants)
        .set({
          startingLocation: {
            position: assignedPosition,
            coordinates: { lat: y, lng: x }
          },
          startingLocationAssignedAt: new Date()
        })
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .returning();

      wss.broadcast('GAME_UPDATE', {
        type: 'POSITION_ASSIGNED',
        gameId,
        teamId,
        position: assignedPosition
      });

      res.json(updatedParticipant);
    } catch (error) {
      console.error("Position assignment error:", error);
      res.status(500).send("Failed to assign position");
    }
  });

  app.post("/api/games/:gameId/assign-random-position", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId } = req.body;

      if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      if (game.status !== "pending") {
        return res.status(400).send("Positions can only be assigned before the game starts");
      }

      const participants = await db
        .select()
        .from(gameParticipants)
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            ne(gameParticipants.teamId, teamId)
          )
        );

      const takenPositions = participants
        .filter(p => p.startingLocation !== null)
        .map(p => p.startingLocation.position);

      const TOTAL_STARTING_POSITIONS = 10;
      const availablePositions = Array.from(
        { length: TOTAL_STARTING_POSITIONS },
        (_, i) => i + 1
      ).filter(pos => !takenPositions.includes(pos));

      if (availablePositions.length === 0) {
        return res.status(400).send("No available positions left");
      }

      const randomPosition = availablePositions[Math.floor(Math.random() * availablePositions.length)];

      const coordinates = game.boundaries.geometry.coordinates[0];
      const center = coordinates.reduce(
        (acc, [lng, lat]) => ({
          lat: acc.lat + lat / coordinates.length,
          lng: acc.lng + lng / coordinates.length
        }),
        { lat: 0, lng: 0 }
      );

      const radius = Math.max(...coordinates.map(([lng, lat]) => {
        const latDiff = center.lat - lat;
        const lngDiff = center.lng - lng;
        return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      }));

      const angle = (-1 * (randomPosition - 1) * 2 * Math.PI / TOTAL_STARTING_POSITIONS) + (Math.PI / 2);
      const safetyFactor = 0.9;
      const x = center.lng + (radius * safetyFactor * Math.cos(angle));
      const y = center.lat + (radius * safetyFactor * Math.sin(angle));

      const [updatedParticipant] = await db
        .update(gameParticipants)
        .set({
          startingLocation: {
            position: randomPosition,
            coordinates: { lat: y, lng: x }
          },
          startingLocationAssignedAt: new Date()
        })
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .returning();

      res.json(updatedParticipant);
    } catch (error) {
      console.error("Random position assignment error:", error);
      res.status(500).send("Failed to assign random position");
    }
  });

  app.post("/api/games", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Only administrators can create games");
    }

    try {
      const result = gameSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid game data",
          errors: result.error.issues,
        });
      }

      const {
        name,
        gameLengthMinutes,
        maxTeams,
        playersPerTeam,
        boundaries: gameBoundaries,
        zoneConfigs
      } = result.data;

      const settings = global.gameSettings || {
        defaultCenter: { lat: 35.8462, lng: -86.3928 },
        defaultRadiusMiles: 1,
        zoneConfigs: []
      };

      const [game] = await db
        .insert(games)
        .values({
          name,
          status: "pending",
          gameLengthMinutes,
          maxTeams,
          playersPerTeam,
          startTime: null,
          endTime: null,
          boundaries: gameBoundaries || {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[
                [settings.defaultCenter.lng - 0.01, settings.defaultCenter.lat - 0.01],
                [settings.defaultCenter.lng + 0.01, settings.defaultCenter.lat - 0.01],
                [settings.defaultCenter.lng + 0.01, settings.defaultCenter.lat + 0.01],
                [settings.defaultCenter.lng - 0.01, settings.defaultCenter.lat + 0.01],
                [settings.defaultCenter.lng - 0.01, settings.defaultCenter.lat - 0.01]
              ]]
            }
          },
          zoneConfigs: zoneConfigs || settings.zoneConfigs,
          createdBy: req.user.id
        })
        .returning();

      wss.broadcast('GAME_UPDATE', {
        type: 'GAME_CREATED',
        gameId: game.id
      });

      res.json(game);
    } catch (error) {
      console.error("Create game error:", error);
      res.status(500).send("Failed to create game");
    }
  });

  app.get("/api/games", async (req, res) => {
    try {
      const allGames = await db
        .select({
          id: games.id,
          name: games.name,
          status: games.status,
          startTime: games.startTime,
          endTime: games.endTime,
          gameLengthMinutes: games.gameLengthMinutes,
          maxTeams: games.maxTeams,
          playersPerTeam: games.playersPerTeam,
          boundaries: games.boundaries,
          zoneConfigs: games.zoneConfigs,
          createdBy: games.createdBy,
          createdAt: games.createdAt,
        })
        .from(games)
        .orderBy(games.createdAt);

      const gamesWithParticipants = await Promise.all(
        allGames.map(async (game) => {
          const participants = await db
            .select({
              id: gameParticipants.id,
              gameId: gameParticipants.gameId,
              teamId: gameParticipants.teamId,
              status: gameParticipants.status,
              eliminatedAt: gameParticipants.eliminatedAt,
              location: gameParticipants.location,
              startingLocation: gameParticipants.startingLocation,
              startingLocationAssignedAt: gameParticipants.startingLocationAssignedAt,
              team: {
                id: teams.id,
                name: teams.name,
                active: teams.active,
                captainId: teams.captainId,
                wins: teams.wins,
                losses: teams.losses,
              }
            })
            .from(gameParticipants)
            .leftJoin(teams, eq(gameParticipants.teamId, teams.id))
            .where(eq(gameParticipants.gameId, game.id));

          const participantsWithTeamMembers = await Promise.all(
            participants.map(async (participant) => {
              if (!participant.teamId) {
                return participant;
              }

              const members = await db
                .select({
                  id: teamMembers.id,
                  userId: teamMembers.userId,
                  joinedAt: teamMembers.joinedAt
                })
                .from(teamMembers)
                .where(eq(teamMembers.teamId, participant.teamId));

              return {
                ...participant,
                team: participant.team ? {
                  ...participant.team,
                  teamMembers: members
                } : undefined
              };
            })
          );

          return { ...game, participants: participantsWithTeamMembers };
        })
      );

      res.json(gamesWithParticipants);
    } catch (error) {
      console.error("Fetch games error:", error);
      res.status(500).json({ message: "Failed to fetch games" });
    }
  });

  app.get("/api/games/:gameId", async (req, res) => {
    try {
      const gameId = parseInt(req.params.gameId);
      if (isNaN(gameId)) {
        return res.status(400).json({ message: "Invalid game ID" });
      }

      const [game] = await db
        .select({
          id: games.id,
          name: games.name,
          status: games.status,
          startTime: games.startTime,
          endTime: games.endTime,
          gameLengthMinutes: games.gameLengthMinutes,
          maxTeams: games.maxTeams,
          playersPerTeam: games.playersPerTeam,
          boundaries: games.boundaries,
          zoneConfigs: games.zoneConfigs,
          createdAt: games.createdAt,
          createdBy: games.createdBy,
          participants: sql<any>`
            json_agg(
              json_build_object(
                'id', ${gameParticipants.id},
                'teamId', ${gameParticipants.teamId},
                'status', ${gameParticipants.status},
                'ready', ${gameParticipants.ready},
                'eliminatedAt', ${gameParticipants.eliminatedAt},
                'location', ${gameParticipants.location},
                'startingLocation', ${gameParticipants.startingLocation},
                'startingLocationAssignedAt', ${gameParticipants.startingLocationAssignedAt},
                'team', json_build_object(
                  'id', ${teams.id},
                  'name', ${teams.name},
                  'description', ${teams.description},
                  'captainId', ${teams.captainId},
                  'active', ${teams.active},
                  'createdAt', ${teams.createdAt},
                  'wins', ${teams.wins},
                  'losses', ${teams.losses},
                  'tags', ${teams.tags},
                  'teamMembers', (
                    SELECT json_agg(
                      json_build_object(
                        'id', tm.id,
                        'userId', tm.user_id,
                        'joinedAt', tm.joined_at
                      )
                    )
                    FROM team_members tm
                    WHERE tm.team_id = ${teams.id}
                  )
                )
              )
            )`
        })
        .from(games)
        .leftJoin(gameParticipants, eq(games.id, gameParticipants.gameId))
        .leftJoin(teams, eq(gameParticipants.teamId, teams.id))
        .where(eq(games.id, gameId))
        .groupBy(games.id)
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      if (game.participants && game.participants[0] === null) {
        game.participants = [];
      }

      res.json(game);
    } catch (error) {
      console.error("Get game error:", error);
      res.status(500).send("Failed to get game");
    }
  });

  app.patch("/api/games/:gameId/status", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { status } = req.body;

      if (!["pending", "active", "completed", "cancelled"].includes(status)) {
        return res.status(400).send("Invalid status");
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      if (status === "active" && game.status !== "pending") {
        return res.status(400).send("Can only activate pending games");
      }

      if (status === "completed" && game.status !== "active") {
        return res.status(400).send("Can only complete active games");
      }

      if (status === "cancelled" && game.status === "completed") {
        return res.status(400).send("Cannot cancel completed games");
      }

      const updateData: any = { status };
      if (status === "active") {
        updateData.startTime = new Date();
      } else if (status === "completed" || status === "cancelled") {
        updateData.endTime = new Date();
      }

      const [updatedGame] = await db
        .update(games)
        .set(updateData)
        .where(eq(games.id, gameId))
        .returning();

      res.json(updatedGame);
    } catch (error) {
      console.error("Update game status error:", error);
      res.status(500).send("Failed to update game status");
    }
  });

  app.post("/api/games/:gameId/assign-starting-location", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId, position } = req.body;

      if (!teamId || !position) {
        return res.status(400).send("Team ID and position are required");
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      if (req.user.role !== "admin" && game.createdBy !== req.user.id) {
        return res.status(403).send("Unauthorized to assign starting locations");
      }

      const startingLocations = calculateStartingLocations(game.boundaries, game.maxTeams);
      const selectedLocation = startingLocations[position - 1];

      if (!selectedLocation) {
        return res.status(400).send("Invalid position number");
      }

      const [updatedParticipant] = await db
        .update(gameParticipants)
        .set({
          startingLocation: selectedLocation,
          startingLocationAssignedAt: new Date(),
        })
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .returning();

      res.json(updatedParticipant);
    } catch (error) {
      console.error("Assign starting location error:", error);
      res.status(500).send("Failed to assign starting location");
    }
  });

  async function assignRandomPosition(availablePositions: number[]): Promise<{ position: number; coordinates: null } | null> {
    if (availablePositions.length === 0) return null;

    const randomPosition = availablePositions[Math.floor(Math.random() * availablePositions.length)];
    return { position: randomPosition, coordinates: null };
  }

  app.post("/api/games/:gameId/join", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId } = req.body;
      const isAdmin = req.user.role === 'admin';

      if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      const [team] = await db
        .select({
          team: teams,
          teamMembers: sql<any>`json_agg(team_members.*)`
        })
        .from(teams)
        .leftJoin(teamMembers, eq(teams.id, teamMembers.teamId))
        .where(eq(teams.id, teamId))
        .groupBy(teams.id)
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (team.team.captainId !== req.user.id && !isAdmin) {
        return res.status(403).send("Only team captain or admin can join games");
      }

      const [existingParticipant] = await db
        .select()
        .from(gameParticipants)
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            eq(gameParticipants.teamId, teamId)
          )
        )
        .limit(1);

      if (existingParticipant) {
        return res.status(400).send("Team is already participating in this game");
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(gameParticipants)
        .where(eq(gameParticipants.gameId, gameId));

      if (count >= game.maxTeams) {
        return res.status(400).send("Game has reached maximum number of teams");
      }

      const teamSize = team.teamMembers?.length || 0;
      if (teamSize > game.playersPerTeam) {
        return res.status(400).send(`Team size exceeds game limit of ${game.playersPerTeam} players`);
      }

      const assignedPositions = await db
        .select({
          position: sql<number>`CAST((${gameParticipants.startingLocation}->>'position') AS INTEGER)`,
          teamId: gameParticipants.teamId
        })
        .from(gameParticipants)
        .where(
          and(
            eq(gameParticipants.gameId, gameId),
            sql`${gameParticipants.startingLocation} IS NOT NULL`
          )
        );

      const takenPositions = new Set(assignedPositions.map(p => p.position));

      const TOTAL_STARTING_POSITIONS = 10;
      const availablePositions = Array.from({ length: TOTAL_STARTING_POSITIONS }, (_, i) => i + 1)
        .filter(p => !takenPositions.has(p));

      const assignedPosition = await assignRandomPosition(availablePositions);

      if (!assignedPosition) {
        return res.status(400).send('No available positions');
      }

      const coordinates = game.boundaries.geometry.coordinates[0];
      const center = coordinates.reduce(
        (acc, [lng, lat]) => ({
          lat: acc.lat + lat / coordinates.length,
          lng: acc.lng + lng / coordinates.length
        }),
        { lat: 0, lng: 0 }
      );

      const radius = Math.max(...coordinates.map(([lng, lat]) => {
        const latDiff = center.lat - lat;
        const lngDiff = center.lng - lng;
        return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      }));

      const angle = (-1 * (assignedPosition.position - 1) * 2 * Math.PI / TOTAL_STARTING_POSITIONS) + (Math.PI / 2);
      const safetyFactor = 0.9;
      const x = center.lng + (radius * safetyFactor * Math.cos(angle));
      const y = center.lat + (radius * safetyFactor * Math.sin(angle));

      const [participant] = await db
        .insert(gameParticipants)
        .values({
          gameId,
          teamId,
          status: "alive",
          ready: false,
          startingLocation: {
            position: assignedPosition.position,
            coordinates: { lat: y, lng: x }
          },
          startingLocationAssignedAt: new Date()
        })
        .returning();

      wss.broadcast('GAME_UPDATE', {
        type: 'TEAM_JOINED',
        gameId,
        teamId,
        position: assignedPosition.position
      });

      res.json(participant);
    } catch (error) {
      console.error("Join game error:", error);
      res.status(500).send("Failed to join game");
    }
  });

  return httpServer;
}

declare global {
  var gameSettings: any;
  var gameWebSocketServer: any;
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: string;
    }
  }
}

const settingsSchema = z.object({
  defaultCenter: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  defaultRadiusMiles: z.number().min(0.1).max(10),
  zoneConfigs: z.array(z.object({
    durationMinutes: z.number().min(5).max(60),
    radiusMultiplier: z.number().min(0.1).max(1),
    intervalMinutes: z.number().min(5).max(60)
  })).min(1),
});

function calculateStartingLocations(boundaries: any, numPoints: number) {
  const coordinates = boundaries.geometry.coordinates[0];

  const center = coordinates.reduce(
    (acc: { lat: number; lng: number }, coord: number[]) => {
      return {
        lat: acc.lat + coord[1] / coordinates.length,
        lng: acc.lng + coord[0] / coordinates.length
      };
    },
    { lat: 0, lng: 0 }
  );

  const baseRadius = Math.max(...coordinates.map((coord: number[]) => {
    const lat = coord[1];
    const lng = coord[0];
    const latDiff = center.lat - lat;
    const lngDiff = center.lng - lng;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  }));

  const startingLocations = [];
  const safeRadius = baseRadius * 0.9;

  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    const lat = center.lat + (safeRadius * Math.sin(angle));
    const lng = center.lng + (safeRadius * Math.cos(angle));
    startingLocations.push({
      position: i + 1,
      coordinates: { lat, lng },
      center,
      baseRadius
    });
  }

  return startingLocations;
}