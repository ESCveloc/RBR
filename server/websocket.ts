import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { parse } from "cookie";

class CustomWebSocketServer extends WebSocketServer {
  broadcast(msg: string, excludeSocket?: WebSocket): void {
    this.clients.forEach((client) => {
      if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  broadcastToGame(gameId: number, msg: string, excludeSocket?: WebSocket): void {
    this.clients.forEach((client: WebSocket & { gameId?: number }) => {
      if (client !== excludeSocket && client.readyState === WebSocket.OPEN && client.gameId === gameId) {
        client.send(msg);
      }
    });
  }
}

export function setupWebSocketServer(server: Server) {
  const wss = new CustomWebSocketServer({ 
    server,
    perMessageDeflate: false,
    maxPayload: 64 * 1024, // 64kb
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      // Ignore Vite HMR WebSocket connections
      const protocol = req.headers['sec-websocket-protocol'];
      if (protocol && protocol.includes('vite-hmr')) {
        return false;
      }

      // Verify session authentication
      const cookies = req.headers.cookie;
      if (!cookies) {
        console.log("WebSocket connection rejected: No cookies provided");
        return false;
      }

      const parsedCookies = parse(cookies);
      if (!parsedCookies['connect.sid']) {
        console.log("WebSocket connection rejected: No session cookie");
        return false;
      }

      return true;
    }
  });

  wss.on("connection", (ws: WebSocket & { gameId?: number }, req: IncomingMessage) => {
    console.log("WebSocket client connected");

    ws.on("message", (message: WebSocket.Data) => {
      try {
        const data = JSON.parse(message.toString());
        console.log("Received WebSocket message:", data);

        // Handle different message types
        switch (data.type) {
          case "JOIN_GAME":
            ws.gameId = data.payload.gameId;
            console.log(`Client joined game ${data.payload.gameId}`);
            break;
          case "LOCATION_UPDATE":
            // Broadcast location update only to clients in the same game
            if (ws.gameId) {
              wss.broadcastToGame(ws.gameId, JSON.stringify(data), ws);
            }
            break;
          case "GAME_UPDATE":
            // Broadcast game state changes to all clients in the game
            if (ws.gameId) {
              wss.broadcastToGame(ws.gameId, JSON.stringify(data));
            }
            break;
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    ws.on("close", () => {
      console.log("WebSocket client disconnected");
      // Clean up any game-specific state
      delete ws.gameId;
    });
  });

  return wss;
}