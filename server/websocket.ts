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

        console.log('[WebSocket] Starting connection verification');
        console.log('[WebSocket] Headers:', JSON.stringify(req.headers, null, 2));

        const cookies = cookie.parse(req.headers.cookie || '');
        console.log('[WebSocket] Parsed cookies:', cookies);

        const sidCookie = cookies['connect.sid'];
        if (!sidCookie) {
          console.log('[WebSocket] No connect.sid cookie found');
          return done(false, 401, 'No session cookie found');
        }

        // Parse signed cookie - remove 's:' prefix and take everything before the dot
        const sessionId = sidCookie.split('.')[0].replace('s:', '');
        console.log('[WebSocket] Extracted session ID:', sessionId);

        // List all sessions in store for debugging
        sessionStore.all((err, sessions) => {
          if (err) {
            console.error('[WebSocket] Error listing sessions:', err);
          } else {
            console.log('[WebSocket] Active sessions:', Object.keys(sessions || {}).length);
            console.log('[WebSocket] Available session IDs:', Object.keys(sessions || {}));
          }
        });

        // Get session from store
        sessionStore.get(sessionId, (err, session) => {
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
          req.session = session as GameSession;
          done(true);
        });
      } catch (error) {
        console.error('[WebSocket] Verification error:', error);
        done(false, 500, 'Session verification failed');
      }
    }
  });

  // Set up heartbeat
  const interval = setInterval(() => {
    wss.clients.forEach((ws: CustomWebSocket) => {
      if (ws.isAlive === false) {
        console.log('[WebSocket] Client inactive, terminating');
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  // Handle new connections
  wss.on('connection', (ws: CustomWebSocket, req: ExtendedIncomingMessage) => {
    ws.isAlive = true;
    ws.session = req.session;

    console.log('[WebSocket] New connection established for user:', ws.session?.user?.id);

    // Setup ping response handler
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        if (!ws.session?.user?.id) {
          console.log('[WebSocket] Unauthorized message attempt');
          ws.send(JSON.stringify({
            type: "ERROR",
            payload: { message: "Unauthorized" }
          }));
          return;
        }

        const message: WebSocketMessage = JSON.parse(data.toString());
        console.log('[WebSocket] Received message:', message.type, 'from user:', ws.session.user.id);

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

          case "LOCATION_UPDATE":
            if (ws.gameId && message.payload?.location) {
              wss.clients.forEach((client: CustomWebSocket) => {
                if (client.gameId === ws.gameId && client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({
                    type: "LOCATION_UPDATE",
                    payload: {
                      gameId: ws.gameId,
                      teamId: ws.session?.user?.id,
                      location: message.payload.location
                    }
                  }));
                }
              });
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