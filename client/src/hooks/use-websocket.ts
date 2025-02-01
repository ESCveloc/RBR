import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

type WebSocketMessage = {
  type: string;
  payload: any;
};

export function useWebSocket(gameId?: number) {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxReconnectAttempts = 5;
  const reconnectAttemptRef = useRef(0);
  const isConnectingRef = useRef(false);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket is not connected, message not sent:', { type, payload });
    }
  }, []);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isConnectingRef.current = true;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Get the current host and construct the WebSocket URL
    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}`;
    console.log('Connecting to WebSocket:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const cleanup = () => {
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('message', handleMessage);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);
      };

      const handleOpen = () => {
        console.log('WebSocket connected successfully');
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0; // Reset reconnect attempts on successful connection

        // Join game room if gameId is provided
        if (gameId) {
          sendMessage('JOIN_GAME', { gameId });
        }
      };

      const handleMessage = (event: MessageEvent) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', message);

          switch (message.type) {
            case 'LOCATION_UPDATE':
              // Handle location updates through React Query cache updates
              break;
            case 'TEAM_ELIMINATED':
              toast({
                title: "Team Eliminated",
                description: `Team ${message.payload.teamName} has been eliminated!`,
                variant: "destructive"
              });
              break;
            case 'GAME_UPDATE':
              // No need for toast here as React Query will handle the UI update
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
        cleanup();
        wsRef.current = null;
        isConnectingRef.current = false;

        // Attempt to reconnect if not at max attempts
        if (reconnectAttemptRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`Attempting to reconnect in ${delay}ms`);

          // Clear any existing reconnect timeout
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          toast({
            title: "Connection Error",
            description: "Failed to connect to game server after multiple attempts",
            variant: "destructive"
          });
        }
      };

      // Add event listeners
      ws.addEventListener('open', handleOpen);
      ws.addEventListener('message', handleMessage);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);

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
  }, [gameId, toast, sendMessage]);

  useEffect(() => {
    connect();

    // Cleanup function
    return () => {
      // Clear any pending reconnection attempts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Close and cleanup the WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      // Reset state
      reconnectAttemptRef.current = 0;
      isConnectingRef.current = false;
    };
  }, [connect]);

  const addListener = useCallback((event: keyof WebSocketEventMap, handler: (event: MessageEvent) => void) => {
    if (wsRef.current) {
      wsRef.current.addEventListener(event, handler as EventListener);
    }
  }, []);

  const removeListener = useCallback((event: keyof WebSocketEventMap, handler: (event: MessageEvent) => void) => {
    if (wsRef.current) {
      wsRef.current.removeEventListener(event, handler as EventListener);
    }
  }, []);

  return {
    socket: wsRef.current,
    sendMessage,
    addEventListener: addListener,
    removeEventListener: removeListener
  };
}