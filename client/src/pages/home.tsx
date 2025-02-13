import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Users, Plus, Download } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Home() {
  const { user, logout } = useUser();
  const { teams, isLoading: teamsLoading } = useTeams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    refetchInterval: 5000,
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

  const activeGames = games?.filter(game => 
    game.status === "active" || game.status === "pending"
  );

  const activeTeam = teams?.find(team => team.active);

  const isTeamParticipating = (game: Game) => {
    return game.participants?.some(participant => participant.teamId === activeTeam?.id);
  };

  return (
    <div className="relative min-h-screen bg-background/95 text-foreground">
      <OctagonsBackground />

      <div className="relative z-10 p-4 md:p-8">
        <header className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary/90 to-purple-400 bg-clip-text text-transparent">
                Battle Royale
              </h1>
              <p className="text-muted-foreground">Welcome back, {user?.username}</p>
            </div>
            <div className="flex gap-2">
              {user?.role === "admin" && (
                <Link href="/admin">
                  <Button variant="ghost" className="hover:bg-primary/10">
                    Admin Dashboard
                  </Button>
                </Link>
              )}
              <Button onClick={handleLogout} variant="ghost" className="hover:bg-destructive/10">
                Logout
              </Button>
            </div>
          </div>
        </header>

        <div className="grid gap-8 md:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-semibold">My Games</h2>
              <div className="flex gap-2">
                <Button variant="outline" className="hover:bg-primary/10">
                  <Plus className="h-4 w-4 mr-2" />
                  New Game
                </Button>
                <Button variant="outline" className="hover:bg-primary/10">
                  <Download className="h-4 w-4 mr-2" />
                  Download App
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="grid gap-4">
                {gamesLoading ? (
                  <Card className="p-8">
                    <div className="flex justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  </Card>
                ) : activeGames?.length === 0 ? (
                  <Card className="p-8">
                    <p className="text-center text-muted-foreground">
                      No active games available at the moment.
                    </p>
                  </Card>
                ) : (
                  activeGames?.map((game) => (
                    <Link key={`game-${game.id}`} href={`/game/${game.id}`}>
                      <Card className="hover:bg-primary/5 transition-all duration-200 cursor-pointer border-primary/20">
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Trophy className="h-5 w-5 text-primary" />
                              {game.name}
                            </div>
                            <Badge variant={game.status === "active" ? "default" : "secondary"}>
                              {game.status === "active" ? "Live" : "Starting Soon"}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span>
                              {game.participants?.length || 0} / {game.maxTeams} teams
                            </span>
                          </div>
                        </CardContent>
                        {game.status === "pending" && activeTeam && !isTeamParticipating(game) && (
                          <CardFooter>
                            <Button 
                              className="w-full"
                              onClick={(e) => {
                                e.preventDefault();
                                handleJoinGame(game.id, activeTeam.id);
                              }}
                              disabled={
                                joinGameMutation.isPending || 
                                ((game.participants?.length ?? 0) >= game.maxTeams && user?.role !== 'admin')
                              }
                            >
                              {joinGameMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : null}
                              {(game.participants?.length ?? 0) >= game.maxTeams && user?.role !== 'admin' 
                                ? "Game Full" 
                                : "Join Game"}
                            </Button>
                          </CardFooter>
                        )}
                        {game.status === "pending" && activeTeam && isTeamParticipating(game) && (
                          <CardFooter>
                            <Badge variant="outline" className="w-full flex justify-center py-2">
                              Team Registered
                            </Badge>
                          </CardFooter>
                        )}
                      </Card>
                    </Link>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-4">
            <ProfileCard />
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="text-xl">Your Teams</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-4">
                    {teams?.map((team) => (
                      <TeamCard 
                        key={team.id} 
                        team={{
                          ...team,
                          teamMembers: team.teamMembers.map(member => ({
                            ...member,
                            joinedAt: member.joinedAt.toISOString()
                          }))
                        }}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}