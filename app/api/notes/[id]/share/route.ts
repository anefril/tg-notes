import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';
import { randomUUID } from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getAuth(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return token;
}

// POST — generate (or return existing) share token for a note
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getAuth(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createAuthenticatedClient(token);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Verify ownership
    const { data: note, error: fetchErr } = await supabase
      .from('notes')
      .select('id, share_token')
      .eq('id', params.id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (fetchErr || !note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

    let shareToken = note.share_token;

    if (!shareToken) {
      shareToken = randomUUID();
      const admin = createClient(supabaseUrl, serviceKey);
      const { error: updateErr } = await admin
        .from('notes')
        .update({ share_token: shareToken })
        .eq('id', params.id)
        .eq('user_id', userId); // defense in depth: match what auth check verified
      if (updateErr) return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      req.headers.get('x-forwarded-proto')?.concat('://', req.headers.get('x-forwarded-host') || '') ||
      `https://${req.headers.get('host')}`;

    return NextResponse.json({ shareUrl: `${origin}/shared/${shareToken}` });
  } catch (err) {
    console.error('Share note error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// DELETE — revoke share link
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getAuth(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createAuthenticatedClient(token);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const admin = createClient(supabaseUrl, serviceKey);
    const { error } = await admin
      .from('notes')
      .update({ share_token: null })
      .eq('id', params.id)
      .eq('user_id', userId);

    if (error) return NextResponse.json({ error: 'Failed to revoke' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Revoke share error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
