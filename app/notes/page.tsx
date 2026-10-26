"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { useApi } from "@/hooks/use-api";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandSearch } from "@/components/search/command-search";
import { NoteCard } from "@/components/notes/note-card";
import { NotesWall } from "@/components/notes/notes-wall";
import { NoteContextMenu } from "@/components/notes/note-context-menu";
import { NoteDialog } from "@/components/notes/note-dialog";
import { NewNoteBox } from "@/components/notes/new-note-box";
import { NewNoteFab } from "@/components/notes/new-note-fab";
import { FileText, ArrowUpDown, MoreVertical, Copy, Loader2, List, LayoutGrid, CheckSquare, Trash2, Filter, ChevronDown, GripVertical, BookOpen, Pin, Tag, Palette, Type, WifiOff, Download, Plus, Minus } from "lucide-react";
import { STICKY_COLORS } from "@/lib/sticky";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-provider";
import { cn } from "@/lib/utils";
import type { Note } from "@/types";

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch { /* the browser may block it without user interaction */ }
}

// List ⇄ wall switch — shared by the page header and the fullscreen wall overlay.
function ViewToggle({ view, onChange }: { view: "list" | "wall"; onChange: (v: "list" | "wall") => void }) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
      <button
        onClick={() => onChange("list")}
        title="List"
        className={cn(
          "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
          view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <List className="h-4 w-4" />
        <span className="hidden sm:inline">List</span>
      </button>
      <button
        onClick={() => onChange("wall")}
        title="Wall"
        className={cn(
          "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
          view === "wall" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="hidden sm:inline">Wall</span>
      </button>
    </div>
  );
}

// Compact tag-filter dropdown (shared by the list toolbar and the wall toolbar).
function TagFilter({
  tags,
  value,
  onChange,
  align = "start",
}: {
  tags: string[];
  value: string;
  onChange: (v: string) => void;
  align?: "start" | "center" | "end";
}) {
  if (tags.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title="Filter by tags"
          className={cn(
            "flex h-9 max-w-[12rem] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
            value
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-foreground hover:bg-accent"
          )}
        >
          <Filter className="h-4 w-4 shrink-0" />
          <span className="truncate">{value || "All tags"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-72 overflow-auto">
        <DropdownMenuCheckboxItem
          checked={!value}
          onCheckedChange={() => onChange("")}
          onSelect={(e) => e.preventDefault()}
        >
          All tags
        </DropdownMenuCheckboxItem>
        {tags.map((kw) => (
          <DropdownMenuCheckboxItem
            key={kw}
            checked={value === kw}
            onCheckedChange={() => onChange(value === kw ? "" : kw)}
            onSelect={(e) => e.preventDefault()}
          >
            {kw}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotesPageInner() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { apiFetch } = useApi();
  const { confirm, notify } = useConfirm();
  const isOnline = useOnlineStatus();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<"created_at" | "extracted_date">("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [deduping, setDeduping] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectAllMode, setSelectAllMode] = useState(false); // all notes (not just loaded) selected
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  // Optional client-side grouping of the (non-pinned) list by sticky colour.
  // Toggle button: on = grouped by colour, off = default date order.
  const [colorSort, setColorSort] = useState(false);

  useEffect(() => {
    setPinnedCollapsed(localStorage.getItem("tg_notes_pinned_collapsed") === "1");
    setColorSort(localStorage.getItem("tg_notes_color_sort") === "1");
  }, []);
  const togglePinnedCollapsed = () =>
    setPinnedCollapsed((c) => {
      localStorage.setItem("tg_notes_pinned_collapsed", c ? "0" : "1");
      return !c;
    });
  const toggleColorSort = () =>
    setColorSort((c) => {
      localStorage.setItem("tg_notes_color_sort", c ? "0" : "1");
      return !c;
    });

  // View is driven by the URL (?view=wall) so the sidebar "Notes" link (→ /notes)
  // always returns to the list, even from the fullscreen wall.
  const view: "list" | "wall" = searchParams.get("view") === "wall" ? "wall" : "list";

  const changeView = (v: "list" | "wall") => {
    router.replace(v === "wall" ? "/notes?view=wall" : "/notes");
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectAllMode(false);
  };

  // Signature of the last applied notes payload — lets the 15s poll skip the
  // state update (and the wall's full re-render) when nothing actually changed.
  const notesSigRef = useRef<string>("");
  // Previous TOTAL note count (server count, not page length) — used to detect
  // new notes during background polls regardless of how many pages are loaded.
  const prevCountRef = useRef<number>(-1);
  // How many notes are currently loaded (incl. "Load more" pages). The silent
  // poll re-fetches this many so it never collapses the list back to one page.
  const loadedCountRef = useRef<number>(0);
  // Timestamp of the last optimistic mutation — the silent poll is skipped for a
  // few seconds after it so it can't revert an edit mid-flight.
  const mutatedAt = useRef(0);

  const PAGE = 30;

  // `silent` skips the loading skeleton — used by background polling and
  // post-edit refreshes so the view doesn't flicker.
  // `fromPoll` is set only by the 15s background interval; it's the one path that
  // may announce "new note from the bot". Every other silent refresh is a user
  // action (create/import/edit) and must not trigger that toast.
  const fetchNotes = useCallback(async (silent = false, fromPoll = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      // A silent poll must refresh ALL loaded pages, not just the first 30, or it
      // would discard everything the user pulled in via "Load more".
      const limit = silent ? Math.max(PAGE, loadedCountRef.current) : PAGE;
      let url = `/api/notes?sort=${sort}&order=${order}&limit=${limit}`;
      if (tagFilter) url += `&tag=${encodeURIComponent(tagFilter)}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        const next = data.notes || [];
        const total = data.count ?? next.length;
        const sig = JSON.stringify(next);
        if (silent && Date.now() - mutatedAt.current < 3000) return;
        if (sig !== notesSigRef.current) {
          // Detect new arrivals by TOTAL count (works past the first page too).
          const prevCount = prevCountRef.current;
          prevCountRef.current = total;
          if (fromPoll && prevCount >= 0 && total > prevCount) {
            playNotificationSound();
            const added = total - prevCount;
            toast.success(added === 1 ? "New note from the bot" : `${added} new notes from the bot`);
          }
          notesSigRef.current = sig;
          loadedCountRef.current = next.length;
          setNotes(next);
          setTotalCount(total);
          setHasMore(total > next.length);
        }
      } else if (!silent) {
        toast.error("Couldn't load notes");
      }
    } catch (err) {
      console.error("Fetch notes error:", err);
      if (!silent) toast.error("Couldn't load notes");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, sort, order, tagFilter, apiFetch]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      let url = `/api/notes?sort=${sort}&order=${order}&limit=30&offset=${notes.length}`;
      if (tagFilter) url += `&tag=${encodeURIComponent(tagFilter)}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        const next: Note[] = data.notes || [];
        const existingIds = new Set(notes.map((n) => n.id));
        const fresh = next.filter((n) => !existingIds.has(n.id));
        const newLen = notes.length + fresh.length;
        loadedCountRef.current = newLen;
        notesSigRef.current = ""; // let the next poll re-sync the now-larger list
        setNotes((prev) => [...prev, ...fresh]);
        setTotalCount(data.count ?? 0);
        setHasMore((data.count ?? 0) > newLen);
      } else {
        toast.error("Couldn't load more notes");
      }
    } catch {
      toast.error("Couldn't load more notes");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, notes, sort, order, tagFilter, apiFetch]);

  const exportNotes = async (format: "json" | "markdown") => {
    // Export EVERYTHING, not just the loaded page — pull the full set first.
    let toExport: Note[] = notes;
    try {
      const res = await apiFetch(`/api/notes?sort=${sort}&order=${order}&limit=10000`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notes) && data.notes.length) toExport = data.notes;
      }
    } catch {
      /* fall back to the loaded notes */
    }
    let content: string;
    let filename: string;
    if (format === "json") {
      content = JSON.stringify(toExport, null, 2);
      filename = "tg-notes.json";
    } else {
      content = toExport
        .map((n) => {
          const date = n.created_at ? new Date(n.created_at).toLocaleDateString("en-US") : "";
          const tags = n.ai_keywords?.length ? `\nTags: ${n.ai_keywords.join(", ")}` : "";
          const text = (n.text || "").replace(/<[^>]+>/g, "");
          return `## ${date}\n\n${text}${tags}`;
        })
        .join("\n\n---\n\n");
      filename = "tg-notes.md";
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${toExport.length} notes`);
  };

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Auto-refresh: quietly pull new notes every 15s (e.g. sent from the bot)
  // without reloading the page.
  useEffect(() => {
    const t = setInterval(() => fetchNotes(true, true), 15000);
    return () => clearInterval(t);
  }, [fetchNotes]);

  const handleDedupe = async () => {
    if (deduping) return;
    const ok = await confirm({
      title: "Remove duplicates?",
      description: "We'll find identical notes and remove the repeats, keeping one of each.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setDeduping(true);
    try {
      const res = await apiFetch("/api/notes/dedupe", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        await notify({
          title: data.removed > 0 ? "Done" : "No duplicates found",
          description: data.removed > 0 ? `Duplicates removed: ${data.removed}` : undefined,
        });
        if (data.removed > 0) fetchNotes();
      }
    } catch (err) {
      console.error("Dedupe error:", err);
    } finally {
      setDeduping(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectAllMode(false);
    setShowBulkColors(false);
  };

  // Esc leaves selection mode (clears the list selection). Ignored while typing.
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      setSelectMode(false);
      setSelectedIds(new Set());
      setSelectAllMode(false);
      setShowBulkColors(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  // Set right after a marquee drag so the trailing click doesn't open a note.
  const suppressClick = useRef(false);
  const cardClick = (id: string) => {
    if (suppressClick.current) return;
    if (selectMode) toggleSelect(id);
    else setOpenNoteId(id); // Keep-style: open in place, no navigation
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0 && !selectAllMode) return;
    const deleteCount = selectAllMode ? totalCount : selectedIds.size;
    const ok = await confirm({
      title: `Move to trash?`,
      description: `${selectAllMode ? `All ${deleteCount} notes` : `The selected notes (${deleteCount})`} will be moved to the trash.`,
      confirmText: "Move to trash",
      destructive: true,
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      if (selectAllMode) {
        // Delete all matching notes server-side (with optional tag filter).
        await apiFetch("/api/notes/trash", {
          method: "POST",
          body: JSON.stringify({ deleteAll: true, tagFilter: tagFilter || undefined }),
        });
      } else {
        await Promise.all(
          Array.from(selectedIds).map((id) => apiFetch(`/api/notes/${id}`, { method: "DELETE" }))
        );
      }
      exitSelect();
      await fetchNotes(true);
    } catch (err) {
      console.error("Bulk delete error:", err);
    } finally {
      setBulkDeleting(false);
    }
  };

  const [bulkTag, setBulkTag] = useState("");

  // Bulk pin/unpin the current selection.
  const bulkSetPin = (value: boolean) => {
    const ids = Array.from(selectedIds);
    setNotes((prev) => prev.map((n) => (selectedIds.has(n.id) ? { ...n, pinned: value } : n)));
    ids.forEach((id) => patchNote(id, { pinned: value }));
  };

  // Bulk-recolour the current selection ("" = remove colour).
  const [showBulkColors, setShowBulkColors] = useState(false);
  const bulkSetColor = (color: string) => {
    const value = color || null;
    const ids = Array.from(selectedIds);
    setNotes((prev) => prev.map((n) => (selectedIds.has(n.id) ? { ...n, color: value } : n)));
    ids.forEach((id) => patchNote(id, { color: value }));
    setShowBulkColors(false);
  };

  // Bulk-add a tag to every selected note (merged, de-duplicated).
  const bulkApplyTag = () => {
    const tag = bulkTag.trim().toLowerCase();
    if (!tag) return;
    setBulkTag("");
    const ids = Array.from(selectedIds);
    ids.forEach((id) => {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      const kw = Array.from(new Set([...(n.ai_keywords || []), tag]));
      patchNote(id, { ai_keywords: kw });
    });
    setNotes((prev) =>
      prev.map((n) =>
        selectedIds.has(n.id) ? { ...n, ai_keywords: Array.from(new Set([...(n.ai_keywords || []), tag])) } : n
      )
    );
  };

  // Bulk-remove a tag from every selected note (only touches notes that have it).
  const bulkRemoveTag = () => {
    const tag = bulkTag.trim().toLowerCase();
    if (!tag) return;
    setBulkTag("");
    const ids = Array.from(selectedIds);
    ids.forEach((id) => {
      const n = notes.find((x) => x.id === id);
      if (!n || !(n.ai_keywords || []).includes(tag)) return;
      patchNote(id, { ai_keywords: (n.ai_keywords || []).filter((k) => k !== tag) });
    });
    setNotes((prev) =>
      prev.map((n) =>
        selectedIds.has(n.id) ? { ...n, ai_keywords: (n.ai_keywords || []).filter((k) => k !== tag) } : n
      )
    );
  };

  // --- Keep-style per-card quick actions (optimistic; the 15s poll reconciles) ---
  const patchNote = useCallback(
    (id: string, body: Record<string, unknown>) => {
      mutatedAt.current = Date.now();
      apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
    },
    [apiFetch]
  );

  const setNoteColor = (id: string, color: string) => {
    const value = color || null; // "" → "no color"
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, color: value } : n)));
    patchNote(id, { color: value });
  };

  const toggleNotePin = (id: string) => {
    const target = !(notes.find((n) => n.id === id)?.pinned ?? false);
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: target } : n)));
    patchNote(id, { pinned: target });
  };

  // Quick-add a single tag to a note from its card.
  const addNoteTag = (id: string, tag: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    const kw = Array.from(new Set([...(n.ai_keywords || []), tag]));
    setNotes((prev) => prev.map((x) => (x.id === id ? { ...x, ai_keywords: kw } : x)));
    patchNote(id, { ai_keywords: kw });
  };

  // Inline-rename a tag on a note from its card.
  const editNoteTag = (id: string, oldTag: string, newTag: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    const kw = n.ai_keywords?.map((k) => (k === oldTag ? newTag : k)).filter(Boolean) ?? [];
    setNotes((prev) => prev.map((x) => (x.id === id ? { ...x, ai_keywords: kw } : x)));
    patchNote(id, { ai_keywords: kw });
  };

  const deleteNote = async (id: string) => {
    const ok = await confirm({ title: "Delete this note?", confirmText: "Delete", destructive: true });
    if (!ok) return;
    mutatedAt.current = Date.now(); // block the silent poll from reviving the note mid-DELETE
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
  };

  // Stable handle to the latest resolveCollisions (assigned each render below) so
  // the memoized drag/resize handlers can call it without going stale.
  const resolveRef = useRef<(id: string) => void>(() => {});

  // --- Pinned-note resize: drag the right edge (width), bottom edge (height) or
  // corner (both). Reuses notes.width/height, so no extra columns are needed. ---
  const PIN_W_MIN = 200, PIN_W_MAX = 760, PIN_W_DEFAULT = 240;
  const PIN_H_MIN = 140, PIN_H_MAX = 900;
  const resizing = useRef<
    { id: string; startX: number; startY: number; startW: number; startH: number; axis: "x" | "y" | "both"; moved: boolean } | null
  >(null);

  const onResizeMove = useCallback((e: PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    r.moved = true;
    mutatedAt.current = Date.now();
    const patch: Partial<Note> = {};
    if (r.axis === "x" || r.axis === "both") {
      patch.width = Math.round(Math.max(PIN_W_MIN, Math.min(PIN_W_MAX, r.startW + (e.clientX - r.startX))));
    }
    if (r.axis === "y" || r.axis === "both") {
      patch.height = Math.round(Math.max(PIN_H_MIN, Math.min(PIN_H_MAX, r.startH + (e.clientY - r.startY))));
    }
    setNotes((prev) => prev.map((n) => (n.id === r.id ? { ...n, ...patch } : n)));
  }, []);

  const onResizeUp = useCallback((e: PointerEvent) => {
    const r = resizing.current;
    resizing.current = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeUp);
    if (!r || !r.moved) return; // a stray click (no drag) must not write defaults
    setNotes((prev) => {
      const n = prev.find((x) => x.id === r.id);
      if (n) {
        const body: Record<string, unknown> = {};
        if (r.axis !== "y") body.width = n.width ?? PIN_W_DEFAULT;
        if (r.axis !== "x") body.height = n.height ?? PIN_H_MIN;
        patchNote(r.id, body);
      }
      return prev;
    });
    // a bigger note pushes its neighbours apart to free space (Alt skips it).
    // Deferred so the resized card is committed at its new size first.
    if (!e.altKey) { const id = r.id; requestAnimationFrame(() => resolveRef.current(id)); }
  }, [onResizeMove, patchNote]);

  const startResize = (id: string, e: React.PointerEvent, axis: "x" | "y" | "both") => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = (e.currentTarget as HTMLElement).parentElement;
    const n = notes.find((x) => x.id === id);
    resizing.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startW: n?.width ?? wrap?.offsetWidth ?? PIN_W_DEFAULT,
      startH: n?.height ?? wrap?.offsetHeight ?? PIN_H_MIN,
      axis,
      moved: false,
    };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onResizeMove);
      window.removeEventListener("pointerup", onResizeUp);
    };
  }, [onResizeMove, onResizeUp]);

  // --- Free positioning of pinned notes (drag the grip to move anywhere; resize
  // by the edges). Position persists via list_x/list_y; size via width/height.
  // Gap-filling is optional — the "Arrange" button packs them on demand. ---
  // list_order doubles as the z-stack: higher = rendered later = painted ON TOP.
  // (nulls sort first / at the bottom).
  const pinSort = (a: Note, b: Note) => (a.list_order ?? -1) - (b.list_order ?? -1);
  // Rank a note by its sticky colour (palette order; no-colour last) — used by the
  // "By color" toggle to group the list. Sort is stable, so the existing
  // date order is preserved within each colour group.
  const colorRank = (n: Note) => {
    const i = STICKY_COLORS.findIndex((c) => c.key === n.color);
    return i >= 0 ? i : STICKY_COLORS.length;
  };
  const byId = useMemo(() => Object.fromEntries(notes.map((n) => [n.id, n] as const)), [notes]);
  const itemEls = useRef<Map<string, HTMLElement>>(new Map());

  const PIN_GAP = 16;
  const [pinnedW, setPinnedW] = useState(0);
  const [pinAreaH, setPinAreaH] = useState(0);
  const pinnedRoCleanup = useRef<(() => void) | null>(null);
  const setPinnedAreaRef = useCallback((el: HTMLDivElement | null) => {
    pinnedRoCleanup.current?.();
    pinnedRoCleanup.current = null;
    if (!el) return;
    const update = () => setPinnedW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    pinnedRoCleanup.current = () => ro.disconnect();
  }, []);

  // Rough height for packing notes that haven't been measured yet.
  const estimatePinH = (n: Note) => {
    const len = (n.text || "").replace(/<[^>]+>/g, "").length;
    let h = 96 + Math.ceil(len / 40) * 22;
    if (n.media_url) h += 160;
    return Math.min(560, Math.max(140, h));
  };

  type Box = { x: number; y: number; w: number; h: number };
  // Actual rendered box of a pinned note (absolute inside the pinned area, so
  // offsetLeft/Top = its x/y). Falls back to saved values before it's measured.
  const pinBox = (n: Note): Box => {
    const el = itemEls.current.get(n.id);
    if (el) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    return { x: n.list_x ?? PIN_GAP, y: n.list_y ?? PIN_GAP, w: n.width ?? PIN_W_DEFAULT, h: estimatePinH(n) };
  };

  // Skyline (bottom-left) bin-pack with ARBITRARY widths — places each note at
  // the candidate x (left edge or a placed note's right edge) with the lowest y
  // that clears every horizontally-overlapping note. `initialPlaced` are fixed
  // obstacles (already-positioned notes) so new notes pack into the FREE space.
  const computePack = (
    list: Note[],
    containerW: number,
    sizeOf: (n: Note) => { w: number; h: number },
    initialPlaced: Box[] = []
  ) => {
    const placed: Box[] = [...initialPlaced];
    const pos: Record<string, { x: number; y: number }> = {};
    const maxW = Math.max(PIN_W_DEFAULT, containerW - PIN_GAP * 2);
    for (const n of list) {
      const s = sizeOf(n);
      const w = Math.min(s.w, maxW);
      const candXs = [PIN_GAP, ...placed.map((p) => p.x + p.w + PIN_GAP)];
      let best: { x: number; y: number } | null = null;
      for (const x of candXs) {
        if (x > PIN_GAP && x + w > containerW - PIN_GAP) continue; // would overflow
        let y = PIN_GAP;
        for (const p of placed) {
          if (x < p.x + p.w + PIN_GAP && x + w + PIN_GAP > p.x) y = Math.max(y, p.y + p.h + PIN_GAP);
        }
        if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y };
      }
      if (!best) best = { x: PIN_GAP, y: PIN_GAP };
      pos[n.id] = best;
      placed.push({ x: best.x, y: best.y, w, h: s.h });
    }
    return pos;
  };

  // iPhone-style local collision push: after a note (`anchorId`) is dropped or
  // resized, push only the notes that overlap it (and the chain) straight down,
  // just enough to clear. Arrangements elsewhere (incl. intentional overlaps you
  // didn't touch) stay put.
  const resolveCollisions = (anchorId: string) => {
    const pinned = notes.filter((n) => n.pinned);
    const boxes: Record<string, Box> = {};
    for (const n of pinned) boxes[n.id] = pinBox(n);
    const anchor = boxes[anchorId];
    if (!anchor) return;
    const overlapX = (a: Box, b: Box) => a.x < b.x + b.w + PIN_GAP && a.x + a.w + PIN_GAP > b.x;
    const overlap = (a: Box, b: Box) =>
      overlapX(a, b) && a.y < b.y + b.h + PIN_GAP && a.y + a.h + PIN_GAP > b.y;

    const changes: Record<string, { x: number; y: number }> = {};
    const settled = new Set<string>([anchorId]);
    const queue: Box[] = [anchor];
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const cur = queue.shift()!;
      for (const n of pinned) {
        if (settled.has(n.id)) continue;
        const b = boxes[n.id];
        if (overlap(cur, b)) {
          b.y = Math.round(cur.y + cur.h + PIN_GAP); // push straight below `cur`
          changes[n.id] = { x: b.x, y: b.y };
          settled.add(n.id);
          queue.push(b);
        }
      }
    }
    if (Object.keys(changes).length) {
      setNotes((prev) => prev.map((n) => (changes[n.id] ? { ...n, list_x: changes[n.id].x, list_y: changes[n.id].y } : n)));
      Object.entries(changes).forEach(([id, c]) => patchNote(id, { list_x: c.x, list_y: c.y }));
    }
  };
  // Always point at the latest resolveCollisions (declared as a ref up top).
  resolveRef.current = resolveCollisions;

  // Arrange the pinned notes. "tight" = one dense skyline; "color"/"tags"/"media"
  // = group into vertical bands (one packed block per group, stacked).
  const arrangePinned = (mode: "tight" | "color" | "tags" | "media") => {
    const list = notes.filter((n) => n.pinned);
    const w = pinnedW || 1000;
    const sizeOf = (n: Note) => ({
      w: n.width ?? PIN_W_DEFAULT,
      h: itemEls.current.get(n.id)?.offsetHeight ?? estimatePinH(n),
    });
    let pos: Record<string, { x: number; y: number }> = {};

    if (mode === "tight") {
      pos = computePack([...list].sort(pinSort), w, sizeOf);
    } else {
      const keyOf = (n: Note): string => {
        if (mode === "color") {
          const i = STICKY_COLORS.findIndex((c) => c.key === n.color);
          return i >= 0 ? String(i).padStart(2, "0") : "99"; // no-colour last
        }
        if (mode === "tags") return (n.ai_keywords?.[0]?.toLowerCase() ?? "￿"); // no-tag last
        return n.media_url ? "0" : "1"; // media first
      };
      const groups = new Map<string, Note[]>();
      for (const n of list) {
        const k = keyOf(n);
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(n);
      }
      let baseY = PIN_GAP;
      for (const k of [...groups.keys()].sort()) {
        const g = groups.get(k)!;
        const gp = computePack(g, w, sizeOf);
        let maxBottom = baseY;
        for (const n of g) {
          const y = gp[n.id].y - PIN_GAP + baseY;
          pos[n.id] = { x: gp[n.id].x, y };
          maxBottom = Math.max(maxBottom, y + sizeOf(n).h);
        }
        baseY = maxBottom + PIN_GAP * 2; // a clear gap between groups
      }
    }

    setNotes((prev) => prev.map((n) => (pos[n.id] ? { ...n, list_x: pos[n.id].x, list_y: pos[n.id].y } : n)));
    Object.entries(pos).forEach(([id, p]) => patchNote(id, { list_x: p.x, list_y: p.y }));
  };

  // Fit each pinned note to its text: width = the content's natural width
  // (measured, clamped 180–360), height = auto (content height, no scroll).
  const fitPinnedToText = () => {
    const widths: Record<string, number> = {};
    notes.filter((n) => n.pinned).forEach((n) => {
      const el = itemEls.current.get(n.id);
      let w = PIN_W_DEFAULT;
      if (el) {
        const sW = el.style.width, sMax = el.style.maxWidth, sH = el.style.height;
        el.style.height = "auto";
        el.style.width = "max-content";
        el.style.maxWidth = "360px";
        w = Math.round(Math.max(180, Math.min(360, el.offsetWidth)));
        el.style.width = sW; el.style.maxWidth = sMax; el.style.height = sH;
      }
      widths[n.id] = w;
    });
    setNotes((prev) => prev.map((n) => (n.pinned ? { ...n, width: widths[n.id] ?? PIN_W_DEFAULT, height: null } : n)));
    Object.entries(widths).forEach(([id, w]) => patchNote(id, { width: w, height: null }));
  };

  // Free drag-move (grip).
  const moving = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const onMoveMove = useCallback((e: PointerEvent) => {
    const m = moving.current;
    if (!m) return;
    mutatedAt.current = Date.now();
    const x = Math.max(0, Math.round(m.origX + (e.clientX - m.startX)));
    const y = Math.max(0, Math.round(m.origY + (e.clientY - m.startY)));
    setNotes((prev) => prev.map((n) => (n.id === m.id ? { ...n, list_x: x, list_y: y } : n)));
  }, []);

  const onMoveUp = useCallback((e: PointerEvent) => {
    const m = moving.current;
    moving.current = null;
    window.removeEventListener("pointermove", onMoveMove);
    window.removeEventListener("pointerup", onMoveUp);
    document.body.style.userSelect = "";
    setMovingId(null);
    if (m) {
      setNotes((prev) => {
        const n = prev.find((x) => x.id === m.id);
        // persist position + the raised z-order (list_order)
        if (n) patchNote(m.id, { list_x: n.list_x ?? 0, list_y: n.list_y ?? 0, list_order: n.list_order ?? 0 });
        return prev;
      });
      // push aside anything the dropped note now overlaps (iPhone-style) — unless
      // Alt is held, which drops it on top (intentional overlap). Deferred to the
      // next frame so the dropped card is committed at its final box first.
      if (!e.altKey) { const id = m.id; requestAnimationFrame(() => resolveRef.current(id)); }
    }
  }, [onMoveMove, patchNote]);

  const startMove = (id: string, e: React.PointerEvent, origX: number, origY: number) => {
    e.preventDefault();
    e.stopPropagation();
    // Raise the grabbed note to the top of the stack (so an Alt-overlap drop
    // lands ON TOP, not hidden under another note). Persisted on drop.
    const topZ = Math.max(0, ...notes.filter((n) => n.pinned).map((n) => n.list_order ?? 0)) + 1;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, list_order: topZ } : n)));
    moving.current = { id, startX: e.clientX, startY: e.clientY, origX, origY };
    setMovingId(id);
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMoveMove);
    window.addEventListener("pointerup", onMoveUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMoveMove);
      window.removeEventListener("pointerup", onMoveUp);
    };
  }, [onMoveMove, onMoveUp]);

  // Measure the pinned area height from the placed cards (so the container grows
  // to contain freely-positioned notes). Keyed to what actually moves cards
  // (positions/sizes via `notes`, container width, collapse) — not every render.
  useLayoutEffect(() => {
    let maxB = 0;
    itemEls.current.forEach((el) => { maxB = Math.max(maxB, el.offsetTop + el.offsetHeight); });
    setPinAreaH(maxB ? maxB + PIN_GAP : 0);
  }, [notes, pinnedW, pinnedCollapsed, view, loading]);

  // Pinned notes without a saved position are auto-packed fresh on every render,
  // which makes them "fluid": they slide away from any positioned note. That
  // broke Alt-drop overlap — dropping a note ON TOP of a not-yet-positioned note
  // made the target dodge instead of staying under it. Once such a note has been
  // rendered at its auto spot, persist that measured position so it becomes fixed
  // and overlaps behave predictably. Idle-only (never mid drag/resize); converges
  // because persisted notes drop out of the unpositioned set on the next run.
  useEffect(() => {
    if (loading || view !== "list" || pinnedCollapsed || movingId || resizing.current) return;
    const fixes: { id: string; x: number; y: number }[] = [];
    for (const n of notes) {
      if (!n.pinned || (n.list_x != null && n.list_y != null)) continue;
      const el = itemEls.current.get(n.id);
      if (el) fixes.push({ id: n.id, x: el.offsetLeft, y: el.offsetTop });
    }
    if (fixes.length === 0) return;
    mutatedAt.current = Date.now();
    setNotes((prev) =>
      prev.map((n) => {
        const f = fixes.find((x) => x.id === n.id);
        return f ? { ...n, list_x: f.x, list_y: f.y } : n;
      })
    );
    fixes.forEach((f) => patchNote(f.id, { list_x: f.x, list_y: f.y }));
  }, [notes, pinnedW, pinnedCollapsed, view, loading, movingId, patchNote]);

  // --- Marquee (rubber-band) selection. The anchor is stored in <main>-relative
  // coordinates (which scroll with the content), so the box stays put while the
  // page auto-scrolls when you drag near the top/bottom edge. ---
  const listRef = useRef<HTMLElement>(null);
  const [marquee, setMarquee] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef<{ ax: number; ay: number; clientX: number; clientY: number; base: Set<string>; moved: boolean; onCard: boolean } | null>(null);
  const autoScroll = useRef<number | null>(null);

  // Recompute the box + selection from the stored anchor and the last pointer
  // position (in main-relative coords, so it survives scrolling).
  const updateMarquee = useCallback(() => {
    const m = marqueeRef.current;
    const main = listRef.current;
    if (!m || !main || !m.moved) return;
    const mr = main.getBoundingClientRect();
    const cx = m.clientX - mr.left, cy = m.clientY - mr.top;
    const left = Math.min(m.ax, cx), top = Math.min(m.ay, cy);
    const right = Math.max(m.ax, cx), bottom = Math.max(m.ay, cy);
    setMarquee({ l: left, t: top, w: right - left, h: bottom - top });
    const sel = new Set(m.base);
    main.querySelectorAll<HTMLElement>("[data-note-id]").forEach((node) => {
      if (node.dataset.clipped === "1") return; // hidden in the collapsed pinned area
      const r = node.getBoundingClientRect();
      const nl = r.left - mr.left, nt = r.top - mr.top, nr = r.right - mr.left, nb = r.bottom - mr.top;
      if (nl < right && nr > left && nt < bottom && nb > top) sel.add(node.dataset.noteId!);
    });
    setSelectedIds(sel);
  }, []);

  // Auto-scroll loop: while dragging near a viewport edge, scroll the page and
  // keep extending the selection — no need to fight the wheel.
  const autoScrollTick = useCallback(() => {
    const m = marqueeRef.current;
    if (!m) { autoScroll.current = null; return; } // gesture ended
    if (m.moved) {
      const EDGE = 70, MAX = 18;
      const vh = window.innerHeight;
      let dy = 0;
      if (m.clientY > vh - EDGE) dy = MAX * Math.min(1, (m.clientY - (vh - EDGE)) / EDGE);
      else if (m.clientY < EDGE) dy = -MAX * Math.min(1, (EDGE - m.clientY) / EDGE);
      if (dy) {
        window.scrollBy(0, dy);
        updateMarquee();
      }
    }
    autoScroll.current = requestAnimationFrame(autoScrollTick);
  }, [updateMarquee]);

  const onMarqueeMove = useCallback((e: PointerEvent) => {
    const m = marqueeRef.current;
    if (!m) return;
    m.clientX = e.clientX;
    m.clientY = e.clientY;
    if (!m.moved) {
      const main = listRef.current;
      const mr = main?.getBoundingClientRect();
      if (mr) {
        const dx = Math.abs(e.clientX - mr.left - m.ax), dy = Math.abs(e.clientY - mr.top - m.ay);
        if (dx + dy > 6) {
          m.moved = true;
          setSelectMode(true);
          document.body.style.userSelect = "none";
        }
      }
    }
    updateMarquee();
  }, [updateMarquee]);

  const onMarqueeUp = useCallback(() => {
    window.removeEventListener("pointermove", onMarqueeMove);
    window.removeEventListener("pointerup", onMarqueeUp);
    window.removeEventListener("pointercancel", onMarqueeUp);
    if (autoScroll.current) { cancelAnimationFrame(autoScroll.current); autoScroll.current = null; }
    document.body.style.userSelect = "";
    const m = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!m) return;
    if (m.moved) {
      suppressClick.current = true; // swallow the trailing click so it doesn't open a note
      setTimeout(() => { suppressClick.current = false; }, 0);
    } else if (!m.onCard) {
      setSelectedIds(new Set()); // plain click on empty space clears the selection
      setSelectMode(false);
    }
  }, [onMarqueeMove]);

  // Start a marquee from anywhere — incl. on a card (a drag rubber-bands; a plain
  // click still opens it). Interactive controls/editors are left alone.
  const onListPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('button,input,a,textarea,select,[role="menuitem"],[contenteditable],[data-no-marquee]')) return;
    const mr = listRef.current?.getBoundingClientRect();
    document.body.style.userSelect = "none";
    marqueeRef.current = {
      ax: e.clientX - (mr?.left ?? 0),
      ay: e.clientY - (mr?.top ?? 0),
      clientX: e.clientX,
      clientY: e.clientY,
      base: e.shiftKey ? new Set(selectedIds) : new Set(),
      moved: false,
      onCard: !!el.closest("[data-note-id]"),
    };
    window.addEventListener("pointermove", onMarqueeMove);
    window.addEventListener("pointerup", onMarqueeUp);
    window.addEventListener("pointercancel", onMarqueeUp);
    autoScroll.current = requestAnimationFrame(autoScrollTick);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMarqueeMove);
      window.removeEventListener("pointerup", onMarqueeUp);
      window.removeEventListener("pointercancel", onMarqueeUp);
      if (autoScroll.current) cancelAnimationFrame(autoScroll.current);
    };
  }, [onMarqueeMove, onMarqueeUp]);

  // Distinct tags across the loaded notes (for the filter dropdown).
  const keywordCounts: Record<string, number> = {};
  for (const kw of notes.flatMap((n) => n.ai_keywords || [])) {
    keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
  }
  const sortedKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([kw]) => kw);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileNav />
      <CommandSearch onNavigate={(id) => setOpenNoteId(id)} />
      {/* One shared tag-autocomplete source for every tag input (list + wall),
          instead of a per-card/per-sticker datalist duplicating the whole list. */}
      <datalist id="tg-all-tags">
        {sortedKeywords.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {view === "wall" ? (
        // Fullscreen canvas: covers the whole site (over the sidebar). z-[45] keeps
        // it above the sidebar (z-40) but below Radix portals (dialogs/menus, z-50).
        <div className="fixed inset-0 z-[45] bg-background">
          <NotesWall
          fullscreen
          notes={notes}
          onChanged={() => fetchNotes(true)}
          onOpen={setOpenNoteId}
          onNoteUpdate={(id, patch) => {
            mutatedAt.current = Date.now(); // block 15s poll for 3s while PATCH is in flight
            notesSigRef.current = "";      // force next poll to notice the change
            setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
          }}
          allTags={sortedKeywords}
        />
          {/* View switch — top-RIGHT, same place as in the list header (so it
              doesn't jump sides when you toggle). Left of the theme button. */}
          <div className="absolute right-16 top-16 z-40 flex items-center rounded-xl border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur md:top-3">
            <ViewToggle view={view} onChange={changeView} />
          </div>
          {/* Tag filter — top-left (clears the centred search bar). */}
          {sortedKeywords.length > 0 && (
            <div className="absolute left-3 top-16 z-40 rounded-xl border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur md:left-20 md:top-3">
              <TagFilter tags={sortedKeywords} value={tagFilter} onChange={setTagFilter} align="start" />
            </div>
          )}
        </div>
      ) : (
        <main
          ref={listRef}
          onPointerDown={onListPointerDown}
          onDragStart={(e) => e.preventDefault()}
          // The whole main is the rubber-band surface (full width + min-h-screen),
          // so you can start a selection from ANY empty point, Windows-style.
          className="relative min-h-screen md:pl-[var(--sidebar-w)] transition-[padding] duration-300"
        >
          <div className="md:hidden h-14" />
          <div className="w-full py-6 space-y-5 px-4 md:px-6">
            {/* pr-14 on desktop keeps the view toggle clear of the fixed top-right
                theme button now that the layout is full-width. */}
            <div data-no-marquee className="flex items-center justify-between md:pr-14">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm shadow-primary/30">
                  <BookOpen className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight leading-none">TG Notes</h1>
                  <p className="text-muted-foreground text-sm mt-1">{totalCount > 0 ? totalCount : notes.length} notes</p>
                </div>
              </div>
              <ViewToggle view={view} onChange={changeView} />
            </div>

            {!selectMode && (
              <div data-no-marquee>
                <NewNoteBox onCreated={() => fetchNotes(true)} />
              </div>
            )}

            {/* Sort + filter toolbar (sticky). */}
            <div data-no-marquee className="sticky top-16 z-30 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-sm"
                onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
              >
                <ArrowUpDown className="h-4 w-4 mr-1.5" />
                {order === "desc" ? "Newest first" : "Oldest first"}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent">
                    {sort === "created_at" ? "By date created" : "By event date"}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuCheckboxItem
                    checked={sort === "created_at"}
                    onCheckedChange={() => setSort("created_at")}
                    onSelect={(e) => e.preventDefault()}
                  >
                    By date created
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={sort === "extracted_date"}
                    onCheckedChange={() => setSort("extracted_date")}
                    onSelect={(e) => e.preventDefault()}
                  >
                    By event date
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <TagFilter tags={sortedKeywords} value={tagFilter} onChange={setTagFilter} />

              {/* "By color" — toggle that groups the list by sticky colour.
                  Active (pressed) = grouped; press again to turn off. */}
              <button
                onClick={toggleColorSort}
                title={colorSort ? "Grouped by color — click to turn off" : "Group by color"}
                aria-pressed={colorSort}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
                  colorSort
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:bg-accent"
                )}
              >
                <Palette className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">By color</span>
              </button>

              {/* list actions — the "select several" + "remove duplicates" buttons here in
                  the always-visible toolbar (more logical than the top-right ⋮). */}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 text-sm" onClick={() => setSelectMode(true)}>
                  <CheckSquare className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">Select</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleDedupe} disabled={deduping}>
                      {deduping ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Copy className="h-4 w-4 mr-2" />
                      )}
                      Remove duplicates
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportNotes("json")}>
                      <Download className="h-4 w-4 mr-2" />
                      Export JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportNotes("markdown")}>
                      <Download className="h-4 w-4 mr-2" />
                      Export Markdown
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {!isOnline && (
              <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
                <WifiOff className="h-4 w-4 shrink-0" />
                No internet connection — changes won't be saved
              </div>
            )}
            {selectMode && selectedIds.size === notes.length && notes.length > 0 && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
                {selectAllMode ? (
                  <>
                    <span className="font-medium">All {totalCount} notes are selected.</span>
                    <button
                      type="button"
                      onClick={() => setSelectAllMode(false)}
                      className="text-primary underline hover:no-underline"
                    >
                      Clear selection
                    </button>
                  </>
                ) : (
                  <>
                    <span>{selectedIds.size} notes on this page are selected.</span>
                    <button
                      type="button"
                      onClick={() => setSelectAllMode(true)}
                      className="text-primary underline hover:no-underline"
                    >
                      Select all {totalCount} notes
                    </button>
                  </>
                )}
              </div>
            )}
            {loading ? (
              <div className="columns-[15rem] gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="mb-4 h-32 rounded-xl bg-muted animate-pulse break-inside-avoid" />
                ))}
              </div>
            ) : notes.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                <p className="text-muted-foreground text-sm">No notes yet</p>
              </div>
            ) : (
              (() => {
                // Pinned notes get a free-position area at the top; the rest is a
                // dense ~240px-column masonry.
                const pinnedNotes = notes.filter((n) => n.pinned).sort(pinSort);
                const otherNotes = notes.filter((n) => !n.pinned);
                const orderedOther = colorSort
                  ? [...otherNotes].sort((a, b) => colorRank(a) - colorRank(b))
                  : otherNotes;

                const cardOf = (note: Note, fill?: boolean) => (
                  <NoteCard
                    note={note}
                    onClick={cardClick}
                    selectionMode={selectMode}
                    selected={selectedIds.has(note.id)}
                    onColor={setNoteColor}
                    onTogglePin={toggleNotePin}
                    onDelete={deleteNote}
                    onAddTag={addNoteTag}
                    onEditTag={editNoteTag}
                    fill={fill}
                    allTags={sortedKeywords}
                  />
                );

                const renderMasonry = (list: Note[]) => (
                  <div className="columns-[15rem] gap-4">
                    {list.map((note) => (
                      <NoteContextMenu key={note.id} note={note} onChanged={() => fetchNotes(true)}>
                        <div data-note-id={note.id} className="mb-4 break-inside-avoid animate-note-in">{cardOf(note)}</div>
                      </NoteContextMenu>
                    ))}
                  </div>
                );

                const grip =
                  "absolute z-20 touch-none rounded-full bg-foreground/20 opacity-0 transition-opacity hover:bg-primary group-hover/pin:opacity-100";
                // Free-position pinned area: each note is absolutely placed at its
                // saved list_x/list_y, draggable anywhere and resizable. Notes
                // WITHOUT a saved position (e.g. just pinned) are packed into the
                // FREE space around the positioned ones, so they don't overlap.
                const positionedBoxes = pinnedNotes
                  .filter((n) => n.list_x != null && n.list_y != null)
                  .map((n) => ({ x: n.list_x!, y: n.list_y!, w: n.width ?? PIN_W_DEFAULT, h: estimatePinH(n) }));
                const unpositioned = pinnedNotes.filter((n) => n.list_x == null || n.list_y == null);
                const autoPos = computePack(
                  unpositioned,
                  pinnedW || 1000,
                  (n) => ({ w: n.width ?? PIN_W_DEFAULT, h: estimatePinH(n) }),
                  positionedBoxes
                );
                const renderPinned = (list: Note[]) => (
                  <div
                    ref={setPinnedAreaRef}
                    className="relative"
                    style={{ height: pinAreaH || undefined, minHeight: 140 }}
                  >
                    {list.map((note) => {
                      const x = note.list_x ?? autoPos[note.id]?.x ?? PIN_GAP;
                      const y = note.list_y ?? autoPos[note.id]?.y ?? PIN_GAP;
                      const w = note.width ?? PIN_W_DEFAULT;
                      return (
                        <NoteContextMenu key={note.id} note={note} onChanged={() => fetchNotes(true)}>
                          <div
                            data-note-id={note.id}
                            data-clipped={pinnedCollapsed ? "1" : undefined}
                            ref={(el) => {
                              if (el) itemEls.current.set(note.id, el);
                              else itemEls.current.delete(note.id);
                            }}
                            className={cn(
                              "group/pin absolute",
                              movingId === note.id ? "z-30 shadow-2xl" : "animate-note-in"
                            )}
                            style={{ left: x, top: y, width: w, height: note.height ?? undefined, maxWidth: "100%" }}
                          >
                            {cardOf(note, note.height != null)}
                            {!selectMode && (
                              <>
                                {/* move grip (left) — drag anywhere */}
                                <div
                                  onPointerDown={(e) => startMove(note.id, e, x, y)}
                                  onClick={(e) => e.stopPropagation()}
                                  title="Drag to move"
                                  className="absolute left-0 top-1/2 z-20 flex h-8 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full bg-card opacity-0 shadow ring-1 ring-border transition-opacity active:cursor-grabbing group-hover/pin:opacity-100"
                                >
                                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>
                                {/* width (right edge) */}
                                <div
                                  onPointerDown={(e) => startResize(note.id, e, "x")}
                                  onClick={(e) => e.stopPropagation()}
                                  title="Drag to resize width"
                                  className={cn(grip, "right-0 top-1/2 h-14 w-2 -translate-y-1/2 translate-x-1/2 cursor-ew-resize")}
                                />
                                {/* height (bottom edge) */}
                                <div
                                  onPointerDown={(e) => startResize(note.id, e, "y")}
                                  onClick={(e) => e.stopPropagation()}
                                  title="Drag to resize height"
                                  className={cn(grip, "bottom-0 left-1/2 h-2 w-14 -translate-x-1/2 translate-y-1/2 cursor-ns-resize")}
                                />
                                {/* both (corner) */}
                                <div
                                  onPointerDown={(e) => startResize(note.id, e, "both")}
                                  onClick={(e) => e.stopPropagation()}
                                  title="Drag to resize"
                                  className={cn(grip, "bottom-0 right-0 h-3.5 w-3.5 translate-x-1/2 translate-y-1/2 cursor-nwse-resize")}
                                />
                              </>
                            )}
                          </div>
                        </NoteContextMenu>
                      );
                    })}
                  </div>
                );

                return (
                  <div className="space-y-6">
                    {pinnedNotes.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-0.5">
                          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Pinned
                          </h2>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={fitPinnedToText}
                              title="Fit size to text (reset manual width/height)"
                              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                            >
                              <Type className="h-3.5 w-3.5" />
                              Fit to text
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  title="Arrange notes"
                                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                                >
                                  <LayoutGrid className="h-3.5 w-3.5" />
                                  Arrange
                                  <ChevronDown className="h-3 w-3 opacity-60" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => arrangePinned("tight")}>
                                  <LayoutGrid className="mr-2 h-4 w-4" /> Compact (no gaps)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => arrangePinned("color")}>
                                  <Palette className="mr-2 h-4 w-4" /> By color
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => arrangePinned("tags")}>
                                  <Tag className="mr-2 h-4 w-4" /> By tags
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => arrangePinned("media")}>
                                  <FileText className="mr-2 h-4 w-4" /> By media (photos first)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <button
                              onClick={togglePinnedCollapsed}
                              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                            >
                              {pinnedCollapsed ? "Expand" : "Collapse"}
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !pinnedCollapsed && "rotate-180")} />
                            </button>
                          </div>
                        </div>
                        {!pinnedCollapsed && (
                          <p data-no-marquee className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
                            Drag by <span className="font-medium">⠿</span> on the left to move · drop onto another to push neighbours aside ·
                            <span className="font-medium"> Alt</span> on release to overlap ·
                            edges / corner to resize · "Fit to text" to fit, "Arrange" to pack tightly
                          </p>
                        )}
                        <div className="relative">
                          <div
                            className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
                            style={{ maxHeight: pinnedCollapsed ? 120 : Math.max(6000, pinAreaH + 40) }}
                          >
                            {renderPinned(pinnedNotes)}
                          </div>
                          {pinnedCollapsed && (
                            <>
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-background" />
                              <button
                                onClick={togglePinnedCollapsed}
                                title="Expand pinned"
                                className="absolute bottom-1 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card shadow-md transition-transform hover:scale-110"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    {otherNotes.length > 0 && (
                      <div className="space-y-2">
                        {pinnedNotes.length > 0 && (
                          <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Others
                          </h2>
                        )}
                        {renderMasonry(orderedOther)}
                      </div>
                    )}
                    {hasMore && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadMore}
                          disabled={loadingMore}
                          className="min-w-[160px]"
                        >
                          {loadingMore ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading…</>
                          ) : (
                            `Load more (${totalCount - notes.length})`
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>

          {/* marquee rectangle (positioned relative to <main>) */}
          {marquee && (
            <div
              className="pointer-events-none absolute z-40 rounded border border-primary/60 bg-primary/10"
              style={{ left: marquee.l, top: marquee.t, width: marquee.w, height: marquee.h }}
            />
          )}
        </main>
      )}
      {/* Floating selection toolbar — always visible while selecting (no scrolling
          up to find it). Centred over the content like the search bar. */}
      {view === "list" && selectMode && (
        <div
          data-no-marquee
          className="fixed bottom-5 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{ left: "calc(50% + var(--sidebar-w) / 2)" }}
        >
          <span className="px-1 text-sm font-medium">Selected: {selectAllMode ? totalCount : selectedIds.size}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const allVisibleSelected = selectedIds.size === notes.length && notes.length > 0;
              if (!allVisibleSelected) {
                // Select all visible notes, reset selectAllMode
                setSelectedIds(new Set(notes.map((n) => n.id)));
                setSelectAllMode(false);
              } else if (!selectAllMode) {
                // All visible selected, activate "all notes" mode
                setSelectAllMode(true);
              } else {
                // Deselect all
                setSelectedIds(new Set());
                setSelectAllMode(false);
              }
            }}
          >
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false); }}>
            Clear
          </Button>
          <div className="mx-0.5 h-6 w-px bg-border" />
          <div className="flex items-center gap-1">
            <input
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); bulkApplyTag(); } }}
              placeholder="Tag…"
              disabled={selectedIds.size === 0}
              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button variant="outline" size="sm" onClick={bulkApplyTag} disabled={selectedIds.size === 0 || !bulkTag.trim()} title="Add this tag to the selected">
              <span className="relative inline-flex">
                <Tag className="h-4 w-4" />
                <Plus className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5" strokeWidth={3} />
              </span>
            </Button>
            <Button variant="outline" size="sm" onClick={bulkRemoveTag} disabled={selectedIds.size === 0 || !bulkTag.trim()} title="Remove this tag from the selected">
              <span className="relative inline-flex">
                <Tag className="h-4 w-4" />
                <Minus className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5" strokeWidth={3} />
              </span>
            </Button>
          </div>
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowBulkColors((v) => !v)} disabled={selectedIds.size === 0}>
              <Palette className="h-4 w-4" />
            </Button>
            {showBulkColors && selectedIds.size > 0 && (
              <div className="absolute bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-popover p-2 shadow-lg">
                <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
                  <button type="button" title="No color" onClick={() => bulkSetColor("")} className="h-6 w-6 rounded-full border border-border bg-card" />
                  {STICKY_COLORS.map((c) => (
                    <button key={c.key} type="button" title={c.label} onClick={() => bulkSetColor(c.key)} className="h-6 w-6 rounded-full border border-black/10" style={{ background: c.bg }} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => bulkSetPin(true)} disabled={selectedIds.size === 0} title="Pin">
            <Pin className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => bulkSetPin(false)} disabled={selectedIds.size === 0} title="Unpin">
            <Pin className="h-4 w-4 rotate-45" />
          </Button>
          <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={selectedIds.size === 0 || bulkDeleting}>
            {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={exitSelect}>Done</Button>
        </div>
      )}

      <NoteDialog
        noteId={openNoteId}
        onClose={() => setOpenNoteId(null)}
        onChanged={() => fetchNotes(true)}
      />
      <NewNoteFab onCreated={fetchNotes} />
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <NotesPageInner />
    </Suspense>
  );
}
