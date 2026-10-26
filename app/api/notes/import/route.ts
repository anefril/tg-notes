import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';
import { sanitizeHtml } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    const { notes } = await req.json();

    if (!notes || !Array.isArray(notes)) {
      return NextResponse.json({ error: 'Missing notes array' }, { status: 400 });
    }

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
    }

    const supabase = createAuthenticatedClient(token);

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Resolve the profile id (notes.user_id references users.id, which may differ
    // from the auth uid for users the Telegram bot created first).
    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Colors a client may set (matches the sticky palette).
    const ALLOWED_COLORS = new Set(['white', 'yellow', 'green', 'pink', 'purple', 'blue', 'orange', 'gray']);

    const notesToInsert = notes.map(
      (note: { text: string; telegramMessageId?: number; createdAt?: string; color?: string | null; pinned?: boolean }) => {
        const row: Record<string, unknown> = {
          user_id: userId,
          text: sanitizeHtml(String(note.text ?? '')),
          telegram_message_id: note.telegramMessageId || null,
          created_at: note.createdAt || new Date().toISOString(),
          analyzed: false,
          color: note.color && ALLOWED_COLORS.has(note.color) ? note.color : null,
          // Every note starts with the default "notes" tag; the user adds their
          // own tags from there.
          ai_keywords: ['notes'],
        };
        // Only reference `pinned` when actually pinning, so note creation keeps
        // working even on databases where the `pinned` column hasn't been added.
        if (note.pinned === true) row.pinned = true;
        return row;
      }
    );

    const { data: insertedNotes, error } = await supabase
      .from('notes')
      .insert(notesToInsert)
      .select();

    if (error) {
      console.error('Insert error:', error);
      return NextResponse.json({ error: 'Failed to import notes' }, { status: 500 });
    }

    return NextResponse.json({ notes: insertedNotes, count: insertedNotes?.length || 0 });
  } catch (err) {
    console.error('Import error:', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
