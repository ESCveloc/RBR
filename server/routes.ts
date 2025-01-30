import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { users, games, teams, teamMembers, gameParticipants } from "@db/schema"; // Added gameParticipants
import { eq, ilike, or, and } from "drizzle-orm";
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

// Update zone calculation logic
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

export function registerRoutes(app: Express): Server {
  // Setup authentication routes
  setupAuth(app);

  const httpServer = createServer(app);

  // Setup WebSocket server for real-time updates
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
      const { name } = req.body;

      if (!name || typeof name !== "string" || name.length < 3) {
        return res.status(400).send("Team name must be at least 3 characters long");
      }

      // Match exactly the database schema
      const [team] = await db
        .insert(teams)
        .values({
          name,
          captain_id: req.user.id,
          active: true,
          created_at: new Date()
        })
        .returning();

      console.log("Team created successfully:", team);

      // Add captain as first team member
      await db.insert(teamMembers).values({
        team_id: team.id,
        user_id: req.user.id
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
        .select()
        .from(teams)
        .leftJoin(teamMembers, eq(teams.id, teamMembers.team_id))
        .where(
          or(
            eq(teams.captain_id, (req.user as any).id),
            eq(teamMembers.user_id, (req.user as any).id)
          )
        );

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
        .innerJoin(users, eq(teamMembers.user_id, users.id))
        .where(eq(teamMembers.team_id, teamId));

      res.json(members);
    } catch (error) {
      console.error("Team members fetch error:", error);
      res.status(500).send("Failed to fetch team members");
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

      if (team.captain_id !== (req.user as any).id) {
        return res.status(403).send("Only team captain can add members");
      }

      // Check if user is already a member
      const existingMember = await db
        .select()
        .from(teamMembers)
        .where(and(
          eq(teamMembers.team_id, teamId),
          eq(teamMembers.user_id, userId)
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

      if (team.captain_id !== (req.user as any).id) {
        return res.status(403).send("Only the current captain can transfer leadership");
      }

      // Verify new captain is a team member
      const isMemberQuery = db
        .select()
        .from(teamMembers)
        .where((teamMembers) => eq(teamMembers.team_id, teamId))
        .where((teamMembers) => eq(teamMembers.user_id, newCaptainId));
      const [isMember] = await isMemberQuery;


      if (!isMember) {
        return res.status(400).send("New captain must be a team member");
      }

      // Update team captain
      const [updatedTeam] = await db
        .update(teams)
        .set({ captain_id: newCaptainId })
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

      if (team.captain_id !== (req.user as any).id) {
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

      if (team.captain_id !== (req.user as any).id) {
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

      if (team.captain_id !== (req.user as any).id) {
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

  // Games API endpoints
  app.post("/api/games", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      console.log("Received game creation request:", req.body);
      const result = gameSchema.safeParse(req.body);
      if (!result.success) {
        console.error("Game validation failed:", result.error);
        return res.status(400).json({
          message: "Invalid game data",
          errors: result.error.issues,
        });
      }

      const {
        name,
        boundaries,
        gameLengthMinutes,
        maxTeams,
        playersPerTeam,
        zoneConfigs
      } = result.data;

      // Use default boundaries if none provided
      const settings = global.gameSettings || {
        defaultCenter: {
          lat: 35.8462,
          lng: -86.3928,
        },
        defaultRadiusMiles: 1,
        zoneConfigs: [
          { durationMinutes: 15, radiusMultiplier: 0.75, intervalMinutes: 20 },
          { durationMinutes: 10, radiusMultiplier: 0.5, intervalMinutes: 15 },
          { durationMinutes: 5, radiusMultiplier: 0.25, intervalMinutes: 10 },
        ],
      };

      const gameBoundaries = boundaries || {
        center: settings.defaultCenter,
        radiusMiles: settings.defaultRadiusMiles,
      };

      const gameZoneConfigs = zoneConfigs || settings.zoneConfigs;

      // Calculate starting locations based on maxTeams
      const startingLocations = calculateStartingLocations(gameBoundaries, maxTeams);

      const [game] = await db
        .insert(games)
        .values({
          name,
          boundaries: gameBoundaries,
          gameLengthMinutes,
          maxTeams,
          playersPerTeam,
          zoneConfigs: gameZoneConfigs,
          createdBy: (req.user as any).id,
          status: "pending",
        })
        .returning();

      console.log("Game created successfully:", game);
      res.json({ ...game, startingLocations });
    } catch (error: any) {
      console.error("Game creation error:", error);
      if (error.code === '23505') {
        return res.status(400).json({ message: "A game with this name already exists" });
      }
      res.status(500).json({ message: "Failed to create game" });
    }
  });

  // Get all games with status
  app.get("/api/games", async (req, res) => {
    try {
      const allGames = await db
        .select()
        .from(games)
        .orderBy(games.createdAt);

      res.json(allGames);
    } catch (error) {
      console.error("Fetch games error:", error);
      res.status(500).json({ message: "Failed to fetch games" });
    }
  });

  // Get game by ID
  app.get("/api/games/:gameId", async (req, res) => {
    try {
      const gameId = parseInt(req.params.gameId);
      if (isNaN(gameId)) {
        return res.status(400).json({ message: "Invalid game ID" });
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      // Get game participants
      const participants = await db
        .select({
          id: gameParticipants.id,
          gameId: gameParticipants.gameId,
          teamId: gameParticipants.teamId,
          status: gameParticipants.status,
          eliminatedAt: gameParticipants.eliminatedAt,
          location: gameParticipants.location,
          startingLocation: gameParticipants.startingLocation,
          startingLocationAssignedAt: gameParticipants.startingLocationAssignedAt
        })
        .from(gameParticipants)
        .where(eq(gameParticipants.gameId, gameId));

      res.json({ ...game, participants });
    } catch (error) {
      console.error("Fetch game error:", error);
      res.status(500).json({ message: "Failed to fetch game" });
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

  // Add new endpoint for joining a game
  app.post("/api/games/:gameId/join", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { teamId } = req.body;

      if (isNaN(gameId) || !teamId) {
        return res.status(400).send("Invalid game ID or team ID");
      }

      // Verify team exists and is active
      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return res.status(404).send("Team not found");
      }

      if (!team.active) {
        return res.status(400).send("Inactive teams cannot join games");
      }

      // Verify game exists and is in pending state
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        return res.status(404).send("Game not found");
      }

      if (game.status !== "pending") {
        return res.status(400).send("Can only join pending games");
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
        return res.status(400).send("Team is already participating in this game");
      }

      // Add team as participant
      const [participant] = await db
        .insert(gameParticipants)
        .values({
          gameId,
          teamId,
          status: "active",
        })
        .returning();

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