import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';
import { useWebSocket } from './use-websocket';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function useGame(gameId: number) {
  const queryClient = useQueryClient();
  const { sendMessage, subscribeToMessage } = useWebSocket(gameId);
  const { toast } = useToast();

  // Subscribe to game updates
  useEffect(() => {
    const unsubscribe = subscribeToMessage('GAME_UPDATE', (payload) => {
      if (payload.gameId === gameId) {
        // Update the cache with the new data directly instead of invalidating
        queryClient.setQueryData([`/api/games/${gameId}`], (oldData: Game | undefined) => {
          if (!oldData) return payload.game;
          return {
            ...oldData,
            ...payload.game,
            // Merge participants array, preserving optimistic updates
            participants: payload.game.participants.map((newParticipant: GameParticipant) => {
              const oldParticipant = oldData.participants?.find(p => p.id === newParticipant.id);
              return oldParticipant ? { ...oldParticipant, ...newParticipant } : newParticipant;
            })
          };
        });
      }
    });

    return () => unsubscribe();
  }, [gameId, queryClient, subscribeToMessage]);

  const { data: game, isLoading, error } = useQuery<Game>({
    queryKey: [`/api/games/${gameId}`],
    staleTime: 60000, // Cache data for 1 minute
    cacheTime: 3600000, // Keep in cache for 1 hour
    refetchInterval: false // Disable polling, rely on WebSocket updates
  });

  const updateLocation = useMutation({
    mutationFn: async (location: GeolocationCoordinates) => {
      sendMessage('LOCATION_UPDATE', { gameId, location });

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
      await queryClient.cancelQueries({ queryKey: [`/api/games/${gameId}`] });
      const previousGame = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);

      if (previousGame?.participants) {
        const updatedParticipants = previousGame.participants.map(p => 
          p.teamId === game?.createdBy ? { ...p, location } : p
        );

        queryClient.setQueryData<Game>([`/api/games/${gameId}`], {
          ...previousGame,
          participants: updatedParticipants
        });
      }

      return { previousGame };
    },
    onError: (err, newLocation, context) => {
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

      const data = await response.json();
      // Broadcast join event through WebSocket
      sendMessage('GAME_JOIN', { gameId, teamId });
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Game>([`/api/games/${gameId}`], (oldData) => {
        if (!oldData) return data;
        return {
          ...oldData,
          participants: [...(oldData.participants || []), data.participant]
        };
      });

      toast({
        title: "Success",
        description: "Successfully joined the game",
      });
    },
    onError: (err) => {
      toast({
        title: "Error joining game",
        description: err.message,
        variant: "destructive"
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