export const STATUS = {
  YES: 'yes',
  NO: 'no',
  NO_NOTES_NEEDED: 'no_notes_needed',
};

export const STAGE = {
  OUTLINE: 'outline',
  CHAPTER: 'chapter',
  COMPILE: 'compile',
};

export function canStartOutline(book) {
  if (!book.notes_on_outline_before?.trim()) {
    return { canProceed: false, reason: 'notes_on_outline_before is empty - waiting for editor input' };
  }
  return { canProceed: true, reason: 'Ready to generate outline' };
}

export function evaluateOutlineGate(book) {
  const status = book.status_outline_notes;

  if (status === STATUS.NO_NOTES_NEEDED) {
    return { canProceed: true, needsRegeneration: false, reason: 'Outline approved - proceeding to chapters' };
  }

  if (status === STATUS.YES) {
    const hasNotes = book.notes_on_outline_after?.trim();
    if (hasNotes) {
      return { canProceed: false, needsRegeneration: true, reason: 'Notes received - regenerating outline' };
    }
    return { canProceed: false, needsRegeneration: false, reason: 'Waiting for notes_on_outline_after' };
  }

  return { canProceed: false, needsRegeneration: false, reason: 'Outline review status is "no" - paused' };
}

export function evaluateChapterGate(chapter) {
  const status = chapter.chapter_notes_status;

  if (status === STATUS.NO_NOTES_NEEDED) {
    return { canProceed: true, needsRegeneration: false, reason: `Chapter ${chapter.chapter_number} approved` };
  }

  if (status === STATUS.YES) {
    const hasNotes = chapter.chapter_notes?.trim();
    if (hasNotes) {
      return { canProceed: false, needsRegeneration: true, reason: `Regenerating chapter ${chapter.chapter_number} with notes` };
    }
    return { canProceed: false, needsRegeneration: false, reason: `Waiting for notes on chapter ${chapter.chapter_number}` };
  }

  return { canProceed: false, needsRegeneration: false, reason: `Chapter ${chapter.chapter_number} gate is "no" - paused` };
}

export function evaluateCompileGate(book, chapters) {
  const allApproved = chapters.length > 0 && chapters.every((c) => c.status === 'approved');

  if (!allApproved) {
    const pending = chapters.filter((c) => c.status !== 'approved').map((c) => c.chapter_number);
    return { canProceed: false, reason: `Chapters not yet approved: ${pending.join(', ')}` };
  }

  const status = book.final_review_notes_status;

  if (status === STATUS.NO_NOTES_NEEDED) {
    return { canProceed: true, reason: 'All chapters approved, no final notes needed - compiling' };
  }

  if (status === STATUS.YES && book.final_review_notes?.trim()) {
    return { canProceed: true, reason: 'Final review notes present - compiling with notes applied' };
  }

  return { canProceed: false, reason: `Final review status is "${status}" - paused` };
}
