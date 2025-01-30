import { useQuery } from "@tanstack/react-query";
import type { Team } from "@db/schema";

interface TeamResponse {
  teams: Team;
  members: any[]; // We'll type this properly later
}

export function useTeams() {
  const { data, isLoading } = useQuery<TeamResponse[]>({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  return {
    teams: data?.map(item => item.teams) || [],
    isLoading,
  };
}