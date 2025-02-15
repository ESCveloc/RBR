import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import { db } from "@db";
import { games, gameParticipants } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Session } from "express-session";
import type { User } from "@db/schema";
import type { IncomingMessage } from "http";
import cookie from "cookie";
import sessionMiddleware from "./session"; // Use relative path

// Extend IncomingMessage to include session
interface ExtendedIncomingMessage extends IncomingMessage {
  session?: Session & { user?: User };
  userSession?: Session & { user?: User };
}

interface CustomWebSocket extends WebSocket {
  gameId?: number;
  isAlive?: boolean;
  session?: Session & { user?: User };
}

interface GeolocationCoordinates {
  latitude: number;
  longitude: number;
}

interface GameState {
  positions: Record<number, GeolocationCoordinates>;
  zones: Array<{
    id: number;
    coordinates: [number, number];
    radius: number;
    controllingTeam?: number;
  }>;
}

interface GameRoom {
  clients: Set<CustomWebSocket>;
  gameState: GameState;
}

class GameWebSocketServer extends WebSocketServer {
  private gameRooms: Map<number, GameRoom> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(options: any) {
    super(options);
    this.setupHeartbeat();
  }

  private setupHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((ws: CustomWebSocket) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.on('close', () => {
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    });
  }

  async broadcast(gameId: number, message: any) {
    const room = this.gameRooms.get(gameId);
    if (!room) return;

    const messageStr = JSON.stringify(message);
    const deadClients: CustomWebSocket[] = [];

    room.clients.forEach(client => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        } else {
          deadClients.push(client);
        }
      } catch (error) {
        deadClients.push(client);
      }
    });

    if (deadClients.length > 0) {
      deadClients.forEach(client => room.clients.delete(client));
      if (room.clients.size === 0) {
        this.gameRooms.delete(gameId);
      }
    }
  }

  async broadcastGameUpdate(gameId: number, type: string, data: any = {}) {
    const room = this.gameRooms.get(gameId);
    if (!room) return;

    try {
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
          gameState: room.gameState,
          ...data
        }
      });
    } catch (error) {
      console.error("[WebSocket] Broadcast error:", error);
    }
  }
}

export function setupWebSocketServer(server: Server) {
  const wss = new GameWebSocketServer({
    server,
    path: '/ws',
    clientTracking: true,
    verifyClient: async (info: { req: ExtendedIncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) => {
      try {
        // Skip verification for Vite HMR
        if (info.req.headers['sec-websocket-protocol'] === 'vite-hmr') {
          return done(true);
        }

        // Parse cookies from the upgrade request
        const cookies = cookie.parse(info.req.headers.cookie || '');
        if (!cookies['battle.sid']) {
          console.error('[WebSocket] No session cookie found');
          return done(false, 401, 'No session cookie found');
        }

        // Create a new promise to handle session loading
        await new Promise<void>((resolve, reject) => {
          try {
            sessionMiddleware(info.req as any, {} as any, (err?: any) => {
              if (err) {
                console.error('[WebSocket] Session middleware error:', err);
                reject(err);
              } else {
                resolve();
              }
            });
          } catch (error) {
            console.error('[WebSocket] Session middleware execution error:', error);
            reject(error);
          }
        });

        if (!info.req.session?.user?.id) {
          console.error('[WebSocket] No user in session');
          return done(false, 401, 'Unauthorized');
        }

        info.req.userSession = info.req.session;
        done(true);
      } catch (error) {
        console.error('[WebSocket] Verification failed:', error);
        done(false, 500, 'Session verification failed');
      }
    }
  });

  wss.on('connection', (ws: CustomWebSocket, req: ExtendedIncomingMessage) => {
    ws.isAlive = true;
    ws.session = req.userSession;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        if (!ws.session?.user?.id) {
          ws.send(JSON.stringify({
            type: "ERROR",
            payload: { message: "Unauthorized" }
          }));
          return;
        }

        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "JOIN_GAME":
            wss.joinGame(ws, message.payload.gameId);
            break;

          case "GAME_STATE":
            if (ws.gameId) {
              wss.updateGameState(ws, ws.gameId, message.payload);
            }
            break;

          default:
            console.warn('[WebSocket] Unknown message type:', message.type);
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: "ERROR",
          payload: { message: "Invalid message format" }
        }));
      }
    });

    ws.on('close', () => {
      wss.leaveGame(ws);
    });
  });

  return wss;
}