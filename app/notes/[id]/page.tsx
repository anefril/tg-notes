"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useApi } from "@/hooks/use-api";
import { useRouter, useParams } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandSearch } from "@/components/search/command-search";
import { NoteCard } from "@/components/notes/note-card";
import { NoteMedia } from "@/components/notes/note-media";
import { RichTextEditor } from "@/components/notes/rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTagColors } from "@/contexts/tag-colors-context";
import { useConfirm } from "@/components/ui/confirm-provider";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Tag,
  Layers,
  Trash2,
  FileText,
  Pencil,
  Save,
  X,
  Plus,
  Loader2,
  Palette,
} from "lucide-react";
import type { Note } from "@/types";
import { OriginalToggle } from "@/components/notes/original-toggle";
import { cn, formatDate, formatRelativeDate, noteToHtml, RICH_CLASS, stripHtml, TAG_COLOR_OPTIONS, KNOWN_TOPICS } from "@/lib/utils";

export default function NoteDetailPage() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const { colorClass, setTagColor } = useTagColors();
  const { confirm } = useConfirm();
  const router = useRouter();
  const params = useParams();
  const noteId = params.id as string;

  const [note, setNote] = useState<Note | null>(null);
  const [topicGroups, setTopicGroups] = useState<{ id: string; name: string }[]>([]);
  const [similarNotes, setSimilarNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSimilar, setShowSimilar] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchNote = useCallback(async () => {
    if (!user || !noteId) return;
    try {
      const res = await apiFetch(`/api/notes/${noteId}`);
      if (res.ok) {
        const data = await res.json();
        setNote(data.note);
        setTopicGroups(data.topicGroups || []);
      }
    } catch (err) {
      console.error("Fetch note error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, noteId, apiFetch]);

  useEffect(() => {
    fetchNote();
  }, [fetchNote]);

  const fetchSimilar = useCallback(async () => {
    if (!noteId) return;
    try {
      const res = await apiFetch(`/api/notes/similar?id=${noteId}&limit=6`);
      if (res.ok) {
        const data = await res.json();
        setSimilarNotes(data.notes || []);
      }
    } catch (err) {
      console.error("Similar fetch error:", err);
    }
  }, [noteId, apiFetch]);

  // Show related notes whenever this note has any topics/keywords (manual or not).
  const hasTags = (note?.ai_topics?.length ?? 0) > 0 || (note?.ai_keywords?.length ?? 0) > 0;
  useEffect(() => {
    if (hasTags) fetchSimilar();
  }, [hasTags, note?.id, fetchSimilar]);

  const handleDelete = async () => {
    if (!noteId) return;
    if (!(await confirm({ title: "Delete this note?", confirmText: "Delete", destructive: true }))) return;
    try {
      const res = await apiFetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/notes");
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const startEdit = () => {
    if (!note) return;
    setEditText(noteToHtml(note.text));
    setEditing(true);
  };

  const handleSave = async () => {
    if (!noteId || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ text: editText }),
      });
      if (res.ok) {
        const data = await res.json();
        setNote(data.note);
        setEditing(false);
      }
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  // --- live tag editing: applies immediately in the open note (no edit mode) ---
  const patchTags = async (body: Record<string, unknown>) => {
    if (!noteId) return;
    // Optimistic: apply locally first, so rapid consecutive tag edits each build
    // on the latest state instead of the second PATCH overwriting the first.
    setNote((prev) => (prev ? ({ ...prev, ...body } as typeof prev) : prev));
    const res = await apiFetch(`/api/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(body) });
    if (res.ok) {
      const data = await res.json();
      setNote(data.note);
    }
  };

  const toggleTopic = (topic: string) => {
    const cur = note?.ai_topics || [];
    patchTags({ ai_topics: cur.includes(topic) ? cur.filter((t) => t !== topic) : [...cur, topic] });
  };

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    setNewKeyword("");
    const cur = note?.ai_keywords || [];
    if (!kw || cur.includes(kw)) return;
    patchTags({ ai_keywords: [...cur, kw] });
  };

  const removeKeyword = (kw: string) => {
    patchTags({ ai_keywords: (note?.ai_keywords || []).filter((k) => k !== kw) });
  };

  // Topic chips: the known set plus any custom ones already on the note.
  const topicOptions = Array.from(new Set([...KNOWN_TOPICS, ...(note?.ai_topics || [])]));

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <MobileNav />
        <main className="md:pl-[var(--sidebar-w)] transition-[padding] duration-300">
          <div className="md:hidden h-14" />
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-6">
            <div className="space-y-4">
              <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              <div className="h-64 bg-muted animate-pulse rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <MobileNav />
        <main className="md:pl-[var(--sidebar-w)] transition-[padding] duration-300">
          <div className="md:hidden h-14" />
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 text-center space-y-4">
            <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto" />
            <p className="text-muted-foreground">Note not found</p>
            <Button variant="outline" onClick={() => router.push("/notes")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back to notes
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileNav />
      <CommandSearch onNavigate={(id) => router.push(`/notes/${id}`)} />
      <main className="md:pl-[var(--sidebar-w)] transition-[padding] duration-300">
        <div className="md:hidden h-14" />
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6 md:pt-16">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => router.push("/notes")}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              {!editing && (
                <Button variant="outline" size="sm" onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {editing ? (
            <Card>
              <CardContent className="p-6 space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Note text</p>
                  <RichTextEditor initialHtml={editText} onChange={setEditText} />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !stripHtml(editText).trim()}>
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 space-y-4">
                {note.media_url && (
                  <NoteMedia url={note.media_url} type={note.media_type} className="max-h-[28rem]" />
                )}
                <div
                  className={cn("text-sm leading-relaxed break-words", RICH_CLASS)}
                  dangerouslySetInnerHTML={{ __html: noteToHtml(note.text) }}
                />
                <OriginalToggle note={note} />
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
          )}

          {!editing && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" />
                    Topics
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {topicOptions.map((t) => {
                      const activeTopic = (note.ai_topics || []).includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTopic(t)}
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-xs transition-colors",
                            activeTopic
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:bg-accent"
                          )}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Tag className="h-3.5 w-3.5" />
                    Tags
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
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="rounded-sm p-0.5 hover:bg-black/10" title="Tag color">
                                <Palette className="h-3 w-3" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-auto p-2">
                              <div className="grid grid-cols-5 gap-1.5">
                                {TAG_COLOR_OPTIONS.map((o) => (
                                  <button
                                    key={o.key}
                                    type="button"
                                    title={o.label}
                                    onClick={() => setTagColor(kw, o.key)}
                                    className="h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-110"
                                    style={{ background: o.dot }}
                                  />
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => setTagColor(kw, null)}
                                className="mt-2 w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                              >
                                Auto (default)
                              </button>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <button
                            type="button"
                            onClick={() => removeKeyword(kw)}
                            className="rounded-sm p-0.5 hover:bg-black/10"
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
                      className="h-9"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addKeyword}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!editing && topicGroups.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Groups</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {topicGroups.map((g) => (
                    <Badge
                      key={g.id}
                      variant="outline"
                      className="cursor-pointer hover:bg-accent"
                      onClick={() => router.push(`/topics`)}
                    >
                      {g.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!editing && similarNotes.length > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setShowSimilar(!showSimilar)}
                className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
              >
                <Layers className="h-4 w-4" />
                Similar notes ({similarNotes.length})
              </button>
              {showSimilar && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {similarNotes.map((sn) => (
                    <NoteCard key={sn.id} note={sn} onClick={(id) => router.push(`/notes/${id}`)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
