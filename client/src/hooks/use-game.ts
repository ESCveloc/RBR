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
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });

        console.log('Game API Response:', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        });

        const responseText = await response.text();
        console.log('Response Text:', responseText);

        if (!response.ok) {
          try {
            // Try to parse error as JSON
            const error = JSON.parse(responseText);
            throw new Error(error.message || 'Failed to fetch game');
          } catch {
            // If not JSON, use text directly
            throw new Error(responseText || 'Failed to fetch game');
          }
        }

        try {
          const data = JSON.parse(responseText);
          console.log('Parsed game data:', data);
          return data;
        } catch (e) {
          console.error('JSON Parse Error:', e);
          throw new Error('Failed to parse game data');
        }
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