import { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapView } from "@/components/game/map-view";
import { TeamCard } from "@/components/game/team-card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Play, X, Users } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { SelectTeam } from "@/components/game/select-team";
import { useWebSocket } from "@/hooks/use-websocket";
import { useGame } from "@/hooks/use-game";
import type { Game } from "@db/schema";
import { getGameStatusColor, getGameStatusText } from "@/lib/game-status";

export default function Game() {
  const [match, params] = useRoute<{ id: string }>("/game/:id");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [, setLocation] = useLocation();

  const gameId = match && params?.id ? parseInt(params.id) : undefined;

  const { socket, isConnected, subscribeToMessage, joinGame } = useWebSocket();

  const isAdmin = user?.role === 'admin';
  const backLink = isAdmin ? "/admin" : "/";

  // Use the useGame hook for game data fetching and mutations
  const {
    game,
    isLoading,
    error,
    updateGameStatus,
  } = useGame(gameId || 0);

  useEffect(() => {
    if (isConnected && socket && gameId) {
      console.log('Joining game room:', gameId);
      joinGame(gameId);
    }
  }, [isConnected, socket, gameId, joinGame]);

  useEffect(() => {
    if (!isConnected || !socket || !gameId) return;

    console.log('Setting up WebSocket subscription in Game page for game:', gameId);
    const unsubscribe = subscribeToMessage('GAME_UPDATE', (data) => {
      try {
        console.log('Received game update:', data);
        if (data.gameId === gameId) {
          queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    return () => {
      console.log('Cleaning up WebSocket subscription in Game page');
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [socket, isConnected, gameId, subscribeToMessage, queryClient]);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Error Loading Game</h1>
          <p className="text-muted-foreground mb-4">{error?.message || "Failed to load game data"}</p>
          <Link href="/">
            <Button>Return to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleStatusUpdate = (newStatus: 'active' | 'completed' | 'cancelled') => {
    updateGameStatus.mutate({ status: newStatus });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href={backLink}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{game?.name}</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className={`rounded-full px-3 py-1 text-sm font-medium ${
              getGameStatusColor(game.status)
            }`}>
              {getGameStatusText(game.status)}
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                {game.status === 'pending' && (
                  <>
                    <Button
                      onClick={() => handleStatusUpdate('active')}
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
                      onClick={() => handleStatusUpdate('cancelled')}
                      disabled={updateGameStatus.isPending}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </>
                )}
                {game.status === 'active' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleStatusUpdate('completed')}
                    disabled={updateGameStatus.isPending}
                  >
                    {updateGameStatus.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>End Game</>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="order-2 md:order-1">
          <div className="h-[600px] w-full rounded-lg overflow-hidden border">
            <MapView game={game} />
          </div>
        </div>

        <div className="order-1 md:order-2 space-y-4">
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

          {isAdmin && game.status === 'pending' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Assign Teams</CardTitle>
              </CardHeader>
              <CardContent>
                <SelectTeam gameId={game.id} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Teams
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {game.participants && game.participants.length > 0 ? (
                  game.participants.map((participant) => (
                    <TeamCard
                      key={participant.id}
                      gameId={game.id}
                      participant={participant}
                      canAssignPosition={isAdmin && game.status === 'pending'}
                      showMembers={true}
                      showLocation={game.status === 'active'}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No teams have joined yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}