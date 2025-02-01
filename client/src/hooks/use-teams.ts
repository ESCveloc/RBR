import { useQuery } from "@tanstack/react-query";
import type { Team, TeamMember } from "@db/schema";

interface TeamWithMembers extends Team {
  teamMembers?: TeamMember[];
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

  // Process the teams data to handle the nested structure and remove duplicates
  const teams = data?.reduce<TeamWithMembers[]>((acc, item) => {
    // Find if we already have this team in our accumulator
    const existingTeamIndex = acc.findIndex(t => t.id === item.teams.id);

    if (existingTeamIndex === -1) {
      // Add new team with its member
      acc.push({
        ...item.teams,
        teamMembers: item.team_members ? [item.team_members] : []
      });
    } else if (item.team_members) {
      // Add member to existing team if not already present
      const existingTeam = acc[existingTeamIndex];
      if (!existingTeam.teamMembers?.some(m => m.id === item.team_members!.id)) {
        existingTeam.teamMembers = [...(existingTeam.teamMembers || []), item.team_members];
      }
    }

    return acc;
  }, []) || [];

  return {
    teams,
    isLoading,
  };
}