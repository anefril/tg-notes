"use client";

import { Download, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoteMediaProps {
  url: string;
  type: string | null;
  className?: string;
}

function DownloadBtn({ url, filename }: { url: string; filename: string }) {
  return (
    <a
      href={url}
      download={filename}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Download"
      className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover/media:opacity-100 hover:bg-black/70"
    >
      <Download className="h-4 w-4" />
    </a>
  );
}

export function NoteMedia({ url, type, className }: NoteMediaProps) {
  if (type === "photo") {
    return (
      <div className="group/media relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Attachment"
          loading="lazy"
          className={cn("w-full rounded-md object-cover", className)}
        />
        <DownloadBtn url={url} filename="photo.jpg" />
      </div>
    );
  }
  if (type === "video") {
    return (
      <div className="group/media relative">
        <video
          src={url}
          controls
          onClick={(e) => e.stopPropagation()}
          className={cn("w-full rounded-md", className)}
        />
        <DownloadBtn url={url} filename="video.mp4" />
      </div>
    );
  }
  if (type === "voice" || type === "audio") {
    return (
      <div className="flex items-center gap-2">
        <audio src={url} controls onClick={(e) => e.stopPropagation()} className="flex-1" />
        <a
          href={url}
          download={type === "voice" ? "voice.ogg" : "audio.mp3"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Download"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <Paperclip className="h-3 w-3" />
      Open file
    </a>
  );
}
