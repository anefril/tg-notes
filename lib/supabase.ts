import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Don't hard-crash the build/dev server on a missing .env. createClient throws
  // synchronously on an empty URL, which would take down every route that imports
  // this module. Warn loudly and fall back to placeholders so pages still render;
  // any real Supabase call will then fail with an obvious error instead.
  console.warn(
    '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.local.example to .env.local and fill them in — auth and data calls will not work until you do.'
  );
}

const resolvedUrl = supabaseUrl || 'https://placeholder.supabase.co';
const resolvedAnonKey = supabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(resolvedUrl, resolvedAnonKey);

export function createServerClient() {
  return createClient(resolvedUrl, resolvedAnonKey);
}

export function createAuthenticatedClient(accessToken: string) {
  return createClient(resolvedUrl, resolvedAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function getUserProfileId(supabase: any, authUserId: string): Promise<string | null> {
  // First try to find by id (primary key in users table)
  const { data: profileById } = await supabase
    .from('users')
    .select('id')
    .eq('id', authUserId)
    .maybeSingle();

  if (profileById) return profileById.id;

  // Fallback: try by auth_user_id
  const { data: profileByAuth } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  return profileByAuth?.id || null;
}
