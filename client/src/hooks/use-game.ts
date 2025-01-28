import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Event, EventParticipant } from '@db/schema';

export function useGame(gameId: number) {
  const queryClient = useQueryClient();

  const { data: game, isLoading } = useQuery<Event>({
    queryKey: ['/api/games', gameId],
    enabled: !!gameId,
    staleTime: 30000, // 30 seconds
    gcTime: 60000, // 1 minute (renamed from cacheTime)
    refetchInterval: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
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
      queryClient.invalidateQueries({ queryKey: ['/api/games', gameId] });
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