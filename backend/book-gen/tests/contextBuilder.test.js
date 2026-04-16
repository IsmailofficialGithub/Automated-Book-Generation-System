import { describe, it, expect } from 'vitest';
import { parseChaptersFromOutline } from '../src/core/contextBuilder.js';

describe('parseChaptersFromOutline', () => {
  it('parses "Chapter 1: Title" format', () => {
    const outline = 'Chapter 1: Introduction\n- Point one\nChapter 2: The Beginning\n- Point one';
    const chapters = parseChaptersFromOutline(outline);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({ number: 1, title: 'Introduction' });
    expect(chapters[1]).toEqual({ number: 2, title: 'The Beginning' });
  });

  it('parses "1. Title" format', () => {
    const outline = '1. Introduction\n2. History';
    const chapters = parseChaptersFromOutline(outline);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].number).toBe(1);
  });

  it('returns empty array for outline with no chapters', () => {
    const result = parseChaptersFromOutline('This is just a description with no chapters.');
    expect(result).toHaveLength(0);
  });

  it('parses markdown header lines', () => {
    const outline = '## Chapter 1: Intro\nSome text\n### 2. Next part';
    const chapters = parseChaptersFromOutline(outline);
    expect(chapters.length).toBeGreaterThanOrEqual(1);
    expect(chapters[0].number).toBe(1);
  });
});
