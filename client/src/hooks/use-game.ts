import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';
import { useWebSocket } from './use-websocket';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function useGame(gameId: number) {
  const queryClient = useQueryClient();
  const ws = useWebSocket();
  const { toast } = useToast();

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
    onMutate: async (location) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: [`/api/games/${gameId}`] });

      // Snapshot the previous value
      const previousGame = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);

      // Optimistically update the cache
      if (previousGame) {
        queryClient.setQueryData<Game>([`/api/games/${gameId}`], {
          ...previousGame,
          participants: previousGame.participants?.map(p => 
            p.teamId === previousGame.participants.find(
              participant => participant.team?.captainId === (game?.createdBy ?? -1)
            )?.teamId
              ? { ...p, location }
              : p
          )
        });
      }

      return { previousGame };
    },
    onError: (err, newLocation, context) => {
      // Revert the optimistic update on error
      if (context?.previousGame) {
        queryClient.setQueryData([`/api/games/${gameId}`], context.previousGame);
      }
      toast({
        title: "Error updating location",
        description: err.message,
        variant: "destructive"
      });
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
    onMutate: async (teamId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: [`/api/games/${gameId}`] });

      // Snapshot the previous value
      const previousGame = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);

      // Optimistically update to show the team has joined
      if (previousGame) {
        const newParticipant: GameParticipant = {
          id: -1, // Temporary ID
          gameId,
          teamId,
          status: 'alive',
          ready: false,
          eliminatedAt: null,
          location: null,
          startingLocation: null,
          startingLocationAssignedAt: null
        };

        queryClient.setQueryData<Game>([`/api/games/${gameId}`], {
          ...previousGame,
          participants: [...(previousGame.participants || []), newParticipant]
        });
      }

      return { previousGame };
    },
    onError: (err, teamId, context) => {
      // Revert the optimistic update on error
      if (context?.previousGame) {
        queryClient.setQueryData([`/api/games/${gameId}`], context.previousGame);
      }
      toast({
        title: "Error joining game",
        description: err.message,
        variant: "destructive"
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Successfully joined the game",
      });
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