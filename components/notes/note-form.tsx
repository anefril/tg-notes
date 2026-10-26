"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";

interface NoteFormProps {
  onNoteCreated: () => void;
}

export function NoteForm({ onNoteCreated }: NoteFormProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { apiFetch } = useApi();

  const handleSubmit = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/notes/import", {
        method: "POST",
        body: JSON.stringify({
          notes: [{ text: text.trim() }],
        }),
      });
      if (res.ok) {
        setText("");
        setExpanded(false);
        onNoteCreated();
      }
    } catch (err) {
      console.error("Create note error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="New note..."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!expanded && e.target.value) setExpanded(true);
        }}
        onFocus={() => setExpanded(true)}
        className="min-h-[60px] resize-none"
        rows={expanded ? 3 : 1}
      />
      {expanded && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("");
              setExpanded(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!text.trim() || loading}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
