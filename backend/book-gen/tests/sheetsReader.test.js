import { describe, it, expect } from 'vitest';
import { normalizeOutlineStatusFromSheet } from '../src/services/sheetsReader.js';

describe('normalizeOutlineStatusFromSheet', () => {
  it('returns null for empty so sync can preserve DB', () => {
    expect(normalizeOutlineStatusFromSheet(null)).toBe(null);
    expect(normalizeOutlineStatusFromSheet('')).toBe(null);
    expect(normalizeOutlineStatusFromSheet('   ')).toBe(null);
  });

  it('normalizes common sheet spellings', () => {
    expect(normalizeOutlineStatusFromSheet('no_notes_needed')).toBe('no_notes_needed');
    expect(normalizeOutlineStatusFromSheet('No Notes Needed')).toBe('no_notes_needed');
    expect(normalizeOutlineStatusFromSheet('YES')).toBe('yes');
    expect(normalizeOutlineStatusFromSheet('no')).toBe('no');
  });
});
