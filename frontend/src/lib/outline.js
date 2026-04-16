/**
 * Match backend `parseChaptersFromOutline` — lines like `1. Title` or `Chapter 1: Title`.
 * @param {string | null | undefined} outlineText
 * @returns {{ number: number; title: string }[]}
 */
export function parseChaptersFromOutline(outlineText) {
  if (!outlineText?.trim()) return [];
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
