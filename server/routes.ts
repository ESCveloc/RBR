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

const scryptAsync = promisify(scrypt);

// Update game schema to match frontend
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
  // Setup authentication routes
  setupAuth(app);

  const httpServer = createServer(app);

  // Setup WebSocket server with proper session handling
  const wss = setupWebSocketServer(httpServer);

  // Admin settings endpoint
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

      // Store settings in memory for now
      global.gameSettings = result.data;

      res.json({ message: "Settings updated successfully" });
    } catch (error) {
      console.error("Update settings error:", error);
      res.status(500).send("Failed to update settings");
    }
  });

  // Update zone settings with more conservative shrinking
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

  // Minimal API route for verification - check database connection
  app.get("/api/health", async (req, res) => {
    try {
      await db.query.teams.findFirst(); // Simple query to test DB connection
      res.status(200).send("Database and API routes are working.");
    } catch (error) {
      console.error("Database connection error:", error);
      res.status(500).send("Database connection failed.");
    }
  });

  // Profile update endpoint
  app.put("/api/user/profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    const { username, currentPassword, newPassword, firstName, preferredPlayTimes, avatar } = req.body;

    // Verify current password
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

    // Check if new username is already taken (if username is being changed)
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

    // Update user profile
    const updateData: any = {
      username,
      firstName,
      preferredPlayTimes,
      avatar
    };

    // If new password is provided, hash it
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

  // Admin API routes
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

    // Prevent self-demotion
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

  // Teams API endpoints
  app.post("/api/teams", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      console.log("Creating team with request body:", req.body);
      const { name, description } = req.body;

      if (!name || typeof name !== "string" || name.length < 3) {
        return res.status(400).send("Team name must be at least 3 characters long");
      }

      // Match exactly the database schema
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

      console.log("Team created successfully:", team);

      // Add captain as first team member
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

      console.log('Teams with member counts:', userTeams);
      res.json(userTeams);
    } catch (error) {
      console.error("Teams fetch error:", error);
      res.status(500).send("Failed to fetch teams");
    }
  });

  // Get team members endpoint
  app.get("/api/teams/:teamId/members", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      // Get team members
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

  // Add new endpoint for removing team members
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

      // Verify team exists and user is captain
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

      // Prevent captain from removing themselves
      if (userId === team.captainId) {
        return res.status(400).send("Team captain cannot be removed");
      }

      // Remove team member
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

  // Search users endpoint
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

  // Add team member endpoint
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

      // Verify team exists and user is captain
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

      // Check if user is already a member
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

      // Add new team member
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

  // Fix the duplicate function and type issues in the position assignment logic

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

      // Verify team exists and current user is captain
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

      // Verify new captain is a team member
      const isMemberQuery = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId))
        .where(eq(teamMembers.userId, newCaptainId));


      if (isMemberQuery.length === 0) {
        return res.status(400).send("New captain must be a team member");
      }

      // Update team captain
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

  // Add new endpoint for updating team details
  app.patch("/api/teams/:teamId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);
      const { name } = req.body;  // Only allow updating the name for now

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      // Verify team exists and user is captain
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

      // Update team name if provided
      const updateData: any = {};
      if (name) {
        updateData.name = name;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).send("No valid fields to update");
      }

      // Update team
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

  // Add new endpoint for deactivating team
  app.patch("/api/teams/:teamId/deactivate", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      // Verify team exists and user is captain
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

      // Update team active status
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

  // Add new endpoint for reactivating team
  app.patch("/api/teams/:teamId/reactivate", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const teamId = parseInt(req.params.teamId);

      if (isNaN(teamId)) {
        return res.status(400).send("Invalid team ID");
      }

      // Verify team exists and user is captain
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

      // Update team active status
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

  // Add this endpoint after the other team-related endpoints
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

      // Verify team exists and user is a member
      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      // Check if user is a team member
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

      // Update team ready status
      // Note: We'll add the ready column to the teams table when implementing database migrations
      res.json({ ready });
    } catch (error) {
      console.error("Update team ready status error:", error);
      res.status(500).send("Failed to update team ready status");
    }
  });

  // Update team ready status endpoint
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

      // Verify participant exists
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

      // Allow both team captain and admin to update ready status
      if (participant.team.captainId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).send("Only team captain or admin can update ready status");
      }

      // Update participant ready status
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

  // Leave game endpoint
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

      // Verify participant exists
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

      // Allow both team captain and admin to leave game
      if (participant.team.captainId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).send("Only team captain or admin can leave the game");
      }

      // Delete the participant
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

  // Update the position assignment endpoint
  // Add helper function to check team qualifications and assign random position
  function assignRandomPosition(availablePositions: number[]): number {
    if (availablePositions.length === 0) {
      throw new Error("No available positions remaining");
    }
    const randomIndex = Math.floor(Math.random() * availablePositions.length);
    return availablePositions[randomIndex];
  }

  function checkTeamQualifications(game: any, participant: any) {
    if (!game || !participant) return false;

    // Get current number of teams in the game
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

      // Get game details and verify status
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

      // Only admin can force reassign positions
      if (force && req.user.role !== "admin") {
        return res.status(403).send("Only administrators can force position reassignment");
      }

      // Verify team is participating in the game
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

      // For non-admin assignments, check qualifications
      if (!force && !checkTeamQualifications(game, participant)) {
        return res.status(400).send("Team must meet all qualifications before being assigned a position");
      }

      // Get currently assigned positions
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

      // Always create 10 starting positions regardless of max teams
      const TOTAL_STARTING_POSITIONS = 10;
      const availablePositions = Array.from({ length: TOTAL_STARTING_POSITIONS }, (_, i) => i + 1)
        .filter(p => !takenPositions.has(p));

      // Determine position (either forced by admin or random)
      let assignedPosition: number;
      if (force && position) {
        // Admin can override and assign specific position
        assignedPosition = position;
      } else {
        // Randomly assign from available positions
        assignedPosition = assignRandomPosition(availablePositions);
      }

      if (!force && takenPositions.has(assignedPosition)) {
        return res.status(400).send("This position is already taken by another team");
      }

      // Calculate position coordinates based on boundaries
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

      // Convert position to angle (evenly distributed around the circle)
      const angle = (-1 * (assignedPosition - 1) * 2 * Math.PI / TOTAL_STARTING_POSITIONS) + (Math.PI / 2);
      const safetyFactor = 0.9; // Keep points inside the boundary
      const x = center.lng + (radius * safetyFactor * Math.cos(angle));
      const y = center.lat + (radius * safetyFactor * Math.sin(angle));

      // Update participant with new starting location
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

      // Broadcast position assignment to all clients
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

  // Add random position assignment endpoint
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

      // Get game details
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

      // Get all taken positions
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

      // Generate array of available positions (1-10)
      const TOTAL_STARTING_POSITIONS = 10;
      const availablePositions = Array.from(
        { length: TOTAL_STARTING_POSITIONS },
        (_, i) => i + 1
      ).filter(pos => !takenPositions.includes(pos));

      if (availablePositions.length === 0) {
        return res.status(400).send("No available positions left");
      }

      // Randomly select from available positions
      const randomPosition = availablePositions[Math.floor(Math.random() * availablePositions.length)];

      // Calculate coordinates for the selected position
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

      // Update participant with new random position
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

  // Games API endpoints
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

      // Create new game with minimal required fields
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

      // Broadcast game creation
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

  // Get all games with status and team members
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

      // Fetch participants for all games with team data
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

          // For each participant, get their team members
          const participantsWithTeamMembers = await Promise.all(
            participants.map(async (participant) => {
              if (!participant.teamId) {
                return participant;
              }

              // Get all team members for this team
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

  // Get game by ID with enhanced team data
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

      // Filter out null participants (from left join when no participants exist)
      if (game.participants && game.participants[0] === null) {
        game.participants = [];
      }

      res.json(game);
    } catch (error) {
      console.error("Get game error:", error);
      res.status(500).send("Failed to get game");
    }
  });

  // Update game status
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

      // Validate state transition
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

  // Add new endpoint for managing team starting locations
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

      // Verify the game exists and user is admin or game creator
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      // Only allow admins or game creator to manually assign positions
      if (req.user.role !== "admin" && game.createdBy !== req.user.id) {
        return res.status(403).send("Unauthorized to assign starting locations");
      }

      // Update the team's starting location
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

  // Add helper function for random position assignment
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

      console.log('Join game request:', { gameId, teamId, userId: req.user.id, isAdmin });

      if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
      }

      // Get game details
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        console.log('Game not found:', gameId);
        return res.status(404).send("Game not found");
      }

      console.log('Found game:', game);

      // Get team details
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
        console.log('Team not found:', teamId);
        return res.status(404).send("Team not found");
      }

      console.log('Found team:', team);

      // Check permissions
      if (team.team.captainId !== req.user.id && !isAdmin) {
        console.log('Permission denied - not captain or admin:', { captainId: team.team.captainId, userId: req.user.id, isAdmin });
        return res.status(403).send("Only team captain or admin can join games");
      }

      // Check if team is already participating
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
        console.log('Team already participating:', { gameId, teamId });
        return res.status(400).send("Team is already participating in this game");
      }

      // Check current number of teams
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(gameParticipants)
        .where(eq(gameParticipants.gameId, gameId));

      if (count >= game.maxTeams) {
        return res.status(400).send("Game has reached maximum number of teams");
      }

      // Check team size
      const teamSize = team.teamMembers?.length || 0;
      if (teamSize > game.playersPerTeam) {
        return res.status(400).send(`Team size exceeds game limit of ${game.playersPerTeam} players`);
      }

      // Get currently assigned positions
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

      // Always create 10 starting positions regardless of max teams
      const TOTAL_STARTING_POSITIONS = 10;
      const availablePositions = Array.from({ length: TOTAL_STARTING_POSITIONS }, (_, i) => i + 1)
        .filter(p => !takenPositions.has(p));

      // Randomly assign position
      const assignedPosition = await assignRandomPosition(availablePositions);

      if (!assignedPosition) {
        return res.status(400).send('No available positions');
      }

      // Calculate position coordinates based on boundaries
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

      // Convert position to angle (evenly distributed around the circle)
      const angle = (-1 * (assignedPosition.position - 1) * 2 * Math.PI / TOTAL_STARTING_POSITIONS) + (Math.PI / 2);
      const safetyFactor = 0.9; // Keep points inside the boundary
      const x = center.lng + (radius * safetyFactor * Math.cos(angle));
      const y = center.lat + (radius * safetyFactor * Math.sin(angle));

      // Create participant with assigned position
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

      // Broadcast team join to all clients
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
  var gameWebSocketServer: any; // Declare gameWebSocketServer
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: string;
    }
  }
}

// Settings schema and game zone configs
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

  // Calculate center point (this should remain constant for all zones)
  const center = coordinates.reduce(
    (acc: { lat: number; lng: number }, coord: number[]) => {
      return {
        lat: acc.lat + coord[1] / coordinates.length,
        lng: acc.lng + coord[0] / coordinates.length
      };
    },
    { lat: 0, lng: 0 }
  );

  // Calculate initial radius based on the furthest point
  const baseRadius = Math.max(...coordinates.map((coord: number[]) => {
    const lat = coord[1];
    const lng = coord[0];
    const latDiff = center.lat - lat;
    const lngDiff = center.lng - lng;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  }));

  // Generate equidistant points around the circle with safe radius
  const startingLocations = [];
  const safeRadius = baseRadius * 0.9; // Keep points well within the boundary

  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    const lat = center.lat + (safeRadius * Math.sin(angle));
    const lng = center.lng + (safeRadius * Math.cos(angle));
    startingLocations.push({
      position: i + 1,
      coordinates: { lat, lng },
      center, // Store center for reference
      baseRadius // Store initial radius for reference
    });
  }

  return startingLocations;
}