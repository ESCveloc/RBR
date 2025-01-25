import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TeamCard } from "@/components/game/team-card";
import { useUser } from "@/hooks/use-user";
import type { Game, Team } from "@db/schema";

export default function Home() {
  const { user } = useUser();
  
  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  if (gamesLoading || teamsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
            Battle Royale
          </h1>
          <p className="text-muted-foreground">Welcome back, {user?.username}</p>
        </div>
        {user?.role === "admin" && (
          <Link href="/admin">
            <Button>Admin Dashboard</Button>
          </Link>
        )}
      </header>

      <div className="grid gap-8">
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold">Active Games</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {games?.map((game) => (
              <Link key={game.id} href={`/game/${game.id}`}>
                <Card className="hover:bg-accent transition-colors cursor-pointer">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-primary" />
                      {game.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {game.status === "active" ? "In Progress" : "Starting Soon"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {game.participants?.length || 0} teams participating
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold">Your Teams</h2>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Team
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {teams?.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
