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

function ProtectedRoute({ component: Component, admin = false, ...rest }: any) {
  const { user, isLoading } = useUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/auth");
    } else if (!isLoading && admin && user?.role !== "admin") {
      setLocation("/");
    }
  }, [user, isLoading, admin, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (admin && user.role !== "admin") {
    return null;
  }

  return <Component {...rest} />;
}

function Router() {
  const { user, isLoading } = useUser();
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const viewAs = searchParams.get('view');

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user is authenticated and tries to access auth page, redirect to appropriate page
  if (user && location === "/auth") {
    if (user.role === "admin") {
      setLocation("/admin");
    } else {
      setLocation("/");
    }
    return null;
  }

  // If admin user is at root and not explicitly viewing as player, redirect to admin page
  if (user?.role === "admin" && location === "/" && viewAs !== "player") {
    setLocation("/admin");
    return null;
  }

  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/">
        <ProtectedRoute component={Home} />
      </Route>
      <Route path="/game/:id">
        <ProtectedRoute component={Game} />
      </Route>
      <Route path="/profile">
        <ProtectedRoute component={Profile} />
      </Route>
      <Route path="/admin">
        <ProtectedRoute component={Admin} admin={true} />
      </Route>
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