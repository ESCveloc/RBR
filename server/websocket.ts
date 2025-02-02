import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { parse } from "cookie";
import { db } from "@db";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
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

  broadcastToGame(gameId: number, data: any, excludeClient?: CustomWebSocket) {
    const room = this.gameRooms.get(gameId);
    if (!room) {
      console.log(`Attempted to broadcast to non-existent game room ${gameId}`);
      return;
    }

    const now = Date.now();
    const lastUpdate = room.lastUpdate;

    if (now - lastUpdate.timestamp < this.updateThrottleMs && 
        JSON.stringify(lastUpdate.data) === JSON.stringify(data)) {
      return;
    }

    const message = JSON.stringify(data);
    let broadcastCount = 0;
    room.clients.forEach(client => {
      if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
        client.send(message);
        broadcastCount++;
      }
    });

    console.log(`Broadcasted to ${broadcastCount} clients in game ${gameId}`);

    room.lastUpdate = {
      timestamp: now,
      data
    };
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

        // Verify session and get user
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

  wss.on("connection", (ws: CustomWebSocket, req: IncomingMessage) => {
    console.log("New WebSocket connection established");
    ws.isAlive = true;

    // Attach user data from the verified session
    const user = (req as any).user;
    if (user) {
      ws.userId = user.id;
      console.log(`WebSocket authenticated for user ${user.id}`);
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("Received WebSocket message:", message);

        // Verify user is authenticated for all messages
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
              wss.broadcastToGame(ws.gameId, {
                type: "LOCATION_UPDATE",
                payload: {
                  ...message.payload,
                  userId: ws.userId
                }
              }, ws);
            }
            break;

          case "GAME_UPDATE":
            if (ws.gameId) {
              // Verify user has permission to update game state
              const user = await db.query.users.findFirst({
                where: eq(users.id, ws.userId)
              });

              if (user?.role === 'admin') {
                wss.broadcastToGame(ws.gameId, message);
              } else {
                console.log("Unauthorized game update attempt");
                ws.send(JSON.stringify({ 
                  type: "ERROR", 
                  payload: { message: "Unauthorized" } 
                }));
              }
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