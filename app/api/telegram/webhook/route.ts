import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';
import { analyzeText } from '@/lib/analyze';
import { normalizeHttpUrl } from '@/lib/utils';
import { waitUntil } from '@vercel/functions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');

const MEDIA_BUCKET = 'media';

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime',
  ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  pdf: 'application/pdf',
};

// Reply-keyboard main menu (bottom panel). Tapping a button sends its text,
// which we map back to a command below.
const mainMenuKeyboard = {
  keyboard: [
    [{ text: '🕒 Recent' }, { text: '📊 Stats' }],
    [{ text: '🌐 Website' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const MENU_MAP: Record<string, string> = {
  '🕒 Recent': '/recent',
  '📊 Stats': '/stats',
  '🌐 Website': '/site',
};

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; last_name?: string; username?: string };
  chat: { id: number };
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  forward_from_chat?: { title?: string };
  forward_from?: { first_name: string; last_name?: string };
  forward_date?: number;
  voice?: { file_id: string; file_size?: number };
  audio?: { file_id: string; file_size?: number };
  video?: { file_id: string; file_size?: number };
  document?: { file_id: string; file_name?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number }>;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

type InlineButton = { text: string; callback_data?: string; url?: string };
type InlineMarkup = { inline_keyboard: InlineButton[][] };

function admin(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function generateCode(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

const BATCH_WINDOW_MS = 8000;

function noteCountText(n: number): string {
  return n === 1 ? '1 note' : `${n} notes`;
}

// Encode a counter as a valid UUID so it fits in the `note_id uuid` column.
// Format: 00000000-0000-0000-0000-000000000001 for n=1.
function countToUuid(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}
function uuidToCount(uuid: string | null | undefined): number {
  if (!uuid) return 0;
  const last = uuid.split('-').pop() ?? '0';
  return parseInt(last, 10) || 0;
}

async function getBatchState(
  db: SupabaseClient,
  telegramId: number
): Promise<{ messageId: number; count: number } | null> {
  const { data } = await db
    .from('bot_state')
    .select('action, message_id, note_id, updated_at')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (!data || data.action !== 'batch_save') return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > BATCH_WINDOW_MS) return null;
  return { messageId: data.message_id, count: uuidToCount(data.note_id) };
}

async function setBatchState(
  db: SupabaseClient,
  telegramId: number,
  messageId: number,
  count: number
): Promise<void> {
  const { error } = await db.from('bot_state').upsert(
    {
      telegram_id: telegramId,
      action: 'batch_save',
      message_id: messageId,
      note_id: countToUuid(count),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id' }
  );
  if (error) console.error('setBatchState error:', error.message);
}

async function handleSaveSuccess(
  db: SupabaseClient,
  telegramId: number,
  chatId: number,
  botToken: string,
): Promise<void> {
  const batch = await getBatchState(db, telegramId);

  let finalMsgId: number;
  let newCount: number;

  if (batch) {
    finalMsgId = batch.messageId;
    newCount = batch.count + 1;
    await setBatchState(db, telegramId, finalMsgId, newCount);
    await editMessageText(chatId, finalMsgId, `⏳ Saving... (${noteCountText(newCount)})`, botToken);
  } else {
    const msgId = await sendTelegramMessage(chatId, `⏳ Saving...`, botToken);
    if (!msgId) return;
    finalMsgId = msgId;
    newCount = 1;
    await setBatchState(db, telegramId, finalMsgId, 1);
    await editMessageText(chatId, finalMsgId, `⏳ Saving... (${noteCountText(1)})`, botToken);
  }

  // Schedule finalization after the batch window expires.
  // Each note schedules a timer; only the last note's timer will find the batch
  // expired and show ✅. Earlier timers see the batch still active and skip.
  const capturedMsgId = finalMsgId;
  waitUntil(
    new Promise<void>((resolve) => setTimeout(resolve, BATCH_WINDOW_MS + 1500))
      .then(async () => {
        const { data } = await db
          .from('bot_state')
          .select('action, message_id, note_id, updated_at')
          .eq('telegram_id', telegramId)
          .maybeSingle();
        if (!data || data.action !== 'batch_save') return; // Already finalized or cleared.
        if (data.message_id !== capturedMsgId) return; // A newer batch started.
        const age = Date.now() - new Date(data.updated_at).getTime();
        if (age <= BATCH_WINDOW_MS) return; // Still active — a later timer will finalize.
        // Mark finalized so concurrent timers skip.
        await db.from('bot_state').upsert(
          { telegram_id: telegramId, action: 'finalized', message_id: capturedMsgId, updated_at: new Date().toISOString() },
          { onConflict: 'telegram_id' }
        );
        const finalCount = Math.max(1, uuidToCount(data.note_id));
        await editMessageText(chatId, capturedMsgId, `✅ Saved ${noteCountText(finalCount)}`, botToken, siteButton);
      })
      .catch((err) => console.error('finalize error:', err)),
  );
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const siteButton: InlineMarkup = { inline_keyboard: [[{ text: '🌐 Open website', url: SITE_URL }]] };

function extractUrls(
  text: string,
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>
): string[] {
  const urls = new Set<string>();
  for (const entity of entities || []) {
    if (entity.type === 'url') {
      const url = text.substring(entity.offset, entity.offset + entity.length);
      if (/^https?:\/\//i.test(url)) urls.add(url);
    } else if (entity.type === 'text_link' && entity.url) {
      if (/^https?:\/\//i.test(entity.url)) urls.add(entity.url);
    }
  }
  const matches = text.match(/https?:\/\/\S+/gi);
  if (matches) for (const m of matches) urls.add(m);
  return Array.from(urls);
}

// --- Telegram message formatting → the site's small HTML subset ---
// Forwarded/typed posts keep their bold/italic/underline/strike/spoiler/code/
// quote/link formatting instead of being flattened to plain text.
type MsgEntity = { type: string; offset: number; length: number; url?: string };

const ENTITY_TAGS: Record<string, [string, string]> = {
  bold: ['<b>', '</b>'],
  italic: ['<i>', '</i>'],
  underline: ['<u>', '</u>'],
  strikethrough: ['<s>', '</s>'],
  spoiler: ['<span>', '</span>'],
  code: ['<code>', '</code>'],
  pre: ['<pre>', '</pre>'],
  blockquote: ['<blockquote>', '</blockquote>'],
  expandable_blockquote: ['<blockquote>', '</blockquote>'],
};

function entityTags(e: MsgEntity): [string, string] | null {
  if (e.type === 'text_link' && e.url) {
    const safe = normalizeHttpUrl(e.url);
    if (!safe) return null;
    const href = safe.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return [`<a href="${href}">`, '</a>'];
  }
  return ENTITY_TAGS[e.type] ?? null;
}

// Returns HTML when the message carries convertible formatting, otherwise null
// so plain messages keep saving as plain text (and dedupe exactly as before).
// Telegram entity offsets are UTF-16 code units, which is what JS string
// indexing uses, so substring() lines up without conversion.
function entitiesToHtml(text: string, entities?: MsgEntity[]): string | null {
  if (!entities?.length) return null;
  const conv = entities.filter((e) => e.length > 0 && entityTags(e) !== null);
  if (conv.length === 0) return null;

  // Cut the text at every entity boundary, then wrap each slice in the tags of
  // all entities covering it — this handles overlapping/nested formatting
  // (e.g. bold + italic on the same range) without producing invalid markup.
  const bounds = new Set<number>([0, text.length]);
  for (const e of conv) {
    bounds.add(Math.max(0, e.offset));
    bounds.add(Math.min(text.length, e.offset + e.length));
  }
  const points = Array.from(bounds).sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const slice = text.substring(start, end);
    if (!slice) continue;
    const active = conv
      .filter((e) => e.offset <= start && e.offset + e.length >= end)
      .sort((a, b) => a.offset - b.offset || b.length - a.length); // outer tags first
    const insidePre = active.some((e) => e.type === 'pre');
    // <pre> keeps real newlines (CSS white-space:pre-wrap); elsewhere \n → <br>.
    const body = insidePre ? escapeHtml(slice) : escapeHtml(slice).replace(/\n/g, '<br>');
    let open = '';
    let close = '';
    for (const e of active) {
      const tags = entityTags(e);
      if (!tags) continue;
      open += tags[0];
      close = tags[1] + close;
    }
    html += open + body + close;
  }
  // Inline formatting inside a quote (e.g. a bold word) splits the block into
  // adjacent copies; merge them so one Telegram quote renders as one block, not
  // several stacked frames. Genuinely separate quotes keep a <br>/text between
  // them, so this only re-joins fragments of the same block.
  return html.replace(/<\/blockquote><blockquote>/g, '').replace(/<\/pre><pre>/g, '');
}

// --- Auto-translation of foreign-language posts ---
// Posts in other languages (Spanish, Chinese, Korean, …) are translated to English
// on save via Google's free translate endpoint; the original is kept so the user
// can reveal it. Text is sent to a third-party (Google) — by design.

// Ask the translator only when there are real words (not just links/numbers/emoji).
// URLs are stripped first so a bare link isn't mistaken for foreign-language text.
// English input comes back with lang "en" and is kept as is (see below).
function needsTranslation(text: string): boolean {
  const stripped = text.replace(/https?:\/\/\S+/gi, ' ');
  const letters = stripped.match(/\p{L}/gu);
  return !!letters && letters.length >= 2;
}

async function translateChunk(q: string): Promise<{ text: string; lang: string } | null> {
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(q)}`;
    // Bound the call so a slow/hung translator can't keep the webhook open long
    // enough for Telegram to retry the update.
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    // Shape: [ [ [translated, original, …], … ], …, detectedLang, … ]
    const segments: unknown[] = Array.isArray(data?.[0]) ? data[0] : [];
    const text = segments.map((s) => (Array.isArray(s) ? s[0] ?? '' : '')).join('');
    const lang = typeof data?.[2] === 'string' ? data[2] : '';
    return text ? { text, lang } : null;
  } catch {
    return null;
  }
}

// Translate to English (chunked so long posts fit the GET endpoint). Returns null
// on any failure — or when the text already is English — so the caller saves the original.
async function translateToEnglish(text: string): Promise<{ text: string; lang: string } | null> {
  const MAX = 1500;
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX && chunks.length < 7) {
    let cut = rest.lastIndexOf('\n', MAX);
    if (cut < MAX * 0.5) cut = rest.lastIndexOf(' ', MAX);
    if (cut < MAX * 0.5) cut = MAX;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);

  const results = await Promise.all(chunks.map((c) => translateChunk(c)));
  if (results.some((r) => r === null)) return null;
  const translated = results.map((r) => r!.text).join('');
  const lang = results.find((r) => r!.lang)?.lang ?? '';
  if (lang === 'en') return null;
  return translated.trim() ? { text: translated, lang } : null;
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  botToken: string,
  replyMarkup?: unknown
): Promise<number | null> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.ok ? (data.result?.message_id ?? null) : null;
  } catch (err) {
    console.error('Send telegram message error:', err);
    return null;
  }
}

async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  botToken: string,
  replyMarkup?: unknown
): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* editing is best-effort (message may be too old / unchanged) */
  }
}

async function answerCallback(callbackId: string, botToken: string, text?: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: text || undefined }),
    });
  } catch {
    /* ignore */
  }
}

async function deleteMessage(chatId: number, messageId: number, botToken: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch {
    /* best effort */
  }
}

async function clearRecentMessages(
  chatId: number,
  fromMessageId: number,
  botToken: string,
  count = 100
): Promise<void> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = fromMessageId - i;
    if (id > 0) ids.push(id);
  }
  await Promise.all(ids.map((id) => deleteMessage(chatId, id, botToken)));
}

async function findUserIdByTelegramId(db: SupabaseClient, telegramId: number): Promise<string | null> {
  const { data } = await db.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
  return data?.id ?? null;
}

async function getOrCreateUserByTelegramId(
  db: SupabaseClient,
  telegramId: number,
  firstName: string,
  lastName?: string
): Promise<string | null> {
  const existing = await findUserIdByTelegramId(db, telegramId);
  if (existing) return existing;

  const { data: created, error } = await db
    .from('users')
    .insert({
      telegram_id: telegramId,
      name: `${firstName}${lastName ? ` ${lastName}` : ''}`.trim(),
    })
    .select('id')
    .maybeSingle();

  if (!error && created) return created.id;

  const after = await findUserIdByTelegramId(db, telegramId);
  if (after) return after;

  console.error('Create user error:', error);
  return null;
}

async function noteExists(db: SupabaseClient, userId: string, text: string): Promise<boolean> {
  const { data } = await db
    .from('notes')
    .select('id')
    .eq('user_id', userId)
    .eq('text', text)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function bookmarkExists(db: SupabaseClient, userId: string, url: string): Promise<boolean> {
  const { data } = await db
    .from('bookmarks')
    .select('id')
    .eq('user_id', userId)
    .eq('url', url)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function saveNote(
  db: SupabaseClient,
  userId: string,
  text: string,
  fields: {
    keywords?: string[];
    topics?: string[];
    summary?: string | null;
    extractedDate?: string | null;
    analyzed?: boolean;
    createdAt?: string; // for forwarded posts: use the original post's date
    mediaUrl?: string | null;
    mediaType?: string | null;
    originalText?: string | null; // pre-translation source (null when not translated)
    sourceLang?: string | null;
  },
  messageId: number
): Promise<string | null> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    text,
    // Default every note to the "notes" tag (user adds their own from there).
    ai_keywords: fields.keywords && fields.keywords.length ? fields.keywords : ['notes'],
    ai_topics: fields.topics ?? [],
    ai_summary: fields.summary ?? null,
    extracted_date: fields.extractedDate ?? null,
    analyzed: fields.analyzed ?? false,
    telegram_message_id: messageId,
  };
  if (fields.createdAt) payload.created_at = fields.createdAt;
  // Only reference the media columns when there's actually a file, so plain
  // notes still save even if the DB migration hasn't been run yet.
  if (fields.mediaUrl) {
    payload.media_url = fields.mediaUrl;
    payload.media_type = fields.mediaType ?? null;
  }
  if (fields.originalText) {
    payload.original_text = fields.originalText;
    payload.source_lang = fields.sourceLang ?? null;
  }

  let { data, error } = await db.from('notes').insert(payload).select('id').maybeSingle();
  // If the translation columns don't exist yet (migration not run), retry without
  // them: the translation still saves, just without the "show original".
  if (error && 'original_text' in payload) {
    delete payload.original_text;
    delete payload.source_lang;
    ({ data, error } = await db.from('notes').insert(payload).select('id').maybeSingle());
  }
  if (error) {
    console.error('Save note error:', error);
    return null;
  }
  return data?.id ?? null;
}

async function saveBookmark(
  db: SupabaseClient,
  userId: string,
  title: string,
  url: string,
  description: string,
  messageId: number
): Promise<boolean> {
  const { error } = await db.from('bookmarks').insert({
    user_id: userId,
    title: title || 'Bookmark',
    url,
    description,
    source: 'telegram',
    telegram_message_id: messageId,
    tags: [],
  });
  if (error) console.error('Save bookmark error:', error);
  return !error;
}

async function userStats(db: SupabaseClient, userId: string): Promise<{ notes: number; bookmarks: number }> {
  const n = await db.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null);
  const b = await db.from('bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return { notes: n.count ?? 0, bookmarks: b.count ?? 0 };
}

function hasMediaContent(message: TelegramMessage): boolean {
  return !!(
    message.voice ||
    message.audio ||
    message.video ||
    message.document ||
    message.photo ||
    message.forward_from_chat ||
    message.forward_from
  );
}

// Telegram's Bot API refuses getFile/download for files larger than this — a hard
// platform limit, not something we can raise from here. Above it, only the text/
// caption of a message can be saved; the file itself is unreachable to the bot.
const TELEGRAM_BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // 20 MB

// The single downloadable attachment on a message, if any (largest photo size).
function mediaDescriptor(
  m: TelegramMessage
): { kind: string; fileId: string; title: string; fileSize?: number } | null {
  if (m.photo?.length) {
    const p = m.photo[m.photo.length - 1];
    return { kind: 'photo', fileId: p.file_id, title: 'Photo', fileSize: p.file_size };
  }
  if (m.video) return { kind: 'video', fileId: m.video.file_id, title: 'Video', fileSize: m.video.file_size };
  if (m.voice) return { kind: 'voice', fileId: m.voice.file_id, title: 'Voice message', fileSize: m.voice.file_size };
  if (m.audio) return { kind: 'audio', fileId: m.audio.file_id, title: 'Audio', fileSize: m.audio.file_size };
  if (m.document) return { kind: 'document', fileId: m.document.file_id, title: m.document.file_name || 'Document', fileSize: m.document.file_size };
  return null;
}

async function getTelegramFilePath(botToken: string, fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await res.json();
    return data?.ok ? (data.result?.file_path ?? null) : null;
  } catch {
    return null;
  }
}

// Download a Telegram file and store it in the public `media` bucket.
// Returns the public URL, or null if anything fails (bot files are capped at 20 MB).
async function storeTelegramFile(
  db: SupabaseClient,
  botToken: string,
  fileId: string,
  userId: string
): Promise<string | null> {
  const filePath = await getTelegramFilePath(botToken, fileId);
  if (!filePath) return null;
  try {
    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileRes.ok) return null;
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    const ext = (filePath.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    const objectPath = `${userId}/${Date.now()}-${randomInt(100000, 1000000)}.${ext}`;
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(objectPath, buf, {
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
      upsert: false,
    });
    if (error) {
      console.error('Storage upload error:', error);
      return null;
    }
    const { data } = db.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error('storeTelegramFile error:', err);
    return null;
  }
}

// Inline keyboard shown under the /start greeting (the bot's main menu).
const startMenu: InlineMarkup = {
  inline_keyboard: [
    [{ text: '🌐 Open website', url: SITE_URL }],
    [{ text: '🕒 Recent', callback_data: 'm|recent' }, { text: '📊 Stats', callback_data: 'm|stats' }],
    [{ text: '❓ What can this bot do', callback_data: 'm|help' }],
  ],
};

async function sendHelp(chatId: number, botToken: string): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `<b>🤖 What I can do</b>\n\n` +
      `Just send me:\n` +
      `• <b>text</b> — saved as a note\n` +
      `• <b>a link</b> — saved as a note too\n` +
      `• <b>a photo / video / voice message / file</b> — saved as a note\n\n` +
      `Once saved, I <b>delete your message</b> to keep the chat clean — the note is already waiting on the website. Duplicates are skipped. ♻️`,
    botToken,
    siteButton
  );
}

async function sendStats(db: SupabaseClient, chatId: number, userId: string, botToken: string): Promise<void> {
  const { notes } = await userStats(db, userId);
  await sendTelegramMessage(chatId, `📊 <b>Stats</b>\n\n📝 Notes: <b>${notes}</b>`, botToken, siteButton);
}

async function sendRecent(db: SupabaseClient, chatId: number, userId: string, botToken: string): Promise<void> {
  const { data: recent } = await db
    .from('notes')
    .select('text')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5);
  if (!recent || recent.length === 0) {
    await sendTelegramMessage(chatId, 'No notes yet. Send me your first one!', botToken);
    return;
  }
  const list = recent
    .map((r: { text: string }, i: number) => {
      const t = (r.text || '').replace(/\s+/g, ' ').trim();
      return `${i + 1}. ${escapeHtml(t.length > 80 ? t.slice(0, 80) + '…' : t)}`;
    })
    .join('\n');
  await sendTelegramMessage(chatId, `🕒 <b>Recent notes:</b>\n\n${list}`, botToken, siteButton);
}

async function handleCallback(db: SupabaseClient, cq: TelegramCallbackQuery, botToken: string): Promise<void> {
  const data = cq.data || '';
  const parts = data.split('|');
  const type = parts[0];
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;

  if (type === 'noop' || !chatId || !messageId) {
    await answerCallback(cq.id, botToken);
    return;
  }

  // Main-menu inline buttons (don't require a note).
  if (type === 'm') {
    await answerCallback(cq.id, botToken);
    const action = parts[1];
    if (action === 'site') {
      await sendTelegramMessage(chatId, '🌐 Your notes website:', botToken, siteButton);
      return;
    }
    if (action === 'help') {
      await sendHelp(chatId, botToken);
      return;
    }
    const uid = await findUserIdByTelegramId(db, cq.from.id);
    if (!uid) {
      await sendTelegramMessage(chatId, 'Sign in first — send /start.', botToken);
      return;
    }
    if (action === 'recent') await sendRecent(db, chatId, uid, botToken);
    else if (action === 'stats') await sendStats(db, chatId, uid, botToken);
    return;
  }

  // No other inline buttons are produced, so just acknowledge anything else.
  await answerCallback(cq.id, botToken);
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}

export async function POST(req: NextRequest) {
  try {
    const update: TelegramUpdate = await req.json();
    const db = admin();

    const { data: settings } = await db
      .from('app_settings')
      .select('bot_token, webhook_secret')
      .limit(1)
      .maybeSingle();

    const expectedSecret = settings?.webhook_secret || '';
    if (!expectedSecret || req.headers.get('x-telegram-bot-api-secret-token') !== expectedSecret) {
      return NextResponse.json({ ok: true });
    }

    const botToken = settings?.bot_token || '';
    if (!botToken) {
      console.error('Bot token not configured');
      return NextResponse.json({ ok: true });
    }

    // ---- inline button presses ----
    if (update.callback_query) {
      await handleCallback(db, update.callback_query, botToken);
      return NextResponse.json({ ok: true });
    }

    if (!update.message?.from) {
      return NextResponse.json({ ok: true });
    }

    const { from, chat, message_id } = update.message;
    const content = update.message.text || update.message.caption || '';
    const entities = update.message.entities || update.message.caption_entities;
    const trimmed = content.trim();

    // ---- commands (also via reply-keyboard buttons) ----
    // Only an EXACT match against the known list counts as a command. A message
    // that merely starts with "/" ("/todo buy milk", a file path, "//TODO") is
    // NOT a command — it must save as a note, not be rejected as "unknown".
    const KNOWN_COMMANDS = new Set(['/start', '/help', '/site', '/clear', '/stats', '/recent']);
    const firstToken = content.startsWith('/')
      ? content.split(/\s+/)[0].toLowerCase().replace(/@[\w_]+$/, '')
      : '';
    const command = MENU_MAP[trimmed] || (KNOWN_COMMANDS.has(firstToken) ? firstToken : '');

    if (command === '/start') {
      const code = generateCode();
      const { error } = await db.from('telegram_auth_codes').insert({
        code,
        telegram_id: from.id,
        first_name: from.first_name || '',
        last_name: from.last_name || '',
        username: from.username || '',
        photo_url: '',
        used: false,
      });
      if (error) {
        await sendTelegramMessage(chat.id, 'Something went wrong. Try again: /start', botToken);
        return NextResponse.json({ ok: true });
      }
      await sendTelegramMessage(
        chat.id,
        `👋 Hi! This is the <b>TG Notes</b> bot.\n\n` +
          `Send me <b>text, a link, a photo, a voice message or a file</b> — I'll save it as a note on your personal website and remove the message from the chat to keep it clean. 🧹\n\n` +
          `🔑 <b>Sign-in code:</b> <code>${code}</code>\n` +
          `Open ${SITE_URL} and enter the code (valid for 5 minutes).`,
        botToken,
        startMenu
      );
      return NextResponse.json({ ok: true });
    }

    if (command === '/help') {
      await sendHelp(chat.id, botToken);
      return NextResponse.json({ ok: true });
    }

    if (command === '/site') {
      await sendTelegramMessage(chat.id, '🌐 Your notes website:', botToken, siteButton);
      return NextResponse.json({ ok: true });
    }

    if (command === '/clear') {
      await clearRecentMessages(chat.id, message_id, botToken, 100);
      await sendTelegramMessage(
        chat.id,
        '🧹 Chat cleared. Telegram only lets bots delete messages from the last ~2 days, so very old ones may stay.',
        botToken
      );
      return NextResponse.json({ ok: true });
    }

    if (command === '/stats') {
      const userId = await findUserIdByTelegramId(db, from.id);
      if (!userId) {
        await sendTelegramMessage(chat.id, 'Nothing here yet. Send your first note, or /start to sign in.', botToken);
        return NextResponse.json({ ok: true });
      }
      await sendStats(db, chat.id, userId, botToken);
      return NextResponse.json({ ok: true });
    }

    if (command === '/recent') {
      const userId = await findUserIdByTelegramId(db, from.id);
      if (!userId) {
        await sendTelegramMessage(chat.id, 'No notes yet. Send me your first one!', botToken);
        return NextResponse.json({ ok: true });
      }
      await sendRecent(db, chat.id, userId, botToken);
      return NextResponse.json({ ok: true });
    }

    // ---- user content ----
    const userId = await getOrCreateUserByTelegramId(db, from.id, from.first_name, from.last_name);
    if (!userId) {
      await sendTelegramMessage(chat.id, "Couldn't save it. Try again later or /start.", botToken);
      return NextResponse.json({ ok: true });
    }

    // Forwarded posts: use the original post's date as the note's creation date.
    const forwardedAt = update.message.forward_date
      ? new Date(update.message.forward_date * 1000).toISOString()
      : undefined;

    // If the message carries a downloadable file (photo/video/voice/audio/document),
    // pull it from Telegram and stash it in storage so it shows on the site.
    const md = mediaDescriptor(update.message);
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    if (md) {
      mediaUrl = await storeTelegramFile(db, botToken, md.fileId, userId);
      if (mediaUrl) {
        mediaType = md.kind;
      } else {
        // Download failed. The usual cause for audio/video is Telegram's 20 MB
        // bot-download cap — warn instead of silently dropping the attachment.
        const tooBig = (md.fileSize ?? 0) > TELEGRAM_BOT_DOWNLOAD_LIMIT;
        await sendTelegramMessage(
          chat.id,
          tooBig
            ? `⚠️ "${escapeHtml(md.title)}" is over 20 MB — Telegram doesn't let bots download files that big, so the attachment wasn't saved (the text/caption will be).`
            : `⚠️ Couldn't download "${escapeHtml(md.title)}" — the attachment wasn't saved (the text/caption will be).`,
          botToken
        );
      }
    }

    if (content) {
      // Text (including links) is saved as a note. We no longer auto-tag — the
      // user assigns topics/tags manually. Date extraction is kept because the
      // reminders cron relies on extracted_date.
      //
      // Forwarded/typed posts keep their formatting (bold, italic, quote,
      // links, …) by converting Telegram message entities to HTML. Messages
      // without formatting fall back to the plain trimmed text, exactly as
      // before — so dedupe and plain notes are unchanged.
      const original = entitiesToHtml(content, entities) ?? trimmed;

      // Foreign-language posts are auto-translated to English. On success the note's
      // text becomes the translation and the (formatted) source is kept in
      // original_text; on any failure we just save the original untouched.
      let text = original;
      let originalText: string | null = null;
      let sourceLang: string | null = null;
      if (needsTranslation(trimmed)) {
        const tr = await translateToEnglish(trimmed);
        if (tr) {
          text = tr.text.trim();
          originalText = original;
          sourceLang = tr.lang || null;
        }
      }

      if (await noteExists(db, userId, text)) {
        await sendTelegramMessage(chat.id, '♻️ Duplicate — this note is already on the website, not adding it again.', botToken);
        await deleteMessage(chat.id, message_id, botToken);
        return NextResponse.json({ ok: true });
      }
      const noteId = await saveNote(
        db,
        userId,
        text,
        {
          // Date extraction always runs on the plain text, never the HTML.
          extractedDate: analyzeText(trimmed).extractedDate,
          analyzed: false,
          createdAt: forwardedAt,
          mediaUrl,
          mediaType,
          originalText,
          sourceLang,
        },
        message_id
      );
      if (noteId) {
        await handleSaveSuccess(db, from.id, chat.id, botToken);
        await deleteMessage(chat.id, message_id, botToken);
      } else {
        await sendTelegramMessage(chat.id, 'Error saving the note', botToken);
      }
      return NextResponse.json({ ok: true });
    }

    // Media without a caption: save a note carrying the downloaded file.
    if (md) {
      const noteId = await saveNote(
        db,
        userId,
        md.title,
        {
          // No text → no reminder date. `forwardedAt` is only a sort/created_at
          // hint; putting it in extracted_date makes the reminders cron fire a
          // bogus "reminder for today" for any media forwarded with today's date.
          extractedDate: null,
          createdAt: forwardedAt,
          mediaUrl,
          mediaType,
        },
        message_id
      );
      if (noteId) {
        await handleSaveSuccess(db, from.id, chat.id, botToken);
        await deleteMessage(chat.id, message_id, botToken);
      } else {
        await sendTelegramMessage(chat.id, 'Error saving', botToken);
      }
      return NextResponse.json({ ok: true });
    }

    // Forwarded post with a header but no text/file — keep the old placeholder note.
    if (hasMediaContent(update.message)) {
      const title = update.message.forward_from_chat?.title || 'Forwarded message';
      const noteId = await saveNote(
        db,
        userId,
        title,
        {
          // See above: forward date is a created_at hint, not a reminder date.
          extractedDate: null,
          createdAt: forwardedAt,
        },
        message_id
      );
      if (noteId) {
        await handleSaveSuccess(db, from.id, chat.id, botToken);
        await deleteMessage(chat.id, message_id, botToken);
      } else {
        await sendTelegramMessage(chat.id, 'Error saving', botToken);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ ok: true });
  }
}
