import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { users, teams, gameParticipants, teamMembers } from "@db/schema";
import { eq } from "drizzle-orm";
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

      // Create team with current user as captain
      const [team] = await db
        .insert(teams)
        .values({
          name,
          captainId: req.user.id,
        })
        .returning();

      // Add captain as first team member
      await db.insert(teamMembers).values({
        teamId: team.id,
        userId: req.user.id,
      });

      res.json(team);
    } catch (error: any) {
      if (error.code === "23505") { // PostgreSQL unique constraint violation
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
      const userTeams = await db.query.teams.findMany({
        where: (teams, { eq }) => eq(teams.captainId, req.user.id),
      });
      res.json(userTeams);
    } catch (error) {
      console.error("Teams fetch error:", error);
      res.status(500).send("Failed to fetch teams");
    }
  });

  return httpServer;
}