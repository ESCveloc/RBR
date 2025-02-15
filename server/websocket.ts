import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import { db } from "@db";
import { games, gameParticipants } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Session } from "express-session";
import type { User } from "@db/schema";
import type { IncomingMessage } from "http";
import cookie from "cookie";
import sessionMiddleware from "./session";

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

interface WebSocketMessage {
  type: string;
  payload: any;
}

export function setupWebSocketServer(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    clientTracking: true,
    verifyClient: async ({ req }: { req: ExtendedIncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) => {
      try {
        if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
          return done(true);
        }

        const cookies = cookie.parse(req.headers.cookie || '');
        if (!cookies['battle.sid']) {
          return done(false, 401, 'No session cookie found');
        }

        // Setup express-specific properties
        (req as any).originalUrl = req.url;
        (req as any).method = req.method || 'GET';
        (req as any).complete = true;
        (req as any).headers = req.headers;
        (req as any).get = (name: string) => req.headers[name.toLowerCase()];
        (req as any).connection = req.socket;

        // Parse session synchronously
        await new Promise<void>((resolve) => {
          sessionMiddleware(req as any, { end: () => null } as any, () => resolve());
        });

        if (!req.session?.user?.id) {
          return done(false, 401, 'Unauthorized');
        }

        req.userSession = req.session;
        done(true);
      } catch (error) {
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

    ws.on('message', async (data) => {
      try {
        if (!ws.session?.user?.id) {
          ws.send(JSON.stringify({
            type: "ERROR",
            payload: { message: "Unauthorized" }
          }));
          return;
        }

        const message: WebSocketMessage = JSON.parse(data.toString());
        switch (message.type) {
          case "JOIN_GAME":
            if (message.payload.gameId) {
              ws.gameId = message.payload.gameId;
              ws.send(JSON.stringify({
                type: "JOINED_GAME",
                payload: { gameId: message.payload.gameId }
              }));
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
      if (ws.gameId) {
        ws.gameId = undefined;
      }
    });
  });

  return wss;
}