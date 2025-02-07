import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';
import { useWebSocket } from './use-websocket';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function useGame(gameId: number) {
  const queryClient = useQueryClient();
  const { socket, sendMessage, subscribeToMessage } = useWebSocket();
  const { toast } = useToast();

  // Subscribe to game updates
  useEffect(() => {
    if (!socket) return;

    // Subscribe to general game state updates
    const unsubscribeGameUpdate = subscribeToMessage('GAME_STATE_UPDATE', (payload) => {
      if (payload.gameId === gameId) {
        queryClient.setQueryData([`/api/games/${gameId}`], payload.game);
      }
    });

    // Subscribe to location updates
    const unsubscribeLocationUpdate = subscribeToMessage('LOCATION_UPDATE', (payload) => {
      if (payload.gameId === gameId) {
        queryClient.setQueryData([`/api/games/${gameId}`], (oldData: Game | undefined) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            participants: oldData.participants?.map(participant => {
              if (participant.teamId === payload.teamId) {
                return {
                  ...participant,
                  location: payload.location
                };
              }
              return participant;
            })
          };
        });
      }
    });

    // Subscribe to ready status updates
    const unsubscribeReadyUpdate = subscribeToMessage('TEAM_READY_UPDATE', (payload) => {
      if (payload.gameId === gameId) {
        queryClient.setQueryData([`/api/games/${gameId}`], (oldData: Game | undefined) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            participants: oldData.participants?.map(participant => {
              if (participant.teamId === payload.teamId) {
                return {
                  ...participant,
                  ready: payload.ready
                };
              }
              return participant;
            })
          };
        });
      }
    });

    return () => {
      unsubscribeGameUpdate();
      unsubscribeLocationUpdate();
      unsubscribeReadyUpdate();
    };
  }, [socket, gameId, queryClient, subscribeToMessage]);

  const { data: game, isLoading, error } = useQuery<Game>({
    queryKey: [`/api/games/${gameId}`],
    staleTime: 30000, // Cache data for 30 seconds
    refetchInterval: false // Disable polling, rely on WebSocket updates
  });

  const updateReadyStatus = useMutation({
    mutationFn: async ({ teamId, ready }: { teamId: number; ready: boolean }) => {
      const response = await fetch(`/api/games/${gameId}/team-ready`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ teamId, ready }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();

      // Send WebSocket update
      sendMessage('TEAM_READY_UPDATE', {
        gameId,
        teamId,
        ready,
        type: 'READY_STATUS_CHANGE'
      });

      return data;
    },
    onMutate: async ({ teamId, ready }) => {
      await queryClient.cancelQueries({ queryKey: [`/api/games/${gameId}`] });
      const previousGame = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);

      if (previousGame) {
        const updatedParticipants = previousGame.participants?.map(p =>
          p.teamId === teamId ? { ...p, ready } : p
        );

        queryClient.setQueryData<Game>([`/api/games/${gameId}`], {
          ...previousGame,
          participants: updatedParticipants
        });
      }

      return { previousGame };
    },
    onError: (err, variables, context) => {
      if (context?.previousGame) {
        queryClient.setQueryData([`/api/games/${gameId}`], context.previousGame);
      }
      toast({
        title: "Error updating ready status",
        description: err.message,
        variant: "destructive"
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Team ready status updated successfully"
      });
    }
  });

  const updateLocation = useMutation({
    mutationFn: async ({ teamId, position, force = false }) => {
      const response = await fetch(`/api/games/${gameId}/update-location`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ teamId, position, force }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      return response.json();
    },
    onMutate: async ({ teamId, position }) => {
      await queryClient.cancelQueries({ queryKey: [`/api/games/${gameId}`] });
      const previousGame = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);

      if (previousGame?.participants) {
        const updatedParticipants = previousGame.participants.map(p => {
          if (p.teamId === teamId) {
            return {
              ...p,
              startingLocation: {
                ...p.startingLocation,
                position
              }
            };
          }
          return p;
        });

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
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Success",
        description: "Location updated successfully"
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
      sendMessage('GAME_STATE_UPDATE', { 
        gameId,
        type: 'TEAM_JOINED',
        teamId 
      });
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
    joinGame,
    updateReadyStatus
  };
}