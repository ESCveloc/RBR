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
  pingTimeout?: NodeJS.Timeout;
  isAuthenticated?: boolean;
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
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(options: any) {
    super(options);
    this.setupHeartbeat();
    console.log("GameWebSocketServer initialized");
  }

  private setupHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      this.clients.forEach((ws: CustomWebSocket) => {
        if (!ws.isAlive) {
          if (ws.pingTimeout) {
            clearTimeout(ws.pingTimeout);
          }
          console.log("Terminating inactive connection for user:", ws.userId);
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();

        if (ws.pingTimeout) {
          clearTimeout(ws.pingTimeout);
        }
        ws.pingTimeout = setTimeout(() => {
          console.log("Ping timeout for user:", ws.userId);
          ws.terminate();
        }, 10000);
      });
    }, 30000);

    this.on('close', () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
    });
  }

  async broadcast(gameId: number, message: any) {
    const room = this.gameRooms.get(gameId);
    if (!room) {
      console.log(`No room found for game ${gameId}`);
      return;
    }

    const messageStr = JSON.stringify(message);
    const deadConnections: CustomWebSocket[] = [];

    room.clients.forEach(client => {
      if (!client.isAuthenticated) {
        console.log(`Skipping message to unauthenticated client for user:`, client.userId);
        return;
      }

      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        } else {
          console.log(`Client in non-OPEN state for user ${client.userId}, marking for removal`);
          deadConnections.push(client);
        }
      } catch (error) {
        console.error(`Error sending message to client ${client.userId}:`, error);
        deadConnections.push(client);
      }
    });

    // Clean up dead connections
    if (deadConnections.length > 0) {
      console.log(`Cleaning up ${deadConnections.length} dead connections for game ${gameId}`);
      deadConnections.forEach(client => {
        room.clients.delete(client);
        if (client.pingTimeout) {
          clearTimeout(client.pingTimeout);
        }
      });

      if (room.clients.size === 0) {
        console.log(`Removing empty room for game ${gameId}`);
        this.gameRooms.delete(gameId);
      }
    }
  }

  async broadcastGameUpdate(gameId: number, type: string, data: any) {
    try {
      const room = this.gameRooms.get(gameId);
      if (!room) {
        console.log(`No room found for game ${gameId}`);
        return;
      }

      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        console.log(`Game ${gameId} not found`);
        return;
      }

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
    if (!client.isAuthenticated || !client.userId) {
      console.log(`Rejecting unauthenticated client ${client.userId} from joining game ${gameId}`);
      client.send(JSON.stringify({
        type: "ERROR",
        payload: { message: "Authentication required to join game" }
      }));
      return;
    }

    if (!this.gameRooms.has(gameId)) {
      console.log(`Creating new room for game ${gameId}`);
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
      console.log(`Client ${client.userId} joined game ${gameId}`);
    }
  }

  leaveGame(client: CustomWebSocket) {
    if (client.gameId) {
      const room = this.gameRooms.get(client.gameId);
      if (room) {
        room.clients.delete(client);
        if (room.clients.size === 0) {
          this.gameRooms.delete(client.gameId);
          console.log(`Room for game ${client.gameId} removed - no more clients`);
        }
      }
      console.log(`Client ${client.userId} left game ${client.gameId}`);
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
        // Allow Vite HMR WebSocket connections
        if (req.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
          console.log('Allowing Vite HMR WebSocket connection');
          return done(true);
        }

        if (!req.headers.cookie) {
          console.log("WebSocket connection rejected: No cookies");
          return done(false, 401, "No session cookie");
        }

        const cookies = parse(req.headers.cookie);
        let sessionId = cookies['battle.sid'];

        // Handle different session cookie formats
        if (!sessionId) {
          console.log("WebSocket connection rejected: No battle.sid cookie found");
          return done(false, 401, "No session ID");
        }

        // Clean up session ID if it contains 's:' prefix
        if (sessionId.startsWith('s:')) {
          sessionId = sessionId.slice(2).split('.')[0];
        }

        console.log("Attempting to verify session:", sessionId);
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
    ws.isAuthenticated = false;

    const user = (req as any).user;
    if (user) {
      ws.userId = user.id;
      try {
        const [userTeam] = await db
          .select({
            teamId: teamMembers.teamId
          })
          .from(teamMembers)
          .where(eq(teamMembers.userId, user.id))
          .limit(1);

        if (userTeam) {
          ws.teamId = userTeam.teamId;
          console.log(`User ${user.id} team information loaded: ${userTeam.teamId}`);
        }
      } catch (error) {
        console.error("Error fetching user team:", error);
      }
    }

    ws.on('pong', () => {
      ws.isAlive = true;
      if (ws.pingTimeout) {
        clearTimeout(ws.pingTimeout);
      }
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message);

        switch (message.type) {
          case 'AUTHENTICATE':
            if (ws.userId && message.payload.userId === ws.userId) {
              ws.isAuthenticated = true;
              console.log(`Client ${ws.userId} authenticated`);
              ws.send(JSON.stringify({
                type: "AUTHENTICATED",
                payload: { userId: ws.userId }
              }));
            } else {
              console.log(`Authentication failed for client`);
              ws.send(JSON.stringify({
                type: "ERROR",
                payload: { message: "Authentication failed" }
              }));
            }
            break;

          default:
            if (!ws.userId || !ws.isAuthenticated) {
              console.log(`Rejecting message from unauthenticated client: ${message.type}`);
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

              default:
                console.warn(`Unknown message type received: ${message.type}`);
            }
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
      console.log(`WebSocket connection closed for user ${ws.userId}`);
      if (ws.pingTimeout) {
        clearTimeout(ws.pingTimeout);
      }
      wss.leaveGame(ws);
    });
  });

  return wss;
}