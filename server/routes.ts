import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { users, events, teams, teamMembers, startingPositions, eventParticipants } from "@db/schema";
import { eq, ilike, or, and } from "drizzle-orm";
import { z } from "zod";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

// Update event schema to match frontend
const eventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  eventLengthMinutes: z.number().min(10).max(180),
  maxTeams: z.number().min(2).max(50),
  playersPerTeam: z.number().min(1).max(10),
  boundaries: z.any().optional(),
  zoneConfigs: z.array(z.object({
    durationMinutes: z.number().min(5).max(60),
    radiusMultiplier: z.number().min(0.1).max(1),
    intervalMinutes: z.number().min(5).max(60)
  })).optional()
});

// Helper function to generate starting positions around a boundary
function generateStartingPositions(boundaries: any, maxTeams: number) {
  try {
    if (!boundaries?.geometry?.coordinates?.[0]) {
      throw new Error("Invalid boundary format");
    }

    const coordinates = boundaries.geometry.coordinates[0];
    const positions = [];

    // Calculate positions evenly spaced around the boundary
    for (let i = 0; i < maxTeams; i++) {
      const index = Math.floor((i / maxTeams) * coordinates.length);
      const boundaryPoint = coordinates[index];

      if (!boundaryPoint || boundaryPoint.length < 2) {
        console.error("Invalid boundary point at index:", index);
        continue;
      }

      positions.push({
        positionNumber: i + 1,
        coordinates: {
          lat: boundaryPoint[1],
          lng: boundaryPoint[0]
        }
      });
    }

    return positions;
  } catch (error) {
    console.error("Error generating starting positions:", error);
    return [];
  }
}

