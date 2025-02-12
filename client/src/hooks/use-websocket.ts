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
}

export function useWebSocket(): WebSocketInterface {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const { user, isLoading: isUserLoading } = useUser();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxReconnectAttempts = 5;
  const reconnectAttemptRef = useRef(0);
  const isConnectingRef = useRef(false);
  const messageHandlersRef = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  const cleanupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent reconnection attempt on intentional close
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
  }, []);

  const connect = useCallback(() => {
    if (!user || isUserLoading || isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    cleanupWebSocket(); // Ensure any existing connection is properly closed
    isConnectingRef.current = true;

    try {
      // Ensure we're using the same origin as the current page
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      console.log('Initiating WebSocket connection to:', wsUrl);

      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('WebSocket connection timeout, closing connection');
          ws.close();
        }
      }, 5000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection established successfully');
        wsRef.current = ws;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        // Send initial authentication message
        ws.send(JSON.stringify({
          type: 'AUTHENTICATE',
          payload: { userId: user.id }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', message);

          if (message.type === 'ERROR') {
            console.error('WebSocket error message:', message.payload);
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

        if (user) {
          toast({
            title: "Connection Error",
            description: "WebSocket connection error occurred. Attempting to reconnect...",
            variant: "destructive"
          });
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection closed:', event.code, event.reason);
        wsRef.current = null;
        isConnectingRef.current = false;

        // Only attempt to reconnect if the closure wasn't intentional and we have a valid user
        if (user && !isUserLoading && reconnectAttemptRef.current < maxReconnectAttempts && event.code !== 1000) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`Scheduling reconnection attempt ${reconnectAttemptRef.current + 1} in ${delay}ms`);

          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (reconnectAttemptRef.current >= maxReconnectAttempts && user) {
          toast({
            title: "Connection Error",
            description: "Failed to establish WebSocket connection after multiple attempts. Please refresh the page.",
            variant: "destructive"
          });
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      isConnectingRef.current = false;
      if (user) {
        toast({
          title: "Connection Error",
          description: "Failed to establish WebSocket connection",
          variant: "destructive"
        });
      }
    }
  }, [user, isUserLoading, toast, cleanupWebSocket]);

  useEffect(() => {
    // Only attempt to connect if we have a valid user and are not loading
    if (!isUserLoading) {
      if (user) {
        connect();
      } else {
        cleanupWebSocket();
      }
    }

    return () => {
      cleanupWebSocket();
    };
  }, [connect, user, isUserLoading, cleanupWebSocket]);

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
      toast({
        title: "Connection Error",
        description: "Cannot join game: WebSocket not connected. Please try again.",
        variant: "destructive"
      });
    }
  }, [sendMessage, toast, user]);

  return {
    socket: wsRef.current,
    sendMessage,
    subscribeToMessage,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    joinGame
  };
}