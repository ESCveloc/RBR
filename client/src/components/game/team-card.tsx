import { useState } from "react";
import type { Team, User } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, ChevronDown, ChevronUp } from "lucide-react";
import { TeamMembersCard } from "./team-members-card";
import { useUser } from "@/hooks/use-user";
import { useQuery } from "@tanstack/react-query";

interface TeamCardProps {
  team: Team & { members?: Array<User> };
  status?: "alive" | "eliminated";
}

export function TeamCard({ team, status }: TeamCardProps) {
  const [showMembers, setShowMembers] = useState(false);
  const { user } = useUser();
  const isCaptain = user?.id === team.captainId;

  const { data: members = [] } = useQuery<User[]>({
    queryKey: [`/api/teams/${team.id}/members`],
    enabled: true, // Always fetch members to show accurate count
  });

  return (
    <Card
      className={`
        ${status === "eliminated" ? "opacity-50" : ""}
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
                  status === "eliminated"
                    ? "bg-destructive"
                    : "bg-primary"
                }
              `}
            >
              <Users className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold">{team.name}</h3>
              <p className="text-sm text-muted-foreground">
                {status
                  ? status.charAt(0).toUpperCase() + status.slice(1)
                  : `${members.length} members`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMembers(!showMembers)}
          >
            {showMembers ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {showMembers && (
          <div className="mt-4">
            <TeamMembersCard 
              teamId={team.id} 
              captainId={team.captainId} 
              isCaptain={isCaptain}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}