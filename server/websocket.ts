import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import { db } from "@db";
import { games, gameParticipants } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Session } from "express-session";
import type { User } from "@db/schema";
import type { IncomingMessage } from "http";
import cookie from "cookie";
import { sessionStore } from "./session";

// Extend Session type to include user
interface GameSession extends Session {
  user?: User;
}

// Extend IncomingMessage to include session
interface ExtendedIncomingMessage extends IncomingMessage {
  session?: GameSession;
  userSession?: GameSession;
}

interface CustomWebSocket extends WebSocket {
  gameId?: number;
  isAlive: boolean;
  session?: GameSession;
  pingTimeout?: NodeJS.Timeout;
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
        // Skip verification for Vite HMR
        if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
          return done(true);
        }

        const cookies = cookie.parse(req.headers.cookie || '');
        const cookieValue = cookies['battle.sid'];

        console.log('[WebSocket] Session cookie:', cookieValue ? 'Found' : 'Not found');

        if (!cookieValue) {
          console.log('[WebSocket] No session cookie found in request');
          return done(false, 401, 'No session cookie found');
        }

        // Extract session ID from signed cookie
        const sessionId = cookieValue.split('.')[0].slice(2);
        console.log('[WebSocket] Extracted session ID:', sessionId);

        // Get session from store
        sessionStore.get(sessionId, (err, session: GameSession | null) => {
          if (err) {
            console.error('[WebSocket] Session store error:', err);
            return done(false, 500, 'Session store error');
          }

          if (!session) {
            console.log('[WebSocket] No session found for ID:', sessionId);
            return done(false, 401, 'No session found');
          }

          if (!session.user?.id) {
            console.log('[WebSocket] No user in session:', session);
            return done(false, 401, 'No user in session');
          }

          console.log('[WebSocket] Session verified for user:', session.user.id);
          req.session = session;
          req.userSession = session;
          done(true);
        });
      } catch (error) {
        console.error('[WebSocket] Verification error:', error);
        done(false, 500, 'Session verification failed');
      }
    }
  });

  // Handle new connections
  wss.on('connection', (ws: CustomWebSocket, req: ExtendedIncomingMessage) => {
    ws.isAlive = true;
    ws.session = req.userSession;

    console.log('[WebSocket] New connection established for user:', ws.session?.user?.id);

    // Setup ping response handler
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        // Verify session is still valid
        if (!ws.session?.user?.id) {
          console.log('[WebSocket] Unauthorized message attempt');
          ws.send(JSON.stringify({
            type: "ERROR",
            payload: { message: "Unauthorized" }
          }));
          return;
        }

        const message: WebSocketMessage = JSON.parse(data.toString());

        switch (message.type) {
          case "JOIN_GAME":
            if (message.payload?.gameId) {
              ws.gameId = message.payload.gameId;
              console.log(`[WebSocket] User ${ws.session.user.id} joined game ${message.payload.gameId}`);
              ws.send(JSON.stringify({
                type: "JOINED_GAME",
                payload: { gameId: message.payload.gameId }
              }));
            }
            break;

          default:
            console.log('[WebSocket] Unknown message type:', message.type);
            ws.send(JSON.stringify({
              type: "ERROR",
              payload: { message: `Unknown message type: ${message.type}` }
            }));
        }
      } catch (error) {
        console.error('[WebSocket] Message handling error:', error);
        ws.send(JSON.stringify({
          type: "ERROR",
          payload: { message: "Invalid message format" }
        }));
      }
    });

    // Handle connection close
    ws.on('close', () => {
      console.log('[WebSocket] Connection closed for user:', ws.session?.user?.id);
      if (ws.gameId) {
        ws.gameId = undefined;
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('[WebSocket] Connection error:', error);
      ws.terminate();
    });
  });

  return wss;
}