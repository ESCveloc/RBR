import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import { db } from "@db";
import { games, gameParticipants } from "@db/schema";
import { eq } from "drizzle-orm";

// Document WebSocket message types and their purposes
type WebSocketMessage = {
  type: string;  // Message type for routing
  payload: any;  // Message data
};

interface CustomWebSocket extends WebSocket {
  gameId?: number;
  isAlive?: boolean;
  pingTimeout?: NodeJS.Timeout;
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
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();

        if (ws.pingTimeout) {
          clearTimeout(ws.pingTimeout);
        }
        ws.pingTimeout = setTimeout(() => {
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
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        } else {
          deadConnections.push(client);
        }
      } catch (error) {
        console.error(`Error sending message to client:`, error);
        deadConnections.push(client);
      }
    });

    // Clean up dead connections
    if (deadConnections.length > 0) {
      deadConnections.forEach(client => {
        room.clients.delete(client);
        if (client.pingTimeout) {
          clearTimeout(client.pingTimeout);
        }
      });

      if (room.clients.size === 0) {
        this.gameRooms.delete(gameId);
      }
    }
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
        .select()
        .from(gameParticipants)
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
      console.log(`Client joined game ${gameId}`);
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
    verifyClient: (info, done) => {
      // Skip verification for Vite HMR
      if (info.req.headers['sec-websocket-protocol'] === 'vite-hmr') {
        return done(true);
      }

      // Always allow connection for now, we'll handle authentication in the connection handler
      done(true);
    }
  });

  wss.on('connection', async (ws: CustomWebSocket) => {
    console.log('New WebSocket connection established');
    ws.isAlive = true;

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
          case "JOIN_GAME":
            wss.joinGame(ws, message.payload.gameId);
            break;

          case "LOCATION_UPDATE":
            if (ws.gameId) {
              await wss.broadcastGameUpdate(ws.gameId, "LOCATION_UPDATE", {
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
      } catch (error) {
        console.error("WebSocket message error:", error);
        ws.send(JSON.stringify({
          type: "ERROR",
          payload: { message: "Invalid message format" }
        }));
      }
    });

    ws.on('close', () => {
      console.log(`WebSocket connection closed`);
      if (ws.pingTimeout) {
        clearTimeout(ws.pingTimeout);
      }
      wss.leaveGame(ws);
    });
  });

  return wss;
}