import { Worker, Queue } from 'bullmq';
import { env, redisConnectionOptions } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateChapter, summarizeChapter } from '../core/llmService.js';
import { evaluateOutlineGate, evaluateChapterGate } from '../core/stateMachine.js';
import { buildChapterContext, parseChaptersFromOutline } from '../core/contextBuilder.js';
import { getBooksReadyForChapters, getBookById, logNote } from '../db/booksRepo.js';
import { getChaptersByBookId, createChapter, saveChapterContent } from '../db/chaptersRepo.js';
import { notifyChapterReady, notifyPaused, notifyError } from '../services/notificationService.js';

const connection = redisConnectionOptions();
export const chapterQueue = new Queue('chapter', { connection });

async function generateAndSaveChapter(book, chapter, chapterNotes = null, previousContent = null) {
  try {
    const contextInput = await buildChapterContext(book.id, chapter.chapter_number);
    const content = await generateChapter(
      book.title,
      book.outline,
      chapter.chapter_number,
      chapter.title,
      contextInput,
      chapterNotes,
      previousContent
    );
    const summary = await summarizeChapter(chapter.chapter_number, chapter.title, content);
    await saveChapterContent(chapter.id, content, summary);
    await notifyChapterReady(book.title, chapter.chapter_number, chapter.id);
  } catch (err) {
    logger.error({ err, chapterId: chapter.id }, 'Chapter generation failed');
    await notifyError(book.title, `Chapter ${chapter.chapter_number}`, err);
  }
}

async function processBookChapters(bookId) {
  const book = await getBookById(bookId);
  const gate = evaluateOutlineGate(book);
  if (!gate.canProceed) return;

  const parsedChapters = parseChaptersFromOutline(book.outline);
  if (!parsedChapters.length) return;

  const existingChapters = await getChaptersByBookId(bookId);

  for (const parsed of parsedChapters) {
    const existing = existingChapters.find((c) => c.chapter_number === parsed.number);

    if (!existing) {
      const chapter = await createChapter(bookId, parsed.number, parsed.title);
      await generateAndSaveChapter(book, chapter);
      continue;
    }

    const chapterGate = evaluateChapterGate(existing);
    if (chapterGate.needsRegeneration) {
      await generateAndSaveChapter(book, existing, existing.chapter_notes, existing.content);
      if (existing.chapter_notes) {
        await logNote(bookId, 'chapter', existing.chapter_notes, existing.id);
      }
    } else if (!chapterGate.canProceed) {
      await notifyPaused(book.title, `Chapter ${existing.chapter_number}`, chapterGate.reason);
      break;
    }
  }
}

export async function pollAndEnqueueChapterJobs() {
  const books = await getBooksReadyForChapters();
  for (const book of books) {
    await chapterQueue.add(
      'generate-chapters',
      { bookId: book.id },
      { jobId: `chapters-${book.id}`, removeOnComplete: true, removeOnFail: false }
    );
  }
  if (books.length) logger.info({ count: books.length }, 'Chapter jobs enqueued');
}

export function startChapterWorker() {
  const worker = new Worker(
    'chapter',
    async (job) => {
      await processBookChapters(job.data.bookId);
    },
    { connection, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Chapter job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Chapter job failed'));
  return worker;
}
