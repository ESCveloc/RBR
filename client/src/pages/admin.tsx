import { useState, useEffect } from "react";
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
import { Loader2, Trophy, Users, Settings, Plus, Power, MoonIcon, SunIcon, Paintbrush, MapPin, Target } from "lucide-react";
import type { Game } from "@db/schema";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useTeams } from "@/hooks/use-teams";
import { useWebSocket } from '@/hooks/use-websocket';
import { getGameStatusColor, getGameStatusText } from "@/lib/game-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTheme } from "@/hooks/use-theme";

interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  createdAt: string;
}

interface AdminSettingsType {
  defaultCenter: {
    lat: number;
    lng: number;
  };
  defaultRadiusMiles: number;
  zoneConfigs: Array<{
    durationMinutes: number;
    radiusMultiplier: number;
    intervalMinutes: number;
  }>;
  theme: {
    primary: string;
    variant: "professional" | "tint" | "vibrant";
    appearance: "light" | "dark" | "system";
    radius: number;
  };
}

const themeSchema = z.object({
  primary: z.string(),
  variant: z.enum(["professional", "tint", "vibrant"]),
  appearance: z.enum(["light", "dark", "system"]),
  radius: z.number().min(0).max(2),
});

const settingsSchema = z.object({
  defaultCenter: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  defaultRadiusMiles: z.number().min(0.1).max(10),
  zoneConfigs: z.array(z.object({
    durationMinutes: z.number().min(5).max(60),
    radiusMultiplier: z.number().min(0.1).max(1),
    intervalMinutes: z.number().min(5).max(60),
  })).min(1),
  theme: themeSchema,
});

const formSchema = z.object({
  name: z.string().min(1, "Game name is required"),
  gameLengthMinutes: z.number().min(10).max(180),
  maxTeams: z.number().min(2).max(50),
  playersPerTeam: z.number().min(1).max(10),
  boundaries: z.any().optional(),
});


function generateDefaultBoundaries(center: { lat: number; lng: number }, radiusMiles: number) {
  const radiusMeters = radiusMiles * 1609.34;

  const points = [];
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * 2 * Math.PI;
    const dx = Math.cos(angle) * radiusMeters;
    const dy = Math.sin(angle) * radiusMeters;

    const latChange = dy / 111111;
    const lngChange = dx / (111111 * Math.cos(center.lat * Math.PI / 180));

    points.push([center.lng + lngChange, center.lat + latChange]);
  }
  points.push(points[0]);

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [points]
    },
    properties: {}
  } as Feature<Polygon>;
}

