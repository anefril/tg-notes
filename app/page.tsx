"use client";

import { AppShell } from "@/components/layout/app-shell";

// Auth is handled globally by <AuthGate> (app/layout.tsx): this only renders
// once a user is signed in.
export default function Home() {
  return <AppShell />;
}
