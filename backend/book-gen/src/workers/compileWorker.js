import { Worker, Queue } from 'bullmq';
import { env, redisConnectionOptions } from '../config/env.js';
import { logger } from '../config/logger.js';
import { evaluateCompileGate } from '../core/stateMachine.js';
import { getBookById, saveOutputUrls } from '../db/booksRepo.js';
import { getChaptersByBookId } from '../db/chaptersRepo.js';
import { exportBook } from '../services/fileExporter.js';
import { notifyBookComplete, notifyPaused, notifyError } from '../services/notificationService.js';
import { supabase } from '../db/supabaseClient.js';

const connection = redisConnectionOptions();
export const compileQueue = new Queue('compile', { connection });

async function compileBook(bookId) {
  const book = await getBookById(bookId);
  const chapters = await getChaptersByBookId(bookId);
  const gate = evaluateCompileGate(book, chapters);

  if (!gate.canProceed) {
    await notifyPaused(book.title, 'compilation', gate.reason);
    return;
  }

  await supabase.from('books').update({ book_output_status: 'compiling' }).eq('id', bookId);

  try {
    const approvedChapters = chapters.filter((c) => c.status === 'approved');
    const urls = await exportBook(book, approvedChapters);
    await saveOutputUrls(bookId, urls);
    await notifyBookComplete(book.title, urls);
    logger.info({ bookId, urls }, 'Book compiled and uploaded');
  } catch (err) {
    await supabase.from('books').update({ book_output_status: 'error' }).eq('id', bookId);
    await notifyError(book.title, 'compile', err);
  }
}

export async function pollAndEnqueueCompileJobs() {
  const { data: books } = await supabase
    .from('books')
    .select('id, final_review_notes_status, book_output_status')
    .neq('book_output_status', 'done')
    .neq('book_output_status', 'compiling')
    .in('final_review_notes_status', ['no_notes_needed', 'yes']);

  for (const book of books ?? []) {
    const chapters = await getChaptersByBookId(book.id);
    const allApproved = chapters.length > 0 && chapters.every((c) => c.status === 'approved');
    if (!allApproved) continue;
    await compileQueue.add(
      'compile-book',
      { bookId: book.id },
      { jobId: `compile-${book.id}`, removeOnComplete: true, removeOnFail: false }
    );
  }
}

export function startCompileWorker() {
  const worker = new Worker(
    'compile',
    async (job) => {
      await compileBook(job.data.bookId);
    },
    { connection, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Compile job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Compile job failed'));
  return worker;
}
