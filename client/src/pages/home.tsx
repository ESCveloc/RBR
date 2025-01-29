import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { TeamCard } from "@/components/game/team-card";
import { ProfileCard } from "@/components/user/profile-card";
import { CreateTeamDialog } from "@/components/game/create-team-dialog";
import { OctagonsBackground } from "@/components/game/octagons-background";
import { useUser } from "@/hooks/use-user";
import type { Game, Team } from "@db/schema";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { user, logout } = useUser();

  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const handleLogout = async () => {
    await logout();
  };

  if (gamesLoading || teamsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
          <Button onClick={handleLogout} variant="outline">
            Logout
          </Button>
        </header>

        <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
          <div className="space-y-8">
            <section>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-semibold">Active Games</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {games?.map((game) => (
                  <Link key={game.id} href={`/game/${game.id}`}>
                    <Card className="hover:bg-accent/80 transition-colors cursor-pointer backdrop-blur-sm bg-background/80">
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
                <CreateTeamDialog />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {teams?.map((team) => (
                  <TeamCard key={team.id} team={team} />
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <ProfileCard />
          </div>
        </div>
      </div>
    </div>
  );
}