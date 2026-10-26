import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripHtml } from '@/lib/utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
// the user's fixed UTC offset in hours (e.g. -5, 1, 5.5); defaults to UTC
const OFFSET_MS = (Number(process.env.NOTES_UTC_OFFSET_HOURS) || 0) * 60 * 60 * 1000;

async function sendTelegram(botToken: string, chatId: number, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: '🌐 Open website', url: SITE_URL }]] },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function run() {
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Empty the trash first: permanently remove notes soft-deleted over 30 days
  // ago. This is independent of the bot, so it must run even when no bot token
  // is configured (otherwise the trash grows forever).
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: purgedRows } = await db
    .from('notes')
    .delete()
    .lt('deleted_at', cutoff)
    .select('id');
  const purged = purgedRows?.length ?? 0;

  const { data: settings } = await db.from('app_settings').select('bot_token').limit(1).maybeSingle();
  const botToken = settings?.bot_token || '';
  if (!botToken) return { sent: 0, due: 0, purged, note: 'bot token not configured' };

  // Everything due up to the end of the user's "today" (extracted_date is stored at
  // UTC midnight). No lower bound, so a reminder that was missed on its day (cron
  // failure, or the note was created after that day's run) still gets delivered
  // on a later run instead of being lost forever. reminded=true prevents repeats.
  const m = new Date(Date.now() + OFFSET_MS);
  const base = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
  const tomorrowIso = new Date(base + 86400000).toISOString();

  const { data: notes, error } = await db
    .from('notes')
    .select('id, text, users!inner(telegram_id)')
    .lt('extracted_date', tomorrowIso)
    .not('extracted_date', 'is', null)
    .eq('reminded', false)
    .is('deleted_at', null);

  if (error) return { sent: 0, due: 0, purged, error: error.message };

  let sent = 0;
  for (const note of notes || []) {
    // PostgREST may return the embedded relation as an object or a single-item array.
    const u = (note as { users?: { telegram_id?: number } | { telegram_id?: number }[] }).users;
    const tid = Array.isArray(u) ? u[0]?.telegram_id : u?.telegram_id;
    if (!tid) continue;
    // note.text may hold HTML (forwarded-post formatting / translations); the
    // reminder is sent as plain text, so strip tags instead of showing them raw.
    const text = stripHtml(note.text || '').replace(/\s+/g, ' ').trim();
    const snippet = text.length > 250 ? text.slice(0, 250) + '…' : text;
    const ok = await sendTelegram(botToken, tid, `🔔 Reminder for today:\n\n${snippet}`);
    if (ok) {
      await db.from('notes').update({ reminded: true }).eq('id', note.id);
      sent++;
    }
  }

  return { sent, due: notes?.length ?? 0, purged };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || '';
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await run();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('Reminders cron error:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
