import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Team, TeamMember } from "@db/schema";
import { useToast } from "@/hooks/use-toast";

interface TeamWithMembers extends Team {
  teamMembers: TeamMember[];
  member_count?: number;
}

interface TeamResponse {
  teams: Team;
  team_members: number;
}

export function useTeams() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<TeamResponse[]>({
    queryKey: ["/api/teams"],
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: false, // Disable polling
  });

  const addTeamMember = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: number; userId: number }) => {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onMutate: async ({ teamId, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/teams"] });

      const previousTeams = queryClient.getQueryData<TeamResponse[]>(["/api/teams"]);

      if (previousTeams) {
        const updatedTeams = previousTeams.map(teamResponse => {
          if (teamResponse.teams.id === teamId) {
            return {
              ...teamResponse,
              team_members: teamResponse.team_members + 1
            };
          }
          return teamResponse;
        });

        queryClient.setQueryData(["/api/teams"], updatedTeams);
      }

      return { previousTeams };
    },
    onError: (err, variables, context) => {
      if (context?.previousTeams) {
        queryClient.setQueryData(["/api/teams"], context.previousTeams);
      }
      toast({
        title: "Error adding team member",
        description: err.message,
        variant: "destructive"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({
        title: "Success",
        description: "Team member added successfully"
      });
    }
  });

  const removeTeamMember = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: number; userId: number }) => {
      const response = await fetch(`/api/teams/${teamId}/members/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onMutate: async ({ teamId, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/teams"] });

      const previousTeams = queryClient.getQueryData<TeamResponse[]>(["/api/teams"]);

      if (previousTeams) {
        const updatedTeams = previousTeams.map(teamResponse => {
          if (teamResponse.teams.id === teamId) {
            return {
              ...teamResponse,
              team_members: Math.max(0, teamResponse.team_members - 1)
            };
          }
          return teamResponse;
        });

        queryClient.setQueryData(["/api/teams"], updatedTeams);
      }

      return { previousTeams };
    },
    onError: (err, variables, context) => {
      if (context?.previousTeams) {
        queryClient.setQueryData(["/api/teams"], context.previousTeams);
      }
      toast({
        title: "Error removing team member",
        description: err.message,
        variant: "destructive"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({
        title: "Success",
        description: "Team member removed successfully"
      });
    }
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
    addTeamMember,
    removeTeamMember
  };
}