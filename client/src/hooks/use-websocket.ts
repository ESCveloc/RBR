import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

type WebSocketMessage = {
  type: string;
  payload: any;
};

export function useWebSocket(gameId: number) {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxReconnectAttempts = 5;
  const reconnectAttemptRef = useRef(0);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Get the current host and construct the WebSocket URL
    const host = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = process.env.NODE_ENV === 'production' ? window.location.port : '5000';

    // Construct WebSocket URL with explicit port
    const wsUrl = `${protocol}//${host}${port ? `:${port}` : ''}`;
    console.log('Connecting to WebSocket:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected successfully');
        reconnectAttemptRef.current = 0;
        // Join game room
        sendMessage('JOIN_GAME', { gameId });
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', message);

          switch (message.type) {
            case 'LOCATION_UPDATE':
              // Handle location updates
              break;
            case 'TEAM_ELIMINATED':
              toast({
                title: "Team Eliminated",
                description: `Team ${message.payload.teamName} has been eliminated!`,
                variant: "destructive"
              });
              break;
            case 'GAME_UPDATE':
              toast({
                title: "Game Update",
                description: message.payload.message
              });
              break;
          }
        } catch (error) {
          console.error('WebSocket message parsing error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket connection error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        wsRef.current = null;

        // Attempt to reconnect if not at max attempts
        if (reconnectAttemptRef.current < maxReconnectAttempts) {
          reconnectAttemptRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
          console.log(`Attempting to reconnect in ${delay}ms`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          toast({
            title: "Connection Error",
            description: "Failed to connect to game server after multiple attempts",
            variant: "destructive"
          });
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      toast({
        title: "Connection Error",
        description: "Failed to establish WebSocket connection",
        variant: "destructive"
      });
    }
  }, [gameId, toast, sendMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { sendMessage };
}