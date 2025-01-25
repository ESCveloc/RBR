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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const profileSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  firstName: z.string().min(1, "First name is required"),
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().optional(),
  avatar: z.string().optional(),
  preferredPlayTimes: z.array(z.string())
});

const PLAY_TIME_OPTIONS = [
  "Morning (6AM-12PM)",
  "Afternoon (12PM-5PM)",
  "Evening (5PM-10PM)",
  "Night (10PM-6AM)"
] as const;

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    mutationFn: async (data: ProfileFormValues) => {
      const response = await fetch("/api/user/profile", {
        method: "PUT",
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
      queryClient.invalidateQueries({ queryKey: ["user"] });
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      form.reset({ 
        username: form.getValues("username"),
        firstName: form.getValues("firstName"),
        currentPassword: "",
        newPassword: "",
        avatar: form.getValues("avatar"),
        preferredPlayTimes: form.getValues("preferredPlayTimes")
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

  async function onSubmit(values: ProfileFormValues) {
    await updateProfile.mutateAsync(values);
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="container max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Profile Settings</CardTitle>
            <CardDescription>
              Update your account settings and customize your profile
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex justify-center">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={form.getValues("avatar")} />
                  <AvatarFallback className="bg-primary/10">
                    {user?.username?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <Button
                  size="icon"
                  variant="outline"
                  className="absolute bottom-0 right-0 rounded-full"
                  onClick={() => {
                    // TODO: Implement avatar upload
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

                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}