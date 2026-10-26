import type { AnalysisResult } from '@/types';

/**
 * Lightweight, dependency-free note analysis (no LLM).
 * Shared by the web "AI analyze" route and the Telegram webhook route so the
 * project does not need a separate Supabase Edge Function.
 */

// Relative words ("today", "tomorrow", "in 3 days") are resolved against the user's calendar day.
// Set NOTES_UTC_OFFSET_HOURS to your fixed UTC offset (e.g. -5, 1, 5.5); defaults to UTC.
const OFFSET_MS = (Number(process.env.NOTES_UTC_OFFSET_HOURS) || 0) * 60 * 60 * 1000;

// Always store dates as UTC midnight of the calendar day, so the reminders cron
// can match them by day without timezone ambiguity.
function midnightUTC(year: number, month1: number, day: number): string | null {
  const dt = new Date(Date.UTC(year, month1 - 1, day));
  // Reject impossible dates (e.g. 31.02) that JS would silently roll over.
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month1 - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.toISOString();
}

// Today's calendar date in the user's timezone, expressed as UTC-midnight epoch ms.
function localTodayBase(): number {
  const m = new Date(Date.now() + OFFSET_MS);
  return Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function extractDates(text: string): string | null {
  const lower = text.toLowerCase();

  // 1. ISO: 2026-06-20
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return midnightUTC(y, m, d);
  }

  // 2. Numeric: 20.06.2026, 20/6/26 (day first)
  const dmy = text.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (dmy) {
    const d = +dmy[1];
    const m = +dmy[2];
    let y = +dmy[3];
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return midnightUTC(y, m, d);
  }

  // 3. Words: "20 june" / "20 june 2026" / "june 20" / "june 20, 2026"
  const monthNames = Object.keys(MONTHS).join('|');
  const dm = lower.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\b(?:\\s+(\\d{4}))?`));
  const md = lower.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`));
  const hit = dm ? { d: +dm[1], m: MONTHS[dm[2]], y: dm[3] } : md ? { d: +md[2], m: MONTHS[md[1]], y: md[3] } : null;
  if (hit && hit.m && hit.d >= 1 && hit.d <= 31) {
    let y = hit.y ? +hit.y : 0;
    if (!y) {
      // No year given — pick the upcoming occurrence (this year, or next if it already passed).
      const base = localTodayBase();
      y = new Date(base).getUTCFullYear();
      if (Date.UTC(y, hit.m - 1, hit.d) < base) y += 1;
    }
    return midnightUTC(y, hit.m, hit.d);
  }

  // 4. "in N days"
  const inDays = lower.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (inDays) {
    return new Date(localTodayBase() + +inDays[1] * 86400000).toISOString();
  }

  // 5. Relative words
  const rel = lower.match(/\b(day after tomorrow|today|tomorrow|yesterday)\b/);
  if (rel) {
    const offsets: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1, 'day after tomorrow': 2 };
    const off = offsets[rel[1]] ?? 0;
    return new Date(localTodayBase() + off * 86400000).toISOString();
  }

  return null;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
    'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
    'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
    'she', 'her', 'it', 'its', 'they', 'them', 'their',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function extractTopics(keywords: string[]): string[] {
  const topicKeywords: Record<string, string[]> = {
    Work: ['work', 'project', 'task', 'meeting', 'deadline', 'office', 'client', 'call'],
    Ideas: ['idea', 'ideas', 'concept', 'think', 'brainstorm', 'maybe'],
    Personal: ['personal', 'family', 'health', 'shopping', 'doctor', 'home', 'gym'],
    Learning: ['learn', 'course', 'book', 'article', 'study', 'read', 'tutorial'],
    Finance: ['money', 'budget', 'payment', 'cost', 'price', 'finance', 'invoice', 'bill'],
    Travel: ['travel', 'ticket', 'hotel', 'flight', 'trip', 'visa'],
    Tech: ['code', 'program', 'server', 'api', 'database', 'tech', 'app', 'bug', 'deploy'],
  };

  const matchedTopics: string[] = [];
  for (const [topic, topicWords] of Object.entries(topicKeywords)) {
    const overlap = keywords.filter((k) => topicWords.includes(k.toLowerCase()));
    if (overlap.length > 0) {
      matchedTopics.push(topic);
    }
  }

  if (matchedTopics.length === 0 && keywords.length > 0) {
    matchedTopics.push('Notes');
  }

  return matchedTopics.slice(0, 3);
}

function generateSummary(text: string): string {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (sentences.length === 0) {
    return text.slice(0, 150) + (text.length > 150 ? '...' : '');
  }

  if (sentences.length <= 2) {
    return sentences.join('. ') + '.';
  }

  return sentences.slice(0, 2).join('. ') + '.';
}

export function analyzeText(text: string): AnalysisResult {
  const keywords = extractKeywords(text);
  return {
    summary: generateSummary(text),
    extractedDate: extractDates(text),
    keywords,
    topics: extractTopics(keywords),
  };
}
