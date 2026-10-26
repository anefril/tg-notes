import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';

// Finds notes with identical text and deletes all but the earliest of each group.
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

    const { data: notes, error } = await supabase
      .from('notes')
      .select('id, text, created_at')
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (error) {
      console.error('Dedupe fetch error:', error);
      return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 });
    }

    const groups = new Map<string, { id: string; created_at: string }[]>();
    for (const n of notes || []) {
      const key = (n.text || '').trim();
      const arr = groups.get(key) || [];
      arr.push({ id: n.id, created_at: n.created_at });
      groups.set(key, arr);
    }

    const toDelete: string[] = [];
    for (const arr of Array.from(groups.values())) {
      if (arr.length <= 1) continue;
      // Keep the earliest, delete the rest.
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      toDelete.push(...arr.slice(1).map((n) => n.id));
    }

    if (toDelete.length > 0) {
      // Soft-delete duplicates so they land in the trash and can be restored.
      const { error: delError } = await supabase
        .from('notes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('id', toDelete);
      if (delError) {
        console.error('Dedupe delete error:', delError);
        return NextResponse.json({ error: 'Failed to delete duplicates' }, { status: 500 });
      }
    }

    return NextResponse.json({ removed: toDelete.length });
  } catch (err) {
    console.error('Dedupe error:', err);
    return NextResponse.json({ error: 'Dedupe failed' }, { status: 500 });
  }
}
