import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';
import { sanitizeHtml } from '@/lib/utils';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const noteId = params.id;

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

    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { data: note, error } = await supabase
      .from('notes')
      .select('*')
      .eq('id', noteId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      console.error('Fetch note error:', error);
      return NextResponse.json({ error: 'Failed to fetch note' }, { status: 500 });
    }

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    const { data: groupLinks } = await supabase
      .from('topic_group_notes')
      .select('topic_group_id')
      .eq('note_id', noteId);

    const topicGroupIds = groupLinks?.map((g: { topic_group_id: string }) => g.topic_group_id) || [];

    let topicGroups: { id: string; name: string }[] = [];
    if (topicGroupIds.length > 0) {
      const { data: groups } = await supabase
        .from('topic_groups')
        .select('id, name')
        .in('id', topicGroupIds);
      topicGroups = groups || [];
    }

    return NextResponse.json({ note, topicGroups });
  } catch (err) {
    console.error('Note detail error:', err);
    return NextResponse.json({ error: 'Failed to fetch note' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const noteId = params.id;

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

    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Default delete moves the note to the trash (soft delete). `?permanent=1`
    // removes it for good (used by the trash screen).
    const permanent = new URL(req.url).searchParams.get('permanent') === '1';

    const { error } = permanent
      ? await supabase.from('notes').delete().eq('id', noteId).eq('user_id', userId)
      : await supabase
          .from('notes')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', noteId)
          .eq('user_id', userId);

    if (error) {
      console.error('Delete note error:', error);
      return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Delete note error:', err);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}

// Fields a client may edit. Everything else (user_id, telegram_message_id,
// embedding, analyzed, created_at, id) is off-limits.
const PATCHABLE = [
  'text', 'ai_summary', 'ai_topics', 'ai_keywords', 'extracted_date',
  // sticky-wall layout
  'pos_x', 'pos_y', 'width', 'height', 'color', 'font',
  // list view
  'pinned', 'list_order', 'list_x', 'list_y',
] as const;

const NUMERIC_FIELDS = new Set(['pos_x', 'pos_y', 'width', 'height', 'list_order', 'list_x', 'list_y']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const noteId = params.id;

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

    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();

    // Restore from trash.
    if (body.restore === true) {
      const { data: restored, error: rErr } = await supabase
        .from('notes')
        .update({ deleted_at: null })
        .eq('id', noteId)
        .eq('user_id', userId)
        .select()
        .maybeSingle();
      if (rErr) {
        console.error('Restore note error:', rErr);
        return NextResponse.json({ error: 'Failed to restore note' }, { status: 500 });
      }
      if (!restored) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      return NextResponse.json({ note: restored });
    }

    const updates: Record<string, unknown> = {};
    for (const key of PATCHABLE) {
      if (key in body) updates[key] = body[key];
    }

    // Sanitize stored note HTML so the DB never holds anything unsafe, regardless
    // of which client wrote it.
    if (typeof updates.text === 'string') {
      updates.text = sanitizeHtml(updates.text);
    }

    // Keep array columns well-typed (strings only) and de-duplicated.
    for (const arrKey of ['ai_topics', 'ai_keywords'] as const) {
      if (arrKey in updates) {
        updates[arrKey] = Array.isArray(updates[arrKey])
          ? Array.from(new Set((updates[arrKey] as unknown[]).map((v) => String(v)).filter(Boolean)))
          : [];
      }
    }

    // Pin flag is a strict boolean.
    if ('pinned' in updates) {
      updates.pinned = Boolean(updates.pinned);
    }

    // Coerce sticky-layout numbers; drop them if not finite. Explicit null is
    // kept (clears the column, e.g. "fit pinned note to its text").
    for (const numKey of NUMERIC_FIELDS) {
      if (numKey in updates) {
        if (updates[numKey] === null) continue;
        const n = Math.round(Number(updates[numKey]));
        if (Number.isFinite(n)) updates[numKey] = n;
        else delete updates[numKey];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: note, error } = await supabase
      .from('notes')
      .update(updates)
      .eq('id', noteId)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Update note error:', error);
      return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
    }

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json({ note });
  } catch (err) {
    console.error('Update note error:', err);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
}
