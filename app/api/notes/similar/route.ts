import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const noteId = searchParams.get('id');
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10) || 10));

    if (!noteId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
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

    const { data: sourceNote } = await supabase
      .from('notes')
      .select('id, ai_keywords, ai_topics')
      .eq('id', noteId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!sourceNote) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    const keywords = sourceNote.ai_keywords || [];
    const topics = sourceNote.ai_topics || [];

    if (keywords.length === 0 && topics.length === 0) {
      const { data: recentNotes } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .neq('id', noteId)
        .order('created_at', { ascending: false })
        .limit(limit);

      return NextResponse.json({ notes: recentNotes || [] });
    }

    const { data: candidateNotes } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .neq('id', noteId)
      .limit(200);

    const scored = (candidateNotes || []).map((note) => {
      const noteKeywords = note.ai_keywords || [];
      const noteTopics = note.ai_topics || [];

      const keywordOverlap = noteKeywords.filter((k: string) => keywords.includes(k)).length;
      const topicOverlap = noteTopics.filter((t: string) => topics.includes(t)).length;

      const score = keywordOverlap * 2 + topicOverlap * 3;
      return { ...note, _score: score };
    });

    scored.sort((a, b) => b._score - a._score);
    const similar = scored.filter((n) => n._score > 0).slice(0, limit);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const results = similar.map(({ _score, ...note }) => note);

    return NextResponse.json({ notes: results });
  } catch (err) {
    console.error('Similar notes error:', err);
    return NextResponse.json({ error: 'Failed to find similar notes' }, { status: 500 });
  }
}
