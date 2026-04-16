import { getPreviousChapterSummaries } from '../db/chaptersRepo.js';

export async function buildChapterContext(bookId, nextChapterNumber) {
  if (nextChapterNumber <= 1) return '';

  const summaries = await getPreviousChapterSummaries(bookId, nextChapterNumber);
  if (!summaries.length) return '';

  const lines = summaries.map(
    (ch) => `Chapter ${ch.chapter_number} - "${ch.title}":\n${ch.summary}`
  );

  return lines.join('\n\n');
}

/** Strip common Markdown / list noise so "1. Title" and "## Chapter 1: Title" still match. */
function normalizeOutlineLine(line) {
  let s = String(line).trim();
  s = s.replace(/^\s*[-*+]\s+/, '');
  s = s.replace(/^\s*#{1,6}\s+/, '');
  s = s.replace(/\*\*/g, '');
  s = s.replace(/`/g, '');
  return s.trim();
}

/**
 * Extract chapter numbers + titles from outline text.
 * Supported examples per line: "1. Title", "Chapter 1: Title", "1 - Title", "## Chapter 1: Title" (after normalize).
 */
export function parseChaptersFromOutline(outlineText) {
  if (!outlineText?.trim()) return [];

  const lines = outlineText.split('\n');
  const chapters = [];
  const seen = new Set();

  const tryPush = (num, title) => {
    const n = parseInt(num, 10);
    const t = (title ?? '').replace(/\s+#+\s*$/, '').trim();
    if (!n || n < 1 || !t) return;
    if (seen.has(n)) return;
    seen.add(n);
    chapters.push({ number: n, title: t });
  };

  for (const raw of lines) {
    const line = normalizeOutlineLine(raw);
    if (!line) continue;

    let m = line.match(/^(?:chapter\s+)?(\d+)[.:\-–]\s*(.+)/i);
    if (m) {
      tryPush(m[1], m[2]);
      continue;
    }

    m = line.match(/^chapter\s+(\d+)\s*[:\-–—]\s*(.+)$/i);
    if (m) {
      tryPush(m[1], m[2]);
      continue;
    }

    m = line.match(/^(\d+)\s+[—\-–]\s+(.+)/);
    if (m) {
      tryPush(m[1], m[2]);
    }
  }

  chapters.sort((a, b) => a.number - b.number);
  return chapters;
}
