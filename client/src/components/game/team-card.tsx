import { useState } from "react";
import type { GameParticipant } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface TeamCardProps {
  gameId: number;
  participant: GameParticipant;
  canAssignPosition?: boolean;
}

export function TeamCard({ gameId, participant, canAssignPosition }: TeamCardProps) {
  const [isAssigning, setIsAssigning] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const assignPosition = useMutation({
    mutationFn: async (position: number) => {
      const response = await fetch(`/api/games/${gameId}/assign-starting-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: participant.teamId, position }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}`] });
      setIsAssigning(false);
      toast({
        title: "Position Assigned",
        description: "Starting position has been assigned successfully.",
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

  return (
    <Card
      className={`
        ${participant.status === "eliminated" ? "opacity-50" : ""}
        hover:bg-accent/50 transition-colors
      `}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`
                w-10 h-10 rounded-full flex items-center justify-center
                ${
                  participant.status === "eliminated"
                    ? "bg-destructive"
                    : "bg-primary"
                }
              `}
            >
              <Users className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold">Team {participant.teamId}</h3>
              <p className="text-sm text-muted-foreground">
                {participant.status === "eliminated" ? "Eliminated" : "Active"}
                {participant.startingLocation && 
                  ` - Position ${participant.startingLocation.position}`}
              </p>
            </div>
          </div>

          {canAssignPosition && !participant.startingLocation && (
            <div className="flex items-center gap-2">
              {isAssigning ? (
                <>
                  <Select
                    onValueChange={(value) => {
                      assignPosition.mutate(parseInt(value));
                    }}
                    disabled={assignPosition.isPending}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Position" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((position) => (
                        <SelectItem key={position} value={position.toString()}>
                          Position {position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAssigning(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAssigning(true)}
                >
                  Assign Position
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}