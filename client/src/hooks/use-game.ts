import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';
import { useWebSocket } from './use-websocket';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

interface UpdatePositionData {
  teamId: number;
  position: number;
  force?: boolean;
}

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
                  startingLocation: payload.startingLocation
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
    staleTime: 30000,
    refetchInterval: false
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
    mutationFn: async ({ teamId, position, force }: UpdatePositionData) => {
      const response = await fetch(`/api/games/${gameId}/assign-position`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ teamId, position, force }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();

      // Send WebSocket update for real-time position changes
      sendMessage('LOCATION_UPDATE', { 
        gameId, 
        teamId,
        startingLocation: data.startingLocation
      });

      return data;
    },
    onMutate: async ({ teamId, position }) => {
      await queryClient.cancelQueries({ queryKey: [`/api/games/${gameId}`] });
      const previousGame = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);

      if (previousGame?.participants) {
        const updatedParticipants = previousGame.participants.map(p => 
          p.teamId === teamId ? { 
            ...p, 
            startingLocation: {
              position,
              coordinates: p.startingLocation?.coordinates || null
            }
          } : p
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
        title: "Error updating position",
        description: err.message,
        variant: "destructive"
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: "Team position updated successfully"
      });
    }
  });

  const joinGame = useMutation({
    mutationFn: async (teamId: number) => {
      // First join the game
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
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const joinData = await response.json();

      // Then assign random position
      const positionResponse = await fetch(`/api/games/${gameId}/assign-random-position`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ teamId }),
        credentials: 'include'
      });

      if (!positionResponse.ok) {
        throw new Error(await positionResponse.text());
      }

      const positionData = await positionResponse.json();

      // Send WebSocket update
      sendMessage('GAME_STATE_UPDATE', { 
        gameId,
        type: 'TEAM_JOINED',
        teamId 
      });

      return {
        ...joinData,
        participant: positionData
      };
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
    onError: (err: Error) => {
      let errorMessage = err.message;
      // Enhance error messages for specific cases
      if (errorMessage.includes("playersPerTeam")) {
        errorMessage = "Your team has too many players for this game. Remove some players or contact an admin.";
      } else if (errorMessage.includes("maxTeams")) {
        errorMessage = "This game has reached its maximum number of teams. Contact an admin if you need to join.";
      }

      toast({
        title: "Error joining game",
        description: errorMessage,
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