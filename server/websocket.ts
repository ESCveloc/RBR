import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";

class CustomWebSocketServer extends WebSocketServer {
  broadcast(msg: string): void {
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
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
    // Ignore Vite HMR WebSocket connections
    verifyClient: (info: any) => {
      return !info.req.headers['sec-websocket-protocol']?.includes('vite-hmr');
    }
  });

  wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        // Handle different message types
        switch (data.type) {
          case "LOCATION_UPDATE":
            // Broadcast location update to all clients
            wss.broadcast(JSON.stringify(data));
            break;
          case "GAME_UPDATE":
            // Broadcast game state changes
            wss.broadcast(JSON.stringify(data));
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
    });
  });

  return wss;
}