import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocketServer } from "./websocket";
import { db } from "@db";
import { games, teams, gameParticipants, teamMembers } from "@db/schema";
import { eq, and } from "drizzle-orm";

export function registerRoutes(app: Express): Server {
  // Setup authentication routes
  setupAuth(app);

  const httpServer = createServer(app);
  
  // Setup WebSocket server for real-time updates
  const wss = setupWebSocketServer(httpServer);

  // Teams API
  app.post("/api/teams", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");
    
    const { name } = req.body;
    const [team] = await db.insert(teams)
      .values({ name, captainId: req.user.id })
      .returning();
      
    await db.insert(teamMembers)
      .values({ teamId: team.id, userId: req.user.id });
      
    res.json(team);
  });

  app.get("/api/teams", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");
    
    const userTeams = await db.query.teams.findMany({
      with: {
        members: true,
        captain: true
      },
      where: eq(teams.active, true)
    });
    
    res.json(userTeams);
  });

  // Games API
  app.post("/api/games", async (req, res) => {
    if (!req.user?.role === "admin") return res.status(403).send("Forbidden");
    
    const { name, boundaries } = req.body;
    const [game] = await db.insert(games)
      .values({ 
        name,
        boundaries,
        createdBy: req.user.id,
        status: "pending"
      })
      .returning();
      
    res.json(game);
  });

  app.get("/api/games", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");
    
    const activeGames = await db.query.games.findMany({
      with: {
        participants: {
          with: {
            team: true
          }
        }
      },
      where: eq(games.status, "active")
    });
    
    res.json(activeGames);
  });

  app.post("/api/games/:id/join", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");
    
    const { teamId } = req.body;
    const gameId = parseInt(req.params.id);
    
    const [participant] = await db.insert(gameParticipants)
      .values({ gameId, teamId })
      .returning();
      
    wss.broadcast(JSON.stringify({
      type: "TEAM_JOINED",
      payload: participant
    }));
    
    res.json(participant);
  });

  app.post("/api/games/:id/update-location", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");
    
    const { location } = req.body;
    const gameId = parseInt(req.params.id);
    
    const [participant] = await db
      .update(gameParticipants)
      .set({ location })
      .where(
        and(
          eq(gameParticipants.gameId, gameId),
          eq(gameParticipants.status, "alive")
        )
      )
      .returning();
      
    wss.broadcast(JSON.stringify({
      type: "LOCATION_UPDATE",
      payload: { gameId, participant }
    }));
    
    res.json(participant);
  });

  return httpServer;
}
