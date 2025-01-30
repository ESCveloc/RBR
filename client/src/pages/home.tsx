import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { TeamCard } from "@/components/game/team-card";
import { ProfileCard } from "@/components/user/profile-card";
import { OctagonsBackground } from "@/components/game/octagons-background";
import { useUser } from "@/hooks/use-user";
import { useTeams } from "@/hooks/use-teams";
import type { Game } from "@db/schema";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { user, logout } = useUser();
  const { teams, isLoading: teamsLoading } = useTeams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const joinGameMutation = useMutation({
    mutationFn: async (payload: { gameId: number; teamId: number }) => {
      const response = await fetch(`/api/games/${payload.gameId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ teamId: payload.teamId }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({
        title: "Success",
        description: "Successfully joined the game!",
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

  const handleLogout = async () => {
    await logout();
  };

  const handleJoinGame = async (gameId: number, teamId: number) => {
    await joinGameMutation.mutate({ gameId, teamId });
  };

  if (gamesLoading || teamsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Filter to only show active and pending games
  const activeGames = games?.filter(game => 
    game.status === "active" || game.status === "pending"
  );

  // Get user's first active team
  const activeTeam = teams?.find(team => team.teams.active);

  return (
    <div className="relative min-h-screen bg-background">
      <OctagonsBackground />

      <div className="relative z-10 p-4 md:p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
              Battle Royale
            </h1>
            <p className="text-muted-foreground">Welcome back, {user?.username}</p>
          </div>
          <div className="flex gap-2">
            {user?.role === "admin" && (
              <Link href="/admin">
                <Button variant="outline">Admin Dashboard</Button>
              </Link>
            )}
            <Button onClick={handleLogout} variant="outline">
              Logout
            </Button>
          </div>
        </header>

        <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold">Active Games</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {activeGames?.length === 0 ? (
                <Card className="col-span-2 p-6">
                  <p className="text-center text-muted-foreground">
                    No active games available at the moment.
                  </p>
                </Card>
              ) : (
                activeGames?.map((game) => (
                  <Link key={`game-${game.id}`} href={`/game/${game.id}`}>
                    <Card className="hover:bg-accent/80 transition-colors cursor-pointer backdrop-blur-sm bg-background/80">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-primary" />
                            {game.name}
                          </div>
                          <Badge variant="secondary" className={
                            game.status === "active" 
                              ? "bg-green-500/10 text-green-500"
                              : "bg-yellow-500/10 text-yellow-500"
                          }>
                            {game.status === "active" ? "In Progress" : "Starting Soon"}
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          {game.participants?.length || 0} teams participating
                        </p>
                        {game.startTime && (
                          <p className="text-sm text-muted-foreground">
                            Started: {new Date(game.startTime).toLocaleString()}
                          </p>
                        )}
                      </CardContent>
                      {game.status === "pending" && activeTeam && (
                        <CardFooter>
                          <Button 
                            className="w-full"
                            onClick={(e) => {
                              e.preventDefault();
                              handleJoinGame(game.id, activeTeam.teams.id);
                            }}
                            disabled={joinGameMutation.isPending}
                          >
                            {joinGameMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Join Game
                          </Button>
                        </CardFooter>
                      )}
                    </Card>
                  </Link>
                ))
              )}
            </div>
          </section>

          <div className="space-y-4">
            <ProfileCard />

            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-semibold">Your Teams</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {teams?.map((team) => (
                    <TeamCard key={team.teams.id} team={team.teams} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}