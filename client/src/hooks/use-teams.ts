import { useQuery } from "@tanstack/react-query";

export function useTeams() {
  const { data: teams, isLoading } = useQuery({
    queryKey: ["/api/teams"],
    staleTime: 0,
    refetchInterval: false,
  });

  return {
    teams: teams || [],
    isLoading,
  };
}