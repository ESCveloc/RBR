import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users, Trophy, ActivitySquare, Loader2, Edit2, Save } from "lucide-react";
import { useTeams } from "@/hooks/use-teams";
import { TeamMembersCard } from "@/components/game/team-members-card";
import { useUser } from "@/hooks/use-user";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function TeamManagement() {
  const [match, params] = useRoute<{ id: string }>("/team/:id");
  const { toast } = useToast();
  const { teams, isLoading } = useTeams();
  const { user } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState("");
  const queryClient = useQueryClient();

  // Debug logging
  useEffect(() => {
    console.log('TeamManagement Debug:', {
      match,
      params,
      teamsLength: teams?.length,
      teams
    });
  }, [match, params, teams]);

  const updateTeam = useMutation({
    mutationFn: async (newDescription: string) => {
      const response = await fetch(`/api/teams/${params?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newDescription }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Team description updated successfully",
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Find the current team
  const team = teams?.find(t => t.id === parseInt(params?.id || "0"));
  const isCaptain = team?.captainId === user?.id;

  // Set initial description when team data is loaded
  useEffect(() => {
    if (team?.description) {
      setDescription(team.description);
    }
  }, [team?.description]);

  if (!match || !team) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Team Not Found</h1>
          <Link href="/?view=player">
            <Button>Return to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    await updateTeam.mutate(description);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/?view=player">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">{team.name}</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 grid gap-8 md:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          {/* Team Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Team Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Wins</p>
                <p className="text-2xl font-bold">{team.wins || 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Losses</p>
                <p className="text-2xl font-bold">{team.losses || 0}</p>
              </div>
            </CardContent>
          </Card>

          {/* Team Description */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <ActivitySquare className="h-5 w-5" />
                  About Team
                </CardTitle>
                {isCaptain && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isEditing) {
                        handleSave();
                      } else {
                        setIsEditing(true);
                      }
                    }}
                    disabled={updateTeam.isPending}
                  >
                    {updateTeam.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : isEditing ? (
                      <Save className="h-4 w-4 mr-2" />
                    ) : (
                      <Edit2 className="h-4 w-4 mr-2" />
                    )}
                    {isEditing ? "Save" : "Edit"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter team description..."
                  className="min-h-[100px]"
                />
              ) : (
                <p className="text-muted-foreground">
                  {team.description || "No team description available."}
                </p>
              )}
              {team.tags && team.tags.length > 0 && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  {team.tags.map((tag) => (
                    <span key={tag} className="px-2 py-1 bg-primary/10 rounded-full text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Team Members */}
        <div className="space-y-4">
          <TeamMembersCard 
            teamId={team.id} 
            captainId={team.captainId}
            isCaptain={isCaptain}
          />
        </div>
      </main>
    </div>
  );
}