export default function Admin() {
  const [selectedArea, setSelectedArea] = useState<Feature<Polygon> | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user, logout } = useUser();
  const { teams, isLoading: teamsLoading } = useTeams();
  const { socket, isConnected, subscribeToMessage } = useWebSocket();
  const { theme, updateTheme } = useTheme();

  const createGame = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      if (!user) {
        throw new Error("You must be logged in to create a game");
      }

      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to create game");
      }

      return response.json();
    },
    onSuccess: (game) => {
      gameForm.reset();
      setSelectedArea(null);
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });

      toast({
        title: "Success",
        description: "Game created successfully",
      });

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

  const { data: settings } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: async () => {
      const response = await fetch("/api/admin/settings", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch settings");
      return response.json();
    }
  });

  useEffect(() => {
    if (!isConnected || !socket) return;

    console.log('Setting up WebSocket subscription in Admin');
    const unsubscribe = subscribeToMessage('GAME_UPDATE', (data) => {
      try {
        console.log('Received game update:', data);
        queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    return () => {
      console.log('Cleaning up WebSocket subscription in Admin');
      unsubscribe();
    };
  }, [socket, isConnected, subscribeToMessage, queryClient]);


  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    staleTime: 30000, 
    refetchInterval: false 
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const response = await fetch("/api/admin/users", {
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }
      return response.json();
    }
  });

  const gameForm = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      gameLengthMinutes: 60,
      maxTeams: 10,
      playersPerTeam: 4,
      boundaries: undefined,
    },
  });

  const settingsForm = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      defaultCenter: { lat: 0, lng: 0 },
      defaultRadiusMiles: 1,
      zoneConfigs: [{ durationMinutes: 15, radiusMultiplier: 0.5, intervalMinutes: 15 }],
      theme: {
        primary: "#007bff",
        variant: "professional",
        appearance: "system",
        radius: 1,
      },
    },
  });

  useEffect(() => {
    if (settings) {
      settingsForm.reset({
        defaultCenter: settings.defaultCenter,
        defaultRadiusMiles: settings.defaultRadiusMiles,
        zoneConfigs: settings.zoneConfigs,
        theme: settings.theme || {
          primary: "#007bff",
          variant: "professional",
          appearance: "system",
          radius: 1,
        },
      });
    }
  }, [settings, settingsForm]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      if (!settings) {
        toast({
          title: "Error",
          description: "Game settings not loaded. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const boundaries = generateDefaultBoundaries(
        settings.defaultCenter,
        settings.defaultRadiusMiles
      );

      const gameData = {
        ...values,
        boundaries
      };

      console.log("Creating game with data:", gameData);
      await createGame.mutateAsync(gameData);
    } catch (error) {
      console.error("Error in form submission:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create game",
        variant: "destructive",
      });
    }
  }

  const updateSettings = useMutation({
    mutationFn: async (values: z.infer<typeof settingsSchema>) => {
      console.log('Updating settings with values:', values);
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to update settings:', errorText);
        throw new Error(errorText || "Failed to update settings");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({
        title: "Success",
        description: "Settings updated successfully",
      });
    },
    onError: (error: Error) => {
      console.error('Settings update error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSettingsSubmit = async (data: z.infer<typeof settingsSchema>) => {
    try {
      console.log('Submitting settings:', data);
      const result = await updateSettings.mutateAsync(data);

      // Only update theme if server update was successful
      if (result?.settings?.theme) {
        updateTheme(result.settings.theme);
      }

      toast({
        title: "Success",
        description: "Settings updated successfully",
      });
    } catch (error) {
      console.error('Form submission error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update settings",
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

  if (gamesLoading || usersLoading || teamsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <div className="flex items-center gap-2">
          <Link href="/?view=player">
            <Button variant="outline" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Player Dashboard
            </Button>
          </Link>
          <Button
            variant="outline"
            className="flex items-center gap-2"
            onClick={async () => {
              try {
                await logout();
                setLocation('/auth');
              } catch (error) {
                toast({
                  title: "Error",
                  description: "Failed to logout. Please try again.",
                  variant: "destructive",
                });
              }
            }}
          >
            <Power className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>

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
          <TabsTrigger value="teams" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Teams
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
                          mode="view"
                          onAreaSelect={setSelectedArea}
                          selectedArea={selectedArea}
                          defaultCenter={settings?.defaultCenter}
                          defaultRadiusMiles={settings?.defaultRadiusMiles}
                        />
                      </div>
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
            <Card>
              <CardHeader>
                <CardTitle>Active Games</CardTitle>
                <CardDescription>Manage ongoing games</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {games?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No games available. Create a new game to get started.
                    </div>
                  ) : (
                    games?.filter(game => game.status === "pending" || game.status === "active")
                      .map((game) => (
                        <Card key={game.id}>
                          <CardContent className="p-4">
                            <div className="flex justify-between items-center">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold">{game.name}</h3>
                                  <Badge
                                    variant="secondary"
                                    className={cn(getGameStatusColor(game.status))}
                                  >
                                    {getGameStatusText(game.status)}
                                  </Badge>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm text-muted-foreground">
                                    Length: {game.gameLengthMinutes} minutes
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    Teams: {game.maxTeams} (max {game.playersPerTeam} players each)
                                  </p>
                                  {game.startTime && (
                                    <p className="text-sm text-muted-foreground">
                                      Starts: {new Date(game.startTime).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                onClick={() => setLocation(`/game/${game.id}`)}
                              >
                                View
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                  )}
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
                  {users?.map((user: User) => (
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

        <TabsContent value="teams">
          <Card>
            <CardHeader>
              <CardTitle>Team Management</CardTitle>
              <CardDescription>View and manage all teams</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Win/Loss</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams?.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell>{team.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={
                          team.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        }>
                          {team.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>{team.teamMembers?.length || 0} members</TableCell>
                      <TableCell>
                        {team.wins || 0}/{team.losses || 0}
                      </TableCell>
                      <TableCell>
                        {new Date(team.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.location.href = `/team/${team.id}`}
                        >
                          View Details
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
              <CardDescription>Configure game appearance and behavior</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...settingsForm}>
                <form
                  onSubmit={settingsForm.handleSubmit(onSettingsSubmit)}
                  className="space-y-6"
                >
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="theme">
                      <AccordionTrigger className="text-lg font-semibold">
                        <div className="flex items-center gap-2">
                          <Paintbrush className="h-4 w-4" />
                          Theme Settings
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pt-4">
                          <FormField
                            control={settingsForm.control}
                            name="theme.appearance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Appearance</FormLabel>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select appearance" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="light">
                                      <div className="flex items-center gap-2">
                                        <SunIcon className="h-4 w-4" />
                                        Light
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="dark">
                                      <div className="flex items-center gap-2">
                                        <MoonIcon className="h-4 w-4" />
                                        Dark
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="system">System</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={settingsForm.control}
                            name="theme.variant"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Color Variant</FormLabel>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select variant" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="professional">Professional</SelectItem>
                                    <SelectItem value="tint">Tint</SelectItem>
                                    <SelectItem value="vibrant">Vibrant</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={settingsForm.control}
                            name="theme.primary"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Primary Color</FormLabel>
                                <FormControl>
                                  <Input
                                    type="color"
                                    {...field}
                                    className="h-10 px-2 py-1"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={settingsForm.control}
                            name="theme.radius"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Border Radius</FormLabel>
                                <FormControl>
                                  <div className="space-y-2">
                                    <Slider
                                      min={0}
                                      max={2}
                                      step={0.1}
                                      value={[field.value]}
                                      onValueChange={([value]) => field.onChange(value)}
                                    />
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                      <span>Square</span>
                                      <span>Rounded</span>
                                    </div>
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="location">
                      <AccordionTrigger className="text-lg font-semibold">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          Location Settings
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pt-4">
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
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="zones">
                      <AccordionTrigger className="text-lg font-semibold">
                        <div className="flex items-center gap-2">
                          <Target className="h-4 w-4" />
                          Zone Configurations
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <FormField
                          control={settingsForm.control}
                          name="zoneConfigs"
                          render={({ field }) => (
                            <FormItem className="space-y-4 pt-4">
                              <FormLabel>Zone Configurations</FormLabel>
                              <div className="space-y-4">
                                {field.value.map((config, index) => (
                                  <Card key={index} className="p-4">
                                    <CardHeader className="p-0 pb-4">
                                      <div className="flex items-center justify-between">
                                        <CardTitle className="text-lg">Zone {index + 1}</CardTitle>
                                        {index > 0 && (
                                          <Button
                                            type="button"
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => {
                                              const newConfigs = [...field.value];
                                              newConfigs.splice(index, 1);
                                              field.onChange(newConfigs);
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        )}
                                      </div>
                                    </CardHeader>
                                    <div className="grid gap-4">
                                      <FormItem>
                                        <FormLabel>Duration (minutes)</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            min={5}
                                            max={60}
                                            value={config.durationMinutes}
                                            onChange={(e) => {
                                              const newValue = Number(e.targettarget.value);
                                              const newConfigs = [...field.value];
                                              newConfigs[index] = {
                                                ...config,
                                                durationMinutes: newValue
                                              };
                                              field.onChange(newConfigs);
                                            }}
                                          />
                                        </FormControl>
                                      </FormItem>
                                      <FormItem>
                                        <FormLabel>Radius Multiplier</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            min={0.1}
                                            max={1}
                                            step={0.1}
                                            value={config.radiusMultiplier}
                                            onChange={(e) => {
                                              const newValue = Number(e.target.value);
                                              const newConfigs = [...field.value];
                                              newConfigs[index] = {
                                                ...config,
                                                radiusMultiplier: newValue
                                              };
                                              field.onChange(newConfigs);
                                            }}
                                          />
                                        </FormControl>
                                      </FormItem>
                                      <FormItem>
                                        <FormLabel>Interval (minutes)</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            min={5}
                                            max={60}
                                            value={config.intervalMinutes}
                                            onChange={(e) => {
                                              const newValue = Number(e.target.value);
                                              const newConfigs = [...field.value];
                                              newConfigs[index] = {
                                                ...config,
                                                intervalMinutes: newValue
                                              };
                                              field.onChange(newConfigs);
                                            }}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    </div>
                                  </Card>
                                ))}
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    const newConfig = {
                                      durationMinutes: 15,
                                      radiusMultiplier: 0.5,
                                      intervalMinutes: 15
                                    };
                                    field.onChange([...field.value, newConfig]);
                                  }}
                                >
                                  Add Zone Configuration
                                </Button>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  <Button
                    type="submit"
                    className="w-full mt-4"
                    disabled={updateSettings.isPending}
                  >
                    {updateSettings.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Settings'
                    )}
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