import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Event, EventParticipant, GeolocationCoordinates } from '@db/schema';

export function useEvent(eventId: number, isParticipant = false) {
  const queryClient = useQueryClient();

  const { data: event, isLoading } = useQuery<Event>({
    queryKey: ['/api/events', eventId],
    enabled: !!eventId,
    staleTime: isParticipant ? 1000 : Infinity, // Never stale for admin, 1s for participants
    gcTime: 60000, // 1 minute
    refetchInterval: isParticipant ? 5000 : false, // Only poll for participants
    refetchOnWindowFocus: isParticipant,
    refetchOnMount: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 30000),
  });

  const updateLocation = useMutation({
    mutationFn: async (location: GeolocationCoordinates) => {
      const response = await fetch(`/api/events/${eventId}/update-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          location: {
            ...location,
            timestamp: Date.now()
          }
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: (data: EventParticipant) => {
      queryClient.setQueryData(['/api/events', eventId], (oldData: Event | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          participants: oldData.participants?.map(p =>
            p.id === data.id ? { ...p, ...data } : p
          )
        };
      });
    }
  });

  return {
    event,
    isLoading,
    updateLocation
  };
}