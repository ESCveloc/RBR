import { useQuery } from "@tanstack/react-query";
import type { Team } from "@db/schema";

interface TeamMember {
  id: number;
  teamId: number;
  userId: number;
  joinedAt: string;
}

interface TeamResponse {
  teams: Team;
  team_members: TeamMember | null;
}

export function useTeams() {
  const { data, isLoading } = useQuery<TeamResponse[]>({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  // Process the teams data to handle the nested structure
  const teams = data?.map(item => ({
    ...item.teams,
    teamMembers: item.team_members ? [item.team_members] : []
  })) || [];

  return {
    teams,
    isLoading,
  };
}