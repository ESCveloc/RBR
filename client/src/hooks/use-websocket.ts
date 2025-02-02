import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';

type WebSocketMessage = {
  type: string;
  payload: any;
  entity?: string;
  id?: number;
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
    // Only connect if user is authenticated and not already connecting
    if (!user || isUserLoading || isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isConnectingRef.current = true;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}`;

    console.log('Attempting WebSocket connection to:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const handleOpen = () => {
        console.log('WebSocket connected successfully');
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;

        // Join game room if gameId is provided
        if (gameId) {
          sendMessage('JOIN_GAME', { gameId });
        }
      };

      const handleMessage = (event: MessageEvent) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', message);

          if (message.type === 'ERROR') {
            toast({
              title: "WebSocket Error",
              description: message.payload.message,
              variant: "destructive"
            });
            return;
          }

          // Execute all registered callbacks for this message type
          messageCallbacksRef.current.get(message.type)?.forEach(callback => {
            callback(message.payload);
          });

          // Handle system messages
          switch (message.type) {
            case 'TEAM_ELIMINATED':
              toast({
                title: "Team Eliminated",
                description: `Team ${message.payload.teamName} has been eliminated!`,
                variant: "destructive"
              });
              break;
          }
        } catch (error) {
          console.error('WebSocket message parsing error:', error);
        }
      };

      const handleError = (error: Event) => {
        console.error('WebSocket connection error:', error);
        isConnectingRef.current = false;
      };

      const handleClose = () => {
        console.log('WebSocket connection closed');
        wsRef.current = null;
        isConnectingRef.current = false;

        // Only attempt reconnection if user is still authenticated
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
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('message', handleMessage);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);

      return () => {
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('message', handleMessage);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      isConnectingRef.current = false;
      wsRef.current = null;
      toast({
        title: "Connection Error",
        description: "Failed to establish WebSocket connection",
        variant: "destructive"
      });
    }
  }, [gameId, user, isUserLoading, toast, sendMessage]);

  useEffect(() => {
    // Only attempt connection when auth state is stable and user is logged in
    if (user && !isUserLoading) {
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
    subscribeToMessage
  };
}