import { useUser } from "@/hooks/use-user";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Camera } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const PLAY_TIME_OPTIONS = [
  "Morning (6AM-12PM)",
  "Afternoon (12PM-5PM)",
  "Evening (5PM-10PM)",
  "Night (10PM-6AM)"
] as const;

const profileSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  firstName: z.string().min(1, "First name is required"),
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().optional(),
  avatar: z.string().optional(),
  preferredPlayTimes: z.array(z.string())
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export function ProfileCard() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: user?.username || "",
      firstName: user?.firstName || "",
      currentPassword: "",
      newPassword: "",
      avatar: user?.avatar || "",
      preferredPlayTimes: Array.isArray(user?.preferredPlayTimes) ? user.preferredPlayTimes : []
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const response = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  async function onSubmit(values: ProfileFormValues) {
    await updateProfile.mutateAsync(values);
  }

  if (!isEditing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {user?.avatar && <AvatarImage src={user.avatar} />}
              <AvatarFallback className="bg-primary/10">
                {user?.username?.[0]?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold">{user?.firstName || user?.username}</h3>
              <p className="text-sm text-muted-foreground">{user?.username}</p>
              {user?.preferredPlayTimes && (
                <p className="text-sm text-muted-foreground mt-1">
                  Plays: {(user.preferredPlayTimes as string[]).join(', ')}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => setIsEditing(true)}
          >
            Edit Profile
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Edit Profile</CardTitle>
        <CardDescription>
          Update your account settings and customize your profile
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <Avatar className="h-24 w-24">
              {user?.avatar && <AvatarImage src={user.avatar} />}
              <AvatarFallback className="bg-primary/10">
                {user?.username?.[0]?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <Button
              size="icon"
              variant="outline"
              className="absolute bottom-0 right-0 rounded-full"
              onClick={() => {
                toast({
                  title: "Coming Soon",
                  description: "Avatar upload functionality will be available soon!",
                });
              }}
            >
              <Camera className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preferredPlayTimes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred Play Times</FormLabel>
                  <FormControl>
                    <div className="space-y-2">
                      {PLAY_TIME_OPTIONS.map((time) => (
                        <div key={time} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={time}
                            checked={field.value.includes(time)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                field.onChange([...field.value, time]);
                              } else {
                                field.onChange(field.value.filter((t) => t !== time));
                              }
                            }}
                          />
                          <label htmlFor={time}>{time}</label>
                        </div>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password (Optional)</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}