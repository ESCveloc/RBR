import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useGame } from "@/hooks/use-game";
import { useWebSocket } from "@/hooks/use-websocket";
import { MapView } from "@/components/game/map-view";
import { TeamCard } from "@/components/game/team-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Play, X, Users, Timer } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SelectTeam } from "@/components/game/select-team";

export default function Game() {
  const [, params] = useRoute<{ id: string }>("/game/:id");
  const gameId = parseInt(params?.id || "0");
  const { game, isLoading, updateLocation } = useGame(gameId);
  const { sendMessage } = useWebSocket(gameId);
  const { toast } = useToast();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [currentZone, setCurrentZone] = useState<number>(0);
  const [zoneTimeRemaining, setZoneTimeRemaining] = useState<number | null>(null);

  // Mutations for game actions
  const updateGameStatus = useMutation({
    mutationFn: async ({ status }: { status: 'active' | 'completed' | 'cancelled' }) => {
      const response = await fetch(`/api/games/${gameId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Game Updated",
        description: "The game status has been updated successfully.",
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

  // Game timer effect
  useEffect(() => {
    if (!game || game.status !== 'active') {
      setTimeRemaining(null);
      return;
    }

    const startTime = new Date(game.startTime).getTime();
    const duration = game.gameLengthMinutes * 60 * 1000;
    const endTime = startTime + duration;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const remaining = endTime - now;

      if (remaining <= 0) {
        setTimeRemaining(0);
        updateGameStatus.mutate({ status: 'completed' });
        clearInterval(timer);
      } else {
        setTimeRemaining(remaining);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [game?.status, game?.startTime, game?.gameLengthMinutes]);

  // Zone timer effect
  useEffect(() => {
    if (!game || game.status !== 'active' || !game.zoneConfigs) {
      setZoneTimeRemaining(null);
      setCurrentZone(0);
      return;
    }

    const startTime = new Date(game.startTime).getTime();
    let totalTime = 0;
    let currentZoneIndex = 0;

    // Calculate which zone we should be in
    for (let i = 0; i < game.zoneConfigs.length; i++) {
      const zoneConfig = game.zoneConfigs[i];
      totalTime += zoneConfig.intervalMinutes * 60 * 1000;

      const now = new Date().getTime();
      if (now < startTime + totalTime) {
        currentZoneIndex = i;
        const zoneStartTime = startTime + totalTime - (zoneConfig.intervalMinutes * 60 * 1000);
        const zoneEndTime = startTime + totalTime;
        const remaining = zoneEndTime - now;

        setCurrentZone(i);
        setZoneTimeRemaining(remaining > 0 ? remaining : 0);
        break;
      }
    }

    const timer = setInterval(() => {
      const now = new Date().getTime();
      if (currentZoneIndex < game.zoneConfigs.length) {
        const zoneConfig = game.zoneConfigs[currentZoneIndex];
        const zoneEndTime = startTime + totalTime;
        const remaining = zoneEndTime - now;

        if (remaining <= 0) {
          setZoneTimeRemaining(0);
          setCurrentZone(currentZoneIndex + 1);
        } else {
          setZoneTimeRemaining(remaining);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [game?.status, game?.startTime, game?.zoneConfigs]);

  useEffect(() => {
    if (!game?.boundaries?.geometry?.coordinates) return;

    // Calculate center from game boundaries for location update
    const coordinates = game.boundaries.geometry.coordinates[0];
    const center = coordinates.reduce(
      (acc, coord) => ({
        lat: acc.lat + coord[1] / coordinates.length,
        lng: acc.lng + coord[0] / coordinates.length
      }),
      { lat: 0, lng: 0 }
    );

    // Create a proper GeolocationCoordinates object
    const locationUpdate: GeolocationCoordinates = {
      latitude: center.lat,
      longitude: center.lng,
      accuracy: 0,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() { return this; }
    };

    updateLocation.mutate(locationUpdate);
  }, [game?.boundaries]);

  const isAdmin = user?.role === 'admin';
  const isGameCreator = game?.createdBy === user?.id;
  const canManageGame = isAdmin || isGameCreator;

  // Format time remaining for display
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (isLoading || !game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const gameStatus = game.status as 'pending' | 'active' | 'completed' | 'cancelled';

  return (
    <div className="min-h-screen bg-background">
      <header className="p-4 border-b">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{game.name}</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Game Timer */}
            {gameStatus === 'active' && timeRemaining !== null && (
              <div className="flex items-center gap-2 text-sm font-medium">
                <Timer className="h-4 w-4" />
                {formatTime(timeRemaining)}
              </div>
            )}

            {/* Zone Timer */}
            {gameStatus === 'active' && zoneTimeRemaining !== null && game.zoneConfigs && (
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-primary">Zone {currentZone + 1}</span>
                {formatTime(zoneTimeRemaining)}
              </div>
            )}

            <span className={`text-sm px-2 py-1 rounded-full ${
              gameStatus === 'active' ? 'bg-green-100 text-green-800' :
              gameStatus === 'completed' ? 'bg-gray-100 text-gray-800' :
              gameStatus === 'cancelled' ? 'bg-red-100 text-red-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {gameStatus === 'active' ? 'In Progress' :
               gameStatus === 'completed' ? 'Completed' :
               gameStatus === 'cancelled' ? 'Cancelled' :
               'Starting Soon'}
            </span>

            {/* Admin Controls */}
            {canManageGame && gameStatus === 'pending' && (
              <Button
                onClick={() => updateGameStatus.mutate({ status: 'active' })}
                disabled={updateGameStatus.isPending}
              >
                <Play className="h-4 w-4 mr-2" />
                Start Game
              </Button>
            )}

            {canManageGame && gameStatus === 'active' && (
              <Button
                variant="destructive"
                onClick={() => updateGameStatus.mutate({ status: 'completed' })}
                disabled={updateGameStatus.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                End Game
              </Button>
            )}

            {canManageGame && gameStatus === 'pending' && (
              <Button
                variant="destructive"
                onClick={() => updateGameStatus.mutate({ status: 'cancelled' })}
                disabled={updateGameStatus.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel Game
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="order-2 md:order-1">
          <MapView game={game} />
        </div>

        <div className="order-1 md:order-2 space-y-4">
          {/* Game Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Game Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p><strong>Duration:</strong> {game.gameLengthMinutes} minutes</p>
              <p><strong>Teams:</strong> {game.participants?.length || 0} / {game.maxTeams}</p>
              <p><strong>Players per Team:</strong> {game.playersPerTeam}</p>
              {game.startTime && (
                <p><strong>Started:</strong> {new Date(game.startTime).toLocaleString()}</p>
              )}
            </CardContent>
          </Card>

          {/* Team Assignment Section */}
          {canManageGame && gameStatus === 'pending' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Assign Teams</CardTitle>
              </CardHeader>
              <CardContent>
                <SelectTeam gameId={game.id} />
              </CardContent>
            </Card>
          )}

          {/* Teams List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Teams
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {game.participants?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No teams have joined yet.</p>
              ) : (
                game.participants?.map((participant) => (
                  <TeamCard
                    key={participant.id}
                    gameId={game.id}
                    participant={participant}
                    canAssignPosition={canManageGame && gameStatus === 'pending'}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}