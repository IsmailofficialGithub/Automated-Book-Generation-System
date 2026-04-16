import { env } from '../config/env.js';
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

export async function getBooksReadyForChapters() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .not('outline', 'is', null);
  if (error) throw new Error(`getBooksReadyForChapters failed: ${error.message}`);
  const books = data ?? [];
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
