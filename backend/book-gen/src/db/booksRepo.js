import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { canRunChapterGeneration } from '../core/stateMachine.js';
import { supabase } from './supabaseClient.js';

export async function getBookById(bookId) {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', bookId)
    .single();
  if (error) throw new Error(`getBookById failed: ${error.message}`);
  return data;
}

export async function getBooksReadyForOutline() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .not('notes_on_outline_before', 'is', null)
    .is('outline', null);
  if (error) throw new Error(`getBooksReadyForOutline failed: ${error.message}`);
  return data ?? [];
}

/** Latest draft row content for a book (by version desc). */
export async function getLatestOutlineDraftContent(bookId) {
  const { data, error } = await supabase
    .from('outline_drafts')
    .select('content')
    .eq('book_id', bookId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestOutlineDraftContent failed: ${error.message}`);
  return data?.content ?? null;
}

/**
 * If `books.outline` is empty but `outline_drafts` has content, copy latest draft into `books.outline`.
 * Chapter generation only reads `books.outline`; drafts alone are not enough until synced.
 */
export async function syncOutlineFromLatestDraft(bookId) {
  const book = await getBookById(bookId);
  if (book.outline?.trim()) return book;
  const draft = await getLatestOutlineDraftContent(bookId);
  if (!draft?.trim()) return book;
  const { error } = await supabase.from('books').update({ outline: draft }).eq('id', bookId);
  if (error) throw new Error(`syncOutlineFromLatestDraft failed: ${error.message}`);
  logger.info({ bookId }, 'books.outline was empty — copied latest outline_drafts.content into books.outline');
  return getBookById(bookId);
}

export async function getBooksReadyForChapters() {
  const { data: withOutline, error } = await supabase
    .from('books')
    .select('*')
    .not('outline', 'is', null);
  if (error) throw new Error(`getBooksReadyForChapters failed: ${error.message}`);

  const { data: draftRows } = await supabase.from('outline_drafts').select('book_id');
  const draftBookIds = [...new Set((draftRows ?? []).map((r) => r.book_id))];
  const withOutlineIds = new Set((withOutline ?? []).map((b) => b.id));

  const books = [...(withOutline ?? [])];
  for (const bid of draftBookIds) {
    if (withOutlineIds.has(bid)) continue;
    const book = await getBookById(bid);
    const draft = await getLatestOutlineDraftContent(bid);
    if (draft?.trim()) {
      books.push({ ...book, outline: draft });
    }
  }

  const allow = env.ALLOW_CHAPTERS_WITHOUT_OUTLINE_APPROVAL;
  return books.filter((b) =>
    canRunChapterGeneration(b, { allowWithoutOutlineApproval: allow }).canProceed
  );
}

export async function saveOutline(bookId, outline, version) {
  const { error: bookErr } = await supabase
    .from('books')
    .update({ outline })
    .eq('id', bookId);
  if (bookErr) throw new Error(`saveOutline (books) failed: ${bookErr.message}`);

  const { error: draftErr } = await supabase
    .from('outline_drafts')
    .insert({ book_id: bookId, version, content: outline });
  if (draftErr) throw new Error(`saveOutline (drafts) failed: ${draftErr.message}`);
}

export async function updateOutlineStatus(bookId, status) {
  const { error } = await supabase
    .from('books')
    .update({ status_outline_notes: status })
    .eq('id', bookId);
  if (error) throw new Error(`updateOutlineStatus failed: ${error.message}`);
}

export async function updateFinalReviewStatus(bookId, status) {
  const { error } = await supabase
    .from('books')
    .update({ final_review_notes_status: status })
    .eq('id', bookId);
  if (error) throw new Error(`updateFinalReviewStatus failed: ${error.message}`);
}

export async function setFinalReview(bookId, fields) {
  const payload = { final_review_notes_status: fields.status };
  if (fields.notes !== undefined) payload.final_review_notes = fields.notes;
  const { error } = await supabase.from('books').update(payload).eq('id', bookId);
  if (error) throw new Error(`setFinalReview failed: ${error.message}`);
}

export async function saveOutputUrls(bookId, urls) {
  const { error } = await supabase
    .from('books')
    .update({
      output_url_docx: urls.docx ?? null,
      output_url_pdf: urls.pdf ?? null,
      output_url_txt: urls.txt ?? null,
      book_output_status: 'done',
    })
    .eq('id', bookId);
  if (error) throw new Error(`saveOutputUrls failed: ${error.message}`);
}

export async function logNote(bookId, stage, noteText, chapterId = null) {
  const { error } = await supabase
    .from('notes_log')
    .insert({ book_id: bookId, chapter_id: chapterId, stage, note_text: noteText });
  if (error) throw new Error(`logNote failed: ${error.message}`);
}
