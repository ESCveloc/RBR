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
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SelectTeamProps {
  gameId: number;
  maxTeams: number;
  playersPerTeam: number;
  currentTeamCount: number;
}

export function SelectTeam({ gameId, maxTeams, playersPerTeam, currentTeamCount }: SelectTeamProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const { teams = [], isLoading: isLoadingTeams } = useTeams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filter out inactive teams
  const activeTeams = teams.filter(team => team.active);

  // Pre-validate teams against game rules
  const teamsWithValidation = activeTeams.map(team => ({
    ...team,
    isValid: team.teamMembers?.length <= playersPerTeam,
    validationMessage: team.teamMembers?.length > playersPerTeam 
      ? `Too many players (has ${team.teamMembers?.length}, max ${playersPerTeam})`
      : null
  }));

  const isGameFull = currentTeamCount >= maxTeams;

  const assignTeam = useMutation({
    mutationFn: async () => {
      if (!selectedTeamId) return;

      const response = await fetch(`/api/games/${gameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: parseInt(selectedTeamId) }),
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

  if (isGameFull) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          This game has reached its maximum number of teams ({maxTeams}). Contact an admin if you need to join.
        </AlertDescription>
      </Alert>
    );
  }

  const selectedTeam = teamsWithValidation.find(t => t.id.toString() === selectedTeamId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a team to join with" />
          </SelectTrigger>
          <SelectContent>
            {teamsWithValidation && teamsWithValidation.length > 0 ? (
              teamsWithValidation.map((team) => (
                <SelectItem 
                  key={team.id} 
                  value={String(team.id)}
                  className={team.isValid ? "" : "text-destructive"}
                >
                  {team.name} ({team.teamMembers?.length || 0} members)
                  {team.validationMessage && ` - ${team.validationMessage}`}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="" disabled>
                No active teams available - Create a team first
              </SelectItem>
            )}
          </SelectContent>
        </Select>

        {selectedTeam && !selectedTeam.isValid && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {selectedTeam.validationMessage}
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => assignTeam.mutate()}
          disabled={!selectedTeamId || assignTeam.isPending || (selectedTeam && !selectedTeam.isValid)}
          className="w-full"
        >
          {assignTeam.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Assigning Team...
            </>
          ) : (
            "Join Game with Selected Team"
          )}
        </Button>
      </div>
    </div>
  );
}