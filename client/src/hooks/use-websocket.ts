import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';

type WebSocketMessage = {
  type: string;
  payload: any;
};

interface WebSocketInterface {
  socket: WebSocket | null;
  sendMessage: (type: string, payload: any) => void;
  subscribeToMessage: (type: string, handler: (payload: any) => void) => () => void;
  isConnected: boolean;
  joinGame: (gameId: number) => void;
  sendLocationUpdate: (gameId: number, location: GeolocationPosition) => void;
  sendZoneUpdate: (gameId: number, zoneId: number, update: any) => void;
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

  const cleanupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent onclose from triggering during cleanup
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    reconnectAttemptRef.current = 0;
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(() => {
    if (!user) {
      console.log('[WebSocket] No user available, skipping connection');
      return;
    }

    if (isConnectingRef.current) {
      console.log('[WebSocket] Connection already in progress');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Connection already open');
      return;
    }

    cleanupWebSocket();
    isConnectingRef.current = true;

    try {
      // Get the WebSocket URL using current window location
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host || window.location.hostname;
      const wsUrl = `${protocol}//${host}/ws`;

      console.log('[WebSocket] Connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);

      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('[WebSocket] Connection timeout, closing socket');
          ws.close();
        }
      }, 5000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connected successfully');
        wsRef.current = ws;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        if (pendingGameJoinRef.current !== null) {
          console.log('[WebSocket] Processing pending game join:', pendingGameJoinRef.current);
          ws.send(JSON.stringify({
            type: 'JOIN_GAME',
            payload: { gameId: pendingGameJoinRef.current }
          }));
          pendingGameJoinRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('[WebSocket] Received:', message);

          if (message.type === 'ERROR') {
            console.error('[WebSocket] Server error:', message.payload);
            toast({
              title: "Server Error",
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
        console.error('[WebSocket] Error:', error);
        isConnectingRef.current = false;
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Closed:', event.code, event.reason);
        wsRef.current = null;
        isConnectingRef.current = false;

        // Only reconnect if we have a user and it wasn't a normal closure
        if (user && event.code !== 1000 && reconnectAttemptRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`[WebSocket] Will reconnect in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      isConnectingRef.current = false;
      toast({
        title: "Connection Error",
        description: "Failed to setup WebSocket connection",
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
  }, [user, connect, cleanupWebSocket]);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Not connected, message dropped:', { type, payload });
      return;
    }

    try {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } catch (error) {
      console.error('[WebSocket] Send error:', error);
    }
  }, []);

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
      console.warn('[WebSocket] Cannot join game: Not authenticated');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendMessage('JOIN_GAME', { gameId });
    } else {
      pendingGameJoinRef.current = gameId;
      connect();
    }
  }, [user, connect, sendMessage]);

  const sendLocationUpdate = useCallback((gameId: number, location: GeolocationPosition) => {
    sendMessage('LOCATION_UPDATE', {
      gameId,
      teamId: user?.id,
      location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      }
    });
  }, [sendMessage, user?.id]);

  const sendZoneUpdate = useCallback((gameId: number, zoneId: number, update: any) => {
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