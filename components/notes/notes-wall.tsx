"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/use-api";
import { cn, noteToHtml, RICH_CLASS, sanitizeHtml, stripHtml, TAG_COLOR_OPTIONS } from "@/lib/utils";
import { STICKY_COLORS, COLOR_MAP, STICKY_FONTS, FONT_MAP, DEFAULT_FONT, noteColorClass } from "@/lib/sticky";
import { NoteMedia } from "@/components/notes/note-media";
import { NoteContextMenu } from "@/components/notes/note-context-menu";
import { OriginalToggle } from "@/components/notes/original-toggle";
import { useTagColors } from "@/contexts/tag-colors-context";
import { useConfirm } from "@/components/ui/confirm-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Note } from "@/types";
import { Palette, Type as TypeIcon, ExternalLink, Trash2, Pencil, Check, Plus, Minus, Link2, Maximize2, X, Tags, Tag, LayoutGrid, Bookmark, Save, Unlink, Undo2 } from "lucide-react";

// A saved wall arrangement (positions snapshot, kept in localStorage).
type SavedView = { id: string; name: string; positions: Record<string, { x: number; y: number; w: number; h: number }> };
const VIEWS_KEY = "tg_notes_wall_views";

// Resize handle config — data-driven so all 8 share one render block.
const RESIZE_HANDLES: { dirs: { l?: boolean; r?: boolean; t?: boolean; b?: boolean }; cls: string }[] = [
  { dirs: { t: true }, cls: "-top-0.5 left-3 right-3 h-2 cursor-ns-resize hover:bg-black/10" },
  { dirs: { b: true }, cls: "-bottom-0.5 left-3 right-3 h-2 cursor-ns-resize hover:bg-black/10" },
  { dirs: { l: true }, cls: "-left-0.5 top-3 bottom-3 w-2 cursor-ew-resize hover:bg-black/10" },
  { dirs: { r: true }, cls: "-right-0.5 top-3 bottom-3 w-2 cursor-ew-resize hover:bg-black/10" },
  { dirs: { t: true, l: true }, cls: "-top-0.5 -left-0.5 h-3.5 w-3.5 cursor-nwse-resize" },
  { dirs: { t: true, r: true }, cls: "-top-0.5 -right-0.5 h-3.5 w-3.5 cursor-nesw-resize" },
  { dirs: { b: true, l: true }, cls: "-bottom-0.5 -left-0.5 h-3.5 w-3.5 cursor-nesw-resize" },
  { dirs: { b: true, r: true }, cls: "-bottom-0.5 -right-0.5 h-3.5 w-3.5 cursor-nwse-resize" },
];

// Dot-grid background image (static; size/position computed from the view).
const DOT_BG = "radial-gradient(circle, rgba(120,120,120,0.28) 1px, transparent 1.4px)";

const W = 240;
const GAP = 16;
const MIN_W = 160;
const MIN_H = 120;

const RICH = RICH_CLASS;

type Layout = { x: number; y: number; w: number; h: number; color: string; font: string };

// Where the segment from a rect's centre toward (tx,ty) crosses the rect border —
// so connector lines touch sticker edges instead of disappearing under them.
function borderPoint(cx: number, cy: number, halfW: number, halfH: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(
    dx !== 0 ? halfW / Math.abs(dx) : Infinity,
    dy !== 0 ? halfH / Math.abs(dy) : Infinity
  );
  return { x: cx + dx * t, y: cy + dy * t };
}

// Order-insensitive set equality for tag arrays.
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// Rough initial sticker height so longer notes start taller (full text visible).
function estimateHeight(text: string, hasMedia: boolean): number {
  const len = text.trim().length;
  const lines = Math.max(1, Math.ceil(len / 30));
  let h = 52 + lines * 20;
  if (hasMedia) h += 170;
  return Math.min(560, Math.max(MIN_H, h));
}

interface NotesWallProps {
  notes: Note[];
  onChanged?: () => void;
  // When true the canvas fills its parent (used by the fullscreen wall overlay)
  // instead of the boxed 72vh card.
  fullscreen?: boolean;
  // Open a note (Keep-style modal). Falls back to page navigation if absent.
  onOpen?: (id: string) => void;
  // Propagate color/font/tag changes to the parent notes state (optimistic sync).
  onNoteUpdate?: (id: string, patch: Partial<Note>) => void;
  allTags?: string[];
}

// Inline editor for a sticker's text — a contentEditable area seeded once with
// the note's HTML, saved on blur. Esc cancels.
function StickyEditor({
  initialHtml,
  onSave,
  onCancel,
}: {
  initialHtml: string;
  onSave: (html: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = initialHtml;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [initialHtml]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onSave(e.currentTarget.innerHTML)}
      // Fills the whole sticker body (no inner frame) so you can click anywhere
      // in the note and type from there.
      className={cn(
        "w-full flex-1 min-h-0 text-sm leading-snug outline-none",
        RICH
      )}
    />
  );
}

