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
import { Slider } from "@/components/ui/slider";
import { MapView } from "@/components/game/map-view";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { insertGameSchema } from "@db/schema";
import { Loader2, Trophy, Users, Settings, Plus } from "lucide-react";
import type { Game, User } from "@db/schema";
import type { Feature, Polygon } from "geojson";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Extend form schema to include zone configurations
const formSchema = insertGameSchema.extend({
  name: z.string().min(1, "Game name is required"),
  zoneConfigs: z.array(z.object({
    durationMinutes: z.number().min(5).max(60),
    radiusMultiplier: z.number().min(0.1).max(1),
  })).min(1),
}).pick({
  name: true,
  gameLengthMinutes: true,
  maxTeams: true,
  playersPerTeam: true,
  boundaries: true,
  zoneConfigs: true,
});

// Settings form schema
const settingsSchema = z.object({
  defaultCenter: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  defaultRadiusMiles: z.number().min(0.1).max(10),
  numberOfZones: z.number().min(2).max(10),
  zoneIntervalMinutes: z.number().min(5).max(60),
});

export default function Admin() {
  const [selectedArea, setSelectedArea] = useState<Feature<Polygon> | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Add settings query
  const { data: settings } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: async () => {
      const response = await fetch("/api/admin/settings", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch settings");
      return response.json();
    },
  });

  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  // Game creation form with zone configurations
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      boundaries: { type: "Feature", geometry: { type: "Polygon", coordinates: [[]] }, properties: {} },
      gameLengthMinutes: 60,
      maxTeams: 10,
      playersPerTeam: 4,
      zoneConfigs: [
        { durationMinutes: 15, radiusMultiplier: 0.75 },
        { durationMinutes: 10, radiusMultiplier: 0.5 },
        { durationMinutes: 5, radiusMultiplier: 0.25 },
      ],
    },
  });

  // Settings form
  const settingsForm = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      defaultCenter: {
        lat: 37.7749,
        lng: -122.4194,
      },
      defaultRadiusMiles: 1,
      numberOfZones: 3,
      zoneIntervalMinutes: 15,
    },
  });

  const updateSettings = async (values: z.infer<typeof settingsSchema>) => {
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      toast({
        title: "Success",
        description: "Settings updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const updateUserRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: "admin" | "user" }) => {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User role updated successfully",
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

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!selectedArea) {
      toast({
        title: "Error",
        description: "Please select a game area on the map",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          boundaries: selectedArea,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      form.reset();
      setSelectedArea(null);
      toast({
        title: "Success",
        description: "Game created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  if (gamesLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      <Tabs defaultValue="games" className="space-y-4">
        <TabsList>
          <TabsTrigger value="games" className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Games
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="games">
          <div className="grid gap-8 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Create New Game</CardTitle>
                <CardDescription>Set up a new battle royale game</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

                    <FormField
                      control={form.control}
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
                      control={form.control}
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
                      control={form.control}
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

                    <FormField
                      control={form.control}
                      name="zoneConfigs"
                      render={({ field }) => (
                        <FormItem className="space-y-4">
                          <FormLabel>Zone Configurations</FormLabel>
                          <div className="space-y-4">
                            {field.value.map((zone, index) => (
                              <Card key={index} className="p-4">
                                <CardHeader className="p-0 pb-4">
                                  <CardTitle className="text-lg">Zone {index + 1}</CardTitle>
                                </CardHeader>
                                <div className="grid gap-4">
                                  <div>
                                    <FormLabel>Duration (minutes)</FormLabel>
                                    <Slider
                                      min={5}
                                      max={60}
                                      step={5}
                                      value={[zone.durationMinutes]}
                                      onValueChange={([value]) => {
                                        const newConfigs = [...field.value];
                                        newConfigs[index].durationMinutes = value;
                                        field.onChange(newConfigs);
                                      }}
                                    />
                                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                      <span>{zone.durationMinutes} minutes</span>
                                      <span>60 minutes</span>
                                    </div>
                                  </div>
                                  <div>
                                    <FormLabel>Zone Size (% of previous)</FormLabel>
                                    <Slider
                                      min={10}
                                      max={100}
                                      step={5}
                                      value={[zone.radiusMultiplier * 100]}
                                      onValueChange={([value]) => {
                                        const newConfigs = [...field.value];
                                        newConfigs[index].radiusMultiplier = value / 100;
                                        field.onChange(newConfigs);
                                      }}
                                    />
                                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                      <span>{(zone.radiusMultiplier * 100).toFixed(0)}%</span>
                                      <span>100%</span>
                                    </div>
                                  </div>
                                </div>
                              </Card>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                field.onChange([
                                  ...field.value,
                                  { durationMinutes: 15, radiusMultiplier: 0.5 },
                                ]);
                              }}
                            >
                              Add Zone
                            </Button>
                          </div>
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
                          defaultCenter={settings?.defaultCenter}
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
                            <p className="text-sm text-muted-foreground">
                              Length: {game.gameLengthMinutes} minutes
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Teams: {game.maxTeams} (max {game.playersPerTeam} players each)
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => window.location.assign(`/game/${game.id}`)}
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
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage user roles and permissions</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>{user.role}</TableCell>
                      <TableCell>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateUserRole.mutate({
                              userId: user.id,
                              role: user.role === "admin" ? "user" : "admin",
                            })
                          }
                          disabled={updateUserRole.isPending}
                        >
                          {updateUserRole.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Toggle Admin
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Game Settings</CardTitle>
              <CardDescription>Configure default game settings</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...settingsForm}>
                <form onSubmit={settingsForm.handleSubmit(updateSettings)} className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={settingsForm.control}
                      name="defaultCenter.lat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Center Latitude</FormLabel>
                          <FormControl>
                            <Input type="number" step="any" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={settingsForm.control}
                      name="defaultCenter.lng"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Center Longitude</FormLabel>
                          <FormControl>
                            <Input type="number" step="any" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={settingsForm.control}
                    name="defaultRadiusMiles"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default Radius (miles)</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            <Slider
                              min={0.1}
                              max={10}
                              step={0.1}
                              value={[field.value]}
                              onValueChange={([value]) => field.onChange(value)}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{field.value.toFixed(1)} miles</span>
                              <span>10 miles</span>
                            </div>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={settingsForm.control}
                    name="numberOfZones"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Number of Zones</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            <Slider
                              min={2}
                              max={10}
                              step={1}
                              value={[field.value]}
                              onValueChange={([value]) => field.onChange(value)}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{field.value} zones</span>
                              <span>10 zones</span>
                            </div>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={settingsForm.control}
                    name="zoneIntervalMinutes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Zone Interval (minutes)</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            <Slider
                              min={5}
                              max={60}
                              step={5}
                              value={[field.value]}
                              onValueChange={([value]) => field.onChange(value)}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{field.value} minutes</span>
                              <span>60 minutes</span>
                            </div>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={settingsForm.formState.isSubmitting}
                  >
                    {settingsForm.formState.isSubmitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save Settings
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}