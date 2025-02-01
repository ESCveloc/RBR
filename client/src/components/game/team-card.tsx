import { useState } from "react";
import { Link } from "wouter";
import type { GameParticipant } from "@db/schema";
import type { TeamWithMembers } from "@/hooks/use-teams";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface TeamCardProps {
  gameId?: number;
  participant?: GameParticipant & { 
    team?: TeamWithMembers;
  };
  team?: TeamWithMembers;
  canAssignPosition?: boolean;
}

export function TeamCard({ gameId, participant, team, canAssignPosition }: TeamCardProps) {
  const [isAssigning, setIsAssigning] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const assignPosition = useMutation({
    mutationFn: async (position: number) => {
      if (!gameId || !participant?.teamId) {
        throw new Error("Missing required game or team information");
      }

      const response = await fetch(`/api/games/${gameId}/assign-starting-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: participant.teamId, position }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      setIsAssigning(false);
      toast({
        title: "Success",
        description: "Starting position has been assigned successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getTeamMembersCount = () => {
    const teamToUse = team || participant?.team;
    if (!teamToUse?.teamMembers) return 0;
    return teamToUse.teamMembers.length;
  };

  // If we're displaying a team outside of a game context
  if (team) {
    return (
      <Link href={`/team/${team.id}`}>
        <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold">{team.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      team.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {team.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      W/L: {team.wins || 0}/{team.losses || 0}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      • {getTeamMembersCount()} members
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  // If we're displaying a participant in a game
  if (participant?.team) {
    return (
      <Card className={`${participant.status === "eliminated" ? "opacity-50" : ""} hover:bg-accent/50 transition-colors`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                participant.status === "eliminated" ? "bg-destructive" : "bg-primary"
              }`}>
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold">{participant.team.name}</h3>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                    participant.status === "eliminated"
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {participant.status === "eliminated" ? "Eliminated" : "Active"}
                  </span>
                  {participant.startingLocation && (
                    <span className="text-xs text-muted-foreground">
                      Position {participant.startingLocation.position}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    • {getTeamMembersCount()} members
                  </span>
                </div>
              </div>
            </div>

            {canAssignPosition && !participant.startingLocation && (
              <div className="flex items-center gap-2">
                {isAssigning ? (
                  <>
                    <Select
                      onValueChange={(value) => {
                        assignPosition.mutate(parseInt(value));
                      }}
                      disabled={assignPosition.isPending}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="Position" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((position) => (
                          <SelectItem key={position} value={position.toString()}>
                            Position {position}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAssigning(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAssigning(true)}
                  >
                    Assign Position
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}