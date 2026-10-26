import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

async function resolve(
  req: NextRequest
): Promise<{ supabase: SupabaseClient; userId: string } | { error: NextResponse }> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Missing auth token' }, { status: 401 }) };

  const supabase = createAuthenticatedClient(token);
  const { data: { user: authUser }, error } = await supabase.auth.getUser();
  if (error || !authUser) return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };

  const userId = await getUserProfileId(supabase, authUser.id);
  if (!userId) return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) };

  return { supabase, userId };
}

// List the user's note-to-note links.
export async function GET(req: NextRequest) {
  const r = await resolve(req);
  if ('error' in r) return r.error;

  const { data, error } = await r.supabase
    .from('note_links')
    .select('*')
    .eq('user_id', r.userId);

  if (error) {
    console.error('List links error:', error);
    return NextResponse.json({ error: 'Failed to load links' }, { status: 500 });
  }
  return NextResponse.json({ links: data || [] });
}

// Create a link between two of the user's notes.
export async function POST(req: NextRequest) {
  const r = await resolve(req);
  if ('error' in r) return r.error;

  const body = await req.json().catch(() => ({}));
  const from = typeof body?.from === 'string' ? body.from : '';
  const to = typeof body?.to === 'string' ? body.to : '';
  if (!from || !to || from === to) {
    return NextResponse.json({ error: 'Invalid notes' }, { status: 400 });
  }

  // Both notes must belong to the user (and not be in the trash).
  const { data: owned } = await r.supabase
    .from('notes')
    .select('id')
    .eq('user_id', r.userId)
    .is('deleted_at', null)
    .in('id', [from, to]);
  if (!owned || owned.length < 2) {
    return NextResponse.json({ error: 'Notes not found' }, { status: 404 });
  }

  // A link between this pair already exists?
  const { data: existing } = await r.supabase
    .from('note_links')
    .select('id, from_note, to_note')
    .eq('user_id', r.userId)
    .or(`and(from_note.eq.${from},to_note.eq.${to}),and(from_note.eq.${to},to_note.eq.${from})`)
    .limit(1)
    .maybeSingle();
  if (existing) {
    // Same direction → nothing to do. Opposite direction → flip the arrow.
    if (existing.from_note === from && existing.to_note === to) {
      return NextResponse.json({ link: existing });
    }
    const { data: flipped, error: flipErr } = await r.supabase
      .from('note_links')
      .update({ from_note: from, to_note: to })
      .eq('id', existing.id)
      .eq('user_id', r.userId)
      .select('*')
      .maybeSingle();
    if (flipErr) {
      console.error('Flip link error:', flipErr);
      return NextResponse.json({ error: 'Failed to update link' }, { status: 500 });
    }
    return NextResponse.json({ link: flipped });
  }

  const { data, error } = await r.supabase
    .from('note_links')
    .insert({ user_id: r.userId, from_note: from, to_note: to })
    .select('*')
    .maybeSingle();

  if (error) {
    // Likely a unique-violation race (the pair was created concurrently) —
    // return the existing link instead of failing.
    const { data: raced } = await r.supabase
      .from('note_links')
      .select('*')
      .eq('user_id', r.userId)
      .or(`and(from_note.eq.${from},to_note.eq.${to}),and(from_note.eq.${to},to_note.eq.${from})`)
      .limit(1)
      .maybeSingle();
    if (raced) return NextResponse.json({ link: raced });
    console.error('Create link error:', error);
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }
  return NextResponse.json({ link: data });
}

// Update a link (toggle curved). Body: { id, curved }.
export async function PATCH(req: NextRequest) {
  const r = await resolve(req);
  if ('error' in r) return r.error;

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.curved === 'boolean') updates.curved = body.curved;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await r.supabase
    .from('note_links')
    .update(updates)
    .eq('id', id)
    .eq('user_id', r.userId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Update link error:', error);
    return NextResponse.json({ error: 'Failed to update link' }, { status: 500 });
  }
  return NextResponse.json({ link: data });
}

// Delete a link by id (?id=...).
export async function DELETE(req: NextRequest) {
  const r = await resolve(req);
  if ('error' in r) return r.error;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await r.supabase.from('note_links').delete().eq('id', id).eq('user_id', r.userId);
  if (error) {
    console.error('Delete link error:', error);
    return NextResponse.json({ error: 'Failed to delete link' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
