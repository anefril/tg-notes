"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { LoginScreen } from "@/components/auth/login-screen";

// Routes that must stay reachable without a login (bot setup is run before any
// account exists).
const PUBLIC_PREFIXES = ["/setup", "/shared"];

// App-wide auth gate: until a session is restored, show a spinner; if there is
// no user, show the login screen instead of the app shell. This is what stops
// a fresh visitor from seeing the (empty) interface before signing in.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  if (pathname && PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-primary" />
          <span className="text-lg font-medium">Loading…</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return <>{children}</>;
}
