import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';

// POST: bulk soft-delete. When `deleteAll` is true, trashes every non-deleted
// note for the user (optionally filtered to a single `tagFilter` keyword).
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
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

    if (body.deleteAll === true) {
      const tagFilter: string | undefined = typeof body.tagFilter === 'string' ? body.tagFilter : undefined;
      const deletedAt = new Date().toISOString();

      let query = supabase
        .from('notes')
        .update({ deleted_at: deletedAt })
        .eq('user_id', userId)
        .is('deleted_at', null);

      if (tagFilter) {
        query = query.contains('ai_keywords', [tagFilter]);
      }

      const { error } = await query;
      if (error) {
        console.error('Bulk trash error:', error);
        return NextResponse.json({ error: 'Failed to trash notes' }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  } catch (err) {
    console.error('Trash POST error:', err);
    return NextResponse.json({ error: 'Failed to trash notes' }, { status: 500 });
  }
}

// Lists soft-deleted notes (the trash). Also opportunistically purges anything
// deleted more than 30 days ago.
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
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
      return NextResponse.json({ notes: [] });
    }

    // Auto-empty: drop notes deleted over 30 days ago.
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    await supabase.from('notes').delete().eq('user_id', userId).lt('deleted_at', cutoff);

    const { data: notes, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Trash list error:', error);
      return NextResponse.json({ error: 'Failed to load trash' }, { status: 500 });
    }

    return NextResponse.json({ notes: notes || [] });
  } catch (err) {
    console.error('Trash error:', err);
    return NextResponse.json({ error: 'Failed to load trash' }, { status: 500 });
  }
}
