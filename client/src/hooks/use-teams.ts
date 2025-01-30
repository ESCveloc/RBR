import { useQuery } from "@tanstack/react-query";
import type { Team } from "@db/schema";

export function useTeams() {
  const { data, isLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  return {
    teams: data || [],
    isLoading,
  };
}