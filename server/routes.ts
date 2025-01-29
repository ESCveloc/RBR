import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { users, games, teams, teamMembers } from "@db/schema";
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

  // Update the get settings endpoint to use Murfreesboro, TN coordinates
  app.get("/api/admin/settings", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    // Return default settings if none are set
    const settings = global.gameSettings || {
      defaultCenter: {
        lat: 35.8462, // Murfreesboro, TN coordinates
        lng: -86.3928,
      },
      defaultRadiusMiles: 1,
      zoneConfigs: [
        { durationMinutes: 15, radiusMultiplier: 0.75, intervalMinutes: 20 },
        { durationMinutes: 10, radiusMultiplier: 0.5, intervalMinutes: 15 },
        { durationMinutes: 5, radiusMultiplier: 0.25, intervalMinutes: 10 },
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
      const { name } = req.body;

      if (!name || typeof name !== "string" || name.length < 3) {
        return res.status(400).send("Team name must be at least 3 characters long");
      }

      const [team] = await db
        .insert(teams)
        .values({
          name,
          captainId: (req.user as any).id,
        })
        .returning();

      await db.insert(teamMembers).values({
        teamId: team.id,
        userId: (req.user as any).id,
      });

      res.json(team);
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(400).send("Team name already exists");
      }
      console.error("Team creation error:", error);
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
        .leftJoin(teamMembers, eq(teams.id, teamMembers.teamId))
        .where(
          or(
            eq(teams.captainId, (req.user as any).id),
            eq(teamMembers.userId, (req.user as any).id)
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
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId));

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
      const isMemberQuery = db
        .select()
        .from(teamMembers)
        .where((teamMembers) => eq(teamMembers.teamId, teamId))
        .where((teamMembers) => eq(teamMembers.userId, newCaptainId));
      const [isMember] = await isMemberQuery;


      if (!isMember) {
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
      res.json(game);
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

  // Update game status
  app.patch("/api/games/:gameId/status", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const gameId = parseInt(req.params.gameId);
      const { status } = req.body;

      if (!["pending", "active", "completed"].includes(status)) {
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

      const updateData: any = { status };
      if (status === "active") {
        updateData.startTime = new Date();
      } else if (status === "completed") {
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
const settingsSchema = z.object({
  defaultCenter: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  defaultRadiusMiles: z.number().min(0.1).max(10),
  zoneConfigs: z.array(z.object({
    durationMinutes: z.number().min(5).max(60),
    radiusMultiplier: z.number().min(0.1).max(1),
    intervalMinutes: z.number().min(5).max(60),
  })).min(1),
});