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

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket is not connected, message not sent:', { type, payload });
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

  const connect = useCallback(() => {
    if (!user || isUserLoading || isConnectingRef.current) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectingRef.current = true;

    try {
      // Use relative WebSocket URL
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}`;
      console.log('Attempting WebSocket connection to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        console.log('WebSocket connected successfully');
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        if (gameId) {
          sendMessage('JOIN_GAME', { gameId });
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'ERROR') {
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
        console.error('WebSocket connection error:', error);
        isConnectingRef.current = false;

        // Close the connection on error to trigger reconnect
        if (wsRef.current) {
          wsRef.current.close();
        }
      });

      ws.addEventListener('close', () => {
        console.log('WebSocket connection closed');
        wsRef.current = null;
        isConnectingRef.current = false;

        if (user && !isUserLoading && reconnectAttemptRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`Attempting to reconnect in ${delay}ms`);

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (reconnectAttemptRef.current >= maxReconnectAttempts) {
          toast({
            title: "Connection Error",
            description: "Failed to connect to game server after multiple attempts. Please refresh the page.",
            variant: "destructive"
          });
        }
      });
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      isConnectingRef.current = false;
      toast({
        title: "Connection Error",
        description: "Failed to establish WebSocket connection",
        variant: "destructive"
      });
    }
  }, [gameId, user, isUserLoading, toast, sendMessage]);

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