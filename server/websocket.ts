import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { parse } from "cookie";
import { db } from "@db";
import { users, games, teams, gameParticipants } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { verify } from "./auth";

interface CustomWebSocket extends WebSocket {
  gameId?: number;
  userId?: number;
  teamId?: number;
  isAlive?: boolean;
}

interface GameRoom {
  clients: Set<CustomWebSocket>;
  lastUpdate: {
    timestamp: number;
    data: any;
  };
}

class GameWebSocketServer extends WebSocketServer {
  private gameRooms: Map<number, GameRoom> = new Map();
  private updateThrottleMs = 100; // Minimum time between broadcasts

  constructor(options: any) {
    super(options);
    this.setupHeartbeat();
    console.log("GameWebSocketServer initialized");
  }

  private setupHeartbeat() {
    setInterval(() => {
      this.clients.forEach((client: CustomWebSocket) => {
        if (!client.isAlive) {
          console.log(`Terminating inactive client: ${client.userId}`);
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);
  }

  // Send real-time update to specific game room
  async broadcastGameUpdate(gameId: number, type: string, data: any) {
    const room = this.gameRooms.get(gameId);
    if (!room) {
      console.log(`No game room found for game ${gameId}`);
      return;
    }

    // Get fresh game data from database
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);

    if (!game) {
      console.log(`Game ${gameId} not found in database`);
      return;
    }

    // Get participants with their teams
    const participants = await db
      .select({
        id: gameParticipants.id,
        gameId: gameParticipants.gameId,
        teamId: gameParticipants.teamId,
        status: gameParticipants.status,
        location: gameParticipants.location,
        team: teams
      })
      .from(gameParticipants)
      .innerJoin(teams, eq(gameParticipants.teamId, teams.id))
      .where(eq(gameParticipants.gameId, gameId));

    const gameData = {
      ...game,
      participants
    };

    const message = JSON.stringify({
      type,
      payload: {
        gameId,
        game: gameData,
        ...data
      }
    });

    console.log(`Broadcasting ${type} to game ${gameId}`);
    room.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Send real-time update to team members
  async broadcastTeamUpdate(teamId: number, type: string, data: any) {
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!team) {
      console.log(`Team ${teamId} not found in database`);
      return;
    }

    const message = JSON.stringify({
      type,
      payload: {
        teamId,
        team,
        ...data
      }
    });

    console.log(`Broadcasting ${type} to team ${teamId} members`);
    this.clients.forEach((client: CustomWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.teamId === teamId) {
        client.send(message);
      }
    });
  }

  joinGame(client: CustomWebSocket, gameId: number) {
    if (client.gameId && client.gameId !== gameId) {
      this.leaveGame(client);
    }

    client.gameId = gameId;

    if (!this.gameRooms.has(gameId)) {
      this.gameRooms.set(gameId, {
        clients: new Set(),
        lastUpdate: {
          timestamp: Date.now(),
          data: null
        }
      });
      console.log(`Created new game room: ${gameId}`);
    }

    this.gameRooms.get(gameId)?.clients.add(client);
    console.log(`Client ${client.userId} joined game ${gameId}`);
  }

  leaveGame(client: CustomWebSocket) {
    if (client.gameId) {
      const room = this.gameRooms.get(client.gameId);
      if (room) {
        room.clients.delete(client);
        console.log(`Client ${client.userId} left game ${client.gameId}`);
        if (room.clients.size === 0) {
          this.gameRooms.delete(client.gameId);
          console.log(`Game room ${client.gameId} closed - no more clients`);
        }
      }
      client.gameId = undefined;
    }
  }
}

export function setupWebSocketServer(server: Server) {
  const wss = new GameWebSocketServer({ 
    server,
    perMessageDeflate: false,
    maxPayload: 64 * 1024,
    verifyClient: async ({ req }: { req: IncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) => {
      try {
        if (req.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
          return done(false);
        }

        const cookies = req.headers.cookie;
        if (!cookies) {
          console.log("WebSocket connection rejected: No cookies");
          return done(false, 401, "No session cookie");
        }

        const sessionId = parse(cookies)['connect.sid'];
        if (!sessionId) {
          console.log("WebSocket connection rejected: No session ID");
          return done(false, 401, "No session ID");
        }

        const user = await verify(sessionId);
        if (!user) {
          console.log("WebSocket connection rejected: Invalid session");
          return done(false, 401, "Invalid session");
        }

        console.log(`WebSocket connection authenticated for user ${user.id}`);
        (req as any).user = user;
        return done(true);
      } catch (error) {
        console.error("WebSocket verification error:", error);
        return done(false, 500, "Internal server error");
      }
    }
  });

  wss.on("connection", async (ws: CustomWebSocket, req: IncomingMessage) => {
    console.log("New WebSocket connection established");
    ws.isAlive = true;

    // Attach user data from the verified session
    const user = (req as any).user;
    if (user) {
      ws.userId = user.id;
      console.log(`WebSocket authenticated for user ${user.id}`);

      // Get user's team information
      const [teamMember] = await db
        .select()
        .from(teams)
        .innerJoin(teamMembers, eq(teams.id, teamMembers.teamId))
        .where(eq(teamMembers.userId, user.id))
        .limit(1);

      if (teamMember) {
        ws.teamId = teamMember.id;
      }
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("Received WebSocket message:", message);

        if (!ws.userId) {
          console.log("Rejecting message from unauthenticated connection");
          ws.send(JSON.stringify({ type: "ERROR", payload: { message: "Not authenticated" } }));
          return;
        }

        switch (message.type) {
          case "JOIN_GAME":
            wss.joinGame(ws, message.payload.gameId);
            break;

          case "LOCATION_UPDATE":
            if (ws.gameId) {
              await wss.broadcastGameUpdate(ws.gameId, "LOCATION_UPDATE", {
                userId: ws.userId,
                location: message.payload.location
              });
            }
            break;

          case "TEAM_UPDATE":
            if (ws.teamId) {
              await wss.broadcastTeamUpdate(ws.teamId, "TEAM_UPDATE", message.payload);
            }
            break;

          case "GAME_STATE_UPDATE":
            if (ws.gameId) {
              await wss.broadcastGameUpdate(ws.gameId, "GAME_STATE_UPDATE", message.payload);
            }
            break;
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
        ws.send(JSON.stringify({ 
          type: "ERROR", 
          payload: { message: "Invalid message format" } 
        }));
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    ws.on("close", () => {
      console.log("WebSocket client disconnected");
      wss.leaveGame(ws);
    });
  });

  return wss;
}