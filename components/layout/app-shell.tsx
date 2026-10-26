"use client";

import { useEffect, useState, useCallback } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandSearch } from "@/components/search/command-search";
import { useAuth } from "@/contexts/auth-context";
import { useApi } from "@/hooks/use-api";
import { useRouter } from "next/navigation";
import { NoteCard } from "@/components/notes/note-card";
import { NoteDialog } from "@/components/notes/note-dialog";
import { NewNoteFab } from "@/components/notes/new-note-fab";
import { FileText, TrendingUp, Tag } from "lucide-react";
import type { Note } from "@/types";

export function AppShell() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileNav />
      <CommandSearch onNavigate={(noteId) => router.push(`/notes/${noteId}`)} />
      <main className="md:pl-[var(--sidebar-w)] transition-[padding] duration-300">
        <div className="md:hidden h-14" />
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
          <DashboardContent />
        </div>
      </main>
    </div>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"created_at" | "extracted_date">("created_at");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/notes?sort=${sort}&order=desc&limit=30`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (err) {
      console.error("Fetch notes error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, sort, apiFetch]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const uniqueKeywordCount = new Set(notes.flatMap((n) => n.ai_keywords || [])).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {user?.name || "Notes"}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {notes.length} notes
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: FileText, label: "Total", value: notes.length },
          { icon: Tag, label: "Tags", value: uniqueKeywordCount },
          { icon: TrendingUp, label: "Today", value: notes.filter(n => {
            const d = new Date(n.created_at);
            const today = new Date();
            return d.toDateString() === today.toDateString();
          }).length },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-3 space-y-1"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="h-3.5 w-3.5" />
              <span className="text-xs">{stat.label}</span>
            </div>
            <p className="text-xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort:</span>
        {(["created_at", "extracted_date"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              sort === s
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            {s === "created_at" ? "By date created" : "By extracted date"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto" />
          <p className="text-muted-foreground text-sm">No notes yet</p>
          <p className="text-muted-foreground/60 text-xs">
            Tap "+" at the bottom right to add one
          </p>
        </div>
      ) : (
        <div className="columns-[15rem] gap-4">
          {notes.map((note) => (
            <div key={note.id} className="mb-4 break-inside-avoid animate-note-in">
              <NoteCard note={note} onClick={(id) => setOpenNoteId(id)} />
            </div>
          ))}
        </div>
      )}

      <NoteDialog noteId={openNoteId} onClose={() => setOpenNoteId(null)} onChanged={fetchNotes} />
      <NewNoteFab onCreated={fetchNotes} />
    </div>
  );
}
