import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Game, GameParticipant } from '@db/schema';
import { useWebSocket } from './use-websocket';
import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

interface UpdatePositionData {
  teamId: number;
  position: number;
  force?: boolean;
}

export function useGame(gameId: number) {
  const queryClient = useQueryClient();
  const { socket, sendMessage, subscribeToMessage, sendLocationUpdate } = useWebSocket();
  const { toast } = useToast();
  const watchIdRef = useRef<number | null>(null);

  // Start location tracking when game is active
  useEffect(() => {
    if (!socket || !gameId) return;

    const startLocationTracking = () => {
      if (!navigator.geolocation) {
        toast({
          title: "Error",
          description: "Geolocation is not supported by your browser",
          variant: "destructive"
        });
        return;
      }

      // Watch position with high accuracy
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          sendLocationUpdate(gameId, position);
        },
        (error) => {
          toast({
            title: "Location Error",
            description: `Failed to get location: ${error.message}`,
            variant: "destructive"
          });
        },
        {
          enableHighAccuracy: true,
          maximumAge: 3000,
          timeout: 5000
        }
      );
    };

    startLocationTracking();

    // Cleanup location tracking
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [socket, gameId, sendLocationUpdate, toast]);

  // Subscribe to game updates
  useEffect(() => {
    if (!socket) return;

    // Subscribe to game state updates (kept for critical game state changes)
    const unsubscribeGameUpdate = subscribeToMessage('GAME_STATE_UPDATE', (payload) => {
      if (payload.gameId === gameId) {
        queryClient.setQueryData([`/api/games/${gameId}`], payload.game);
      }
    });

    // Subscribe to position updates (critical for gameplay)
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

    return () => {
      unsubscribeGameUpdate();
      unsubscribeLocationUpdate();
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

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Game>([`/api/games/${gameId}`], (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          participants: oldData.participants?.map(p =>
            p.teamId === data.teamId ? { ...p, ready: data.ready } : p
          )
        };
      });

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

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Game>([`/api/games/${gameId}`], (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          participants: oldData.participants?.map(p =>
            p.teamId === data.teamId ? { ...p, startingLocation: data.startingLocation } : p
          )
        };
      });

      toast({
        title: "Success",
        description: "Team position updated successfully"
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error updating position",
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
    onSuccess: (data) => {
      queryClient.setQueryData<Game>([`/api/games/${gameId}`], (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          participants: [...(oldData.participants || []), data]
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
    updateReadyStatus
  };
}