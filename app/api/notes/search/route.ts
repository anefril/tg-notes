import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q');
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

    if (!q) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
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

    const userId = await getUserProfileId(supabase, authUser.id);
    if (!userId) {
      return NextResponse.json({ notes: [] });
    }

    // Escape LIKE wildcards so the query text is matched literally, and run
    // separate parameterized queries instead of interpolating user input into a
    // .or() filter string (raw input there breaks on commas/parentheses/% or
    // silently changes the filter logic).
    const likePattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;

    const [textRes, summaryRes, keywordRes, topicRes] = await Promise.all([
      supabase.from('notes').select('*').eq('user_id', userId).is('deleted_at', null).ilike('text', likePattern).limit(limit),
      supabase.from('notes').select('*').eq('user_id', userId).is('deleted_at', null).ilike('ai_summary', likePattern).limit(limit),
      supabase.from('notes').select('*').eq('user_id', userId).is('deleted_at', null).contains('ai_keywords', [q]).limit(limit),
      supabase.from('notes').select('*').eq('user_id', userId).is('deleted_at', null).contains('ai_topics', [q]).limit(limit),
    ]);

    const anyErr = textRes.error || summaryRes.error || keywordRes.error || topicRes.error;
    if (anyErr) {
      console.error('Search error:', anyErr);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    const seen = new Set<string>();
    const allNotes = [
      ...(textRes.data || []),
      ...(summaryRes.data || []),
      ...(keywordRes.data || []),
      ...(topicRes.data || []),
    ]
      .filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      })
      .slice(0, limit);

    return NextResponse.json({ notes: allNotes, query: q });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
