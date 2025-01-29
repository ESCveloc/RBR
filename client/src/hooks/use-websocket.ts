import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

type WebSocketMessage = {
  type: string;
  payload: any;
};

export function useWebSocket(gameId: number, isParticipant = false) {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxReconnectAttempts = 5;
  const reconnectAttemptRef = useRef(0);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const connect = useCallback(() => {
    if (!isParticipant || !isMountedRef.current || wsRef.current?.readyState === WebSocket.OPEN || isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) {
        ws.close();
        return;
      }
      console.log('WebSocket connected');
      isConnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      sendMessage('JOIN_GAME', { gameId });
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;

      try {
        const message: WebSocketMessage = JSON.parse(event.data);
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
        console.error('WebSocket message error:', error);
      }
    };

    ws.onerror = (error) => {
      if (!isMountedRef.current) return;
      console.error('WebSocket error:', error);
      isConnectingRef.current = false;
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      console.log('WebSocket disconnected');
      isConnectingRef.current = false;

      if (isParticipant && reconnectAttemptRef.current < maxReconnectAttempts) {
        reconnectAttemptRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connect();
          }
        }, delay);
      } else if (reconnectAttemptRef.current >= maxReconnectAttempts && isMountedRef.current) {
        toast({
          title: "Connection Error",
          description: "Failed to connect to game server after multiple attempts",
          variant: "destructive"
        });
      }
    };
  }, [gameId, toast, sendMessage, isParticipant]);

  useEffect(() => {
    isMountedRef.current = true;

    if (isParticipant) {
      connect();
    }

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, isParticipant]);

  return { sendMessage };
}