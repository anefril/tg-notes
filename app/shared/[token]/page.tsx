"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NoteMedia } from "@/components/notes/note-media";
import { OriginalToggle } from "@/components/notes/original-toggle";
import { Loader2, FileText, Tag, Clock } from "lucide-react";
import { cn, noteToHtml, formatRelativeDate, RICH_CLASS } from "@/lib/utils";
import { noteColorClass } from "@/lib/sticky";

const RICH = RICH_CLASS;

type PublicNote = {
  id: string;
  text: string;
  created_at: string;
  ai_keywords?: string[];
  media_url?: string;
  media_type?: string | null;
  color?: string | null;
  ai_summary?: string | null;
  original_text?: string | null;
  source_lang?: string | null;
};

export default function SharedNotePage() {
  const { token } = useParams<{ token: string }>();
  const [note, setNote] = useState<PublicNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/note/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.note) setNote(data.note);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>TG Notes — shared note</span>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error || !note ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
            <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto" />
            <p className="text-muted-foreground">Note not found or the link is invalid</p>
          </div>
        ) : (
          <div className={cn("rounded-xl border border-border p-6 space-y-4", noteColorClass(note.color))}>
            {note.media_url && (
              <NoteMedia url={note.media_url} type={note.media_type ?? null} className="max-h-[30rem]" />
            )}
            <div
              className={cn("text-sm leading-relaxed break-words", RICH)}
              dangerouslySetInnerHTML={{ __html: noteToHtml(note.text) }}
            />
            <OriginalToggle note={note} />
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatRelativeDate(note.created_at)}
            </p>
            {(note.ai_keywords?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                {note.ai_keywords!.map((kw) => (
                  <span key={kw} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
