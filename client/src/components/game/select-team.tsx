import { useState } from "react";
import { useTeams } from "@/hooks/use-teams";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useUser } from "@/hooks/use-user";

interface SelectTeamProps {
  gameId: number;
}

export function SelectTeam({ gameId }: SelectTeamProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const { teams = [], isLoading: isLoadingTeams } = useTeams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Get game data for team limits
  const game = queryClient.getQueryData<any>([`/api/games/${gameId}`]);
  const currentTeamCount = game?.participants?.filter(p => p.startingLocation !== null)?.length || 0;
  const isGameFull = currentTeamCount >= (game?.maxTeams || 0);
  const isAdmin = user?.role === 'admin';

  // Filter out inactive teams
  const activeTeams = teams.filter(team => team.active);

  const assignTeam = useMutation({
    mutationFn: async () => {
      if (!selectedTeamId) return;

      // Remove game full check for admins
      if (isGameFull && !isAdmin) {
        throw new Error("Game has reached maximum number of teams");
      }

      const response = await fetch(`/api/games/${gameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: parseInt(selectedTeamId), force: isAdmin }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Team Assigned",
        description: "The team has been successfully assigned to the game.",
      });
      setSelectedTeamId("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoadingTeams) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a team" />
          </SelectTrigger>
          <SelectContent>
            {activeTeams && activeTeams.length > 0 ? (
              activeTeams.map((team) => (
                <SelectItem 
                  key={team.id} 
                  value={String(team.id)}
                >
                  {team.name} ({team.member_count || team.teamMembers?.length || 0} members)
                </SelectItem>
              ))
            ) : (
              <SelectItem value="" disabled>
                No active teams available
              </SelectItem>
            )}
          </SelectContent>
        </Select>

        <Button
          onClick={() => assignTeam.mutate()}
          disabled={!selectedTeamId || assignTeam.isPending}
          className={isGameFull && !isAdmin ? "opacity-50" : ""}
        >
          {assignTeam.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Assign"
          )}
        </Button>
      </div>
      {isGameFull && !isAdmin && (
        <p className="text-sm text-destructive">
          Game has reached the maximum number of teams
        </p>
      )}
      {isGameFull && isAdmin && (
        <p className="text-sm text-yellow-500">
          Game is full, but you can still add teams as an admin
        </p>
      )}
    </div>
  );
}