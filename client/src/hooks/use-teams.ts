import { useQuery } from "@tanstack/react-query";
import type { Team, TeamMember } from "@db/schema";

interface TeamWithMembers extends Team {
  teamMembers: TeamMember[];
  member_count?: number;
}

interface TeamResponse {
  teams: Team;
  team_members: number;
}

export function useTeams() {
  const { data, isLoading } = useQuery<TeamResponse[]>({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  // Process the teams data to handle the nested structure and remove duplicates
  const teams = data?.reduce<TeamWithMembers[]>((acc, item) => {
    const existingTeam = acc.find(t => t.id === item.teams.id);

    if (!existingTeam) {
      // Create new team entry
      acc.push({
        ...item.teams,
        member_count: item.team_members,
        teamMembers: []
      });
    }

    return acc;
  }, []) || [];

  return {
    teams,
    isLoading,
  };
}