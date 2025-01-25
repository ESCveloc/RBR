import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Crown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@db/schema";
import { InviteMemberDialog } from "./invite-member-dialog";

interface TeamMembersCardProps {
  teamId: number;
  captainId?: number;
  isCaptain?: boolean;
}

export function TeamMembersCard({ teamId, captainId, isCaptain }: TeamMembersCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useQuery<User[]>({
    queryKey: [`/api/teams/${teamId}/members`],
  });

  const updateCaptain = useMutation({
    mutationFn: async (newCaptainId: number) => {
      const response = await fetch(`/api/teams/${teamId}/captain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCaptainId }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${teamId}/members`] });
      toast({
        title: "Success",
        description: "Team captain updated successfully",
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Team Members</CardTitle>
        {isCaptain && <InviteMemberDialog teamId={teamId} />}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {members?.map((member) => (
            <div key={member.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
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
              <div className="flex items-center gap-2">
                {member.id === captainId ? (
                  <Crown className="h-4 w-4 text-yellow-500" />
                ) : (
                  isCaptain && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateCaptain.mutate(member.id)}
                      disabled={updateCaptain.isPending}
                    >
                      {updateCaptain.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Make Captain
                    </Button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}