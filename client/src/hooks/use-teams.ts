import { useQuery } from "@tanstack/react-query";
import type { Team } from "@db/schema";

interface TeamMember {
  id: number;
  teamId: number;
  userId: number;
  joinedAt: string;
}

export function useTeams() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  // Ensure we have unique teams with their members
  const teams = data?.reduce<Team[]>((acc, team) => {
    if (!team?.teams?.id) return acc;

    // Check if we already have this team
    const existingTeam = acc.find(t => t.id === team.teams.id);
    if (!existingTeam) {
      // Add new team with its member
      acc.push({
        ...team.teams,
        teamMembers: team.team_members ? [team.team_members] : []
      });
    } else if (team.team_members) {
      // Add member to existing team
      existingTeam.teamMembers = existingTeam.teamMembers || [];
      if (!existingTeam.teamMembers.some(m => m.id === team.team_members.id)) {
        existingTeam.teamMembers.push(team.team_members);
      }
    }
    return acc;
  }, []) || [];

  return {
    teams,
    isLoading,
  };
}