function generateDefaultBoundaries(center: { lat: number; lng: number; }, radiusMiles: number) {
  // This is a placeholder; a real implementation would generate boundaries
  // based on the center and radius.  This simply returns a default structure.
  return {
    center: center,
    radiusMiles: radiusMiles,
  };
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
      global.eventSettings = result.data;

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

    // Return default settings if none are set
    const settings = global.eventSettings || {
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

  // Events API endpoints
  app.post("/api/events", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const result = eventSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid event data",
          errors: result.error.issues,
        });
      }

      const {
        name,
        boundaries,
        eventLengthMinutes,
        maxTeams,
        playersPerTeam,
        zoneConfigs
      } = result.data;

      // Use default boundaries if none provided
      const settings = global.eventSettings || {
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

      const eventBoundaries = boundaries || generateDefaultBoundaries(
        settings.defaultCenter,
        settings.defaultRadiusMiles
      );

      const eventZoneConfigs = zoneConfigs || settings.zoneConfigs;

      const [event] = await db
        .insert(events)
        .values({
          name,
          boundaries: eventBoundaries,
          eventLengthMinutes,
          maxTeams,
          playersPerTeam,
          zoneConfigs: eventZoneConfigs,
          createdBy: (req.user as any).id,
          status: "pending",
        })
        .returning();

      // Generate and insert starting positions
      const positions = generateStartingPositions(eventBoundaries, maxTeams);
      await Promise.all(
        positions.map((pos) =>
          db.insert(startingPositions).values({
            eventId: event.id,
            positionNumber: pos.positionNumber,
            coordinates: pos.coordinates,
          })
        )
      );

      // Fetch the event with its starting positions
      const [eventWithPositions] = await db
        .select()
        .from(events)
        .where(eq(events.id, event.id))
        .limit(1);

      const eventStartingPositions = await db
        .select()
        .from(startingPositions)
        .where(eq(startingPositions.eventId, event.id));

      res.json({ ...eventWithPositions, startingPositions: eventStartingPositions });
    } catch (error: any) {
      console.error("Event creation error:", error);
      res.status(500).json({ message: "Failed to create event" });
    }
  });

  // Get starting positions for an event
  app.get("/api/events/:eventId/starting-positions", async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).send("Invalid event ID");
      }

      const positions = await db
        .select()
        .from(startingPositions)
        .where(eq(startingPositions.eventId, eventId))
        .orderBy(startingPositions.positionNumber);

      res.json(positions);
    } catch (error) {
      console.error("Fetch starting positions error:", error);
      res.status(500).send("Failed to fetch starting positions");
    }
  });

  // Assign team to starting position (admin only)
  app.patch("/api/events/:eventId/starting-positions/:positionId/team", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const { teamId } = req.body;
      const positionId = parseInt(req.params.positionId);
      const eventId = parseInt(req.params.eventId);

      if (isNaN(positionId) || isNaN(eventId)) {
        return res.status(400).send("Invalid position or event ID");
      }

      // Check if team is already assigned to another position
      const existingAssignment = await db
        .select()
        .from(startingPositions)
        .where(
          and(
            eq(startingPositions.eventId, eventId),
            eq(startingPositions.assignedTeamId, teamId)
          )
        )
        .limit(1);

      if (existingAssignment.length > 0) {
        return res.status(400).send("Team is already assigned to a position");
      }

      const [updatedPosition] = await db
        .update(startingPositions)
        .set({ assignedTeamId: teamId })
        .where(
          and(
            eq(startingPositions.id, positionId),
            eq(startingPositions.eventId, eventId)
          )
        )
        .returning();

      res.json(updatedPosition);
    } catch (error) {
      console.error("Update starting position error:", error);
      res.status(500).send("Failed to update starting position");
    }
  });

  // Assign staff to starting position (admin only)
  app.patch("/api/events/:eventId/starting-positions/:positionId/staff", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const { staffId } = req.body;
      const positionId = parseInt(req.params.positionId);
      const eventId = parseInt(req.params.eventId);

      if (isNaN(positionId) || isNaN(eventId)) {
        return res.status(400).send("Invalid position or event ID");
      }

      const [updatedPosition] = await db
        .update(startingPositions)
        .set({ staffAssignedId: staffId })
        .where(
          and(
            eq(startingPositions.id, positionId),
            eq(startingPositions.eventId, eventId)
          )
        )
        .returning();

      res.json(updatedPosition);
    } catch (error) {
      console.error("Update staff assignment error:", error);
      res.status(500).send("Failed to update staff assignment");
    }
  });

  // Randomly assign teams to starting positions
  app.post("/api/events/:eventId/randomize-positions", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const eventId = parseInt(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).send("Invalid event ID");
      }

      // Get all positions for this event
      const positions = await db
        .select()
        .from(startingPositions)
        .where(eq(startingPositions.eventId, eventId));

      // Filter unassigned positions in memory instead of using eq with null
      const unassignedPositions = positions.filter(pos => pos.assignedTeamId === null);

      const eventParticipantsResult = await db
        .select()
        .from(eventParticipants)
        .where(eq(eventParticipants.eventId, eventId));

      const teams = eventParticipantsResult.map(p => p.teamId);
      const shuffledTeams = teams.sort(() => Math.random() - 0.5);

      // Assign teams to positions
      await Promise.all(
        unassignedPositions.map(async (pos, index) => {
          if (index < shuffledTeams.length) {
            await db
              .update(startingPositions)
              .set({ assignedTeamId: shuffledTeams[index] })
              .where(eq(startingPositions.id, pos.id));
          }
        })
      );

      const updatedPositions = await db
        .select()
        .from(startingPositions)
        .where(eq(startingPositions.eventId, eventId))
        .orderBy(startingPositions.positionNumber);

      res.json(updatedPositions);
    } catch (error) {
      console.error("Randomize positions error:", error);
      res.status(500).send("Failed to randomize positions");
    }
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

  // Get all events with status
  app.get("/api/events", async (req, res) => {
    try {
      const allEvents = await db
        .select()
        .from(events)
        .orderBy(events.createdAt);

      res.json(allEvents);
    } catch (error) {
      console.error("Fetch events error:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  // Update event status
  app.patch("/api/events/:eventId/status", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Not logged in");
    }

    try {
      const eventId = parseInt(req.params.eventId);
      const { status } = req.body;

      if (!["pending", "active", "completed"].includes(status)) {
        return res.status(400).send("Invalid status");
      }

      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!event) {
        return res.status(404).send("Event not found");
      }

      // Validate state transition
      if (status === "active" && event.status !== "pending") {
        return res.status(400).send("Can only activate pending events");
      }

      if (status === "completed" && event.status !== "active") {
        return res.status(400).send("Can only complete active events");
      }

      const updateData: any = { status };
      if (status === "active") {
        updateData.startTime = new Date();
      } else if (status === "completed") {
        updateData.endTime = new Date();
      }

      const [updatedEvent] = await db
        .update(events)
        .set(updateData)
        .where(eq(events.id, eventId))
        .returning();

      res.json(updatedEvent);
    } catch (error) {
      console.error("Update event status error:", error);
      res.status(500).send("Failed to update event status");
    }
  });

  // Assign team to starting position (admin only)
  app.patch("/api/events/:eventId/starting-positions/:positionId/team", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const { teamId } = req.body;
      const positionId = parseInt(req.params.positionId);
      const eventId = parseInt(req.params.eventId);

      if (isNaN(positionId) || isNaN(eventId)) {
        return res.status(400).send("Invalid position or event ID");
      }

      // Check if team is already assigned to another position
      const existingAssignment = await db
        .select()
        .from(startingPositions)
        .where(
          and(
            eq(startingPositions.eventId, eventId),
            eq(startingPositions.assignedTeamId, teamId)
          )
        )
        .limit(1);

      if (existingAssignment.length > 0) {
        return res.status(400).send("Team is already assigned to a position");
      }

      const [updatedPosition] = await db
        .update(startingPositions)
        .set({ assignedTeamId: teamId })
        .where(
          and(
            eq(startingPositions.id, positionId),
            eq(startingPositions.eventId, eventId)
          )
        )
        .returning();

      res.json(updatedPosition);
    } catch (error) {
      console.error("Update starting position error:", error);
      res.status(500).send("Failed to update starting position");
    }
  });

  // Assign staff to starting position (admin only)
  app.patch("/api/events/:eventId/starting-positions/:positionId/staff", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const { staffId } = req.body;
      const positionId = parseInt(req.params.positionId);
      const eventId = parseInt(req.params.eventId);

      if (isNaN(positionId) || isNaN(eventId)) {
        return res.status(400).send("Invalid position or event ID");
      }

      const [updatedPosition] = await db
        .update(startingPositions)
        .set({ staffAssignedId: staffId })
        .where(
          and(
            eq(startingPositions.id, positionId),
            eq(startingPositions.eventId, eventId)
          )
        )
        .returning();

      res.json(updatedPosition);
    } catch (error) {
      console.error("Update staff assignment error:", error);
      res.status(500).send("Failed to update staff assignment");
    }
  });

  // Randomly assign teams to starting positions
  app.post("/api/events/:eventId/randomize-positions", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(403).send("Forbidden");
    }

    try {
      const eventId = parseInt(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).send("Invalid event ID");
      }

      // Get all positions for this event
      const positions = await db
        .select()
        .from(startingPositions)
        .where(eq(startingPositions.eventId, eventId));

      // Filter unassigned positions in memory instead of using eq with null
      const unassignedPositions = positions.filter(pos => pos.assignedTeamId === null);

      const eventParticipantsResult = await db
        .select()
        .from(eventParticipants)
        .where(eq(eventParticipants.eventId, eventId));

      const teams = eventParticipantsResult.map(p => p.teamId);
      const shuffledTeams = teams.sort(() => Math.random() - 0.5);

      // Assign teams to positions
      await Promise.all(
        unassignedPositions.map(async (pos, index) => {
          if (index < shuffledTeams.length) {
            await db
              .update(startingPositions)
              .set({ assignedTeamId: shuffledTeams[index] })
              .where(eq(startingPositions.id, pos.id));
          }
        })
      );

      const updatedPositions = await db
        .select()
        .from(startingPositions)
        .where(eq(startingPositions.eventId, eventId))
        .orderBy(startingPositions.positionNumber);

      res.json(updatedPositions);
    } catch (error) {
      console.error("Randomize positions error:", error);
      res.status(500).send("Failed to randomize positions");
    }
  });

  return httpServer;
}

declare global {
  var eventSettings: any;
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