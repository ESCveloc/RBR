import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InsertUser, User } from "@db/schema";

type RequestResult = {
  ok: true;
} | {
  ok: false;
  message: string;
};

async function handleRequest(
  url: string,
  method: string,
  body?: InsertUser
): Promise<RequestResult> {
  try {
    console.log(`[Auth] Making ${method} request to ${url}`);
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    if (!response.ok) {
      console.error(`[Auth] Request failed with status ${response.status}`);
      if (response.status >= 500) {
        return { ok: false, message: response.statusText };
      }

      const message = await response.text();
      console.error(`[Auth] Error message:`, message);
      return { ok: false, message };
    }

    console.log(`[Auth] Request succeeded`);
    return { ok: true };
  } catch (e: any) {
    console.error(`[Auth] Request error:`, e);
    return { ok: false, message: e.toString() };
  }
}

async function fetchUser(): Promise<User | null> {
  console.log('[Auth] Fetching user data');
  const response = await fetch("/api/user", {
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401) {
      console.log('[Auth] User not authenticated');
      return null;
    }
    console.error('[Auth] Error fetching user:', response.status);
    throw new Error(`${response.status}: ${await response.text()}`);
  }

  const userData = await response.json();
  console.log('[Auth] User data received:', { ...userData, password: '[REDACTED]' });
  return userData;
}

export function useUser() {
  const queryClient = useQueryClient();

  const { data: user, error, isLoading } = useQuery<User | null>({
    queryKey: ["user"],
    queryFn: fetchUser,
    staleTime: Infinity,
    retry: false,
  });

  console.log('[Auth] Current user state:', { 
    user: user ? { ...user, password: '[REDACTED]' } : null, 
    isLoading, 
    error 
  });

  const loginMutation = useMutation({
    mutationFn: (userData: InsertUser) =>
      handleRequest("/api/login", "POST", userData),
    onSuccess: () => {
      console.log('[Auth] Login successful, invalidating user query');
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => handleRequest("/api/logout", "POST"),
    onSuccess: () => {
      console.log('[Auth] Logout successful, invalidating user query');
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: (userData: InsertUser) =>
      handleRequest("/api/register", "POST", userData),
    onSuccess: () => {
      console.log('[Auth] Registration successful, invalidating user query');
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });

  return {
    user,
    isLoading,
    error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    register: registerMutation.mutateAsync,
  };
}