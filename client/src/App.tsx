import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Home from "@/pages/home";
import Game from "@/pages/game";
import Admin from "@/pages/admin";
import Team from "@/pages/team";
import Profile from "@/pages/profile";
import { useUser } from "@/hooks/use-user";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

function ProtectedRoute({ component: Component, admin = false, ...rest }: any) {
  const { user, isLoading } = useUser();
  const [, setLocation] = useLocation();
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        setShouldRedirect(true);
      } else if (admin && user.role !== "admin") {
        setShouldRedirect(true);
      }
    }
  }, [user, isLoading, admin]);

  useEffect(() => {
    if (shouldRedirect) {
      if (!user) {
        setLocation("/auth");
      } else if (admin && user.role !== "admin") {
        setLocation("/");
      }
    }
  }, [shouldRedirect, user, admin, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (shouldRedirect) {
    return null;
  }

  return <Component {...rest} />;
}

function Router() {
  const { user, isLoading } = useUser();
  const [location] = useLocation();
  const [redirectPath, setRedirectPath] = useState<string | null>(null);
  const searchParams = new URLSearchParams(window.location.search);
  const viewAs = searchParams.get('view');

  useEffect(() => {
    if (!isLoading) {
      if (user && location === "/auth") {
        setRedirectPath(user.role === "admin" ? "/admin" : "/");
      } else if (user?.role === "admin" && location === "/" && viewAs !== "player") {
        setRedirectPath("/admin");
      }
    }
  }, [user, isLoading, location, viewAs]);

  useEffect(() => {
    if (redirectPath) {
      window.location.href = redirectPath;
    }
  }, [redirectPath]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
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
      <Route path="/team/:id">
        <ProtectedRoute component={Team} />
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