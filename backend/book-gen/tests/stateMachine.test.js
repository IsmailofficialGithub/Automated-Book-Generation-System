import { describe, it, expect } from 'vitest';
import {
  canStartOutline,
  evaluateOutlineGate,
  canRunChapterGeneration,
  evaluateChapterGate,
  evaluateCompileGate,
} from '../src/core/stateMachine.js';

describe('canStartOutline', () => {
  it('returns false when notes_on_outline_before is empty', () => {
    const result = canStartOutline({ notes_on_outline_before: '' });
    expect(result.canProceed).toBe(false);
  });

  it('returns false when notes_on_outline_before is null', () => {
    const result = canStartOutline({ notes_on_outline_before: null });
    expect(result.canProceed).toBe(false);
  });

  it('returns true when notes_on_outline_before has content', () => {
    const result = canStartOutline({ notes_on_outline_before: 'Focus on history' });
    expect(result.canProceed).toBe(true);
  });
});

describe('evaluateOutlineGate', () => {
  it('proceeds when status is no_notes_needed', () => {
    const result = evaluateOutlineGate({ status_outline_notes: 'no_notes_needed' });
    expect(result.canProceed).toBe(true);
    expect(result.needsRegeneration).toBe(false);
  });

  it('flags regeneration when status is yes and notes exist', () => {
    const result = evaluateOutlineGate({
      status_outline_notes: 'yes',
      notes_on_outline_after: 'Make chapter 3 longer',
    });
    expect(result.canProceed).toBe(false);
    expect(result.needsRegeneration).toBe(true);
  });

  it('pauses when status is yes but no notes yet', () => {
    const result = evaluateOutlineGate({
      status_outline_notes: 'yes',
      notes_on_outline_after: null,
    });
    expect(result.canProceed).toBe(false);
    expect(result.needsRegeneration).toBe(false);
  });

  it('pauses when status is no', () => {
    const result = evaluateOutlineGate({ status_outline_notes: 'no' });
    expect(result.canProceed).toBe(false);
  });
});

describe('canRunChapterGeneration', () => {
  const outline = 'Chapter 1: Intro\nChapter 2: Body';

  it('blocks when outline is empty', () => {
    const result = canRunChapterGeneration({ outline: '' }, { allowWithoutOutlineApproval: true });
    expect(result.canProceed).toBe(false);
  });

  it('allows when no_notes_needed', () => {
    const result = canRunChapterGeneration(
      { outline, status_outline_notes: 'no_notes_needed' },
      { allowWithoutOutlineApproval: false }
    );
    expect(result.canProceed).toBe(true);
  });

  it('blocks status no when approval required', () => {
    const result = canRunChapterGeneration(
      { outline, status_outline_notes: 'no' },
      { allowWithoutOutlineApproval: false }
    );
    expect(result.canProceed).toBe(false);
  });

  it('allows status no when approval not required', () => {
    const result = canRunChapterGeneration(
      { outline, status_outline_notes: 'no' },
      { allowWithoutOutlineApproval: true }
    );
    expect(result.canProceed).toBe(true);
  });

  it('blocks yes with notes awaiting outline regen', () => {
    const result = canRunChapterGeneration(
      { outline, status_outline_notes: 'yes', notes_on_outline_after: 'fix ch1' },
      { allowWithoutOutlineApproval: true }
    );
    expect(result.canProceed).toBe(false);
    expect(result.needsOutlineRegeneration).toBe(true);
  });
});

describe('evaluateChapterGate', () => {
  it('proceeds when chapter_notes_status is no_notes_needed', () => {
    const result = evaluateChapterGate({ chapter_number: 1, chapter_notes_status: 'no_notes_needed' });
    expect(result.canProceed).toBe(true);
  });

  it('flags regeneration when status is yes and notes exist', () => {
    const result = evaluateChapterGate({
      chapter_number: 2,
      chapter_notes_status: 'yes',
      chapter_notes: 'Add more examples',
    });
    expect(result.needsRegeneration).toBe(true);
  });
});

describe('evaluateCompileGate', () => {
  it('blocks when not all chapters are approved', () => {
    const chapters = [
      { chapter_number: 1, status: 'approved' },
      { chapter_number: 2, status: 'draft' },
    ];
    const result = evaluateCompileGate({ final_review_notes_status: 'no_notes_needed' }, chapters);
    expect(result.canProceed).toBe(false);
  });

  it('proceeds when all chapters approved and no_notes_needed', () => {
    const chapters = [
      { chapter_number: 1, status: 'approved' },
      { chapter_number: 2, status: 'approved' },
    ];
    const result = evaluateCompileGate({ final_review_notes_status: 'no_notes_needed' }, chapters);
    expect(result.canProceed).toBe(true);
  });

  it('blocks when no chapters exist', () => {
    const result = evaluateCompileGate({ final_review_notes_status: 'no_notes_needed' }, []);
    expect(result.canProceed).toBe(false);
  });
});
