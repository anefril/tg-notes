"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/notes/rich-text-editor";
import { STICKY_COLORS, COLOR_MAP, noteColorClass } from "@/lib/sticky";
import { useApi } from "@/hooks/use-api";
import { cn, stripHtml } from "@/lib/utils";
import { Palette, Pin, Loader2, Check, Plus } from "lucide-react";

interface NewNoteBoxProps {
  onCreated?: () => void;
}

// Google-Keep-style note composer: a centered collapsed bar that expands into an
// editor card on click. Saves on "Done" or when you click away (if non-empty).
export function NewNoteBox({ onCreated }: NewNoteBoxProps) {
  const { apiFetch } = useApi();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [color, setColor] = useState<string>("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  const reset = () => {
    setText("");
    setColor("");
    setPinned(false);
    setShowColors(false);
    setOpen(false);
  };

  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (!stripHtml(text).trim()) {
      reset();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await apiFetch("/api/notes/import", {
        method: "POST",
        body: JSON.stringify({ notes: [{ text, color: color || null, pinned }] }),
      });
      if (res.ok) {
        reset();
        onCreated?.();
      }
    } catch (err) {
      console.error("Create note error:", err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, color, pinned, apiFetch, onCreated]);

  // Click-away → save (Keep behaviour).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // ignore clicks inside our box, or inside any Radix popover/dialog portal
      if (wrapRef.current?.contains(t) || t.closest?.('[data-radix-popper-content-wrapper],[role="dialog"]')) return;
      save();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, save]);

  const colored = !!color && !!COLOR_MAP[color];

  return (
    <div className="mx-auto w-full max-w-xl" ref={wrapRef}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-10 w-full items-center rounded-md border border-primary/30 bg-primary/10 px-3 text-sm font-medium text-primary/70 shadow-sm transition-all duration-200 hover:bg-primary/15 hover:text-primary/90 hover:shadow-md"
        >
          <Plus className="mr-2 h-4 w-4 shrink-0" />
          Take a note…
        </button>
      ) : (
        <div
          className={cn(
            "overflow-hidden rounded-md border border-border shadow-lg transition-all duration-200",
            noteColorClass(color)
          )}
        >
          <RichTextEditor
            initialHtml=""
            onChange={setText}
            className={colored ? "min-h-[90px] bg-transparent" : "min-h-[90px]"}
          />
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <div className="relative">
              <button
                type="button"
                title="Color"
                onClick={() => setShowColors((v) => !v)}
                className="rounded-md p-1.5 text-current opacity-80 hover:bg-foreground/10"
              >
                <Palette className="h-4 w-4" />
              </button>
              {showColors && (
                <div className="absolute bottom-9 left-0 z-10 rounded-lg border border-border bg-popover p-2 shadow-lg">
                  <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
                    <button
                      type="button"
                      title="No color"
                      onClick={() => { setColor(""); setShowColors(false); }}
                      className={cn(
                        "h-6 w-6 rounded-full border border-border bg-card",
                        !color && "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                      )}
                    />
                    {STICKY_COLORS.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        title={c.label}
                        onClick={() => { setColor(c.key); setShowColors(false); }}
                        className={cn(
                          "h-6 w-6 rounded-full border border-black/10",
                          color === c.key && "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                        )}
                        style={{ background: c.bg }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              title={pinned ? "Unpin" : "Pin"}
              onClick={() => setPinned((v) => !v)}
              className={cn("rounded-md p-1.5 text-current opacity-80 hover:bg-foreground/10", pinned && "text-primary")}
            >
              <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-foreground/10 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
