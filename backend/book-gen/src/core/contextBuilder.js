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

export function parseChaptersFromOutline(outlineText) {
  const lines = outlineText.split('\n');
  const chapters = [];

  for (const line of lines) {
    const match = line.match(/^(?:chapter\s+)?(\d+)[.:\-–]\s*(.+)/i);
    if (match) {
      chapters.push({
        number: parseInt(match[1], 10),
        title: match[2].trim(),
      });
    }
  }

  return chapters;
}
