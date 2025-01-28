import { useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useEvent } from "@/hooks/use-event";
import { MapView } from "@/components/game/map-view";
import { TeamCard } from "@/components/game/team-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { Event, EventParticipant } from "@db/schema";

export default function Event() {
  const [, params] = useRoute<{ id: string }>("/event/:id");
  const [location] = useLocation();
  const eventId = parseInt(params?.id || "0");
  const isParticipant = !location.includes("/admin");
  const { event, isLoading } = useEvent(eventId, isParticipant);

  // Real-time updates temporarily disabled
  // useEffect(() => {
  //   if (!event?.boundaries || !isParticipant) return;
  //   const center = event.boundaries.center ?? {
  //     lat: event.boundaries.geometry.coordinates[0][0][1],
  //     lng: event.boundaries.geometry.coordinates[0][0][0],
  //   };
  //   const coordinates = {
  //     latitude: center.lat,
  //     longitude: center.lng,
  //     accuracy: 0,
  //     altitude: null,
  //     altitudeAccuracy: null,
  //     heading: null,
  //     speed: null,
  //     timestamp: Date.now()
  //   };
  //   updatePlayerLocation(coordinates);
  // }, [event?.boundaries, isParticipant]);

  if (isLoading || !event) {
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
            <Link href={isParticipant ? "/" : "/admin"}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{event.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {event.status === "active" ? "In Progress" : "Starting Soon"}
            </span>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="order-2 md:order-1">
          <MapView event={event} />
        </div>

        <div className="order-1 md:order-2 space-y-4">
          <Card>
            <CardContent className="p-4">
              <h2 className="text-lg font-semibold mb-4">Remaining Teams</h2>
              <div className="space-y-4">
                {event.participants?.map((participant: EventParticipant) => (
                  participant.team && (
                    <TeamCard
                      key={participant.id}
                      team={participant.team}
                      status={participant.status === "active" ? "alive" : "eliminated"}
                    />
                  )
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}