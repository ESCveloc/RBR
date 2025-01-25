import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { MapView } from "@/components/game/map-view";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { insertGameSchema } from "@db/schema";
import { Loader2, Plus } from "lucide-react";
import type { Game } from "@db/schema";

const formSchema = insertGameSchema.pick({
  name: true,
  boundaries: true,
});

export default function Admin() {
  const [selectedArea, setSelectedArea] = useState<GeoJSON.Feature | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: games, isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      boundaries: null,
    },
  });

  const createGame = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      form.reset();
      setSelectedArea(null);
      toast({
        title: "Success",
        description: "Game created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!selectedArea) {
      toast({
        title: "Error",
        description: "Please select a game area on the map",
        variant: "destructive",
      });
      return;
    }

    await createGame.mutateAsync({
      ...values,
      boundaries: selectedArea,
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      <div className="grid gap-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create New Game</CardTitle>
            <CardDescription>Set up a new battle royale game</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
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

                <div className="h-[300px] rounded-lg overflow-hidden border">
                  <MapView
                    mode="draw"
                    onAreaSelect={setSelectedArea}
                    selectedArea={selectedArea}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  <Plus className="h-4 w-4 mr-2" />
                  Create Game
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Games</CardTitle>
            <CardDescription>Manage ongoing games</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {games?.map((game) => (
                <Card key={game.id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold">{game.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {game.status}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() =>
                          window.location.assign(`/game/${game.id}`)
                        }
                      >
                        View
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
