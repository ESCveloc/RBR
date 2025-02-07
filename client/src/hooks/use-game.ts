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
    queryFn: async () => {
      const response = await fetch(`/api/games/${gameId}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to fetch game data');
      }
      return response.json();
    },
    staleTime: 30000, // Cache data for 30 seconds
    retry: 1 // Only retry once
  });

  const updateGameStatus = useMutation({
    mutationFn: async ({ status }: { status: Game['status'] }) => {
      const response = await fetch(`/api/games/${gameId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ status }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to update game status');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData([`/api/games/${gameId}`], data);
      toast({
        title: "Success",
        description: "Game status updated successfully"
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error updating game status",
        description: err.message,
        variant: "destructive"
      });
    }
  });

  const updateLocation = useMutation({
    mutationFn: async ({ teamId, position, force = false }: { teamId: number; position: number; force?: boolean }) => {
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
        const errorText = await response.text();
        throw new Error(errorText);
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Success",
        description: "Location updated successfully"
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error updating location",
        description: err.message,
        variant: "destructive"
      });
    }
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

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Success",
        description: "Team ready status updated successfully"
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error updating ready status",
        description: err.message,
        variant: "destructive"
      });
    }
  });

  const leaveGame = useMutation({
    mutationFn: async (teamId: number) => {
      const response = await fetch(`/api/games/${gameId}/leave`, {
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

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games`] });
      toast({
        title: "Success",
        description: "Successfully left the game"
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error leaving game",
        description: err.message,
        variant: "destructive"
      });
    }
  });

  const cancelGame = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/games/${gameId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games`] });
      toast({
        title: "Success",
        description: "Game cancelled successfully"
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error cancelling game",
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
    onError: (err: Error) => {
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
    updateReadyStatus,
    leaveGame,
    cancelGame,
    updateGameStatus
  };
}