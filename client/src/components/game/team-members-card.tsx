import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";
import type { User } from "@db/schema";

interface TeamMembersCardProps {
  teamId: number;
}

export function TeamMembersCard({ teamId }: TeamMembersCardProps) {
  const { data: members, isLoading } = useQuery<User[]>({
    queryKey: [`/api/teams/${teamId}/members`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Team Members</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {members?.map((member) => (
            <div key={member.id} className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                {member.avatar && <AvatarImage src={member.avatar} />}
                <AvatarFallback className="bg-primary/10">
                  {member.username[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{member.firstName || member.username}</p>
                <p className="text-xs text-muted-foreground">{member.username}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
