import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Event, EventParticipant } from '@db/schema';

export function useGame(gameId: number, isParticipant = false) {
  const queryClient = useQueryClient();

  const { data: game, isLoading } = useQuery<Event>({
    queryKey: ['/api/games', gameId],
    enabled: !!gameId,
    staleTime: Infinity, // Never stale for now
    gcTime: 60000, // 1 minute
    refetchInterval: false, // Disable polling for now
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const updateLocation = useMutation({
    mutationFn: async (location: GeolocationCoordinates) => {
      const response = await fetch(`/api/games/${gameId}/update-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: (data: EventParticipant) => {
      // Disabled real-time updates
      // queryClient.invalidateQueries({ queryKey: ['/api/games', gameId] });
    }
  });

  const joinGame = useMutation({
    mutationFn: async (teamId: number) => {
      const response = await fetch(`/api/games/${gameId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games', gameId] });
    }
  });

  return {
    game,
    isLoading,
    updateLocation,
    joinGame
  };
}