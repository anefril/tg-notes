"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Loader2, FileText, X } from "lucide-react";
import { cn, truncate, stripHtml } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";
import { NoteDialog } from "@/components/notes/note-dialog";
import type { Note } from "@/types";

// Google-Keep-style search bar: a wide pill centred at the top of the screen.
// Always visible (desktop), live-searches as you type, opens a result in the
// in-place note modal.
export function TopSearch() {
  const { apiFetch } = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/api/notes/search?q=${encodeURIComponent(q)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.notes || []);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  // Close the dropdown when clicking outside the bar.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const showDropdown = focused && query.trim().length > 0;

  return (
    <>
      <NoteDialog noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
      <div
        ref={wrapRef}
        // Centred over the content area (offset by half the sidebar width) so it
        // lines up with the centred "create note" box below it.
        className="fixed top-3 z-50 hidden w-[min(78vw,36rem)] -translate-x-1/2 md:block"
        style={{ left: "calc(50% + var(--sidebar-w) / 2)" }}
      >
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border bg-card/95 px-4 shadow-sm backdrop-blur transition-shadow",
            focused && "shadow-md"
          )}
          onClick={() => inputRef.current?.focus()}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search notes…"
            className="h-11 w-full bg-transparent text-sm outline-none"
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          {query && !loading && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setQuery("");
                setResults([]);
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent"
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showDropdown && (
          <div className="mt-2 overflow-hidden rounded-xl border bg-popover shadow-lg">
            {results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {loading ? "Searching…" : "Nothing found"}
              </div>
            ) : (
              results.map((n) => (
                <button
                  key={n.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setOpenNoteId(n.id);
                    setQuery("");
                    setResults([]);
                    setFocused(false);
                  }}
                  className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-2 text-sm leading-snug break-words">
                    {truncate(stripHtml(n.text), 100)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
