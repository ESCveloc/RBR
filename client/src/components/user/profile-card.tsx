import { useUser } from "@/hooks/use-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { CreateTeamDialog } from "@/components/game/create-team-dialog";

export function ProfileCard() {
  const { user } = useUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Profile</CardTitle>
        <CardDescription>
          Your account information and preferences
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
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
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">Username</h4>
              <p className="text-sm text-muted-foreground">{user?.username}</p>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-1">First Name</h4>
              <p className="text-sm text-muted-foreground">{user?.firstName || 'Not set'}</p>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-1">Preferred Play Times</h4>
              {user?.preferredPlayTimes && user.preferredPlayTimes.length > 0 ? (
                <ul className="text-sm text-muted-foreground space-y-1">
                  {(user.preferredPlayTimes as string[]).map((time) => (
                    <li key={time}>{time}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No preferred times set</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Link href="/profile">
              <Button variant="outline" className="w-full">
                Edit Profile
              </Button>
            </Link>
            <CreateTeamDialog />
            {user?.role === "admin" && (
              <Link href="/admin">
                <Button className="w-full">Admin Dashboard</Button>
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}