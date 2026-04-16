import { supabase } from './supabaseClient.js';

export async function getChaptersByBookId(bookId) {
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
    .eq('book_id', bookId)
    .order('chapter_number', { ascending: true });
  if (error) throw new Error(`getChaptersByBookId failed: ${error.message}`);
  return data ?? [];
}

export async function getPreviousChapterSummaries(bookId, beforeChapterNumber) {
  const { data, error } = await supabase
    .from('chapters')
    .select('chapter_number, title, summary')
    .eq('book_id', bookId)
    .eq('status', 'approved')
    .lt('chapter_number', beforeChapterNumber)
    .order('chapter_number', { ascending: true });
  if (error) throw new Error(`getPreviousChapterSummaries failed: ${error.message}`);
  return data ?? [];
}

export async function createChapter(bookId, chapterNumber, title) {
  const { data, error } = await supabase
    .from('chapters')
    .insert({
      book_id: bookId,
      chapter_number: chapterNumber,
      title,
      status: 'pending',
      chapter_notes_status: 'no',
    })
    .select()
    .single();
  if (error) throw new Error(`createChapter failed: ${error.message}`);
  return data;
}

export async function saveChapterContent(chapterId, content, summary) {
  const { error } = await supabase
    .from('chapters')
    .update({ content, summary, status: 'draft' })
    .eq('id', chapterId);
  if (error) throw new Error(`saveChapterContent failed: ${error.message}`);
}

export async function updateChapterNotesStatus(chapterId, status) {
  const { error } = await supabase
    .from('chapters')
    .update({ chapter_notes_status: status })
    .eq('id', chapterId);
  if (error) throw new Error(`updateChapterNotesStatus failed: ${error.message}`);
}

export async function approveChapter(chapterId) {
  const { error } = await supabase
    .from('chapters')
    .update({ status: 'approved' })
    .eq('id', chapterId);
  if (error) throw new Error(`approveChapter failed: ${error.message}`);
}

export async function getLastChapterNumber(bookId) {
  const { data, error } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('book_id', bookId)
    .order('chapter_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLastChapterNumber failed: ${error.message}`);
  return data?.chapter_number ?? 0;
}
