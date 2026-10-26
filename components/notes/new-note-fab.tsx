"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/notes/rich-text-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { stripHtml } from "@/lib/utils";

interface NewNoteFabProps {
  onCreated?: () => void;
}

export function NewNoteFab({ onCreated }: NewNoteFabProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const { apiFetch } = useApi();

  const save = async () => {
    if (!stripHtml(text).trim() || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/notes/import", {
        method: "POST",
        body: JSON.stringify({ notes: [{ text }] }),
      });
      if (res.ok) {
        setText("");
        setOpen(false);
        onCreated?.();
      }
    } catch (err) {
      console.error("Create note error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => {
          setText("");
          setOpen(true);
        }}
        aria-label="New note"
        className="fixed bottom-6 right-6 z-[46] h-14 w-14 rounded-full p-0 shadow-lg shadow-primary/30"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
          </DialogHeader>
          <RichTextEditor initialHtml="" onChange={setText} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!stripHtml(text).trim() || loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
