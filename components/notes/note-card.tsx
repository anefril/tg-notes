"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Calendar, ChevronDown, Check, Pin, Palette, Trash2, Plus } from "lucide-react";
import { cn, formatRelativeDate, formatDate, noteToHtml, RICH_CLASS, TAG_COLOR_OPTIONS } from "@/lib/utils";
import { STICKY_COLORS, COLOR_MAP, noteColorClass } from "@/lib/sticky";
import { OriginalToggle } from "@/components/notes/original-toggle";
import { useTagColors } from "@/contexts/tag-colors-context";
import { NoteMedia } from "@/components/notes/note-media";
import type { Note } from "@/types";

interface NoteCardProps {
  note: Note;
  onClick: (id: string) => void;
  selected?: boolean;
  selectionMode?: boolean;
  // Keep-style quick actions shown on hover (omit to hide that action).
  onColor?: (id: string, color: string) => void;
  onTogglePin?: (id: string) => void;
  onDelete?: (id: string) => void;
  // Quick-add a tag from the card (shows a "+" next to the tags on hover).
  onAddTag?: (id: string, tag: string) => void;
  // Inline-edit a tag (click a badge to rename it).
  onEditTag?: (id: string, oldTag: string, newTag: string) => void;
  // Fill a fixed-height parent and scroll the body (used by resized pinned notes).
  fill?: boolean;
  allTags?: string[];
}

// Collapse notes taller than this; show a "Show more" toggle instead.
const CLAMP_PX = 340;

// Rich-text classes so saved formatting (bold/italic/underline/strike) shows in previews.
const RICH = RICH_CLASS;

