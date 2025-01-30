import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { MapView } from "@/components/game/map-view";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Trophy, Users, Settings, Plus } from "lucide-react";
import type { Game } from "@db/schema";
import type { Feature, Polygon } from "geojson";
import { useUser } from "@/hooks/use-user";

const formSchema = z.object({
  name: z.string().min(1, "Game name is required"),
  gameLengthMinutes: z.number().min(10).max(180),
  maxTeams: z.number().min(2).max(50),
  playersPerTeam: z.number().min(1).max(10),
  boundaries: z.any().optional(),
});

export default function Admin() {
  const [selectedArea, setSelectedArea] = useState<Feature<Polygon> | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useUser();

  const createGame = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      if (!user) {
        throw new Error("You must be logged in to create a game");
      }

      if (!selectedArea) {
        throw new Error("Game boundaries must be drawn on the map");
      }

      // Include the selected area boundaries in the game creation request
      const gameData = {
        ...values,
        boundaries: selectedArea,
      };

      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gameData),
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to create game");
      }

      return response.json();
    },
    onSuccess: (game) => {
      toast({
        title: "Success",
        description: "Game created successfully",
      });

      // Reset form
      gameForm.reset();
      setSelectedArea(null);
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });

      // Redirect to the new game page
      setTimeout(() => {
        setLocation(`/game/${game.id}`);
      }, 0);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const gameForm = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      gameLengthMinutes: 60,
      maxTeams: 10,
      playersPerTeam: 4,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      if (!selectedArea) {
        toast({
          title: "Error",
          description: "Please draw game boundaries on the map",
          variant: "destructive",
        });
        return;
      }

      await createGame.mutateAsync({ ...values, boundaries: selectedArea });
    } catch (error) {
      console.error("Error in form submission:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create game",
        variant: "destructive",
      });
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">You must be logged in as an admin to view this page.</p>
          <Link href="/">
            <Button>Return to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Create New Game</CardTitle>
            <CardDescription>Set up a new battle royale game</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...gameForm}>
              <form onSubmit={gameForm.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={gameForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Game Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter game name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={gameForm.control}
                  name="gameLengthMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Game Length (minutes)</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Slider
                            min={10}
                            max={180}
                            step={5}
                            value={[field.value]}
                            onValueChange={([value]) => field.onChange(value)}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{field.value} minutes</span>
                            <span>3 hours</span>
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={gameForm.control}
                  name="maxTeams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Teams</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Slider
                            min={2}
                            max={50}
                            step={1}
                            value={[field.value]}
                            onValueChange={([value]) => field.onChange(value)}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{field.value} teams</span>
                            <span>50 teams</span>
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={gameForm.control}
                  name="playersPerTeam"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Players per Team</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Slider
                            min={1}
                            max={10}
                            step={1}
                            value={[field.value]}
                            onValueChange={([value]) => field.onChange(value)}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{field.value} players</span>
                            <span>10 players</span>
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div>
                  <FormLabel>Game Area</FormLabel>
                  <div className="h-[300px] rounded-lg overflow-hidden border mt-2">
                    <MapView
                      mode="draw"
                      onAreaSelect={setSelectedArea}
                      selectedArea={selectedArea}
                    />
                  </div>
                  {!selectedArea && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Draw a polygon or rectangle on the map to set the game boundaries
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createGame.isPending}
                >
                  {createGame.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Game
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}