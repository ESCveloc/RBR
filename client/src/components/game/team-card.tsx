import { useState } from "react";
import { Link } from "wouter";
import type { GameParticipant, Team } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, LogOut } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";

interface TeamCardProps {
  gameId?: number;
  participant?: GameParticipant & { 
    team: Team & { 
      teamMembers: Array<{ id: number; userId: number; joinedAt: string }>;
      member_count?: number;
    } 
  };
  team?: Team & { 
    teamMembers: Array<{ id: number; userId: number; joinedAt: string }>;
    member_count?: number;
  };
  canAssignPosition?: boolean;
}

export function TeamCard({ gameId, participant, team, canAssignPosition }: TeamCardProps) {
  const [isAssigning, setIsAssigning] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Get team object based on context
  const currentTeam = participant?.team || team;
  const isCaptain = currentTeam?.captainId === user?.id;

  const toggleReady = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId) return;

      const response = await fetch(`/api/games/${gameId}/team-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          teamId: participant.teamId,
          ready: !participant.ready
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Status Updated",
        description: `Team is now ${participant?.ready ? "not ready" : "ready"} for the game.`,
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

  const leaveGame = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId) return;

      const response = await fetch(`/api/games/${gameId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: participant.teamId }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Left Game",
        description: "Your team has left the game.",
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
    if (team?.member_count !== undefined) {
      return team.member_count;
    }
    if (participant?.team?.member_count !== undefined) {
      return participant.team.member_count;
    }
    return 0;
  };

  // If we're displaying a team outside of a game context
  if (team) {
    return (
      <Link href={`/team/${team.id}`} key={`team-${team.id}`}>
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
      <Card
        key={`participant-${participant.teamId}`}
        className={`
          ${participant.status === "eliminated" ? "opacity-50" : ""}
          hover:bg-accent/50 transition-colors
        `}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold">{participant.team.name}</h3>
                <span className="text-xs text-muted-foreground">
                  {getTeamMembersCount()} members
                </span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                participant.status === "eliminated"
                  ? 'bg-red-100 text-red-700'
                  : participant.ready
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {participant.status === "eliminated" 
                  ? "Eliminated" 
                  : participant.ready 
                  ? "Ready"
                  : "Not Ready"
                }
              </span>

              {isCaptain && participant.status !== "eliminated" && (
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={participant.ready || false}
                      onCheckedChange={() => toggleReady.mutate()}
                      disabled={toggleReady.isPending}
                    />
                    <span className="text-sm">Ready</span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => leaveGame.mutate()}
                    disabled={leaveGame.isPending}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}