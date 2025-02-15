import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface ThemeConfig {
  primary: string;
  variant: "professional" | "tint" | "vibrant";
  appearance: "light" | "dark" | "system";
  radius: number;
}

export function useTheme() {
  const queryClient = useQueryClient();

  const { data: theme } = useQuery<ThemeConfig>({
    queryKey: ["/api/theme"],
    queryFn: async () => {
      const response = await fetch("/api/theme", {
        credentials: "include"
      });
      if (!response.ok) throw new Error("Failed to fetch theme");
      return response.json();
    }
  });

  const updateTheme = useMutation({
    mutationFn: async (newTheme: ThemeConfig) => {
      const response = await fetch("/api/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTheme),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update theme");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/theme"] });
      window.location.reload(); // Reload to apply new theme
    }
  });

  useEffect(() => {
    if (theme) {
      document.documentElement.style.setProperty('--radius', `${theme.radius}rem`);
      document.documentElement.style.setProperty('--primary', theme.primary);
      document.documentElement.setAttribute('data-theme', theme.variant);
      
      if (theme.appearance === 'system') {
        document.documentElement.removeAttribute('data-theme-appearance');
      } else {
        document.documentElement.setAttribute('data-theme-appearance', theme.appearance);
      }
    }
  }, [theme]);

  return {
    theme,
    updateTheme
  };
}