export function NoteCard({
  note,
  onClick,
  selected,
  selectionMode,
  onColor,
  onTogglePin,
  onDelete,
  onAddTag,
  onEditTag,
  fill,
  allTags,
}: NoteCardProps) {
  const { colors, colorClass, setTagColor } = useTagColors();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);

  const submitTag = () => {
    const t = tagInput.trim().toLowerCase();
    setTagInput("");
    setAddingTag(false);
    if (t && onAddTag) onAddTag(note.id, t);
  };

  // Measure after render: only notes that overflow the clamp get a toggle.
  // Disabled when `fill` — the card has a fixed height and scrolls instead.
  useEffect(() => {
    if (fill) return;
    const el = bodyRef.current;
    if (el) setOverflow(el.scrollHeight > CLAMP_PX + 8);
  }, [note.text, fill]);

  const clamped = overflow && !expanded && !fill;

  // Colored cards (Google Keep style): the .note-* class paints background + text
  // and adapts to dark mode (muted dark variants).
  const colored = !!note.color && !!COLOR_MAP[note.color];
  const showActions = !selectionMode && (!!onTogglePin || !!onColor || !!onDelete);

  // Action icons sit in a theme-aware pill so they stay visible on any note colour.
  const iconBtn = "rounded p-1 text-foreground/80 hover:bg-foreground/10";

  return (
    <Card
      className={cn(
        "group relative cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        colored && "border-black/5",
        noteColorClass(note.color),
        selected && "ring-2 ring-primary",
        fill && "flex h-full flex-col hover:translate-y-0"
      )}
      onClick={() => onClick(note.id)}
    >
      {note.pinned && (
        <div className="absolute left-2 top-2 z-10" title="Pinned">
          <Pin className={cn("h-3.5 w-3.5 fill-current", colored ? "text-current opacity-70" : "text-primary")} />
        </div>
      )}

      {selectionMode && (
        <div
          className={cn(
            "absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background/80"
          )}
        >
          {selected && <Check className="h-3 w-3" />}
        </div>
      )}

      {showActions && (
        <div
          className="absolute right-1.5 top-1.5 z-20 flex items-center gap-0.5 rounded-md bg-background/85 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {onTogglePin && (
            <button
              type="button"
              title={note.pinned ? "Unpin" : "Pin"}
              onClick={() => onTogglePin(note.id)}
              className={iconBtn}
            >
              <Pin className={cn("h-3.5 w-3.5", note.pinned && "fill-current")} />
            </button>
          )}
          {onColor && (
            <button
              type="button"
              title="Color"
              onClick={() => setShowColors((v) => !v)}
              className={iconBtn}
            >
              <Palette className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              title="Delete"
              onClick={() => onDelete(note.id)}
              className={iconBtn}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {showColors && onColor && (
        <div
          className="absolute right-1.5 top-9 z-30 rounded-lg border border-border bg-popover p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
            <button
              type="button"
              title="No color"
              onClick={() => {
                onColor(note.id, "");
                setShowColors(false);
              }}
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
                onClick={() => {
                  onColor(note.id, c.key);
                  setShowColors(false);
                }}
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

      <CardContent className={cn("p-4 space-y-3", fill && "flex min-h-0 flex-1 flex-col overflow-auto")}>
        {note.media_url && (
          <NoteMedia url={note.media_url} type={note.media_type} className="max-h-64" />
        )}
        <div>
          <div
            ref={bodyRef}
            className={cn("text-sm leading-relaxed break-words", RICH, clamped && "overflow-hidden")}
            style={
              clamped
                ? {
                    maxHeight: CLAMP_PX,
                    WebkitMaskImage: "linear-gradient(to bottom, #000 72%, transparent)",
                    maskImage: "linear-gradient(to bottom, #000 72%, transparent)",
                  }
                : undefined
            }
            dangerouslySetInnerHTML={{ __html: noteToHtml(note.text) }}
          />
          {overflow && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className={cn(
                "mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium hover:underline",
                colored ? "text-current opacity-80" : "text-primary"
              )}
            >
              {expanded ? "Show less" : "Show more"}
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
          <OriginalToggle note={note} colored={colored} />
        </div>

        {(note.ai_keywords?.length > 0 || onAddTag) && (
          <div className="flex flex-wrap items-center gap-1">
            {note.ai_keywords?.slice(0, 4).map((kw) => (
              editingTag === kw && onEditTag ? (
                <div key={kw} className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    list="tg-all-tags"
                    defaultValue={kw}
                    onBlur={(e) => {
                      const v = e.target.value.trim().toLowerCase();
                      if (v && v !== kw) {
                        // Tag colours are global; this rename only affects ONE note,
                        // so copy the colour onto the new tag but leave the old tag's
                        // colour intact for the other notes still using it.
                        if (colors[kw] && !colors[v]) setTagColor(v, colors[kw]);
                        onEditTag(note.id, kw, v);
                      }
                      setEditingTag(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.trim().toLowerCase();
                        if (v && v !== kw) {
                          if (colors[kw] && !colors[v]) setTagColor(v, colors[kw]);
                          onEditTag(note.id, kw, v);
                        }
                        setEditingTag(null);
                      } else if (e.key === "Escape") {
                        setEditingTag(null);
                      }
                    }}
                    className="h-5 w-24 rounded border border-input bg-background/80 px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  />
                  {/* Color swatches */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title="No color"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTagColor(kw, null)}
                      className={cn("h-3 w-3 rounded-full border border-border bg-background", !colors[kw] && "ring-1 ring-foreground ring-offset-[1px]")}
                    />
                    {TAG_COLOR_OPTIONS.map(c => (
                      <button
                        key={c.key}
                        type="button"
                        title={c.label}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTagColor(kw, c.key)}
                        className={cn("h-3 w-3 rounded-full border border-black/10", colors[kw] === c.key && "ring-1 ring-foreground ring-offset-[1px]")}
                        style={{ background: c.dot }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <Badge
                  key={kw}
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onEditTag) setEditingTag(kw);
                  }}
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-4 border-transparent",
                    colorClass(kw),
                    onEditTag && "cursor-text"
                  )}
                  title={onEditTag ? "Click to edit" : undefined}
                >
                  {kw}
                </Badge>
              )
            ))}
            {onAddTag && (
              addingTag ? (
                <input
                  autoFocus
                  list="tg-all-tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onBlur={submitTag}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); submitTag(); }
                    else if (e.key === "Escape") { setTagInput(""); setAddingTag(false); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="tag…"
                  className="h-5 w-20 rounded border border-input bg-background/80 px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <button
                  type="button"
                  title="Add tag"
                  onClick={(e) => { e.stopPropagation(); setAddingTag(true); }}
                  className={cn(
                    "inline-flex h-4 items-center gap-0.5 rounded px-1 text-[10px] font-medium transition-opacity",
                    colored ? "bg-foreground/10 text-current" : "bg-secondary text-muted-foreground hover:text-foreground",
                    note.ai_keywords?.length > 0 ? "opacity-0 group-hover:opacity-100" : "opacity-70 group-hover:opacity-100"
                  )}
                >
                  <Plus className="h-3 w-3" />
                  {(note.ai_keywords?.length ?? 0) === 0 && <span>tag</span>}
                </button>
              )
            )}
          </div>
        )}

        <div className={cn("flex items-center gap-3 text-[11px]", colored ? "text-current opacity-70" : "text-muted-foreground")}>
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
      </CardContent>
    </Card>
  );
}
