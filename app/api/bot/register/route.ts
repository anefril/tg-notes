import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

export async function POST(req: NextRequest) {
  try {
    const { botToken, botUsername, adminKey } = await req.json();

    // Registering a bot rewrites the webhook config for everyone, so it must be
    // admin-only. Require a secret known only to the operator (set as the
    // ADMIN_SECRET env var). Fail closed if it isn't configured.
    const adminSecret = process.env.ADMIN_SECRET || '';
    if (!adminSecret || typeof adminKey !== 'string' || adminKey !== adminSecret) {
      return NextResponse.json({ error: 'Forbidden: wrong admin key' }, { status: 403 });
    }

    if (!botToken || !botToken.trim()) {
      return NextResponse.json({ error: 'Bot token is required' }, { status: 400 });
    }

    const token = botToken.trim();
    const username = (botUsername || '').trim().replace('@', '');

    // 1. Verify the token by calling getMe
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await meRes.json();

    if (!meData.ok) {
      return NextResponse.json(
        { error: `Invalid bot token: ${meData.description || 'Unknown error'}` },
        { status: 400 }
      );
    }

    const realUsername = meData.result.username || username;

    // 2. Register the webhook — points at THIS site's /api/telegram/webhook route.
    //    Derived from the incoming request so it matches wherever the app is deployed.
    //    Telegram requires a public HTTPS URL, so run /setup on the live site (not localhost).
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`).replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/telegram/webhook`;
    // A shared secret only Telegram and our server know. Telegram echoes it back
    // in the X-Telegram-Bot-Api-Secret-Token header on every call, so the webhook
    // can reject forged requests from anyone else.
    const webhookSecret = (randomUUID() + randomUUID()).replace(/-/g, '');
    const setWebhookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        secret_token: webhookSecret,
      }),
    });
    const webhookData = await setWebhookRes.json();

    if (!webhookData.ok) {
      return NextResponse.json(
        { error: `Failed to set webhook: ${webhookData.description || 'Unknown error'}` },
        { status: 500 }
      );
    }

    // 3. Save bot token + username to app_settings (single-row table)
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: existingRow } = await serviceClient
      .from('app_settings')
      .select('id')
      .maybeSingle();

    if (existingRow) {
      await serviceClient
        .from('app_settings')
        .update({
          bot_token: token,
          bot_username: realUsername,
          webhook_url: webhookUrl,
          webhook_secret: webhookSecret,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRow.id);
    } else {
      await serviceClient.from('app_settings').insert({
        bot_token: token,
        bot_username: realUsername,
        webhook_url: webhookUrl,
        webhook_secret: webhookSecret,
      });
    }

    // 4. Command menu (the ☰ "Menu" button next to the chat input) so users can
    // always find /start and the other actions.
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🔑 Sign in / get a website code' },
          { command: 'recent', description: '🕒 Recent notes' },
          { command: 'stats', description: '📊 How many notes I have' },
          { command: 'site', description: '🌐 Open the website' },
          { command: 'help', description: '❓ What this bot can do' },
        ],
      }),
    });
    await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_button: { type: 'commands' } }),
    });

    // 5. Profile texts shown before the user presses START.
    await fetch(`https://api.telegram.org/bot${token}/setMyDescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description:
          'The TG Notes bot. Send text, a link, a photo, a voice message or a file — I will save it as a note on your personal website and remove the message from the chat. Tap Start to begin.',
      }),
    });
    await fetch(`https://api.telegram.org/bot${token}/setMyShortDescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        short_description: 'I save your messages as notes on your personal TG Notes website.',
      }),
    });

    return NextResponse.json({
      ok: true,
      botUsername: realUsername,
      webhookUrl,
      botInfo: meData.result,
    });
  } catch (err) {
    console.error('Bot register error:', err);
    return NextResponse.json({ error: 'Failed to register bot' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data } = await serviceClient
      .from('app_settings')
      .select('bot_username, webhook_url')
      .maybeSingle();

    return NextResponse.json({
      botUsername: data?.bot_username || '',
      webhookUrl: data?.webhook_url || '',
      configured: !!(data?.bot_username),
    });
  } catch (err) {
    console.error('Bot info error:', err);
    return NextResponse.json({ error: 'Failed to get bot info' }, { status: 500 });
  }
}
