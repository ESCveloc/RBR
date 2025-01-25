import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Home from "@/pages/home";
import Game from "@/pages/game";
import Admin from "@/pages/admin";
import Profile from "@/pages/profile";
import { useUser } from "@/hooks/use-user";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

function Router() {
  const { user, isLoading } = useUser();
  const [location, setLocation] = useLocation();

  // Redirect admin users to admin dashboard by default if they're on the home page
  useEffect(() => {
    if (user?.role === "admin" && location === "/") {
      setLocation("/admin");
    }
  }, [user, location, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show auth page if user is not logged in
  if (!user) {
    return <AuthPage />;
  }

  // Protected routes for authenticated users
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/game/:id" component={Game} />
      <Route path="/profile" component={Profile} />
      {user.role === "admin" && <Route path="/admin" component={Admin} />}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;