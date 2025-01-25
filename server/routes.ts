import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { games, teams, gameParticipants, teamMembers } from "@db/schema";
import { eq } from "drizzle-orm";

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


  return httpServer;
}