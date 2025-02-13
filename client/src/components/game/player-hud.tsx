import { useState, useEffect } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { Card } from "@/components/ui/card";
import { Timer, Users, Skull } from "lucide-react";
import type { Game, GameParticipant } from "@db/schema";
import { Progress } from "@/components/ui/progress";

interface PlayerHUDProps {
  game: Game;
  participant?: GameParticipant;
}

interface EliminationEvent {
  timestamp: Date;
  eliminatedTeam: string;
  eliminatedBy: string;
  reason: string;
}

export function PlayerHUD({ game, participant }: PlayerHUDProps) {
  const { subscribeToMessage } = useWebSocket();
  const [timeToShrink, setTimeToShrink] = useState<number | null>(null);
  const [eliminations, setEliminations] = useState<EliminationEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState(0);

  useEffect(() => {
    // Subscribe to zone shrink updates
    const unsubscribeZone = subscribeToMessage("ZONE_UPDATE", (payload) => {
      setTimeToShrink(payload.nextShrinkIn);
      setCurrentPhase(payload.currentPhase);
    });

    // Subscribe to elimination events
    const unsubscribeElim = subscribeToMessage("PLAYER_ELIMINATED", (payload) => {
      setEliminations(prev => [{
        timestamp: new Date(),
        eliminatedTeam: payload.eliminatedTeam,
        eliminatedBy: payload.eliminatedBy,
        reason: payload.reason
      }, ...prev.slice(0, 9)]); // Keep last 10 eliminations
    });

    return () => {
      unsubscribeZone();
      unsubscribeElim();
    };
  }, [subscribeToMessage]);

  return (
    <div className="fixed bottom-4 left-4 space-y-4 w-64">
      {/* Safe Zone Indicator */}
      <Card className="p-4 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
          <Timer className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Zone Status</h3>
        </div>
        <div className="space-y-2">
          <Progress 
            value={timeToShrink ? (timeToShrink / 300) * 100 : 100} 
            className="h-2"
          />
          <p className="text-xs">
            {timeToShrink 
              ? `Next shrink in ${Math.ceil(timeToShrink / 60)}m ${timeToShrink % 60}s`
              : "Waiting for game start"}
          </p>
          <p className="text-xs text-muted-foreground">
            Phase {currentPhase}/4
          </p>
        </div>
      </Card>

      {/* Team Tracking (if in squad mode) */}
      {participant?.team && (
        <Card className="p-4 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Team Status</h3>
          </div>
          <div className="space-y-1">
            {participant.team.teamMembers?.map((member) => (
              <div key={member.userId} className="flex items-center justify-between">
                <span className="text-xs truncate">{member.userId}</span>
                <span className="text-xs text-green-500">Alive</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Elimination Log */}
      <Card className="p-4 bg-background/80 backdrop-blur-sm max-h-48 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <Skull className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Elimination Log</h3>
        </div>
        <div className="space-y-2">
          {eliminations.map((elim, i) => (
            <div key={i} className="text-xs">
              <span className="text-muted-foreground">
                {new Date(elim.timestamp).toLocaleTimeString()} 
              </span>
              <p>
                {elim.eliminatedTeam} was eliminated by {elim.eliminatedBy}
                {elim.reason && ` (${elim.reason})`}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
