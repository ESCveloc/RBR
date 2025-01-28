import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Event, EventParticipant } from '@db/schema';

export function useEvent(eventId: number, isParticipant = false) {
  const queryClient = useQueryClient();

  const { data: event, isLoading } = useQuery<Event>({
    queryKey: ['/api/events', eventId],
    enabled: !!eventId,
    staleTime: isParticipant ? 1000 : 30000, // 1 second for participants, 30 seconds for admin
    gcTime: 60000, // 1 minute
    refetchInterval: isParticipant ? 5000 : 0, // Only poll for participants
    refetchOnWindowFocus: isParticipant,
    refetchOnMount: isParticipant,
  });

  const updateLocation = useMutation({
    mutationFn: async (location: GeolocationCoordinates) => {
      const response = await fetch(`/api/events/${eventId}/update-location`, {
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
      queryClient.invalidateQueries({ queryKey: ['/api/events', eventId] });
    }
  });

  const joinEvent = useMutation({
    mutationFn: async (teamId: number) => {
      const response = await fetch(`/api/events/${eventId}/join`, {
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
      queryClient.invalidateQueries({ queryKey: ['/api/events', eventId] });
    }
  });

  return {
    event,
    isLoading,
    updateLocation,
    joinEvent
  };
}