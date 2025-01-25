import type { Team } from "@db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";

interface TeamCardProps {
  team: Team & { members?: Array<any> };
  status?: "alive" | "eliminated";
}

export function TeamCard({ team, status }: TeamCardProps) {
  return (
    <Card
      className={`
        ${status === "eliminated" ? "opacity-50" : ""}
        hover:bg-accent transition-colors
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
                  : `${team.members?.length || 0} members`}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}