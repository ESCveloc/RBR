import { useState } from "react";
import { Link } from "wouter";
import type { GameParticipant, Team, Game } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, LogOut } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TeamCardProps {
  gameId?: number;
  participant?: GameParticipant & {
    team: Team & {
      teamMembers: Array<{ id: number; userId: number; joinedAt: string }>;
      member_count?: number;
    };
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
  const [selectedPosition, setSelectedPosition] = useState<string>(
    participant?.startingLocation?.position
      ? String(participant.startingLocation.position)
      : ""
  );
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  const currentTeam = participant?.team || team;
  const isCaptain = currentTeam?.captainId === user?.id;
  const isAdmin = user?.role === 'admin';
  const isReady = participant?.ready || false;
  const hasStartingPosition = participant?.startingLocation !== null;

  // Get taken positions from the game data
  const game = queryClient.getQueryData<Game>([`/api/games/${gameId}`]);
  const takenPositions = game?.participants
    ?.filter(p => p.teamId !== participant?.teamId)
    ?.map(p => p.startingLocation?.position)
    ?.filter(Boolean) || [];

  // Generate available positions array [1..10] for the clockwise pattern
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);

  const assignPosition = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId || !selectedPosition) return;

      console.log('Assigning position:', {
        teamId: participant.teamId,
        position: parseInt(selectedPosition),
        isAdmin,
        force: isAdmin // Force flag for admin reassignments
      });

      const response = await fetch(`/api/games/${gameId}/assign-position`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          teamId: participant.teamId,
          position: parseInt(selectedPosition),
          isAdmin,
          force: isAdmin // Add force flag for admin reassignments
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Position assignment error:', error);
        throw new Error(error);
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      if (data.startingLocation) {
        setSelectedPosition(String(data.startingLocation.position));
      }
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

  const handlePositionChange = (value: string) => {
    const newPosition = parseInt(value);
    const currentPosition = participant?.startingLocation?.position;

    // Filter out current team's position from taken positions
    const otherTeamPositions = takenPositions.filter(pos => pos !== currentPosition);

    // Allow admins to reassign positions regardless of current assignments
    if (isAdmin || !otherTeamPositions.includes(newPosition)) {
      setSelectedPosition(value);
      assignPosition.mutate();
    } else {
      toast({
        title: "Position Taken",
        description: "This position is already taken by another team. Please select a different position.",
        variant: "destructive"
      });
    }
  };

  const toggleReady = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId) return;

      const response = await fetch(`/api/games/${gameId}/team-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: participant.teamId,
          ready: !isReady
        }),
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
        title: "Status Updated",
        description: `Team is now ${!isReady ? "ready" : "not ready"} for the game.`,
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
        description: "Team has left the game.",
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

  // Team card in game context
  if (participant?.team) {
    return (
      <Card className="hover:bg-white/5 transition-colors">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-4">
                    <h3 className="font-semibold">{participant.team.name}</h3>
                    {isAdmin && (
                      <div className="flex items-center gap-2 min-w-[120px] group">
                        <Switch
                          checked={isReady}
                          onCheckedChange={() => {
                            if (!toggleReady.isPending) {
                              toggleReady.mutate();
                            }
                          }}
                          disabled={toggleReady.isPending}
                          className="group-hover:ring-2 group-hover:ring-primary/30 transition-all"
                        />
                        <span className="text-sm text-muted-foreground">Ready</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {showMembers && (
                      <span className="text-xs text-muted-foreground">
                        {participant.team.teamMembers.length} members
                      </span>
                    )}
                    {showStatus && (
                      <Badge variant="secondary" className={cn(
                        "transition-none",
                        participant.status === "eliminated"
                          ? 'bg-red-500/10 text-red-500'
                          : isReady
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-gray-500/10 text-gray-500'
                      )}>
                        {participant.status === "eliminated"
                          ? "Eliminated"
                          : isReady
                            ? "Ready"
                            : "Not Ready"
                        }
                      </Badge>
                    )}
                    {showLocation && hasStartingPosition && participant.startingLocation && (
                      <span className="text-xs text-muted-foreground">
                        • Site {participant.startingLocation.position}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {participant.status !== "eliminated" && (
              <div className="grid gap-4 md:grid-cols-2 border-t mt-4 pt-4">
                <div>
                  {(canAssignPosition || isAdmin) && participant?.team && (
                    <Select
                      value={selectedPosition}
                      onValueChange={handlePositionChange}
                    >
                      <SelectTrigger className="w-full max-w-[160px]">
                        <SelectValue placeholder="Select Site">
                          {selectedPosition ? `Site ${selectedPosition}` : "Select Site"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {positions.map((pos) => {
                          return (
                            <SelectItem
                              key={pos}
                              value={String(pos)}
                              disabled={takenPositions.includes(pos) && pos !== participant?.startingLocation?.position}
                              className={cn(
                                takenPositions.includes(pos) && pos !== participant?.startingLocation?.position && "opacity-50",
                                takenPositions.includes(pos) && pos !== participant?.startingLocation?.position && "cursor-not-allowed",
                                pos === participant?.startingLocation?.position && "text-primary font-medium"
                              )}
                            >
                              Site {pos}
                              {takenPositions.includes(pos) && pos !== participant?.startingLocation?.position && " (Taken)"}
                              {pos === participant?.startingLocation?.position && " (Current)"}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {isAdmin && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => leaveGame.mutate()}
                      disabled={leaveGame.isPending}
                      className="w-full max-w-[160px] bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors duration-200"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Leave
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Team card outside game context (e.g., in team list)
  if (team) {
    return (
      <Link href={`/team/${team.id}`}>
        <Card className="hover:bg-white/5 transition-colors cursor-pointer">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">{team.name}</h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={cn(
                      team.active ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-500'
                    )}>
                      {team.active ? 'Active' : 'Inactive'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      W/L: {team.wins || 0}/{team.losses || 0}
                    </span>
                    {showMembers && (
                      <span className="text-xs text-muted-foreground">
                        • {team.teamMembers.length} members
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

  return null;
}