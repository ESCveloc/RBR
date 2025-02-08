import { useState } from "react";
import { Link } from "wouter";
import type { GameParticipant, Team } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, LogOut, X } from "lucide-react";
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
import { useGame } from "@/hooks/use-game";
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
  showLocation?: boolean;
}

export function TeamCard({
  gameId,
  participant,
  team,
  canAssignPosition,
  showMembers = false,
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
  const { updateReadyStatus, updateLocation } = useGame(gameId || 0);

  // If we're in game context (gameId exists), only show if there's a valid participant with team
  if (gameId && (!participant || !participant.team)) {
    return null;
  }

  // If we're not in game context, only show if there's a valid team
  if (!gameId && !team) {
    return null;
  }

  const currentTeam = participant?.team || team;
  if (!currentTeam) return null;

  const isCaptain = currentTeam?.captainId === user?.id;
  const isAdmin = user?.role === 'admin';
  const isReady = participant?.ready || false;
  const hasStartingPosition = participant?.startingLocation !== null;
  const canManageTeam = isAdmin || isCaptain;

  // Get game data for player limits
  const game = queryClient.getQueryData<any>([`/api/games/${gameId}`]);
  const maxPlayers = game?.playersPerTeam || 0;
  const currentTeamSize = participant?.team?.teamMembers?.length || team?.teamMembers?.length || 0;
  const isOverPlayerLimit = maxPlayers > 0 && currentTeamSize > maxPlayers;


  // Get taken positions from the game data
  const takenPositions = game?.participants
    ?.filter((p: any) => p.teamId !== participant?.teamId && p.startingLocation)
    ?.map((p: any) => p.startingLocation?.position)
    ?.filter(Boolean) || [];

  // Generate available positions array [1..10] for the clockwise pattern
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);

  const handlePositionChange = async (value: string) => {
    if (!participant?.teamId) {
      console.log('No team ID available for position update');
      return;
    }

    setSelectedPosition(value);
    try {
      await updateLocation.mutateAsync({
        teamId: participant.teamId,
        position: parseInt(value),
        force: isAdmin
      });
    } catch (error) {
      console.error('Failed to update position:', error);
      // Reset to previous position on error
      setSelectedPosition(participant.startingLocation?.position?.toString() || "");
    }
  };

  const handleReadyToggle = () => {
    if (!gameId || !participant?.teamId) return;
    updateReadyStatus.mutate({
      teamId: participant.teamId,
      ready: !isReady
    });
  };

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
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
    },
  });

  // Team card in game context
  if (participant?.team) {
    return (
      <Card className="w-full transition-all duration-200 hover:bg-white/5 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 transition-transform duration-200 hover:scale-110 hover:bg-primary/20 group">
                  <Users className="h-5 w-5 text-primary transition-transform duration-200 group-hover:scale-110" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate max-w-[200px] transition-colors duration-200 hover:text-primary">
                    {participant.team.name}
                  </h3>
                  {showMembers && participant.team.teamMembers && (
                    <div className="flex flex-col gap-1">
                      <span className={cn(
                        "text-xs",
                        isOverPlayerLimit ? "text-red-500" : "text-muted-foreground"
                      )}>
                        {participant.team.teamMembers.length} members
                        {maxPlayers > 0 && ` (max ${maxPlayers})`}
                      </span>
                      {isOverPlayerLimit && (
                        <span className="text-xs text-red-500">
                          ⚠️ Exceeds game player limit
                        </span>
                      )}
                    </div>
                  )}
                  {showLocation && hasStartingPosition && participant.startingLocation && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      Site {participant.startingLocation.position}
                    </span>
                  )}
                </div>
              </div>
              {canManageTeam && (
                <div className="flex items-center gap-2 ml-3 transition-transform duration-200 hover:translate-x-1">
                  <Switch
                    checked={isReady}
                    onCheckedChange={handleReadyToggle}
                    disabled={updateReadyStatus.isPending}
                    className="transition-all duration-200 group-hover:ring-2 group-hover:ring-primary/30 data-[state=checked]:bg-primary/90 hover:data-[state=checked]:bg-primary"
                  />
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    isReady
                      ? "text-green-500 bg-green-500/10"
                      : "text-yellow-500 bg-yellow-500/10"
                  )}>
                    {isReady ? "Ready" : "Not Ready"}
                  </span>
                </div>
              )}
            </div>

            {participant.status !== "eliminated" && (
              <div className="grid gap-4 md:grid-cols-2 border-t mt-4 pt-4">
                <div>
                  {canAssignPosition && (
                    <Select
                      value={selectedPosition}
                      onValueChange={handlePositionChange}
                    >
                      <SelectTrigger className="w-full max-w-[160px] transition-all duration-200 hover:border-primary focus:ring-primary">
                        <SelectValue placeholder="Select Site">
                          {selectedPosition ? `Site ${selectedPosition}` : "Select Site"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {positions.map((pos) => {
                          const isTaken = takenPositions.includes(pos);
                          const isCurrentPosition = pos === participant?.startingLocation?.position;
                          return (
                            <SelectItem
                              key={pos}
                              value={String(pos)}
                              disabled={isTaken && !isCurrentPosition}
                              className={cn(
                                "transition-all duration-200",
                                isTaken && !isCurrentPosition && "opacity-50",
                                isCurrentPosition && "text-primary font-medium",
                                "hover:bg-primary/10"
                              )}
                            >
                              Site {pos}
                              {isTaken && !isCurrentPosition && " (Taken)"}
                              {isCurrentPosition && " (Current)"}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {canManageTeam && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => leaveGame.mutate()}
                      disabled={leaveGame.isPending}
                      className="w-full max-w-[160px] transition-all duration-200 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:scale-105 active:scale-95"
                    >
                      <LogOut className="h-4 w-4 mr-2 transition-transform duration-200 group-hover:translate-x-1" />
                      Leave
                    </Button>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => setSelectedPosition(participant?.startingLocation?.position?.toString() || "")}
                      disabled={updateLocation.isPending}
                      className="w-full max-w-[160px] ml-2 transition-all duration-200 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:scale-105 active:scale-95 group"
                    >
                      <X className="h-4 w-4 mr-2 transition-transform duration-200 group-hover:-translate-x-1" />
                      Cancel
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
        <Card className="w-full">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{team.name}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    W/L: {team.wins || 0}/{team.losses || 0}
                  </span>
                  {showMembers && team.teamMembers && (
                    <span className="text-xs text-muted-foreground">
                      • {team.teamMembers.length} members
                    </span>
                  )}
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