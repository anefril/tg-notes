"use client";

import { useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";

export function useApi() {
  const { accessToken } = useAuth();

  // Memoized so the function identity is stable across renders. Without this,
  // every component that puts `apiFetch` in a useEffect/useCallback dependency
  // list re-runs its effect on every render → an infinite refetch loop that
  // makes loading skeletons flicker on and off.
  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        ...((options.headers as Record<string, string>) || {}),
      };

      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }

      if (!headers["Content-Type"] && options.method && options.method !== "GET") {
        headers["Content-Type"] = "application/json";
      }

      return fetch(url, { ...options, headers });
    },
    [accessToken]
  );

  return { apiFetch, isAuthenticated: !!accessToken };
}
