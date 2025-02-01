import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';
import { useWebSocket } from './use-websocket';
import { useEffect } from 'react';

export function useGame(gameId: number) {
  const queryClient = useQueryClient();
  const ws = useWebSocket();

  // Subscribe to game status updates
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'GAME_UPDATE' && data.gameId === gameId) {
          // Invalidate the game query to trigger a refetch
          queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, gameId, queryClient]);

  const { data: game, isLoading, error } = useQuery<Game>({
    queryKey: [`/api/games/${gameId}`],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/games/${gameId}`, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch game data');
        }

        const data = await response.json();
        return data;
      } catch (err) {
        console.error('Error fetching game:', err);
        throw err;
      }
    },
    enabled: !!gameId,
    retry: 3,
    staleTime: 30000, // Cache data for 30 seconds
    refetchInterval: false // Disable polling, rely on WebSocket updates
  });

  const updateLocation = useMutation({
    mutationFn: async (location: GeolocationCoordinates) => {
      const response = await fetch(`/api/games/${gameId}/update-location`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ location }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: (data: GameParticipant) => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
    }
  });

  const joinGame = useMutation({
    mutationFn: async (teamId: number) => {
      const response = await fetch(`/api/games/${gameId}/join`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ teamId }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
    }
  });

  return {
    game,
    isLoading,
    error,
    updateLocation,
    joinGame
  };
}