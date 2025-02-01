import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useGame } from "@/hooks/use-game";
import { MapView } from "@/components/game/map-view";
import { TeamCard } from "@/components/game/team-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Play, X, Users } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SelectTeam } from "@/components/game/select-team";

export default function Game() {
  const [match, params] = useRoute<{ id: string }>("/game/:id");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Only set gameId if we have a match and valid ID
  const gameId = match && params?.id ? parseInt(params.id) : undefined;
  const { game, isLoading, error } = useGame(gameId!);

  // Simple admin check
  const isAdmin = user?.role === 'admin';

  // Get the back link based on user role
  const backLink = isAdmin ? "/admin" : "/";

  // Debug logging
  useEffect(() => {
    console.log('Game Component Debug:', {
      user,
      isAdmin,
      gameStatus: game?.status,
      gameId,
      game,
      error
    });
  }, [user, isAdmin, game, gameId, error]);

  const updateGameStatus = useMutation({
    mutationFn: async ({ status }: { status: 'active' | 'completed' | 'cancelled' }) => {
      if (!gameId) {
        throw new Error('No game ID provided');
      }

      console.log('Updating game status:', { gameId, status });

      const response = await fetch(`/api/games/${gameId}/status`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ status }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to update game status");
      }

      const data = await response.json();
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      toast({
        title: "Success",
        description: "Game status updated successfully",
      });
    },
    onError: (error: Error) => {
      console.error('Error updating game status:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Handle invalid route match
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
    console.log('Attempting to update status:', { newStatus, currentStatus: game.status });
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

          {/* Right side - Status and controls */}
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-purple-500/15 px-3 py-1 text-sm font-medium text-purple-700">
              {game.status === 'active' ? 'In Progress' :
               game.status === 'pending' ? 'Pending' :
               game.status === 'completed' ? 'Completed' :
               game.status === 'cancelled' ? 'Cancelled' : 'Unknown'}
            </div>

            {/* Admin controls */}
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
          {/* Increase height of map container */}
          <div className="h-[600px] w-full rounded-lg overflow-hidden border">
            <MapView game={game} />
          </div>
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

          {/* Teams List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Teams
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {game.participants && game.participants.length > 0 ? (
                game.participants.map((participant) => (
                  <TeamCard
                    key={participant.id}
                    gameId={game.id}
                    participant={{
                      ...participant,
                      team: participant.team || undefined
                    }}
                    canAssignPosition={isAdmin && game.status === 'pending'}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No teams have joined yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}