import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import { db } from "@db";
import { games, gameParticipants } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Session } from "express-session";
import type { User } from "@db/schema";

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
    console.log("[WebSocket] Server initialized");
  }

  private setupHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((ws: CustomWebSocket) => {
        if (!ws.isAlive) {
          console.log("[WebSocket] Terminating inactive client");
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.on('close', () => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
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
        console.error(`[WebSocket] Send error:`, error);
        deadClients.push(client);
      }
    });

    // Cleanup dead connections
    if (deadClients.length > 0) {
      deadClients.forEach(client => {
        room.clients.delete(client);
        console.log("[WebSocket] Removed dead client from game", gameId);
      });

      if (room.clients.size === 0) {
        this.gameRooms.delete(gameId);
        console.log("[WebSocket] Removed empty game room", gameId);
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

      if (!game) {
        console.log("[WebSocket] Game not found:", gameId);
        return;
      }

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

  joinGame(client: CustomWebSocket, gameId: number) {
    if (!client.session?.user) {
      console.log("[WebSocket] Unauthorized join attempt");
      client.send(JSON.stringify({
        type: "ERROR",
        payload: { message: "Unauthorized" }
      }));
      return;
    }

    console.log("[WebSocket] Client joining game:", {
      gameId,
      userId: client.session.user.id,
      username: client.session.user.username
    });

    if (!this.gameRooms.has(gameId)) {
      this.gameRooms.set(gameId, {
        clients: new Set(),
        gameState: { positions: {}, zones: [] }
      });
      console.log("[WebSocket] Created new game room:", gameId);
    }

    const room = this.gameRooms.get(gameId)!;
    room.clients.add(client);
    client.gameId = gameId;

    // Send current state to new client
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "GAME_STATE",
        payload: {
          gameId,
          gameState: room.gameState
        }
      }));
    }
  }

  leaveGame(client: CustomWebSocket) {
    if (client.gameId) {
      const room = this.gameRooms.get(client.gameId);
      if (room) {
        room.clients.delete(client);
        console.log("[WebSocket] Client left game:", {
          gameId: client.gameId,
          username: client.session?.user?.username
        });

        if (room.clients.size === 0) {
          this.gameRooms.delete(client.gameId);
          console.log("[WebSocket] Removed empty game room:", client.gameId);
        }
      }
      client.gameId = undefined;
    }
  }

  updateGameState(client: CustomWebSocket, gameId: number, update: Partial<GameState>) {
    if (!client.session?.user) {
      console.log("[WebSocket] Unauthorized state update attempt");
      return;
    }

    const room = this.gameRooms.get(gameId);
    if (!room) return;

    Object.assign(room.gameState, update);
    this.broadcastGameUpdate(gameId, "GAME_STATE", {
      gameState: room.gameState
    });
  }
}

export function setupWebSocketServer(server: Server) {
  const wss = new GameWebSocketServer({
    server,
    path: '/ws',
    clientTracking: true,
    verifyClient: (info: { req: any }, done: (result: boolean, code?: number, message?: string) => void) => {
      // Skip verification for Vite HMR
      if (info.req.headers['sec-websocket-protocol'] === 'vite-hmr') {
        console.log('[WebSocket] Allowing Vite HMR connection');
        return done(true);
      }

      const session = info.req.session;
      console.log('[WebSocket] Verifying client:', {
        hasSession: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.id,
        headers: info.req.headers
      });

      if (!session?.user?.id) {
        console.log('[WebSocket] Rejecting unauthorized connection');
        return done(false, 401, 'Unauthorized');
      }

      info.req.userSession = session;
      console.log('[WebSocket] Client verified:', session.user.username);
      done(true);
    }
  });

  wss.on('connection', (ws: CustomWebSocket, req: any) => {
    console.log('[WebSocket] Client connected:', req.userSession?.user?.username);
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
        console.log('[WebSocket] Received message:', {
          type: message.type,
          from: ws.session.user.username
        });

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
        console.error('[WebSocket] Message handling error:', error);
        ws.send(JSON.stringify({
          type: "ERROR",
          payload: { message: "Invalid message format" }
        }));
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected:', ws.session?.user?.username);
      wss.leaveGame(ws);
    });
  });

  return wss;
}