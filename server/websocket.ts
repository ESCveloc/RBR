import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { parse } from "cookie";
import { db } from "@db";
import { users, games, teams, teamMembers, gameParticipants } from "@db/schema";
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
  private updateThrottleMs = 100;

  constructor(options: any) {
    super(options);
    this.setupHeartbeat();
    console.log("GameWebSocketServer initialized");
  }

  private setupHeartbeat() {
    const interval = setInterval(() => {
      this.clients.forEach((client: CustomWebSocket) => {
        if (!client.isAlive) {
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.on('close', () => {
      clearInterval(interval);
    });
  }

  async broadcast(gameId: number, message: any) {
    const room = this.gameRooms.get(gameId);
    if (!room) return;

    const messageStr = JSON.stringify(message);

    room.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  async broadcastGameUpdate(gameId: number, type: string, data: any) {
    try {
      const room = this.gameRooms.get(gameId);
      if (!room) return;

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) return;

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

      await this.broadcast(gameId, {
        type,
        payload: {
          gameId,
          game: { ...game, participants },
          ...data
        }
      });
    } catch (error) {
      console.error("Error broadcasting game update:", error);
    }
  }

  joinGame(client: CustomWebSocket, gameId: number) {
    if (!this.gameRooms.has(gameId)) {
      this.gameRooms.set(gameId, {
        clients: new Set(),
        lastUpdate: {
          timestamp: Date.now(),
          data: null
        }
      });
    }

    const room = this.gameRooms.get(gameId);
    if (room) {
      room.clients.add(client);
      client.gameId = gameId;
    }
  }

  leaveGame(client: CustomWebSocket) {
    if (client.gameId) {
      const room = this.gameRooms.get(client.gameId);
      if (room) {
        room.clients.delete(client);
        if (room.clients.size === 0) {
          this.gameRooms.delete(client.gameId);
        }
      }
      client.gameId = undefined;
    }
  }
}

export function setupWebSocketServer(server: Server) {
  const wss = new GameWebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 64 * 1024,
    clientTracking: true,
    verifyClient: async ({ req }: { req: IncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) => {
      try {
        // Skip verification for Vite HMR
        if (req.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
          console.log('Allowing Vite HMR WebSocket connection');
          return done(true);
        }

        if (!req.headers.cookie) {
          console.log("WebSocket connection rejected: No cookies");
          return done(false, 401, "No session cookie");
        }

        const cookies = parse(req.headers.cookie);
        const sessionId = cookies['connect.sid'];
        if (!sessionId) {
          console.log("WebSocket connection rejected: No session ID");
          return done(false, 401, "No session ID");
        }

        const user = await verify(sessionId);
        if (!user) {
          console.log("WebSocket connection rejected: Invalid session");
          return done(false, 401, "Invalid session");
        }

        console.log(`Authenticated WebSocket connection for user ${user.id}`);
        (req as any).user = user;
        return done(true);
      } catch (error) {
        console.error("WebSocket verification error:", error);
        return done(false, 500, "Internal server error");
      }
    }
  });

  wss.on('connection', async (ws: CustomWebSocket, req: IncomingMessage) => {
    console.log('New WebSocket connection established');
    ws.isAlive = true;

    const user = (req as any).user;
    if (user) {
      ws.userId = user.id;

      try {
        // Get user's team information
        const [userTeam] = await db
          .select({
            teamId: teamMembers.teamId
          })
          .from(teamMembers)
          .where(eq(teamMembers.userId, user.id))
          .limit(1);

        if (userTeam) {
          ws.teamId = userTeam.teamId;
        }
      } catch (error) {
        console.error("Error fetching user team:", error);
      }
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (!ws.userId) {
          ws.send(JSON.stringify({
            type: "ERROR",
            payload: { message: "Not authenticated" }
          }));
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

    ws.on('error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      wss.leaveGame(ws);
    });
  });

  return wss;
}