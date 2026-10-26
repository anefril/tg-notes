import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeHttpUrl } from '@/lib/utils';
import { getUserProfileId } from '@/lib/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tag = searchParams.get('tag');
    const sort = searchParams.get('sort') || 'newest';

    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    let query = supabase.from('bookmarks').select('*');

    if (tag) {
      query = query.contains('tags', [tag]);
    }

    if (sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else if (sort === 'oldest') {
      query = query.order('created_at', { ascending: true });
    } else if (sort === 'alphabetical') {
      query = query.order('title', { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ bookmarks: data || [] });
  } catch (err) {
    console.error('Get bookmarks error:', err);
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: user } = await supabase.auth.getUser();
    if (!user.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Map the auth uid to the profile id (they differ for bot-first users), so
    // the bookmark is owned by the same id RLS expects.
    const userId = await getUserProfileId(supabase, user.user.id);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { title, url, description, tags, source } = await req.json();

    if (!title || !url) {
      return NextResponse.json({ error: 'Title and URL required' }, { status: 400 });
    }

    const safeUrl = normalizeHttpUrl(url);
    if (!safeUrl) {
      return NextResponse.json({ error: 'Only http(s) links are allowed' }, { status: 400 });
    }

    const { data, error } = await supabase.from('bookmarks').insert({
      user_id: userId,
      title,
      url: safeUrl,
      description: description || '',
      tags: tags || [],
      source: source || 'web',
    }).select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ bookmark: data?.[0] });
  } catch (err) {
    console.error('Create bookmark error:', err);
    return NextResponse.json({ error: 'Failed to create bookmark' }, { status: 500 });
  }
}
