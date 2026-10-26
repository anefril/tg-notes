"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useApi } from "@/hooks/use-api";
import { useConfirm } from "@/components/ui/confirm-provider";
import { Pencil, Trash2 } from "lucide-react";
import type { Note } from "@/types";

interface NoteContextMenuProps {
  note: Note;
  onChanged?: () => void;
  children: React.ReactNode;
}

// Right-click menu for a note (list cards and wall stickers): open/edit, trash.
export function NoteContextMenu({ note, onChanged, children }: NoteContextMenuProps) {
  const router = useRouter();
  const { apiFetch } = useApi();
  const { confirm } = useConfirm();

  const del = async () => {
    const ok = await confirm({
      title: "Move to trash?",
      description: "The note will be moved to the trash.",
      confirmText: "Move to trash",
      destructive: true,
    });
    if (!ok) return;
    await apiFetch(`/api/notes/${note.id}`, { method: "DELETE" });
    onChanged?.();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => router.push(`/notes/${note.id}`)}>
          <Pencil className="mr-2 h-4 w-4" />
          Open / edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={del} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Move to trash
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
