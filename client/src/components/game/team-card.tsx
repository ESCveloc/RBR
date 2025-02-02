import { useState } from "react";
import { Link } from "wouter";
import type { GameParticipant, Team } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, LogOut, MapPin } from "lucide-react";
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
  showMembers?: boolean;
  showStatus?: boolean;
  showLocation?: boolean;
}

export function TeamCard({ 
  gameId, 
  participant, 
  team, 
  canAssignPosition,
  showMembers = false,
  showStatus = false,
  showLocation = false 
}: TeamCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  const currentTeam = participant?.team || team;
  const isCaptain = currentTeam?.captainId === user?.id;

  const toggleReady = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId) return;

      const newReadyState = !participant.ready;

      const response = await fetch(`/api/games/${gameId}/team-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          teamId: participant.teamId,
          ready: newReadyState
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = await response.json();

      return {
        ...result,
        ready: newReadyState,
        teamId: participant.teamId
      };
    },
    onSuccess: (updatedParticipant) => {
      queryClient.setQueryData([`/api/games/${gameId}`], (oldData: any) => {
        if (!oldData) return oldData;

        return {
          ...oldData,
          participants: oldData.participants?.map((p: any) =>
            p.teamId === updatedParticipant.teamId
              ? { ...p, ready: updatedParticipant.ready }
              : p
          )
        };
      });

      toast({
        title: "Status Updated",
        description: `Team is now ${updatedParticipant.ready ? "ready" : "not ready"} for the game.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const assignPosition = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId) return;

      const response = await fetch(`/api/games/${gameId}/assign-position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: participant.teamId }),
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
        title: "Success",
        description: "Starting position assigned.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const leaveGame = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId) return;
      const response = await fetch(`/api/games/${gameId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: participant.teamId }),
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
    return currentTeam?.teamMembers?.length || 0;
  };

  // Team card outside game context
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center justify-center w-16 rounded-full px-2 py-0.5 text-xs font-medium ${
                      team.active ? 'bg-green-100 text-green-700' : 'bg-zinc-200 text-zinc-700'
                    }`}>
                      {team.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      W/L: {team.wins || 0}/{team.losses || 0}
                    </span>
                    {showMembers && (
                      <span className="text-xs text-muted-foreground">
                        • {getTeamMembersCount()} members
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  // Team card in game context
  if (participant?.team) {
    const isReady = !!participant.ready;
    const hasStartingPosition = participant.startingLocation !== null;

    return (
      <Card
        key={`participant-${participant.teamId}`}
        className={`${participant.status === "eliminated" ? "opacity-50" : ""}`}
      >
        <CardContent className="p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold">{participant.team.name}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {showMembers && (
                      <span className="text-xs text-muted-foreground">
                        {getTeamMembersCount()} members
                      </span>
                    )}
                    {showLocation && hasStartingPosition && participant.startingLocation && (
                      <span className="text-xs text-muted-foreground">
                        • Starting Position {participant.startingLocation.position + 1}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {showStatus && (
                <span className={`inline-flex items-center justify-center w-16 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                  participant.status === "eliminated"
                    ? 'bg-red-100 text-red-700'
                    : isReady
                    ? 'bg-green-100 text-green-700'
                    : 'bg-zinc-200 text-zinc-700'
                }`}>
                  {participant.status === "eliminated" 
                    ? "Eliminated" 
                    : isReady
                    ? "Ready"
                    : "Not Ready"
                  }
                </span>
              )}
            </div>

            {participant.status !== "eliminated" && (
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2">
                  {isCaptain && (
                    <>
                      <Switch
                        checked={isReady}
                        onCheckedChange={() => {
                          if (!toggleReady.isPending) {
                            toggleReady.mutate();
                          }
                        }}
                        disabled={toggleReady.isPending}
                      />
                      <span className="text-sm text-muted-foreground">Ready</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {canAssignPosition && !hasStartingPosition && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => assignPosition.mutate()}
                      disabled={assignPosition.isPending}
                    >
                      <MapPin className="h-4 w-4 mr-2" />
                      Assign Position
                    </Button>
                  )}
                  {isCaptain && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => leaveGame.mutate()}
                      disabled={leaveGame.isPending}
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Leave
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}