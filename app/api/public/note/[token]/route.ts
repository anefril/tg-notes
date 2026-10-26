import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Public endpoint — no auth. Returns a note by share_token (service role bypasses RLS).
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: note, error } = await admin
      .from('notes')
      .select('id, text, created_at, ai_keywords, media_url, media_type, color, ai_summary, original_text, source_lang')
      .eq('share_token', params.token)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !note) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ note });
  } catch (err) {
    console.error('Public note fetch error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
