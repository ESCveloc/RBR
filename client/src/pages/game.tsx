import { useEffect } from "react";
import { useRoute } from "wouter";
import { useGame } from "@/hooks/use-game";
import { useWebSocket } from "@/hooks/use-websocket";
import { MapView } from "@/components/game/map-view";
import { TeamCard } from "@/components/game/team-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function Game() {
  const [, params] = useRoute<{ id: string }>("/game/:id");
  const gameId = parseInt(params?.id || "0");
  const { game, isLoading, updateLocation } = useGame(gameId);
  const { sendMessage } = useWebSocket(gameId);
  const { toast } = useToast();

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

    // Update location based on game boundaries center
    updateLocation.mutate({
      latitude: center.lat,
      longitude: center.lng,
      accuracy: 0,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    });
  }, [game?.boundaries]);

  if (isLoading || !game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {game.status === "active" ? "In Progress" : "Starting Soon"}
            </span>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="order-2 md:order-1">
          <MapView game={game} />
        </div>

        <div className="order-1 md:order-2 space-y-4">
          <Card>
            <CardContent className="p-4">
              <h2 className="text-lg font-semibold mb-4">Teams</h2>
              <div className="space-y-4">
                {game.participants?.map((participant) => (
                  <TeamCard
                    key={participant.id}
                    participant={participant}
                    startingLocation={participant.startingLocation}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}