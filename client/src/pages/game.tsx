import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useGame } from "@/hooks/use-game";
import { useWebSocket } from "@/hooks/use-websocket";
import { MapView } from "@/components/game/map-view";
import { TeamCard } from "@/components/game/team-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Play, X, Users } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SelectTeam } from "@/components/game/select-team";
import type { Game as GameType } from "@db/schema";

export default function Game() {
  const [match, params] = useRoute<{ id: string }>("/game/:id");
  const { toast } = useToast();

  // Only set gameId if we have a match and valid ID
  const gameId = match && params?.id ? parseInt(params.id) : undefined;

  // Debug logs for route matching and game status
  console.log('Route match:', match);
  console.log('Route params:', params);
  console.log('Computed game ID:', gameId);

  const { game, isLoading } = useGame(gameId);
  const { user } = useUser();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';
  const isGameCreator = game?.createdBy === user?.id;
  const canManageGame = isAdmin || isGameCreator;
  const gameStatus = game?.status;

  // Debug logs for auth and game state
  console.log('User:', user);
  console.log('Game:', game);
  console.log('Can manage game:', canManageGame);
  console.log('Game status:', gameStatus);
  console.log('Should show buttons:', canManageGame && gameStatus === 'pending');

  // Make sure we have explicit checks
  if (!match || !gameId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Game Not Found</h1>
          <Link href="/">
            <Button>Return to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const updateGameStatus = useMutation({
    mutationFn: async ({ status }: { status: 'active' | 'completed' | 'cancelled' }) => {
      if (!gameId) {
        throw new Error('No game ID provided');
      }

      console.log("Updating game status to:", status);
      const response = await fetch(`/api/games/${gameId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games', gameId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  //Handle invalid route match and loading state (moved up)


  // Rest of the component remains unchanged, but with explicit status check
  return (
    <div className="min-h-screen bg-background">
      <header className="p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{game.name}</h1>
          </div>

          {/* Right side - Status and controls */}
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-purple-500/15 px-3 py-1 text-sm font-medium text-purple-700">
              {gameStatus === 'active' ? 'In Progress' :
               gameStatus === 'completed' ? 'Completed' :
               gameStatus === 'cancelled' ? 'Cancelled' :
               'Pending'}
            </div>

            {canManageGame && gameStatus === 'pending' && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => updateGameStatus.mutate({ status: 'active' })}
                  disabled={updateGameStatus.isPending}
                  size="sm"
                >
                  {updateGameStatus.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Start Game
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => updateGameStatus.mutate({ status: 'cancelled' })}
                  disabled={updateGameStatus.isPending}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="order-2 md:order-1">
          <MapView game={game} />
        </div>

        <div className="order-1 md:order-2 space-y-4">
          {/* Game Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Game Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p><strong>Duration:</strong> {game.gameLengthMinutes} minutes</p>
                <p><strong>Teams:</strong> {game.participants?.length || 0} / {game.maxTeams}</p>
                <p><strong>Players per Team:</strong> {game.playersPerTeam}</p>
                {game.startTime && (
                  <p><strong>Started:</strong> {new Date(game.startTime).toLocaleString()}</p>
                )}
              </div>
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
              {!game.participants || game.participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No teams have joined yet.</p>
              ) : (
                game.participants.map((participant) => (
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

const formatTime = (ms: number) => {
  const minutes = Math.floor(ms / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};