import { useQuery } from "@tanstack/react-query";
import type { Team } from "@db/schema";

interface TeamWithMembers {
  teams: Team;
  team_members: {
    id: number;
    teamId: number;
    userId: number;
    joinedAt: string;
  };
}

export function useTeams() {
  const { data, isLoading } = useQuery<TeamWithMembers[]>({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  return {
    teams: data?.map(item => ({
      ...item.teams,
      members: [item.team_members].filter(member => member !== null)
    })) || [],
    isLoading,
  };
}