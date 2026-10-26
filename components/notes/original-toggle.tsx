"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { cn, noteToHtml, RICH_CLASS, languageName } from "@/lib/utils";

// Shown under an auto-translated note: a small "Translated from <lang> · original"
// toggle that reveals the (hidden by default) original, formatted source text.
export function OriginalToggle({
  note,
  colored,
  className,
}: {
  note: { original_text?: string | null; source_lang?: string | null };
  colored?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!note.original_text) return null;

  const lang = languageName(note.source_lang);
  return (
    <div className={cn("mt-1.5", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium hover:underline",
          colored ? "text-current opacity-70 hover:opacity-100" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Languages className="h-3 w-3" />
        {open ? "Hide original" : `Translated${lang ? ` from ${lang}` : ""} · original`}
      </button>
      {open && (
        <div
          className={cn(
            "mt-1 border-l-2 border-foreground/20 pl-2 text-sm leading-relaxed break-words opacity-80",
            RICH_CLASS
          )}
          dangerouslySetInnerHTML={{ __html: noteToHtml(note.original_text) }}
        />
      )}
    </div>
  );
}
