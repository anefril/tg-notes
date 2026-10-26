"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, Underline, Strikethrough } from "lucide-react";
import { cn, RICH_CLASS } from "@/lib/utils";

interface RichTextEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
  className?: string;
}

const TOOLS: { cmd: string; Icon: typeof Bold; title: string }[] = [
  { cmd: "bold", Icon: Bold, title: "Bold" },
  { cmd: "italic", Icon: Italic, title: "Italic" },
  { cmd: "underline", Icon: Underline, title: "Underline" },
  { cmd: "strikeThrough", Icon: Strikethrough, title: "Strikethrough" },
];

export function RichTextEditor({ initialHtml, onChange, className }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Set the starting HTML once (on mount). Later prop changes are ignored so the
  // caret never jumps while typing.
  useEffect(() => {
    if (ref.current && !initialized.current) {
      ref.current.innerHTML = initialHtml || "";
      initialized.current = true;
    }
  }, [initialHtml]);

  const exec = (cmd: string) => {
    // Produce presentational tags (<b>/<i>/<u>/<strike>) instead of styled spans.
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* ignore */
    }
    document.execCommand(cmd, false);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || "");
  };

  return (
    <div className="rounded-md border border-input bg-background">
      <div className="flex items-center gap-0.5 border-b border-border px-1 py-1">
        {TOOLS.map(({ cmd, Icon, title }) => (
          <button
            key={cmd}
            type="button"
            title={title}
            // mousedown + preventDefault keeps the text selection in the editor
            onMouseDown={(e) => {
              e.preventDefault();
              exec(cmd);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML || "")}
        className={cn(
          "min-h-[150px] px-3 py-2 text-sm leading-relaxed break-words focus:outline-none",
          RICH_CLASS,
          className
        )}
      />
    </div>
  );
}
