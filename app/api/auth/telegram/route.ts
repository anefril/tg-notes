import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code } = body;

    // New flow: code-based auth from Telegram bot
    if (code) {
      // Must be exactly 8 digits. Guard the type too: a JSON number or array would
      // make `code.length` undefined (false-reject a valid code) or slip an array
      // into the query, so reject anything that isn't an 8-digit string up front.
      if (typeof code !== 'string' || !/^\d{8}$/.test(code)) {
        return NextResponse.json({ error: 'Enter the 8-digit code' }, { status: 400 });
      }

      const serviceClient = createClient(supabaseUrl, serviceKey);

      // Find the auth code (not used, not expired)
      const { data: authCode, error: findError } = await serviceClient
        .from('telegram_auth_codes')
        .select('*')
        .eq('code', code)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (findError || !authCode) {
        return NextResponse.json(
          { error: 'Code not found, expired or already used' },
          { status: 404 }
        );
      }

      // A code must always carry the telegram id it was minted for; without it the
      // email below collapses to a shared telegram_null@tgnotes.app account.
      if (authCode.telegram_id == null) {
        return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
      }

      // Atomically claim the code: only succeeds if it was still unused, so two
      // concurrent requests can't both consume the same single-use code (TOCTOU).
      const { data: claimed } = await serviceClient
        .from('telegram_auth_codes')
        .update({ used: true })
        .eq('id', authCode.id)
        .eq('used', false)
        .select('id')
        .maybeSingle();

      if (!claimed) {
        return NextResponse.json(
          { error: 'Code not found, expired or already used' },
          { status: 404 }
        );
      }

      // Create or sign in the Supabase Auth user.
      const displayName = [authCode.first_name, authCode.last_name].filter(Boolean).join(' ');
      const email = `telegram_${authCode.telegram_id}@tgnotes.app`;
      const avatar = authCode.photo_url || '';
      // Each account gets a strong random password that only the server stores
      // (users.auth_secret); it is rotated whenever it stops working.
      const anonClient = createClient(supabaseUrl, supabaseAnonKey);
      const newSecret = () => (randomUUID() + randomUUID()).replace(/-/g, '');

      // Find the profile and its stored random password.
      const { data: profile } = await serviceClient
        .from('users')
        .select('id, auth_user_id, auth_secret')
        .eq('telegram_id', authCode.telegram_id)
        .maybeSingle();

      let password = profile?.auth_secret || '';
      let signIn = password
        ? await anonClient.auth.signInWithPassword({ email, password })
        : null;

      if (!signIn || signIn.error) {
        // No usable stored password yet — set a fresh random one.
        password = newSecret();

        if (profile?.auth_user_id) {
          // Auth user exists; rotate its password to the new random value.
          const { error: rotateError } = await serviceClient.auth.admin.updateUserById(
            profile.auth_user_id,
            { password }
          );
          if (rotateError) {
            console.error('rotate password error:', rotateError);
            return NextResponse.json({ error: 'Sign-in error' }, { status: 500 });
          }
        } else {
          // No linked auth user — create one pre-confirmed.
          const { error: createError } = await serviceClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { telegram_id: authCode.telegram_id, name: displayName, avatar },
          });

          if (createError) {
            console.error('create account error:', createError);
            return NextResponse.json({ error: 'Error creating the account' }, { status: 500 });
          }
        }

        signIn = await anonClient.auth.signInWithPassword({ email, password });
      }

      if (!signIn || signIn.error) {
        console.error('Sign in error:', signIn?.error);
        return NextResponse.json({ error: 'Sign-in error' }, { status: 500 });
      }

      const userId = signIn.data.user?.id || '';
      const accessToken = signIn.data.session?.access_token || '';
      const refreshToken = signIn.data.session?.refresh_token || '';

      if (!userId || !accessToken) {
        return NextResponse.json({ error: 'Session error' }, { status: 500 });
      }

      // Link the auth user to the profile row (create it if the bot never made one)
      // and persist the random password.
      if (profile) {
        await serviceClient
          .from('users')
          .update({ auth_user_id: userId, auth_secret: password, name: displayName, avatar })
          .eq('id', profile.id);
      } else {
        await serviceClient.from('users').insert({
          id: userId,
          auth_user_id: userId,
          telegram_id: authCode.telegram_id,
          name: displayName,
          avatar,
          auth_secret: password,
        });
      }

      return NextResponse.json({
        user: {
          id: userId,
          telegram_id: authCode.telegram_id,
          name: displayName,
          avatar,
        },
        accessToken,
        refreshToken,
      });
    }

    // No valid 6-digit code in the request body.
    // (A legacy Telegram-login-widget flow used to live here, but it trusted the
    // request's `hash`/`id` without verifying the Telegram HMAC signature — an
    // account-takeover risk — so it was removed. The 6-digit code above is the
    // only supported login.)
    return NextResponse.json({ error: 'Enter the 8-digit code' }, { status: 400 });
  } catch (err) {
    console.error('Auth error:', err);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
