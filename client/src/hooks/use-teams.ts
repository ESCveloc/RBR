import { useQuery } from "@tanstack/react-query";

export interface TeamUser {
  id: number;
  username: string;
  firstName: string | null;
  avatar: string | null;
}

export interface TeamMember {
  id: number;
  teamId: number;
  userId: number;
  joinedAt: string;
  user: TeamUser;
}

export interface TeamWithMembers {
  id: number;
  name: string;
  description: string | null;
  captainId: number;
  active: boolean;
  wins: number | null;
  losses: number | null;
  tags: string[];
  createdAt: string;
  teamMembers: TeamMember[];
  member_count?: number;
}

interface TeamResponse {
  teams: TeamWithMembers;
  team_members: number;
}

export function useTeams() {
  const { data, isLoading, error } = useQuery<TeamResponse[]>({
    queryKey: ["/api/teams"],
    staleTime: 1000 * 60, // 1 minute
    refetchInterval: 1000 * 30, // 30 seconds
    retry: 3,
  });

  // Process the teams data to handle the nested structure and remove duplicates
  const teams = data?.reduce<TeamWithMembers[]>((acc, item) => {
    if (!item?.teams?.id) return acc;

    const existingTeam = acc.find(t => t.id === item.teams.id);
    if (!existingTeam) {
      // Create new team entry with default values for optional fields
      acc.push({
        ...item.teams,
        member_count: item.team_members,
        teamMembers: item.teams.teamMembers || [],
        wins: item.teams.wins || 0,
        losses: item.teams.losses || 0,
        tags: item.teams.tags || [],
      });
    }
    return acc;
  }, []) || [];

  return {
    teams,
    isLoading,
    error,
  };
}