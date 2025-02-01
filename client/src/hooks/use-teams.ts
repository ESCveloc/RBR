import { useQuery } from "@tanstack/react-query";
import type { Team, TeamMember } from "@db/schema";
import { useWebSocket } from "./use-websocket";
import { useEffect } from "react";

interface TeamWithMembers extends Team {
  teamMembers: TeamMember[];
  member_count?: number;
}

interface TeamResponse {
  teams: Team;
  team_members: number;
}

export function useTeams() {
  const { socket } = useWebSocket();
  const { data, isLoading, refetch } = useQuery<TeamResponse[]>({
    queryKey: ["/api/teams"],
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: false, // Disable polling
  });

  // Subscribe to team updates via WebSocket
  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'TEAM_UPDATE') {
          // Trigger a refetch when we receive a team update
          refetch();
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, [socket, refetch]);

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