export function NotesWall({ notes, onChanged, fullscreen = false, onOpen, onNoteUpdate, allTags }: NotesWallProps) {
  const router = useRouter();
  const { apiFetch } = useApi();
  const { colors, colorClass, setTagColor } = useTagColors();
  const { confirm } = useConfirm();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [views, setViews] = useState<SavedView[]>([]);
  // Undo stack for wall changes (restore arrows / positions). Capped.
  type UndoEntry =
    | { type: "links"; links: { id: string; from_note: string; to_note: string; curved?: boolean }[] }
    | { type: "layout"; positions: Record<string, { x: number; y: number; w: number; h: number }> };
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const pushUndo = (e: UndoEntry) => setUndoStack((s) => [...s, e].slice(-30));
  // Boxes captured at the start of a drag/resize, keyed by note id — a group
  // drag records every member so undo restores the whole group, not just the
  // anchor. `id` is the anchor the interaction started on.
  const undoBefore = useRef<{ id: string; boxes: Record<string, { x: number; y: number; w: number; h: number }> } | null>(null);
  const [layout, setLayout] = useState<Record<string, Layout>>({});
  const [active, setActive] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<{ id: string; kind: "color" | "font" } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<{ id: string; from_note: string; to_note: string; curved?: boolean }[]>([]);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [arrowMenu, setArrowMenu] = useState<{ id: string; curved: boolean; x: number; y: number } | null>(null);
  // Optimistic per-note tag edits so rapid chip clicks don't lose updates.
  const [tagOverride, setTagOverride] = useState<Record<string, { topics: string[]; keywords: string[] }>>({});
  // Wall tag inline editing state.
  const [editingTag, setEditingTag] = useState<{ noteId: string; kw: string } | null>(null);
  const [addingTagNoteId, setAddingTagNoteId] = useState<string | null>(null);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [addTagInput, setAddTagInput] = useState("");

  const tagsOf = useCallback(
    (n: Note) => tagOverride[n.id] ?? { topics: n.ai_topics || [], keywords: n.ai_keywords || [] },
    [tagOverride]
  );

  // Drop optimistic overrides once a refetched note matches them (or vanishes).
  useEffect(() => {
    setTagOverride((prev) => {
      if (!Object.keys(prev).length) return prev;
      const byId = new Map(notes.map((n) => [n.id, n]));
      const next: typeof prev = {};
      for (const [id, o] of Object.entries(prev)) {
        const n = byId.get(id);
        if (n && sameSet(o.topics, n.ai_topics || []) && sameSet(o.keywords, n.ai_keywords || [])) continue;
        if (n) next[id] = o;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [notes]);

  const toggleSelectSticker = (id: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Set while a link mutation is in flight so a concurrent refetch can't clobber
  // the optimistic state and resurrect a just-deleted/edited arrow.
  const mutatingLinks = useRef(false);

  const fetchLinks = useCallback(async () => {
    if (mutatingLinks.current) return;
    try {
      const res = await apiFetch("/api/notes/links");
      if (res.ok) {
        const data = await res.json();
        if (!mutatingLinks.current) setLinks(data.links || []);
      }
    } catch {
      /* ignore */
    }
  }, [apiFetch]);

  // Refetch links only when the *set* of notes changes (add/remove), not on every
  // 15s poll that returns the same notes.
  const noteIdsKey = useMemo(() => notes.map((n) => n.id).join(","), [notes]);
  useEffect(() => {
    fetchLinks();
  }, [fetchLinks, noteIdsKey]);

  const createLink = async (from: string, to: string) => {
    setLinkingFrom(null);
    if (from === to) return;
    mutatingLinks.current = true;
    try {
      await apiFetch("/api/notes/links", { method: "POST", body: JSON.stringify({ from, to }) });
    } catch {
      /* ignore */
    } finally {
      mutatingLinks.current = false;
    }
    fetchLinks();
  };

  const deleteLink = async (id: string) => {
    setArrowMenu(null);
    setLinks((prev) => prev.filter((l) => l.id !== id));
    mutatingLinks.current = true;
    try {
      await apiFetch(`/api/notes/links?id=${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    } finally {
      mutatingLinks.current = false;
    }
  };

  const clearAllLinks = async () => {
    if (links.length === 0) return;
    const ok = await confirm({
      title: "Remove all arrows?",
      description: `All links between notes (${links.length}) will be removed. The notes themselves stay.`,
      confirmText: "Remove all",
      destructive: true,
    });
    if (!ok) return;
    pushUndo({ type: "links", links: links.map((l) => ({ ...l })) }); // allow "Undo"
    const ids = links.map((l) => l.id);
    setArrowMenu(null);
    setLinks([]);
    mutatingLinks.current = true;
    try {
      await Promise.all(ids.map((id) => apiFetch(`/api/notes/links?id=${id}`, { method: "DELETE" })));
    } catch {
      /* ignore */
    } finally {
      mutatingLinks.current = false;
    }
  };

  const setLinkCurved = async (id: string, curved: boolean) => {
    setArrowMenu(null);
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, curved } : l)));
    mutatingLinks.current = true;
    try {
      await apiFetch("/api/notes/links", { method: "PATCH", body: JSON.stringify({ id, curved }) });
    } catch {
      /* ignore */
    } finally {
      mutatingLinks.current = false;
    }
  };

  // Live tag editing on a sticker (chips at the bottom).
  const patchNoteTags = (id: string, body: Record<string, unknown>) => {
    apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) })
      .then(() => onChanged?.())
      .catch(() => {});
  };
  const removeStickerKeyword = (n: Note, kw: string) => {
    const cur = tagsOf(n);
    const keywords = cur.keywords.filter((k) => k !== kw);
    setTagOverride((p) => ({ ...p, [n.id]: { topics: cur.topics, keywords } }));
    patchNoteTags(n.id, { ai_keywords: keywords });
  };
  const renameStickerKeyword = (n: Note, oldKw: string, newKw: string) => {
    const cur = tagsOf(n);
    const keywords = cur.keywords.map((k) => (k === oldKw ? newKw : k));
    setTagOverride((p) => ({ ...p, [n.id]: { topics: cur.topics, keywords } }));
    patchNoteTags(n.id, { ai_keywords: keywords });
  };
  const addStickerKeyword = (n: Note, kw: string) => {
    const cur = tagsOf(n);
    const keywords = [...new Set([...cur.keywords, kw])];
    setTagOverride((p) => ({ ...p, [n.id]: { topics: cur.topics, keywords } }));
    patchNoteTags(n.id, { ai_keywords: keywords });
  };

  // Bulk add/remove a tag across every selected sticker.
  const bulkAddTagWall = () => {
    const kw = bulkTagInput.trim().toLowerCase();
    if (!kw) return;
    for (const id of selectedSet) {
      const note = notes.find((n) => n.id === id);
      if (note) addStickerKeyword(note, kw);
    }
    setBulkTagInput("");
  };
  const bulkRemoveTagWall = () => {
    const kw = bulkTagInput.trim().toLowerCase();
    if (!kw) return;
    for (const id of selectedSet) {
      const note = notes.find((n) => n.id === id);
      if (note && tagsOf(note).keywords.includes(kw)) removeStickerKeyword(note, kw);
    }
    setBulkTagInput("");
  };
  const applyStickerTagColor = (noteId: string, kw: string, colorKey: string | null) => {
    setTagColor(kw, colorKey);
  };
  const renameStickerTagColor = (oldKw: string, newKw: string) => {
    // Renaming a tag on a single sticker must not strip the global colour from
    // the old tag (other notes still use it); only seed the new tag's colour.
    if (colors[oldKw] && !colors[newKw]) setTagColor(newKw, colors[oldKw]);
  };

  // Esc: cancel an in-progress "connect", otherwise clear the selection and
  // close any open menus. Ignored while typing in an input/editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (linkingFrom) { setLinkingFrom(null); return; }
      setSelectedSet((prev) => (prev.size ? new Set() : prev));
      setOpenMenu(null);
      setArrowMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkingFrom]);

  // Canvas viewport: pan offset (x,y) in screen px + zoom (k). Stickers live in
  // canvas coordinates inside a transformed layer.
  const [viewT, setViewT] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(viewT);
  useEffect(() => {
    viewRef.current = viewT;
  }, [viewT]);

  // Mirror of `layout` for callbacks that need the current positions without
  // re-subscribing (fit-to-content).
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const didFit = useRef(false);

  // Track the live container width so the auto-layout uses the right column count.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the layout map: saved coordinates win; un-placed notes fall into a grid.
  // In-session edits (prev[id]) are preserved across refetches.
  useEffect(() => {
    if (!containerW) return;
    const cols = Math.max(1, Math.floor((containerW + GAP) / (W + GAP)));
    setLayout((prev) => {
      const next: Record<string, Layout> = {};
      // Masonry-style packing for un-placed notes: each column tracks its own Y,
      // so content-sized stickers don't overlap on first layout.
      const colHeights = new Array(cols).fill(GAP);
      let autoIdx = 0;
      for (const n of notes) {
        if (prev[n.id]) {
          const p = prev[n.id];
          // Pick up colour/font that were changed elsewhere (e.g. in the note
          // modal) so the sticker reflects them after a refetch; keep the wall's
          // own position/size.
          const color = n.color ?? "";
          const font = n.font ?? DEFAULT_FONT;
          next[n.id] = color !== p.color || font !== p.font ? { ...p, color, font } : p;
          continue;
        }
        if (n.pos_x != null && n.pos_y != null) {
          next[n.id] = {
            x: n.pos_x,
            y: n.pos_y,
            w: n.width ?? W,
            h: n.height ?? estimateHeight(stripHtml(n.text), !!n.media_url),
            color: n.color ?? "",
            font: n.font ?? DEFAULT_FONT,
          };
        } else {
          const col = autoIdx % cols;
          autoIdx++;
          const h = n.height ?? estimateHeight(stripHtml(n.text), !!n.media_url);
          next[n.id] = {
            x: GAP + col * (W + GAP),
            y: colHeights[col],
            w: n.width ?? W,
            h,
            color: n.color ?? "",
            font: n.font ?? DEFAULT_FONT,
          };
          colHeights[col] += h + GAP;
        }
      }
      return next;
    });
  }, [notes, containerW]);

  const persist = useCallback(
    (id: string, l: Partial<Layout>) => {
      const body: Record<string, unknown> = {};
      if (l.x != null) body.pos_x = Math.round(l.x);
      if (l.y != null) body.pos_y = Math.round(l.y);
      if (l.w != null) body.width = Math.round(l.w);
      if (l.h != null) body.height = Math.round(l.h);
      if (l.color != null) body.color = l.color || null; // "" → null = remove colour
      if (l.font != null) body.font = l.font;
      apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
    },
    [apiFetch]
  );
  // Latest persist behind a stable ref, so the window pointer handlers below keep
  // a constant identity. Otherwise a silent token refresh mid-drag re-creates
  // them and the cleanup effect strips the live listeners — the gesture sticks.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // --- drag / resize / pan via pointer events on the window ---
  const interaction = useRef<
    | { type: "drag"; id: string; offX: number; offY: number; groupOffsets: Record<string, { dx: number; dy: number }> }
    | { type: "resize"; id: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number; l: boolean; r: boolean; t: boolean; b: boolean }
    | { type: "pan"; startX: number; startY: number; origX: number; origY: number }
    | null
  >(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const it = interaction.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!it || !rect) return;

    if (it.type === "pan") {
      setViewT((prev) => ({ ...prev, x: it.origX + (e.clientX - it.startX), y: it.origY + (e.clientY - it.startY) }));
      return;
    }

    const v = viewRef.current;
    setLayout((prev) => {
      const cur = prev[it.id];
      if (!cur) return prev;
      if (it.type === "drag") {
        // No boundary clamp — the canvas is infinite in every direction.
        const x = (e.clientX - rect.left - v.x) / v.k - it.offX;
        const y = (e.clientY - rect.top - v.y) / v.k - it.offY;
        const next = { ...prev, [it.id]: { ...cur, x, y } };
        // Move all other selected notes by the same delta as the dragged note.
        for (const [sid, off] of Object.entries(it.groupOffsets)) {
          if (next[sid]) next[sid] = { ...next[sid], x: x + off.dx, y: y + off.dy };
        }
        return next;
      }
      const dx = (e.clientX - it.startX) / v.k;
      const dy = (e.clientY - it.startY) / v.k;
      const nw = Math.max(MIN_W, it.origW + (it.r ? dx : 0) - (it.l ? dx : 0));
      const nh = Math.max(MIN_H, it.origH + (it.b ? dy : 0) - (it.t ? dy : 0));
      const nx = it.l ? it.origX + (it.origW - nw) : it.origX;
      const ny = it.t ? it.origY + (it.origH - nh) : it.origY;
      return { ...prev, [it.id]: { ...cur, x: nx, y: ny, w: nw, h: nh } };
    });
  }, []);

  const onPointerUp = useCallback(() => {
    const it = interaction.current;
    interaction.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (!it || it.type === "pan") return;
    // record the prior boxes (anchor + group members) so this move/resize can be undone
    const before = undoBefore.current;
    undoBefore.current = null;
    if (before && before.id === it.id) setUndoStack((s) => [...s, { type: "layout", positions: before.boxes } as UndoEntry].slice(-30));
    setLayout((prev) => {
      const cur = prev[it.id];
      if (cur) persistRef.current(it.id, cur);
      // Persist group members too.
      if (it.type === "drag") {
        for (const sid of Object.keys(it.groupOffsets)) {
          const sl = prev[sid];
          if (sl) persistRef.current(sid, sl);
        }
      }
      return prev;
    });
  }, [onPointerMove]);

  const beginInteraction = useCallback(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const startDrag = (id: string, e: React.PointerEvent) => {
    const cur = layout[id];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!cur || !rect) return;
    setActive(id);
    setOpenMenu(null);
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
      [id]: { x: cur.x, y: cur.y, w: cur.w, h: cur.h },
    };
    const v = viewRef.current;
    const cx = (e.clientX - rect.left - v.x) / v.k;
    const cy = (e.clientY - rect.top - v.y) / v.k;
    // If this note is part of a multi-selection, drag all selected notes together.
    const groupOffsets: Record<string, { dx: number; dy: number }> = {};
    if (selectedSet.has(id) && selectedSet.size > 1) {
      const map = layoutRef.current;
      for (const sid of selectedSet) {
        if (sid !== id) {
          const sl = map[sid];
          if (sl) {
            groupOffsets[sid] = { dx: sl.x - cur.x, dy: sl.y - cur.y };
            boxes[sid] = { x: sl.x, y: sl.y, w: sl.w, h: sl.h };
          }
        }
      }
    }
    undoBefore.current = { id, boxes };
    interaction.current = { type: "drag", id, offX: cx - cur.x, offY: cy - cur.y, groupOffsets };
    beginInteraction();
  };

  const startPan = (e: React.PointerEvent) => {
    setActive(null);
    setOpenMenu(null);
    setArrowMenu(null);
    setLinkingFrom(null); // clicking empty space cancels an in-progress connect
    if (!e.shiftKey) setSelectedSet(new Set()); // click empty space clears the selection
    const v = viewRef.current;
    interaction.current = { type: "pan", startX: e.clientX, startY: e.clientY, origX: v.x, origY: v.y };
    beginInteraction();
  };

  // Zoom around a screen point, keeping that point fixed.
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setViewT((prev) => {
      const k = Math.min(2.5, Math.max(0.25, prev.k * factor));
      const cx = (px - prev.x) / prev.k;
      const cy = (py - prev.y) / prev.k;
      return { k, x: px - cx * k, y: py - cy * k };
    });
  }, []);

  const zoomButton = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    zoomAt(rect ? rect.width / 2 : 0, rect ? rect.height / 2 : 0, factor);
  };

  // Frame all stickers in view (works no matter how far they've been dragged).
  const fitAll = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const map = layoutRef.current;
    const ids = Object.keys(map);
    if (!rect || ids.length === 0) {
      setViewT({ x: 0, y: 0, k: 1 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const l = map[id];
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.w);
      maxY = Math.max(maxY, l.y + l.h);
    }
    const pad = 48;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const k = Math.min(1.5, Math.max(0.2, Math.min(rect.width / bw, rect.height / bh)));
    const x = rect.width / 2 - ((minX + maxX) / 2) * k;
    const y = rect.height / 2 - ((minY + maxY) / 2) * k;
    setViewT({ x, y, k });
  }, []);

  // Frame everything once, after the first layout is built.
  useEffect(() => {
    if (didFit.current || !containerW) return;
    if (Object.keys(layout).length === 0) return;
    didFit.current = true;
    fitAll();
  }, [layout, containerW, fitAll]);

  // --- Tidy arrangement: shelf-pack all stickers left→right, wrapping rows.
  // "tag"/"color" sort by the grouping key and start a fresh row at each change,
  // so same-key notes cluster into bands. "grid" keeps the current order.
  const firstTag = (n: Note) => n.ai_keywords?.[0] || n.ai_topics?.[0] || "￿";
  // Order colours by their position in the palette; no-colour notes go last.
  const colorRank = (key: string) => {
    if (!key) return 999;
    const i = STICKY_COLORS.findIndex((c) => c.key === key);
    return i < 0 ? 998 : i;
  };
  const tidyArrange = useCallback(
    (mode: "grid" | "tag" | "color") => {
      const usable = Math.max(W + GAP, (containerRef.current?.clientWidth || containerW || 1000) - GAP);
      // Use the live layout colour (reflects edits), not the stale note prop.
      const colorOf = (n: Note) => layoutRef.current[n.id]?.color || "";
      let ordered = notes;
      if (mode === "tag") ordered = [...notes].sort((a, b) => firstTag(a).localeCompare(firstTag(b)));
      else if (mode === "color") ordered = [...notes].sort((a, b) => colorRank(colorOf(a)) - colorRank(colorOf(b)));
      const pos: Record<string, { x: number; y: number }> = {};
      let x = GAP, y = GAP, rowH = 0;
      let lastKey: string | null = null;
      for (const n of ordered) {
        const l = layoutRef.current[n.id];
        if (!l) continue;
        const key = mode === "tag" ? firstTag(n) : mode === "color" ? colorOf(n) : null;
        const groupBreak = key !== null && lastKey !== null && key !== lastKey;
        if (groupBreak || (x + l.w > usable && x > GAP)) {
          x = GAP;
          y += rowH + GAP;
          rowH = 0;
        }
        pos[n.id] = { x, y };
        x += l.w + GAP;
        rowH = Math.max(rowH, l.h);
        lastKey = key;
      }
      // snapshot current boxes for undo
      const before: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const id in pos) { const l = layoutRef.current[id]; if (l) before[id] = { x: l.x, y: l.y, w: l.w, h: l.h }; }
      setUndoStack((s) => [...s, { type: "layout", positions: before } as UndoEntry].slice(-30));
      setLayout((prev) => {
        const next = { ...prev };
        for (const id in pos) if (next[id]) next[id] = { ...next[id], ...pos[id] };
        return next;
      });
      for (const id in pos) persist(id, pos[id]);
      setTimeout(fitAll, 0);
    },
    [notes, containerW, persist, fitAll]
  );

  // --- Saved arrangements (localStorage). Snapshot every sticker's box now;
  // restore puts them back later (and re-persists so it sticks).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEWS_KEY);
      if (raw) setViews(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const writeViews = (v: SavedView[]) => {
    setViews(v);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  const saveView = () => {
    const positions: SavedView["positions"] = {};
    for (const [id, l] of Object.entries(layoutRef.current)) positions[id] = { x: l.x, y: l.y, w: l.w, h: l.h };
    writeViews([...views, { id: String(Date.now()), name: `Layout ${views.length + 1}`, positions }]);
  };
  const restoreView = (view: SavedView) => {
    const before: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of Object.keys(view.positions)) { const l = layoutRef.current[id]; if (l) before[id] = { x: l.x, y: l.y, w: l.w, h: l.h }; }
    setUndoStack((s) => [...s, { type: "layout", positions: before } as UndoEntry].slice(-30));
    setLayout((prev) => {
      const next = { ...prev };
      for (const [id, p] of Object.entries(view.positions)) if (next[id]) next[id] = { ...next[id], ...p };
      return next;
    });
    for (const [id, p] of Object.entries(view.positions)) if (layoutRef.current[id]) persist(id, p);
    setTimeout(fitAll, 0);
  };
  const deleteView = (id: string) => writeViews(views.filter((v) => v.id !== id));

  // --- Undo: pop the last change and revert it (restore arrows or positions). ---
  const restoreLayout = (positions: Record<string, { x: number; y: number; w: number; h: number }>) => {
    setLayout((prev) => {
      const next = { ...prev };
      for (const [id, p] of Object.entries(positions)) if (next[id]) next[id] = { ...next[id], ...p };
      return next;
    });
    for (const [id, p] of Object.entries(positions)) if (layoutRef.current[id]) persist(id, p);
    setTimeout(fitAll, 0);
  };
  const restoreLinks = async (saved: { id: string; from_note: string; to_note: string; curved?: boolean }[]) => {
    mutatingLinks.current = true;
    try {
      for (const lk of saved) {
        try {
          const res = await apiFetch("/api/notes/links", { method: "POST", body: JSON.stringify({ from: lk.from_note, to: lk.to_note }) });
          if (res.ok && lk.curved) {
            const data = await res.json();
            if (data?.link?.id) await apiFetch("/api/notes/links", { method: "PATCH", body: JSON.stringify({ id: data.link.id, curved: true }) });
          }
        } catch { /* ignore one */ }
      }
    } finally {
      mutatingLinks.current = false;
    }
    fetchLinks();
  };
  const undo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    if (last.type === "links") restoreLinks(last.links);
    else restoreLayout(last.positions);
  };

  // Ctrl+Z / Cmd+Z triggers undo (unless you're typing in a field/sticker editor).
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.code !== "KeyZ") return; // e.code = physical key (any layout)
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Native non-passive wheel: ctrl/⌘+wheel zooms to cursor, plain wheel pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      setArrowMenu(null); // the canvas is moving — detach any open arrow menu
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
        return;
      }
      e.preventDefault();
      // Normalise wheel units (line/page mode) and cap the per-event step so a
      // mouse wheel pans smoothly instead of jumping in big chunks.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const clamp = (d: number) => Math.max(-60, Math.min(60, d * unit));
      const dx = clamp(e.deltaX);
      const dy = clamp(e.deltaY);
      setViewT((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const startResize = (
    id: string,
    e: React.PointerEvent,
    dirs: { l?: boolean; r?: boolean; t?: boolean; b?: boolean }
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const cur = layout[id];
    if (!cur) return;
    setActive(id);
    undoBefore.current = { id, boxes: { [id]: { x: cur.x, y: cur.y, w: cur.w, h: cur.h } } };
    interaction.current = {
      type: "resize",
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: cur.x,
      origY: cur.y,
      origW: cur.w,
      origH: cur.h,
      l: !!dirs.l,
      r: !!dirs.r,
      t: !!dirs.t,
      b: !!dirs.b,
    };
    beginInteraction();
  };

  const applyStyle = (id: string, patch: Partial<Layout>) => {
    setLayout((p) => (p[id] ? { ...p, [id]: { ...p[id], ...patch } } : p));
    persist(id, patch);
    setOpenMenu(null);
    // Push color/font changes to the parent's notes state so the list view stays
    // in sync without a full refetch (which could race against the in-flight PATCH).
    if ('color' in patch) onNoteUpdate?.(id, { color: patch.color || null });
    if ('font' in patch) onNoteUpdate?.(id, { font: patch.font || null });
  };

  const remove = async (id: string) => {
    const ok = await confirm({ title: "Delete this note?", confirmText: "Delete", destructive: true });
    if (!ok) return;
    await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
    setLayout((p) => {
      const { [id]: _drop, ...rest } = p;
      return rest;
    });
    onChanged?.();
  };

  const deleteSelected = async () => {
    if (selectedSet.size === 0) return;
    const ok = await confirm({
      title: "Move to trash?",
      description: `The selected notes (${selectedSet.size}) will be moved to the trash.`,
      confirmText: "Move to trash",
      destructive: true,
    });
    if (!ok) return;
    const ids = Array.from(selectedSet);
    await Promise.all(ids.map((id) => apiFetch(`/api/notes/${id}`, { method: "DELETE" })));
    setLayout((p) => {
      const next = { ...p };
      for (const id of ids) delete next[id];
      return next;
    });
    setSelectedSet(new Set());
    onChanged?.();
  };

  const saveText = useCallback(
    (id: string, html: string) => {
      setEditingText(null);
      const clean = sanitizeHtml(html);
      if (!stripHtml(clean).trim()) return; // ignore empty edits, keep the old text
      apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ text: clean }) })
        .then(() => onChanged?.())
        .catch(() => {});
    },
    [apiFetch, onChanged]
  );

  const zoomPct = Math.round(viewT.k * 100);

  // Precompute arrow paths only when links/positions change — not every pan frame.
  const arrowGeoms = useMemo(() => {
    return links
      .map((lk) => {
        const a = layout[lk.from_note];
        const b = layout[lk.to_note];
        if (!a || !b) return null;
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const p1 = borderPoint(acx, acy, a.w / 2, a.h / 2, bcx, bcy);
        const p2 = borderPoint(bcx, bcy, b.w / 2, b.h / 2, acx, acy);
        let d: string;
        if (lk.curved) {
          const ex = p2.x - p1.x, ey = p2.y - p1.y;
          const len = Math.hypot(ex, ey) || 1;
          // Gentle, near-constant bow (~28px) so the arc stays natural at any
          // distance and doesn't balloon/morph while a note is dragged around.
          const off = Math.min(28, len * 0.35);
          const cpx = (p1.x + p2.x) / 2 + (-ey / len) * off;
          const cpy = (p1.y + p2.y) / 2 + (ex / len) * off;
          d = `M${p1.x},${p1.y} Q${cpx},${cpy} ${p2.x},${p2.y}`;
        } else {
          d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
        }
        return { id: lk.id, curved: !!lk.curved, d };
      })
      .filter(Boolean) as { id: string; curved: boolean; d: string }[];
  }, [links, layout]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden bg-muted/20 touch-none",
        fullscreen ? "h-full" : "rounded-xl border border-dashed border-border/70"
      )}
      style={{
        height: fullscreen ? "100%" : "72vh",
        minHeight: fullscreen ? undefined : 480,
        cursor: "grab",
        backgroundImage: DOT_BG,
        backgroundSize: `${24 * viewT.k}px ${24 * viewT.k}px`,
        backgroundPosition: `${viewT.x}px ${viewT.y}px`,
      }}
      onPointerDown={startPan}
    >
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${viewT.x}px, ${viewT.y}px) scale(${viewT.k})`, transformOrigin: "0 0" }}
      >
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
        <defs>
          <marker id="wall-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#3b82f6" />
          </marker>
        </defs>
        {arrowGeoms.map((g) => (
          <g key={g.id}>
            <path
              d={g.d} fill="none" stroke="transparent" strokeWidth={16}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setArrowMenu({ id: g.id, curved: g.curved, x: e.clientX, y: e.clientY });
              }}
            />
            <path
              d={g.d} fill="none" stroke="#3b82f6" strokeWidth={2} markerEnd="url(#wall-arrow)"
              style={{ pointerEvents: "none" }}
            />
          </g>
        ))}
      </svg>
      {notes.map((n) => {
        const l = layout[n.id];
        if (!l) return null;
        const isActive = active === n.id;
        const menu = openMenu?.id === n.id ? openMenu.kind : null;
        const st = tagsOf(n);
        return (
          <NoteContextMenu key={n.id} note={n} onChanged={onChanged}>
          <div
            className={cn(
              "absolute flex flex-col rounded-lg shadow-md select-none touch-none group bg-card border border-border/40",
              noteColorClass(l.color),
              isActive && "shadow-xl ring-2 ring-black/10",
              selectedSet.has(n.id) && "ring-2 ring-primary",
              linkingFrom === n.id && "ring-2 ring-blue-500",
              // Keep the active note AND every selected note above the rest, so a
              // multi-selection drags as one layer on top instead of sliding under.
              isActive || selectedSet.has(n.id) ? "z-20" : "z-10"
            )}
            style={{
              left: l.x,
              top: l.y,
              width: l.w,
              height: l.h,
              fontFamily: FONT_MAP[l.font] ?? FONT_MAP[DEFAULT_FONT],
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return; // right/middle click → let the context menu handle it
              if (linkingFrom) {
                if (linkingFrom !== n.id) createLink(linkingFrom, n.id);
                else setLinkingFrom(null);
                return;
              }
              if (e.shiftKey) {
                toggleSelectSticker(n.id);
                return;
              }
              startDrag(n.id, e);
            }}
          >
            {/* toolbar (drag is disabled here) */}
            <div
              className={cn(
                "relative z-10 flex items-center justify-end gap-0.5 px-1 pt-1 transition-opacity",
                isActive || editingText === n.id ? "opacity-100" : "opacity-60 group-hover:opacity-100"
              )}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title={editingText === n.id ? "Done" : "Edit text"}
                onClick={() => setEditingText(editingText === n.id ? null : n.id)}
                className="rounded p-1 text-current opacity-80 hover:bg-foreground/10"
              >
                {editingText === n.id ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                title="Color"
                onClick={() => setOpenMenu(menu === "color" ? null : { id: n.id, kind: "color" })}
                className="rounded p-1 text-current opacity-80 hover:bg-foreground/10"
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Font"
                onClick={() => setOpenMenu(menu === "font" ? null : { id: n.id, kind: "font" })}
                className="rounded p-1 text-current opacity-80 hover:bg-foreground/10"
              >
                <TypeIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Link to another note with an arrow"
                onClick={() => setLinkingFrom(linkingFrom === n.id ? null : n.id)}
                className={cn("rounded p-1 text-current opacity-80 hover:bg-foreground/10", linkingFrom === n.id && "bg-foreground/20")}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Open"
                onClick={() => (onOpen ? onOpen(n.id) : router.push(`/notes/${n.id}`))}
                className="rounded p-1 text-current opacity-80 hover:bg-foreground/10"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => remove(n.id)}
                className="rounded p-1 text-current opacity-80 hover:bg-foreground/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* color / font popover */}
            {menu && (
              <div
                className="absolute right-1 top-9 z-30 rounded-lg border border-border bg-popover p-2 shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {menu === "color" ? (
                  <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
                    <button
                      title="No color"
                      onClick={() => applyStyle(n.id, { color: "" })}
                      className={cn(
                        "h-6 w-6 rounded-full border border-border bg-card",
                        !l.color && "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                      )}
                    />
                    {STICKY_COLORS.map((c) => (
                      <button
                        key={c.key}
                        title={c.label}
                        onClick={() => applyStyle(n.id, { color: c.key })}
                        className={cn(
                          "h-6 w-6 rounded-full border border-black/10",
                          l.color === c.key && "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                        )}
                        style={{ background: c.bg }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex w-36 flex-col gap-0.5">
                    {STICKY_FONTS.map((f) => (
                      <button
                        key={f.key}
                        onClick={() => applyStyle(n.id, { font: f.key })}
                        style={{ fontFamily: f.css }}
                        className={cn(
                          "rounded px-2 py-1 text-left text-sm text-popover-foreground hover:bg-accent",
                          l.font === f.key && "bg-accent font-semibold"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* body */}
            <div
              className={cn(
                "flex flex-1 flex-col px-3 pb-3",
                editingText === n.id ? "overflow-auto" : "overflow-hidden cursor-grab active:cursor-grabbing"
              )}
              onPointerDown={(e) => {
                if (editingText === n.id) e.stopPropagation();
              }}
              // Double-click opens the note in the modal (like the list view);
              // use the ✎ button for quick inline editing.
              onDoubleClick={() => {
                if (editingText !== n.id) (onOpen ? onOpen(n.id) : router.push(`/notes/${n.id}`));
              }}
            >
              {n.media_url && <NoteMedia url={n.media_url} type={n.media_type} className="mb-2 max-h-28" />}
              {editingText === n.id ? (
                <StickyEditor
                  initialHtml={noteToHtml(n.text)}
                  onSave={(html) => saveText(n.id, html)}
                  onCancel={() => setEditingText(null)}
                />
              ) : (
                <>
                  <div
                    className={cn("flex-1 text-sm leading-snug break-words", RICH)}
                    dangerouslySetInnerHTML={{ __html: noteToHtml(n.text) }}
                  />
                  <OriginalToggle note={n} />
                </>
              )}
            </div>

            {/* tags footer — click chip to edit, hover X to remove, + to add */}
            <div
              className="relative z-10 flex flex-wrap items-center gap-1 px-2 pb-2"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {st.keywords.map((kw, i) =>
                editingTag?.noteId === n.id && editingTag?.kw === kw ? (
                  <div key={`edit-${i}-${kw}`} className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      list="tg-all-tags"
                      defaultValue={kw}
                      onBlur={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        if (v && v !== kw) { renameStickerTagColor(kw, v); renameStickerKeyword(n, kw, v); }
                        else if (!v) removeStickerKeyword(n, kw);
                        setEditingTag(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = (e.target as HTMLInputElement).value.trim().toLowerCase();
                          if (v && v !== kw) { renameStickerTagColor(kw, v); renameStickerKeyword(n, kw, v); }
                          else if (!v) removeStickerKeyword(n, kw);
                          setEditingTag(null);
                        } else if (e.key === "Escape") {
                          setEditingTag(null);
                        }
                      }}
                      className="h-4 w-16 rounded border border-input bg-background/80 px-1 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                    />
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title="No color"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyStickerTagColor(n.id, kw, null)}
                        className={cn("h-3 w-3 rounded-full border border-border bg-card", !colors[kw] && "ring-1 ring-foreground ring-offset-[1px]")}
                      />
                      {TAG_COLOR_OPTIONS.map(c => (
                        <button
                          key={c.key}
                          type="button"
                          title={c.label}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyStickerTagColor(n.id, kw, c.key)}
                          className={cn("h-3 w-3 rounded-full border border-black/10", colors[kw] === c.key && "ring-1 ring-foreground ring-offset-[1px]")}
                          style={{ background: c.dot }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span
                    key={`k-${i}-${kw}`}
                    className={cn(
                      "group/tag inline-flex items-center gap-0.5 rounded border border-transparent px-1.5 py-0.5 text-[10px] cursor-text",
                      colorClass(kw)
                    )}
                    onClick={() => setEditingTag({ noteId: n.id, kw })}
                    title="Click to edit"
                  >
                    {kw}
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeStickerKeyword(n, kw); }}
                      className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
                      title="Remove tag"
                    >
                      <X className="h-2 w-2" />
                    </button>
                  </span>
                )
              )}
              {addingTagNoteId === n.id ? (
                <input
                  autoFocus
                  list="tg-all-tags"
                  value={addTagInput}
                  onChange={(e) => setAddTagInput(e.target.value)}
                  onBlur={() => {
                    const v = addTagInput.trim().toLowerCase();
                    if (v) addStickerKeyword(n, v);
                    setAddTagInput("");
                    setAddingTagNoteId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = addTagInput.trim().toLowerCase();
                      if (v) addStickerKeyword(n, v);
                      setAddTagInput("");
                      setAddingTagNoteId(null);
                    } else if (e.key === "Escape") {
                      setAddTagInput("");
                      setAddingTagNoteId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="tag…"
                  className="h-4 w-16 rounded border border-input bg-background/80 px-1 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTagNoteId(n.id)}
                  title="Add tag"
                  className="inline-flex h-4 items-center gap-0.5 rounded px-1 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity bg-foreground/10"
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
              )}
            </div>

            {/* resize handles — all 4 edges + 4 corners; z-20 so the tags footer
                doesn't cover the bottom ones */}
            {RESIZE_HANDLES.map((h, i) => (
              <div
                key={i}
                onPointerDown={(e) => startResize(n.id, e, h.dirs)}
                className={cn("absolute z-20", h.cls)}
              />
            ))}
          </div>
          </NoteContextMenu>
        );
      })}
      </div>

      {notes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No notes yet
        </div>
      )}

      {/* arrangement controls (bottom-centre): undo / tidy / by-tag / saved views */}
      <div
        className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {undoStack.length > 0 && (
          <>
            <button
              type="button"
              title="Undo the last change (restore arrows / layout)"
              onClick={undo}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Undo</span>
            </button>
            <div className="mx-0.5 h-6 w-px bg-border" />
          </>
        )}
        <button
          type="button"
          title="Arrange in a neat grid"
          onClick={() => tidyArrange("grid")}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Grid</span>
        </button>
        <button
          type="button"
          title="Group by tags"
          onClick={() => tidyArrange("tag")}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Tags className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">By tags</span>
        </button>
        <button
          type="button"
          title="Group by color"
          onClick={() => tidyArrange("color")}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Palette className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">By color</span>
        </button>
        {links.length > 0 && (
          <button
            type="button"
            title="Remove all link arrows"
            onClick={clearAllLinks}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Unlink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Arrows</span>
          </button>
        )}
        <div className="mx-0.5 h-6 w-px bg-border" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Saved layouts"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <Bookmark className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Views</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-72 w-56 overflow-auto">
            <DropdownMenuItem onClick={saveView}>
              <Save className="mr-2 h-4 w-4" />
              Save the current view
            </DropdownMenuItem>
            {views.length > 0 && <DropdownMenuSeparator />}
            {views.map((v) => (
              <div key={v.id} className="flex items-center">
                <button
                  onClick={() => restoreView(v)}
                  className="flex-1 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {v.name}
                </button>
                <button
                  onClick={() => deleteView(v.id)}
                  title="Delete view"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {views.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* zoom controls (fixed in the viewport, not panned/zoomed) */}
      <div
        className="absolute bottom-3 left-3 z-40 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomButton(0.85)}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-[2.75rem] text-center text-xs font-medium tabular-nums">{zoomPct}%</span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomButton(1.18)}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Show all notes"
          onClick={fitAll}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          All
        </button>
      </div>

      {linkingFrom && (
        <div
          className="absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg border border-blue-400/50 bg-card/95 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Click a second note to link it with an arrow · Esc to cancel
        </div>
      )}

      {selectedSet.size > 0 && (
        <div
          className="absolute top-32 left-1/2 z-40 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-card/95 px-3 py-2 shadow-md backdrop-blur md:top-20"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-xs font-medium whitespace-nowrap">Selected: {selectedSet.size}</span>

          <div className="h-5 w-px bg-border" />

          {/* Bulk colour */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="No color"
              onClick={() => Array.from(selectedSet).forEach(id => applyStyle(id, { color: '' }))}
              className="h-5 w-5 rounded-full border border-border bg-background hover:ring-1 hover:ring-foreground"
            />
            {STICKY_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                onClick={() => Array.from(selectedSet).forEach(id => applyStyle(id, { color: c.key }))}
                className="h-5 w-5 rounded-full border border-black/10 hover:ring-1 hover:ring-foreground"
                style={{ background: c.bg }}
              />
            ))}
          </div>

          <div className="h-5 w-px bg-border" />

          {/* Bulk tag add/remove */}
          <div className="flex items-center gap-1">
            <input
              list="tg-all-tags"
              value={bulkTagInput}
              onChange={(e) => setBulkTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  bulkAddTagWall();
                } else if (e.key === "Escape") {
                  setBulkTagInput("");
                }
              }}
              placeholder="tag…"
              className="h-6 w-20 rounded-md border border-input bg-background/80 px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              title="Add this tag to the selected"
              onClick={bulkAddTagWall}
              disabled={!bulkTagInput.trim()}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input hover:bg-accent disabled:opacity-40"
            >
              <span className="relative inline-flex">
                <Tag className="h-3.5 w-3.5" />
                <Plus className="absolute -right-1.5 -top-1.5 h-2 w-2" strokeWidth={3} />
              </span>
            </button>
            <button
              type="button"
              title="Remove this tag from the selected"
              onClick={bulkRemoveTagWall}
              disabled={!bulkTagInput.trim()}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input hover:bg-accent disabled:opacity-40"
            >
              <span className="relative inline-flex">
                <Tag className="h-3.5 w-3.5" />
                <Minus className="absolute -right-1.5 -top-1.5 h-2 w-2" strokeWidth={3} />
              </span>
            </button>
          </div>

          <div className="h-5 w-px bg-border" />

          <button
            type="button"
            onClick={deleteSelected}
            className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" /> Move to trash
          </button>
          <button
            type="button"
            onClick={() => setSelectedSet(new Set())}
            className="rounded-md px-2 py-1 text-xs hover:bg-accent"
          >
            Clear
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-16 left-3 z-40 max-w-[min(92%,40rem)] rounded-lg border border-border bg-card/90 px-3.5 py-2.5 text-sm leading-relaxed text-foreground shadow-sm backdrop-blur">
        <span className="font-medium">Tips:</span> drag empty space to pan the canvas ·
        Ctrl + wheel to zoom · Shift + click a note to select ·
        the 🔗 button on a note links it with an arrow
      </div>

      {arrowMenu && (
        <div
          className="fixed z-50 flex w-44 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
          style={{
            left: Math.min(arrowMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 188),
            top: Math.min(arrowMenu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 96),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setLinkCurved(arrowMenu.id, !arrowMenu.curved)}
            className="rounded px-2 py-1 text-left hover:bg-accent"
          >
            {arrowMenu.curved ? "Make straight" : "Make curved"}
          </button>
          <button
            onClick={() => deleteLink(arrowMenu.id)}
            className="rounded px-2 py-1 text-left text-destructive hover:bg-accent"
          >
            Delete link
          </button>
        </div>
      )}
    </div>
  );
}
