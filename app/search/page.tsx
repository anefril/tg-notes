"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useApi } from "@/hooks/use-api";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandSearch } from "@/components/search/command-search";
import { NoteCard } from "@/components/notes/note-card";
import { NoteDialog } from "@/components/notes/note-dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Loader2, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Note } from "@/types";

export default function SearchPage() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic request id — guards against out-of-order responses overwriting a
  // newer query's results (type "ab" then "abc"; the slow "ab" must not win).
  const reqIdRef = useRef(0);

  const doSearch = useCallback(async (q: string) => {
    if (!user || !q.trim()) {
      reqIdRef.current++; // invalidate any in-flight request
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/notes/search?q=${encodeURIComponent(q)}&limit=30`
      );
      if (myReq !== reqIdRef.current) return; // a newer search superseded this one
      if (res.ok) {
        const data = await res.json();
        setResults(data.notes || []);
        setSearched(true);
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [user, apiFetch]);

  // Live debounced search — fires 300ms after user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileNav />
      <CommandSearch onNavigate={(id) => router.push(`/notes/${id}`)} />
      <main className="md:pl-[var(--sidebar-w)] transition-[padding] duration-300">
        <div className="md:hidden h-14" />
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6 md:pt-16">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Search className="h-6 w-6" />
              Search
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Search text, tags and keywords
            </p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Start typing..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 pr-10"
              autoFocus
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          <p className="text-xs text-muted-foreground -mt-2">
            Tip: press Ctrl+K to search from any page
          </p>

          {loading && results.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : searched && results.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-3">
                <FileText className="h-10 w-10 text-muted-foreground/50 mx-auto" />
                <p className="text-muted-foreground text-sm">
                  Nothing found for &quot;{query}&quot;
                </p>
              </CardContent>
            </Card>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Found: {results.length}</p>
              <div className="columns-1 md:columns-2 gap-3">
                {results.map((note) => (
                  <div key={note.id} className="mb-3 break-inside-avoid">
                    <NoteCard note={note} onClick={(id) => setOpenNoteId(id)} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </main>
      <NoteDialog noteId={openNoteId} onClose={() => setOpenNoteId(null)} onChanged={() => doSearch(query)} />
    </div>
  );
}
