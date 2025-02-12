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
import { cn } from "@/lib/utils";

interface SelectTeamProps {
  gameId: number;
}

interface GameParticipant {
  teamId: number;
  startingLocation: {
    position: number;
  } | null;
}

export function SelectTeam({ gameId }: SelectTeamProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const { teams = [], isLoading: isLoadingTeams } = useTeams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Get game data for team limits
  const game = queryClient.getQueryData<any>([`/api/games/${gameId}`]);
  const currentTeamCount = game?.participants?.filter((p: GameParticipant) => p.startingLocation !== null)?.length || 0;
  const isGameFull = currentTeamCount >= (game?.maxTeams || 0);
  const isAdmin = user?.role === 'admin';

  // Get current participants' team IDs
  const participantTeamIds = new Set(
    game?.participants?.map((p: GameParticipant) => p.teamId) || []
  );

  // Filter out inactive teams and teams already in the game
  const availableTeams = teams.filter(
    team => team.active && !participantTeamIds.has(team.id)
  );

  const assignTeam = useMutation({
    mutationFn: async () => {
      if (!selectedTeamId) return;

      // Only apply the game full check for non-admin users
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
            {availableTeams && availableTeams.length > 0 ? (
              availableTeams.map((team) => {
                const teamSize = team.member_count || team.teamMembers?.length || 0;
                const isOverPlayerLimit = game?.playersPerTeam && teamSize > game.playersPerTeam;
                return (
                  <SelectItem 
                    key={team.id} 
                    value={String(team.id)}
                    className={cn(
                      "transition-all duration-200",
                      isOverPlayerLimit && "text-yellow-500"
                    )}
                  >
                    {team.name} ({teamSize} members)
                    {isOverPlayerLimit && " ⚠️ Exceeds player limit"}
                  </SelectItem>
                );
              })
            ) : (
              <SelectItem value="" disabled>
                No available teams
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
    </div>
  );
}