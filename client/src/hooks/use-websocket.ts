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
  sendLocationUpdate: (gameId: number, teamId: number, location: GeolocationPosition) => void;
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
  const locationUpdateQueueRef = useRef<{ gameId: number; teamId: number; location: GeolocationPosition }[]>([]);
  const zoneUpdateQueueRef = useRef<{ gameId: number; zoneId: number; update: any }[]>([]);

  const cleanupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent close handler from triggering reconnect
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
    // Only connect if we have a valid user and aren't already connecting/connected
    if (!user?.id) {
      console.log('No authenticated user found, skipping WebSocket connection');
      return;
    }

    if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    cleanupWebSocket();
    isConnectingRef.current = true;

    try {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      console.log('Initiating WebSocket connection to:', wsUrl, 'with user:', user.id);

      const ws = new WebSocket(wsUrl);

      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('WebSocket connection timeout, closing connection');
          ws.close();
        }
      }, 5000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection established successfully for user:', user.id);
        wsRef.current = ws;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        // Process any pending game join after connection
        if (pendingGameJoinRef.current !== null) {
          console.log('Processing pending game join:', pendingGameJoinRef.current);
          ws.send(JSON.stringify({
            type: 'JOIN_GAME',
            payload: { gameId: pendingGameJoinRef.current }
          }));
          pendingGameJoinRef.current = null;
        }

        // Process any queued location updates
        while (locationUpdateQueueRef.current.length > 0) {
          const update = locationUpdateQueueRef.current.shift();
          if (update) {
            sendLocationUpdate(update.gameId, update.teamId, update.location);
          }
        }

        // Process any queued zone updates
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
          console.log('Received WebSocket message:', message);

          if (message.type === 'ERROR') {
            console.error('WebSocket error message:', message.payload);
            toast({
              title: "Connection Error",
              description: message.payload.message || "An error occurred",
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
                console.error('Error in message handler:', err);
              }
            });
          }
        } catch (error) {
          console.error('WebSocket message parsing error:', error);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', error);
        isConnectingRef.current = false;

        toast({
          title: "Connection Error",
          description: "Connection error occurred. Attempting to reconnect...",
          variant: "destructive"
        });
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log(`WebSocket connection closed for user ${user?.id}:`, event.code, event.reason);
        wsRef.current = null;
        isConnectingRef.current = false;

        // Attempt to reconnect unless it was a normal closure or authentication error
        if (user && reconnectAttemptRef.current < maxReconnectAttempts && 
            event.code !== 1000 && event.code !== 4001 && event.code !== 4002) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`Scheduling reconnection attempt ${reconnectAttemptRef.current + 1} in ${delay}ms`);

          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (event.code === 4001 || event.code === 4002) {
          toast({
            title: "Authentication Error",
            description: "Please log in again to continue.",
            variant: "destructive"
          });
        } else if (reconnectAttemptRef.current >= maxReconnectAttempts) {
          toast({
            title: "Connection Error",
            description: "Failed to establish connection after multiple attempts. Please refresh the page.",
            variant: "destructive"
          });
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      isConnectingRef.current = false;
      toast({
        title: "Connection Error",
        description: "Failed to establish connection",
        variant: "destructive"
      });
    }
  }, [user, toast, cleanupWebSocket]);

  useEffect(() => {
    // Only attempt connection if we have a valid user
    if (user?.id) {
      console.log('User authenticated, attempting WebSocket connection:', user.id);
      connect();
    } else {
      console.log('No authenticated user, cleaning up WebSocket');
      cleanupWebSocket();
    }

    return () => {
      cleanupWebSocket();
    };
  }, [user, connect, cleanupWebSocket]);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, message not sent:', { type, payload });
      return;
    }

    try {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
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
    if (!user?.id) {
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
      console.log('WebSocket not connected, queueing game join');
      pendingGameJoinRef.current = gameId;
      connect();
    }
  }, [user, connect, sendMessage, toast]);

  const sendLocationUpdate = useCallback((gameId: number, teamId: number, location: GeolocationPosition) => {
    const locationData = {
      gameId,
      teamId,
      location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        timestamp: location.timestamp
      }
    };

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      locationUpdateQueueRef.current.push({ gameId, teamId, location });
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