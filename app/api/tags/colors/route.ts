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

export async function GET(req: NextRequest) {
  const r = await resolve(req);
  if ('error' in r) return r.error;

  const { data } = await r.supabase.from('users').select('tag_colors').eq('id', r.userId).maybeSingle();
  return NextResponse.json({ colors: data?.tag_colors || {} });
}

export async function PUT(req: NextRequest) {
  const r = await resolve(req);
  if ('error' in r) return r.error;

  const body = await req.json().catch(() => ({}));
  const raw = body?.colors;

  // Sanitize to a string->string map with sane caps.
  const colors: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === 'string' && typeof v === 'string' && k && v) {
        colors[k.slice(0, 60)] = v.slice(0, 24);
      }
      if (Object.keys(colors).length >= 500) break;
    }
  }

  const { error } = await r.supabase.from('users').update({ tag_colors: colors }).eq('id', r.userId);
  if (error) {
    console.error('Update tag_colors error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ colors });
}
