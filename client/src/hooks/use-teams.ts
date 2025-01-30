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

  const processedTeams = data?.reduce<Team[]>((acc, item) => {
    const existingTeam = acc.find(t => t.id === item.teams.id);
    if (!existingTeam) {
      const members = item.team_members ? [item.team_members] : [];
      acc.push({
        ...item.teams,
        members
      });
    }
    return acc;
  }, []) || [];

  return {
    teams: processedTeams,
    isLoading,
  };
}