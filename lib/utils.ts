import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatRelativeDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} h ago`;
    if (diffDays < 7) return `${diffDays} d ago`;
    return formatDate(date);
  } catch {
    return '';
  }
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

// Deterministic colour for a tag, so the same tag always looks the same.
const TAG_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
];

export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// The fixed topic vocabulary, shared by the bot picker, note editor, context
// menu and sticky wall. Single source of truth — keep in sync with lib/analyze.
export const KNOWN_TOPICS = [
  'Work', 'Ideas', 'Personal', 'Learning', 'Finance',
  'Travel', 'Tech', 'Notes', 'Media',
];

// User-pickable named tag colours. `dot` is the swatch shown in the picker;
// `badge` is the chip class. Listed as string literals so Tailwind keeps them.
export const TAG_COLOR_OPTIONS: { key: string; label: string; dot: string; badge: string }[] = [
  { key: 'blue', label: 'Blue', dot: '#3b82f6', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  { key: 'emerald', label: 'Green', dot: '#10b981', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { key: 'amber', label: 'Yellow', dot: '#f59e0b', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  { key: 'orange', label: 'Orange', dot: '#f97316', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  { key: 'rose', label: 'Red', dot: '#f43f5e', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
  { key: 'violet', label: 'Violet', dot: '#8b5cf6', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  { key: 'cyan', label: 'Cyan', dot: '#06b6d4', badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300' },
  { key: 'teal', label: 'Teal', dot: '#14b8a6', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' },
  { key: 'gray', label: 'Gray', dot: '#6b7280', badge: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
];

const TAG_BADGE_BY_KEY: Record<string, string> = Object.fromEntries(
  TAG_COLOR_OPTIONS.map((o) => [o.key, o.badge])
);

// Chip class for a tag: the user's chosen colour if any, else the auto colour.
export function tagBadgeClass(key: string | null | undefined, tag: string): string {
  return (key && TAG_BADGE_BY_KEY[key]) || tagColor(tag);
}

// ---- note text: notes may hold plain text (from the bot) OR formatting HTML
// (from the web editor). These helpers let both render/preview safely. ----

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'div', 'p', 'span',
  // Block/inline formatting carried over from forwarded Telegram posts.
  'blockquote', 'code', 'pre', 'a',
]);

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(s || '');
}

// Plain text for previews / search snippets.
export function stripHtml(s: string): string {
  return (s || '')
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(div|p)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keep only basic formatting tags, drop all attributes — notes are private, but
// this still blocks <script>, javascript: handlers, etc.
export function sanitizeHtml(s: string): string {
  if (!s) return '';
  let out = s.replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_m, slash, tag, attrs) => {
    const t = String(tag).toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (slash) return `</${t}>`;
    // Links keep a single validated http(s) href; every other attribute is
    // dropped (the href guard blocks javascript:/data: XSS vectors).
    if (t === 'a') {
      const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(String(attrs));
      const raw = m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
      const safe = raw ? normalizeHttpUrl(raw) : null;
      if (!safe) return '';
      const href = safe.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${t}>`;
  });
  return out;
}

function plainToHtml(s: string): string {
  return escapeHtmlText(s || '').replace(/\n/g, '<br>');
}

// HTML representation for rendering / loading into the editor.
export function noteToHtml(s: string): string {
  return isHtml(s) ? sanitizeHtml(s) : plainToHtml(s);
}

// Language names for the "Translated from <lang>" badge.
const LANG_NAMES_GENITIVE: Record<string, string> = {
  ru: 'Russian', zh: 'Chinese', ko: 'Korean', ja: 'Japanese',
  de: 'German', fr: 'French', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', tr: 'Turkish', ar: 'Arabic', uk: 'Ukrainian',
  pl: 'Polish', nl: 'Dutch', hi: 'Hindi', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', fa: 'Persian', he: 'Hebrew',
  el: 'Greek', cs: 'Czech', sv: 'Swedish', fi: 'Finnish',
  ro: 'Romanian', hu: 'Hungarian', ka: 'Georgian', hy: 'Armenian',
  az: 'Azerbaijani', kk: 'Kazakh', be: 'Belarusian',
};

export function languageName(code: string | null | undefined): string {
  if (!code) return '';
  return LANG_NAMES_GENITIVE[code] || LANG_NAMES_GENITIVE[code.split('-')[0]] || code;
}

// Tailwind utilities that style the small HTML subset a note can contain
// (bold/italic/underline/strike + blockquote/code/pre/links). Shared by every
// surface that renders note HTML so forwarded-post formatting looks the same
// everywhere. Lives in lib/** which Tailwind scans, so the arbitrary variants
// below are emitted into the build.
export const RICH_CLASS =
  "[&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_u]:underline [&_s]:line-through [&_strike]:line-through " +
  // Telegram-style quote: rounded block, blue left bar, faint blue fill.
  "[&_blockquote]:my-1.5 [&_blockquote]:rounded-md [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#3390ec] [&_blockquote]:bg-[#3390ec]/10 [&_blockquote]:py-1.5 [&_blockquote]:pl-3 [&_blockquote]:pr-2.5 " +
  "[&_code]:rounded [&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] " +
  "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-foreground/10 [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[0.85em] [&_pre]:whitespace-pre-wrap " +
  "[&_a]:underline [&_a]:break-words";

/**
 * Returns a normalized http(s) URL, or null if the input is not a safe web URL.
 * A bare host (e.g. "example.com") is assumed to be https. Anything with a
 * non-http(s) scheme (javascript:, data:, …) is rejected — those are XSS vectors
 * when rendered into an <a href>.
 */
export function normalizeHttpUrl(input: string): string | null {
  let candidate = (input || '').trim();
  if (!candidate) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = 'https://' + candidate;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
