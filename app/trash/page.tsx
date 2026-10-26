"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useApi } from "@/hooks/use-api";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NoteMedia } from "@/components/notes/note-media";
import { OriginalToggle } from "@/components/notes/original-toggle";
import { useConfirm } from "@/components/ui/confirm-provider";
import { toast } from "sonner";
import { Trash2, RotateCcw, ArrowLeft, Loader2, Clock, Check } from "lucide-react";
import { cn, formatRelativeDate, noteToHtml, RICH_CLASS, stripHtml, truncate } from "@/lib/utils";
import type { Note } from "@/types";

const RICH = RICH_CLASS;

export default function TrashPage() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const { confirm } = useConfirm();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<Note | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // --- Marquee (rubber-band) selection ---
  const listRef = useRef<HTMLElement>(null);
  const [marquee, setMarquee] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef<{ ax: number; ay: number; clientX: number; clientY: number; base: Set<string>; moved: boolean; onCard: boolean } | null>(null);
  const autoScroll = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const fetchTrash = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch("/api/notes/trash");
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (err) {
      console.error("Trash fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, apiFetch]);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const restore = async (id: string) => {
    setBusy(id);
    try {
      const res = await apiFetch(`/api/notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ restore: true }),
      });
      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setOpenNote((cur) => (cur?.id === id ? null : cur));
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }
    } finally {
      setBusy(null);
    }
  };

  const deleteForever = async (id: string) => {
    const ok = await confirm({
      title: "Delete forever?",
      description: "This can't be undone — the note will be gone for good.",
      confirmText: "Delete forever",
      destructive: true,
    });
    if (!ok) return;
    setBusy(id);
    try {
      const res = await apiFetch(`/api/notes/${id}?permanent=1`, { method: "DELETE" });
      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setOpenNote((cur) => (cur?.id === id ? null : cur));
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }
    } finally {
      setBusy(null);
    }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelectedIds(new Set());

  const bulkRestore = async () => {
    if (selectedIds.size === 0) return;
    // FIX: capture snapshot BEFORE any async work — closure is stale after awaits
    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    try {
      // FIX: collect responses and only remove notes where server confirmed ok
      const results = await Promise.all(
        ids.map((id) =>
          apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ restore: true }) })
            .then((res) => ({ id, ok: res.ok }))
            .catch(() => ({ id, ok: false }))
        )
      );
      const restored = new Set(results.filter((r) => r.ok).map((r) => r.id));
      const failed = ids.length - restored.size;
      if (restored.size > 0) {
        setNotes((prev) => prev.filter((n) => !restored.has(n.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          restored.forEach((id) => next.delete(id));
          return next;
        });
        if (failed > 0) {
          toast.error(`Restored ${restored.size}, failed ${failed}`);
        } else {
          toast.success(`Restored ${restored.size} notes`);
        }
      } else {
        toast.error("Couldn't restore the notes");
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDeleteForever = async () => {
    if (selectedIds.size === 0) return;
    // FIX: capture snapshot BEFORE confirm dialog opens so the count shown
    // in the dialog matches what actually gets deleted, regardless of checkbox
    // changes while the dialog is open.
    const ids = Array.from(selectedIds);
    const ok = await confirm({
      title: "Delete forever?",
      description: `The selected notes (${ids.length}) will be gone for good — this can't be undone.`,
      confirmText: "Delete forever",
      destructive: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      // FIX: collect responses and only remove notes where server confirmed ok
      const results = await Promise.all(
        ids.map((id) =>
          apiFetch(`/api/notes/${id}?permanent=1`, { method: "DELETE" })
            .then((res) => ({ id, ok: res.ok }))
            .catch(() => ({ id, ok: false }))
        )
      );
      const deleted = new Set(results.filter((r) => r.ok).map((r) => r.id));
      const failed = ids.length - deleted.size;
      if (deleted.size > 0) {
        setNotes((prev) => prev.filter((n) => !deleted.has(n.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          deleted.forEach((id) => next.delete(id));
          return next;
        });
        if (failed > 0) {
          toast.error(`Deleted ${deleted.size}, failed ${failed}`);
        } else {
          toast.success(`Deleted ${deleted.size} notes forever`);
        }
      } else {
        toast.error("Couldn't delete the notes");
      }
    } finally {
      setBulkBusy(false);
    }
  };

  // FIX: check actual membership, not just sizes — sizes can coincidentally match
  const allSelected = notes.length > 0 && notes.every((n) => selectedIds.has(n.id));
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(notes.map((n) => n.id)));

  // --- Marquee helpers ---
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
      const r = node.getBoundingClientRect();
      const nl = r.left - mr.left, nt = r.top - mr.top, nr = r.right - mr.left, nb = r.bottom - mr.top;
      if (nl < right && nr > left && nt < bottom && nb > top) sel.add(node.dataset.noteId!);
    });
    setSelectedIds(sel);
  }, []);

  const autoScrollTick = useCallback(() => {
    const m = marqueeRef.current;
    if (!m) { autoScroll.current = null; return; }
    if (m.moved) {
      const EDGE = 70, MAX = 18;
      const vh = window.innerHeight;
      let dy = 0;
      if (m.clientY > vh - EDGE) dy = MAX * Math.min(1, (m.clientY - (vh - EDGE)) / EDGE);
      else if (m.clientY < EDGE) dy = -MAX * Math.min(1, (EDGE - m.clientY) / EDGE);
      if (dy) { window.scrollBy(0, dy); updateMarquee(); }
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
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
    } else if (!m.onCard) {
      setSelectedIds(new Set());
    }
  }, [onMarqueeMove]);

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

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileNav />
      <main
        ref={listRef}
        onPointerDown={onListPointerDown}
        onDragStart={(e) => e.preventDefault()}
        className="relative min-h-screen md:pl-[var(--sidebar-w)] transition-[padding] duration-300"
      >
        <div className="md:hidden h-14" />
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6 md:pt-16">
          <Button data-no-marquee variant="ghost" size="sm" onClick={() => router.push("/notes")} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to notes
          </Button>
          <div data-no-marquee>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Trash2 className="h-6 w-6" />
              Trash
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Deleted notes are kept for 30 days, then removed automatically.{" "}
              {notes.length > 0 && `Now: ${notes.length}`}
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Trash2 className="h-12 w-12 text-muted-foreground/50 mx-auto" />
              <p className="text-muted-foreground text-sm">The trash is empty</p>
            </div>
          ) : (
            <>
              {/* "Select all" header row */}
              <div data-no-marquee className="flex items-center gap-3 pb-1 border-b border-border">
                <button
                  type="button"
                  onClick={toggleAll}
                  title={allSelected ? "Deselect all" : "Select all"}
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                    allSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40 hover:border-primary"
                  )}
                >
                  {allSelected && <Check className="h-3 w-3" />}
                </button>
                <span className="text-xs text-muted-foreground select-none">
                  {selectedIds.size > 0
                    ? `Selected: ${selectedIds.size} of ${notes.length}`
                    : "Tick the box, click a card or drag to select"}
                </span>
              </div>

              <div className="space-y-2">
                {notes.map((note) => {
                  const isSelected = selectedIds.has(note.id);
                  return (
                    <div key={note.id} data-note-id={note.id}>
                      {/* FIX: onClick on Card so the entire card surface (incl. padding) opens the note */}
                      <Card
                        className={cn(
                          "group cursor-pointer transition-all hover:shadow-md",
                          isSelected && "ring-2 ring-primary bg-primary/5"
                        )}
                        onClick={() => {
                          if (suppressClick.current) return;
                          setOpenNote(note);
                        }}
                      >
                        <CardContent className="p-4 flex items-start gap-3">
                          {/* FIX: disabled during bulkBusy so it can't mutate selectedIds mid-flight */}
                          <button
                            type="button"
                            data-no-marquee
                            disabled={bulkBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(note.id);
                            }}
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-all",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground opacity-100"
                                : "border-muted-foreground/40 opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                              bulkBusy && "opacity-40 cursor-not-allowed"
                            )}
                            title={isSelected ? "Deselect" : "Select"}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </button>

                          {/* Note text — click propagates up to Card */}
                          <div className="min-w-0 flex-1 space-y-1 pointer-events-none">
                            <p className="text-sm break-words line-clamp-3">
                              {truncate(stripHtml(note.text) || "(no text)", 200)}
                            </p>
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              deleted {formatRelativeDate(note.deleted_at)}
                            </p>
                          </div>

                          {/* Per-note actions — stopPropagation prevents opening the note */}
                          <div
                            data-no-marquee
                            className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => restore(note.id)}
                              disabled={busy === note.id || bulkBusy}
                              title="Restore"
                            >
                              {busy === note.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1 hidden sm:inline">Restore</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive"
                              onClick={() => deleteForever(note.id)}
                              disabled={busy === note.id || bulkBusy}
                              title="Delete forever"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Marquee rectangle */}
        {marquee && (
          <div
            className="pointer-events-none absolute z-40 rounded border border-primary/60 bg-primary/10"
            style={{ left: marquee.l, top: marquee.t, width: marquee.w, height: marquee.h }}
          />
        )}
      </main>

      {/* Floating bulk-action toolbar */}
      {selectedIds.size > 0 && (
        <div
          data-no-marquee
          className="fixed bottom-5 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{ left: "calc(50% + var(--sidebar-w) / 2)" }}
        >
          <span className="px-1 text-sm font-medium">Selected: {selectedIds.size}</span>
          <Button variant="ghost" size="sm" onClick={toggleAll} disabled={bulkBusy}>
            {allSelected ? "Deselect all" : "All"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection} disabled={bulkBusy}>
            Clear
          </Button>
          <div className="mx-0.5 h-6 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={bulkRestore} disabled={bulkBusy}>
            {bulkBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            <span className="ml-1 hidden sm:inline">Restore</span>
          </Button>
          <Button variant="destructive" size="sm" onClick={bulkDeleteForever} disabled={bulkBusy}>
            {bulkBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            <span className="ml-1 hidden sm:inline">Delete forever</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy}>
            Done
          </Button>
        </div>
      )}

      {/* Read deleted note in full */}
      <Dialog open={!!openNote} onOpenChange={(o) => { if (!o) setOpenNote(null); }}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">Deleted note</DialogTitle>
          {openNote && (
            <div className="space-y-4">
              {openNote.media_url && (
                <NoteMedia url={openNote.media_url} type={openNote.media_type} className="max-h-[26rem]" />
              )}
              <div
                className={cn("text-sm leading-relaxed break-words", RICH)}
                dangerouslySetInnerHTML={{ __html: noteToHtml(openNote.text) }}
              />
              <OriginalToggle note={openNote} />
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                deleted {formatRelativeDate(openNote.deleted_at)}
              </p>
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restore(openNote.id)}
                  disabled={busy === openNote.id}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteForever(openNote.id)}
                  disabled={busy === openNote.id}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete forever
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
