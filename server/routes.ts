import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { users, teams, gameParticipants, teamMembers } from "@db/schema";
import { eq, ilike, or, and } from "drizzle-orm";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export function registerRoutes(app: Express): Server {
  // Setup authentication routes
  setupAuth(app);

  const httpServer = createServer(app);

  // Setup WebSocket server for real-time updates
  const wss = setupWebSocketServer(httpServer);

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
          captainId: req.user.id,
        })
        .returning();

      await db.insert(teamMembers).values({
        teamId: team.id,
        userId: req.user.id,
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
            eq(teams.captainId, req.user.id),
            eq(teamMembers.userId, req.user.id)
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

      if (team.captainId !== req.user.id) {
        return res.status(403).send("Only team captain can add members");
      }

      // Check if user is already a member
      const [existingMember] = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId))
        .where(eq(teamMembers.userId, userId))
        .limit(1);

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

      if (team.captainId !== req.user.id) {
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

  return httpServer;
}