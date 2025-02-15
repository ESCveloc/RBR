import { useEffect, useRef } from 'react';
import { useUser } from '@/hooks/use-user';

type WebSocketMessage = {
  type: string;
  payload: any;
};

class GameWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("WebSocket connection already exists");
      return;
    }

    console.log("Initiating WebSocket connection to:", this.url);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("WebSocket connection established successfully");
      this.sendQueuedMessages();
    };

    this.ws.onclose = (event) => {
      console.log("WebSocket connection closed:", event.code, event.reason);
      if (event.code === 1000 || event.code === 1001) {
        // Normal closure, don't reconnect
        return;
      }
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };
  }

  private handleMessage(message: WebSocketMessage) {
    console.log("Received message:", message);
    // Handle game-specific messages
    switch (message.type) {
      case "GAME_STATE_UPDATE":
      case "LOCATION_UPDATE":
      case "TEAM_STATUS_UPDATE":
      case "GAME_EVENT":
        // These will be handled by the subscribers
        break;
      case "ERROR":
        console.error("WebSocket error:", message.payload);
        break;
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.log(`Scheduling reconnection attempt ${this.reconnectAttempts + 1} in ${delay}ms`);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  send(message: WebSocketMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("Sending message:", message);
      this.ws.send(JSON.stringify(message));
    } else {
      console.log("WebSocket not ready, queueing message:", message);
      this.messageQueue.push(message);
      this.connect(); // Try to reconnect if not connected
    }
  }

  private sendQueuedMessages() {
    console.log(`Sending ${this.messageQueue.length} queued messages`);
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close(1000, "Normal closure");
    }
  }
}

export function useGameWebSocket() {
  const wsRef = useRef<GameWebSocket | null>(null);
  const { user } = useUser();

  useEffect(() => {
    if (!user) {
      if (wsRef.current) {
        console.log("No user, closing WebSocket connection");
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    if (!wsRef.current) {
      console.log("Creating new WebSocket connection");
      wsRef.current = new GameWebSocket(wsUrl);
    }
    wsRef.current.connect();

    return () => {
      if (wsRef.current) {
        console.log("Cleaning up WebSocket connection");
        wsRef.current.close();
      }
    };
  }, [user]);

  return {
    send: (message: WebSocketMessage) => {
      if (!wsRef.current) {
        console.warn("No WebSocket connection available");
        return;
      }
      wsRef.current.send(message);
    }
  };
}