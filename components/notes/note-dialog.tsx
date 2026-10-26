"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/use-api";
import { useTagColors } from "@/contexts/tag-colors-context";
import { useConfirm } from "@/components/ui/confirm-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NoteMedia } from "@/components/notes/note-media";
import { RichTextEditor } from "@/components/notes/rich-text-editor";
import { OriginalToggle } from "@/components/notes/original-toggle";
import { STICKY_COLORS, COLOR_MAP, noteColorClass } from "@/lib/sticky";
import {
  cn,
  formatDate,
  formatRelativeDate,
  noteToHtml,
  RICH_CLASS,
  stripHtml,
  TAG_COLOR_OPTIONS,
} from "@/lib/utils";
import { toast } from "sonner";
import {
  Pencil,
  Save,
  Trash2,
  Palette,
  Pin,
  X,
  Plus,
  Loader2,
  Clock,
  Calendar,
  Tag,
  Maximize2,
  Share2,
} from "lucide-react";
import type { Note } from "@/types";

const RICH = RICH_CLASS;

interface NoteDialogProps {
  noteId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

// Google-Keep-style note view: opens in place as a centered modal over a dimmed
// backdrop (no page navigation). Edit text, tags, colour, pin and delete inline.
export function NoteDialog({ noteId, onClose, onChanged }: NoteDialogProps) {
  const router = useRouter();
  const { apiFetch } = useApi();
  const { colorClass, setTagColor } = useTagColors();
  const { confirm } = useConfirm();

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [showColors, setShowColors] = useState(false);
  const [sharing, setSharing] = useState(false);

  const open = !!noteId;

  const fetchNote = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/notes/${noteId}`);
      if (res.ok) {
        const data = await res.json();
        setNote(data.note);
      }
    } catch (err) {
      console.error("Fetch note error:", err);
    } finally {
      setLoading(false);
    }
  }, [noteId, apiFetch]);

  // (Re)load whenever a different note is opened; reset transient UI.
  useEffect(() => {
    if (!noteId) {
      setNote(null);
      setEditing(false);
      setShowColors(false);
      return;
    }
    setEditing(false);
    setShowColors(false);
    fetchNote();
  }, [noteId, fetchNote]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!noteId) return;
      // Optimistic: apply locally first, so rapid consecutive edits (two tags
      // added back-to-back) each build on the latest state instead of the second
      // PATCH overwriting the first.
      setNote((prev) => (prev ? ({ ...prev, ...body } as typeof prev) : prev));
      const res = await apiFetch(`/api/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(body) });
      if (res.ok) {
        const data = await res.json();
        setNote(data.note);
        onChanged?.();
      }
    },
    [noteId, apiFetch, onChanged]
  );

  const saveText = async () => {
    if (!noteId || saving || !stripHtml(editText).trim()) return;
    setSaving(true);
    try {
      await patch({ text: editText });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!noteId) return;
    const ok = await confirm({ title: "Delete this note?", confirmText: "Delete", destructive: true });
    if (!ok) return;
    await apiFetch(`/api/notes/${noteId}`, { method: "DELETE" });
    onChanged?.();
    onClose();
  };

  const shareNote = async () => {
    if (!noteId || sharing) return;
    setSharing(true);
    try {
      const res = await apiFetch(`/api/notes/${noteId}/share`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(data.shareUrl);
        toast.success("Link copied to the clipboard");
      } else {
        // Fallback: copy the notes page URL
        const url = `${window.location.origin}/notes/${noteId}`;
        await navigator.clipboard.writeText(url);
        toast.success("Link copied (signed-in users only)");
      }
    } catch {
      toast.error("Couldn't copy the link");
    } finally {
      setSharing(false);
    }
  };

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    setNewKeyword("");
    const cur = note?.ai_keywords || [];
    if (!kw || cur.includes(kw)) return;
    patch({ ai_keywords: [...cur, kw] });
  };
  const removeKeyword = (kw: string) => {
    patch({ ai_keywords: (note?.ai_keywords || []).filter((k) => k !== kw) });
  };

  const colored = !!note?.color && !!COLOR_MAP[note.color];
  const iconBtn = "rounded-md p-1.5 hover:bg-foreground/10";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        // Larger standard size so even short notes look full; long notes scroll.
        className={cn(
          "flex max-h-[88vh] min-h-[60vh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-y-auto p-0",
          noteColorClass(note?.color)
        )}
      >
        <DialogTitle className="sr-only">Note</DialogTitle>

        {loading && !note ? (
          <div className="flex h-44 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !note ? (
          <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
            Note not found
          </div>
        ) : (
          <>
            {/* toolbar (pr-12 keeps clear of the built-in ✕) */}
            <div className="relative flex items-center gap-0.5 px-3 pt-3 pr-12">
              <button
                type="button"
                title={note.pinned ? "Unpin" : "Pin"}
                onClick={() => patch({ pinned: !note.pinned })}
                className={iconBtn}
              >
                <Pin className={cn("h-4 w-4", note.pinned && "fill-current")} />
              </button>
              <button type="button" title="Color" onClick={() => setShowColors((v) => !v)} className={iconBtn}>
                <Palette className="h-4 w-4" />
              </button>
              {!editing && (
                <button
                  type="button"
                  title="Edit text"
                  onClick={() => {
                    setEditText(noteToHtml(note.text));
                    setEditing(true);
                  }}
                  className={iconBtn}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              <button type="button" title="Delete" onClick={remove} className={iconBtn}>
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Share (copy link)"
                onClick={shareNote}
                disabled={sharing}
                className={iconBtn}
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                title="Open on its own page"
                onClick={() => router.push(`/notes/${note.id}`)}
                className={cn(iconBtn, "ml-auto")}
              >
                <Maximize2 className="h-4 w-4" />
              </button>

              {showColors && (
                <div
                  className="absolute left-10 top-12 z-10 rounded-lg border border-border bg-popover p-2 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
                    <button
                      type="button"
                      title="No color"
                      onClick={() => { patch({ color: null }); setShowColors(false); }}
                      className={cn(
                        "h-6 w-6 rounded-full border border-border bg-card",
                        !note.color && "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                      )}
                    />
                    {STICKY_COLORS.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        title={c.label}
                        onClick={() => { patch({ color: c.key }); setShowColors(false); }}
                        className={cn(
                          "h-6 w-6 rounded-full border border-black/10",
                          note.color === c.key && "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                        )}
                        style={{ background: c.bg }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* body */}
            <div className="flex-1 space-y-4 px-5 pb-5 pt-3">
              {note.media_url && <NoteMedia url={note.media_url} type={note.media_type} className="max-h-[26rem]" />}

              {editing ? (
                <div className="space-y-3">
                  <RichTextEditor initialHtml={editText} onChange={setEditText} />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      className="rounded-md px-3 py-1.5 text-sm hover:bg-foreground/10"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveText}
                      disabled={saving || !stripHtml(editText).trim()}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={cn("text-sm leading-relaxed break-words", RICH)}
                  dangerouslySetInnerHTML={{ __html: noteToHtml(note.text) }}
                />
              )}

              {!editing && <OriginalToggle note={note} colored={colored} />}

              <div className={cn("flex items-center gap-4 text-xs", colored ? "text-current opacity-70" : "text-muted-foreground")}>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelativeDate(note.created_at)}
                </span>
                {note.extracted_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(note.extracted_date)}
                  </span>
                )}
              </div>

              <div className={cn("h-px w-full", colored ? "bg-foreground/20" : "bg-border")} />

              {/* keywords */}
              <div className="space-y-2">
                <p className={cn("flex items-center gap-1 text-xs font-medium", colored ? "text-current opacity-70" : "text-muted-foreground")}>
                  <Tag className="h-3.5 w-3.5" /> Tags
                </p>
                {(note.ai_keywords?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {note.ai_keywords.map((kw) => (
                      <span
                        key={kw}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border border-transparent pl-2 pr-1 py-0.5 text-xs",
                          colorClass(kw)
                        )}
                      >
                        {kw}
                        <ColorPicker kw={kw} onPick={setTagColor} />
                        <button
                          type="button"
                          onClick={() => removeKeyword(kw)}
                          className="rounded-sm p-0.5 hover:bg-foreground/10"
                          aria-label={`Remove ${kw}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder="Add a tag, then Enter…"
                    className="h-9 bg-background/70"
                  />
                  <button
                    type="button"
                    onClick={addKeyword}
                    className="inline-flex items-center rounded-md border border-black/15 px-2.5 hover:bg-foreground/10"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Per-keyword colour swatch picker (matches the note-detail page).
function ColorPicker({ kw, onPick }: { kw: string; onPick: (kw: string, key: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        title="Tag color"
        onClick={() => setOpen((v) => !v)}
        className="rounded-sm p-0.5 hover:bg-foreground/10"
      >
        <Palette className="h-3 w-3" />
      </button>
      {open && (
        <span
          className="absolute left-0 top-5 z-20 block w-auto rounded-lg border border-border bg-popover p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="grid grid-cols-5 gap-1.5">
            {TAG_COLOR_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                title={o.label}
                onClick={() => { onPick(kw, o.key); setOpen(false); }}
                className="h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-110"
                style={{ background: o.dot }}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={() => { onPick(kw, null); setOpen(false); }}
            className="mt-2 block w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-foreground/10"
          >
            Auto (default)
          </button>
        </span>
      )}
    </span>
  );
}
