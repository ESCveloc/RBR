import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';

type WebSocketMessage = {
  type: string;
  payload: any;
};

interface GameState {
  positions: Record<number, GeolocationCoordinates>;
  zones: Array<{
    id: number;
    coordinates: [number, number];
    radius: number;
    controllingTeam?: number;
  }>;
}

interface WebSocketInterface {
  socket: WebSocket | null;
  sendMessage: (type: string, payload: any) => void;
  subscribeToMessage: (type: string, handler: (payload: any) => void) => () => void;
  isConnected: boolean;
  joinGame: (gameId: number) => void;
  sendLocationUpdate: (gameId: number, location: GeolocationPosition) => void;
  sendZoneUpdate: (gameId: number, zoneId: number, update: Partial<GameState['zones'][0]>) => void;
}

export function useWebSocket(): WebSocketInterface {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const { user } = useUser();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxReconnectAttempts = 5;
  const reconnectAttemptRef = useRef(0);
  const isConnectingRef = useRef(false);
  const messageHandlersRef = useRef<Map<string, Set<(payload: any) => void>>>(new Map());
  const pendingGameJoinRef = useRef<number | null>(null);
  const locationUpdateQueueRef = useRef<{ gameId: number; location: GeolocationPosition }[]>([]);
  const zoneUpdateQueueRef = useRef<{ gameId: number; zoneId: number; update: any }[]>([]);

  const cleanupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    reconnectAttemptRef.current = 0;
    isConnectingRef.current = false;
    messageHandlersRef.current.clear();
    pendingGameJoinRef.current = null;
    locationUpdateQueueRef.current = [];
    zoneUpdateQueueRef.current = [];
  }, []);

  const connect = useCallback(() => {
    if (!user || isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Connection attempt skipped:', {
        noUser: !user,
        isConnecting: isConnectingRef.current,
        alreadyConnected: wsRef.current?.readyState === WebSocket.OPEN
      });
      return;
    }

    cleanupWebSocket();
    isConnectingRef.current = true;

    try {
      // Get the WebSocket URL ensuring it's properly formed
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      console.log('[WebSocket] Attempting connection to:', wsUrl);
      const ws = new WebSocket(wsUrl);

      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('[WebSocket] Connection timeout, closing socket');
          ws.close();
        }
      }, 5000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connection established successfully');
        wsRef.current = ws;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        // Process pending game join
        if (pendingGameJoinRef.current !== null) {
          console.log('[WebSocket] Processing pending game join:', pendingGameJoinRef.current);
          ws.send(JSON.stringify({
            type: 'JOIN_GAME',
            payload: { gameId: pendingGameJoinRef.current }
          }));
          pendingGameJoinRef.current = null;
        }

        // Process queued updates
        while (locationUpdateQueueRef.current.length > 0) {
          const update = locationUpdateQueueRef.current.shift();
          if (update) {
            sendLocationUpdate(update.gameId, update.location);
          }
        }

        while (zoneUpdateQueueRef.current.length > 0) {
          const update = zoneUpdateQueueRef.current.shift();
          if (update) {
            sendZoneUpdate(update.gameId, update.zoneId, update.update);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('[WebSocket] Received message:', message);

          if (message.type === 'ERROR') {
            console.error('[WebSocket] Error message:', message.payload);
            toast({
              title: "WebSocket Error",
              description: message.payload.message,
              variant: "destructive"
            });
            return;
          }

          const handlers = messageHandlersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach(handler => {
              try {
                handler(message.payload);
              } catch (err) {
                console.error('[WebSocket] Handler error:', err);
              }
            });
          }
        } catch (error) {
          console.error('[WebSocket] Message parsing error:', error);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error('[WebSocket] Connection error:', error);
        isConnectingRef.current = false;

        if (ws.readyState !== WebSocket.OPEN) {
          toast({
            title: "Connection Error",
            description: "Failed to connect to game server. Retrying...",
            variant: "destructive"
          });
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connection closed:', event.code, event.reason);
        wsRef.current = null;
        isConnectingRef.current = false;

        // Only attempt reconnection if not a normal closure and we have a valid user
        if (user && event.code !== 1000 && reconnectAttemptRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`[WebSocket] Scheduling reconnection attempt ${reconnectAttemptRef.current + 1} in ${delay}ms`);
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (reconnectAttemptRef.current >= maxReconnectAttempts) {
          toast({
            title: "Connection Error",
            description: "Unable to connect to game server. Please refresh the page.",
            variant: "destructive"
          });
        }
      };
    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      isConnectingRef.current = false;
      toast({
        title: "Connection Error",
        description: "Failed to establish connection to game server",
        variant: "destructive"
      });
    }
  }, [user, toast, cleanupWebSocket]);

  useEffect(() => {
    if (user) {
      connect();
    } else {
      cleanupWebSocket();
    }

    return () => {
      cleanupWebSocket();
    };
  }, [connect, user, cleanupWebSocket]);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Not connected, message not sent:', { type, payload });
      return;
    }

    try {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } catch (error) {
      console.error('[WebSocket] Error sending message:', error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
    }
  }, [toast]);

  const subscribeToMessage = useCallback((type: string, handler: (payload: any) => void) => {
    if (!messageHandlersRef.current.has(type)) {
      messageHandlersRef.current.set(type, new Set());
    }
    const handlers = messageHandlersRef.current.get(type)!;
    handlers.add(handler);

    return () => {
      const handlers = messageHandlersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          messageHandlersRef.current.delete(type);
        }
      }
    };
  }, []);

  const joinGame = useCallback((gameId: number) => {
    if (!user) {
      console.warn('Cannot join game: User not authenticated');
      toast({
        title: "Authentication Error",
        description: "Please log in to join a game.",
        variant: "destructive"
      });
      return;
    }

    console.log('Attempting to join game:', gameId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('Sending JOIN_GAME message');
      sendMessage('JOIN_GAME', { gameId });
    } else {
      console.warn('Cannot join game: WebSocket not connected');
      pendingGameJoinRef.current = gameId;
      connect();
    }
  }, [sendMessage, toast, user, connect]);

  const sendLocationUpdate = useCallback(async (gameId: number, location: GeolocationPosition) => {
    const locationData = {
      gameId,
      location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        timestamp: location.timestamp
      }
    };

    if (!navigator.onLine || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      locationUpdateQueueRef.current.push({ gameId, location });
      return;
    }

    sendMessage('LOCATION_UPDATE', locationData);
  }, [sendMessage]);

  const sendZoneUpdate = useCallback((gameId: number, zoneId: number, update: Partial<GameState['zones'][0]>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      zoneUpdateQueueRef.current.push({ gameId, zoneId, update });
      return;
    }

    sendMessage('ZONE_UPDATE', { gameId, zoneId, update });
  }, [sendMessage]);

  return {
    socket: wsRef.current,
    sendMessage,
    subscribeToMessage,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    joinGame,
    sendLocationUpdate,
    sendZoneUpdate
  };
}