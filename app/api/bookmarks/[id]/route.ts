import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';
import { normalizeHttpUrl } from '@/lib/utils';

// Fields a client is allowed to change via PATCH. Everything else (user_id,
// source, telegram_message_id, created_at, id) is off-limits.
const PATCHABLE = ['title', 'url', 'description', 'tags'] as const;

async function resolveOwner(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const supabase = createAuthenticatedClient(token);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
  if (authError || !authUser) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const userId = await getUserProfileId(supabase, authUser.id);
  if (!userId) {
    return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) };
  }

  return { supabase, userId };
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const owner = await resolveOwner(req);
    if (owner.error) return owner.error;

    const { error } = await owner.supabase
      .from('bookmarks')
      .delete()
      .eq('id', params.id)
      .eq('user_id', owner.userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete bookmark error:', err);
    return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const owner = await resolveOwner(req);
    if (owner.error) return owner.error;

    const body = await req.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of PATCHABLE) {
      if (key in body) updates[key] = body[key];
    }
    if ('url' in updates) {
      const safeUrl = normalizeHttpUrl(String(updates.url));
      if (!safeUrl) {
        return NextResponse.json({ error: 'Only http(s) links are allowed' }, { status: 400 });
      }
      updates.url = safeUrl;
    }

    const { data, error } = await owner.supabase
      .from('bookmarks')
      .update(updates)
      .eq('id', params.id)
      .eq('user_id', owner.userId)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ bookmark: data?.[0] });
  } catch (err) {
    console.error('Update bookmark error:', err);
    return NextResponse.json({ error: 'Failed to update bookmark' }, { status: 500 });
  }
}
