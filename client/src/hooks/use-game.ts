import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';

export function useGame(gameId: number) {
  const queryClient = useQueryClient();

  const { data: game, isLoading, error } = useQuery<Game>({
    queryKey: [`/api/games/${gameId}`],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/games/${gameId}`, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          const text = await response.text();
          try {
            // Try to parse error as JSON
            const error = JSON.parse(text);
            throw new Error(error.message || 'Failed to fetch game');
          } catch {
            // If not JSON, use text directly
            throw new Error(text || 'Failed to fetch game');
          }
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Invalid response format from server');
        }

        return response.json();
      } catch (err) {
        console.error('Error fetching game:', err);
        throw err;
      }
    },
    enabled: !!gameId,
    retry: 3,
    staleTime: 1000,
    refetchInterval: 5000
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