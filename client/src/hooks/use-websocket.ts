import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';

type WebSocketMessage = {
  type: string;
  payload: any;
};

export function useWebSocket(gameId?: number) {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const { user, isLoading: isUserLoading } = useUser();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxReconnectAttempts = 5;
  const reconnectAttemptRef = useRef(0);
  const isConnectingRef = useRef(false);
  const messageCallbacksRef = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  const connect = useCallback(() => {
    if (!user || isUserLoading || isConnectingRef.current) {
      console.log('Skipping WebSocket connection:', {
        hasUser: !!user,
        isLoading: isUserLoading,
        isConnecting: isConnectingRef.current
      });
      return;
    }

    if (wsRef.current) {
      console.log('Closing existing WebSocket connection');
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectingRef.current = true;
    console.log('Initiating WebSocket connection...');

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
      console.log('Connecting to WebSocket URL:', wsUrl);

      const ws = new WebSocket(wsUrl);

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('WebSocket connection timeout, closing connection');
          ws.close();
        }
      }, 5000);

      ws.addEventListener('open', () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection established successfully');
        wsRef.current = ws;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        if (gameId) {
          console.log('Joining game room:', gameId);
          sendMessage('JOIN_GAME', { gameId });
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', message.type);

          if (message.type === 'ERROR') {
            console.error('WebSocket error message:', message.payload);
            toast({
              title: "WebSocket Error",
              description: message.payload.message,
              variant: "destructive"
            });
            return;
          }

          messageCallbacksRef.current.get(message.type)?.forEach(callback => {
            callback(message.payload);
          });
        } catch (error) {
          console.error('WebSocket message parsing error:', error);
        }
      });

      ws.addEventListener('error', (error) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', error);
        isConnectingRef.current = false;

        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      });

      ws.addEventListener('close', (event) => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection closed:', event.code, event.reason);
        wsRef.current = null;
        isConnectingRef.current = false;

        if (user && !isUserLoading && reconnectAttemptRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`Scheduling reconnection attempt ${reconnectAttemptRef.current + 1} in ${delay}ms`);

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (reconnectAttemptRef.current >= maxReconnectAttempts) {
          toast({
            title: "Connection Error",
            description: "Failed to establish WebSocket connection after multiple attempts. Please refresh the page.",
            variant: "destructive"
          });
        }
      });
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      isConnectingRef.current = false;
      toast({
        title: "Connection Error",
        description: "Failed to establish WebSocket connection",
        variant: "destructive"
      });
    }
  }, [gameId, user, isUserLoading, toast]);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket not connected, message not sent:', { type, payload });
    }
  }, []);

  const subscribeToMessage = useCallback((type: string, callback: (payload: any) => void) => {
    if (!messageCallbacksRef.current.has(type)) {
      messageCallbacksRef.current.set(type, new Set());
    }
    messageCallbacksRef.current.get(type)?.add(callback);

    return () => {
      messageCallbacksRef.current.get(type)?.delete(callback);
      if (messageCallbacksRef.current.get(type)?.size === 0) {
        messageCallbacksRef.current.delete(type);
      }
    };
  }, []);

  useEffect(() => {
    if (!isUserLoading && user) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      isConnectingRef.current = false;
      messageCallbacksRef.current.clear();
    };
  }, [connect, user, isUserLoading]);

  return {
    socket: wsRef.current,
    sendMessage,
    subscribeToMessage,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN
  };
}