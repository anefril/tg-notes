import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, getUserProfileId } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') || 'desc';
    const tag = searchParams.get('tag');
    const topic = searchParams.get('topic');
    // Clamp so a bad/absent query param can't produce an invalid PostgREST range
    // (NaN, 0, or negative → range(0,NaN)/range(0,-1)/range(-5,…) all fail/empty).
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      console.error('Missing auth token');
      return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
    }

    const supabase = createAuthenticatedClient(token);

    // Get the current user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      console.error('Auth error or no user:', authError);
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Find user profile by auth_user_id (primary) or id (fallback for migrated users)
    const userId = await getUserProfileId(supabase, authUser.id);

    if (!userId) {
      return NextResponse.json({ notes: [], count: 0 });
    }

    let query = supabase
      .from('notes')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (tag) {
      query = query.contains('ai_keywords', [tag]);
    }

    if (topic) {
      query = query.contains('ai_topics', [topic]);
    }

    const validSorts = ['created_at', 'extracted_date', 'ai_summary'];
    const sortCol = validSorts.includes(sort) ? sort : 'created_at';

    // Pinned notes first, so they always appear in the first page even when the
    // list is paginated (the client lifts pinned out of the loaded set).
    query = query.order('pinned', { ascending: false, nullsFirst: false });
    query = query.order(sortCol, { ascending: order === 'asc', nullsFirst: false });
    query = query.range(offset, offset + limit - 1);

    const { data: notes, error, count } = await query;

    if (error) {
      console.error('Fetch notes error:', error);
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
    }

    return NextResponse.json({ notes: notes || [], count: count ?? notes?.length ?? 0 });
  } catch (err) {
    console.error('Notes list error:', err);
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }
}
