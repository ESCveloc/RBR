import { useState } from "react";
import { Link } from "wouter";
import type { GameParticipant, Team } from "@db/schema";
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
  participant?: {
    id: number;
    teamId: number;
    ready: boolean;
    gameId: number;
    status: "alive" | "eliminated";
    eliminatedAt: Date | null;
    location: GeolocationCoordinates | null;
    startingLocation: {
      position: number;
      coordinates: { lat: number; lng: number; };
    } | null;
    startingLocationAssignedAt: Date | null;
    team: {
      id: number;
      name: string;
      description: string | null;
      captainId: number;
      active: boolean;
      wins: number;
      losses: number;
      tags: string[] | null;
      createdAt: Date;
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

  // Generate positions array [1..10] for the clockwise pattern
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);

  const assignPosition = useMutation({
    mutationFn: async () => {
      if (!gameId || !participant?.teamId || !selectedPosition) return;

      const response = await fetch(`/api/games/${gameId}/assign-position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: participant.teamId,
          force: isAdmin,
          position: parseInt(selectedPosition)  // Send 1-based position
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
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
      <Card className="hover:bg-accent/50 transition-colors">
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
                      <div className="flex items-center gap-2 min-w-[120px]">
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
                      onValueChange={(value) => {
                        setSelectedPosition(value);
                        assignPosition.mutate();
                      }}
                    >
                      <SelectTrigger className="w-full max-w-[160px]">
                        <SelectValue placeholder="Select Site">
                          {selectedPosition ? `Site ${selectedPosition}` : "Select Site"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {positions.map((pos) => (
                          <SelectItem key={pos} value={String(pos)}>
                            Site {pos}
                          </SelectItem>
                        ))}
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
                      className="w-full max-w-[160px] bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
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
        <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
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