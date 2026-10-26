"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, FileText, Loader2 } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import type { Note } from "@/types";
import { truncate, stripHtml } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";

interface CommandSearchProps {
  onNavigate: (noteId: string) => void;
}

export function CommandSearch({ onNavigate }: CommandSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const { apiFetch } = useApi();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(
          `/api/notes/search?q=${encodeURIComponent(q)}&limit=10`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.notes || []);
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput
        placeholder="Search notes..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : query ? (
            "Nothing found"
          ) : (
            "Start typing to search"
          )}
        </CommandEmpty>
        {results.length > 0 && (
          <CommandGroup heading="Notes">
            {results.map((note) => (
              <CommandItem
                key={note.id}
                value={note.id}
                onSelect={() => {
                  onNavigate(note.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{truncate(stripHtml(note.text), 80)}</p>
                  <div className="flex gap-1 mt-1">
                    {note.ai_keywords?.slice(0, 3).map((kw) => (
                      <Badge key={kw} variant="secondary" className="text-[10px] px-1 py-0">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
