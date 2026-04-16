import { Worker, Queue } from 'bullmq';
import { env, redisConnectionOptions } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateChapter, summarizeChapter } from '../core/llmService.js';
import { canRunChapterGeneration, evaluateChapterGate } from '../core/stateMachine.js';
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

async function processOneChapter(book, parsed, existingChapters) {
  const bookId = book.id;
  const existing = existingChapters.find((c) => c.chapter_number === parsed.number);

  if (!existing) {
    const chapter = await createChapter(bookId, parsed.number, parsed.title);
    await generateAndSaveChapter(book, chapter);
    return { stopped: false };
  }

  const chapterGate = evaluateChapterGate(existing);
  if (chapterGate.needsRegeneration) {
    await generateAndSaveChapter(book, existing, existing.chapter_notes, existing.content);
    if (existing.chapter_notes) {
      await logNote(bookId, 'chapter', existing.chapter_notes, existing.id);
    }
    return { stopped: false };
  }
  if (!chapterGate.canProceed) {
    await notifyPaused(book.title, `Chapter ${existing.chapter_number}`, chapterGate.reason);
    return { stopped: true };
  }
  return { stopped: false };
}

async function processBookChapters(bookId) {
  const book = await getBookById(bookId);
  const gate = canRunChapterGeneration(book, {
    allowWithoutOutlineApproval: env.ALLOW_CHAPTERS_WITHOUT_OUTLINE_APPROVAL,
  });
  if (!gate.canProceed) {
    logger.info({ bookId, reason: gate.reason }, 'Chapter stage: outline gate blocked');
    return;
  }

  const parsedChapters = parseChaptersFromOutline(book.outline);
  if (!parsedChapters.length) return;

  const existingChapters = await getChaptersByBookId(bookId);

  for (const parsed of parsedChapters) {
    const { stopped } = await processOneChapter(book, parsed, existingChapters);
    if (stopped) break;
  }
}

/** Generate (or regenerate) exactly one chapter by number from the book outline. */
export async function processSingleChapter(bookId, chapterNumber) {
  const book = await getBookById(bookId);
  const gate = canRunChapterGeneration(book, {
    allowWithoutOutlineApproval: env.ALLOW_CHAPTERS_WITHOUT_OUTLINE_APPROVAL,
  });
  if (!gate.canProceed) {
    logger.info({ bookId, chapterNumber, reason: gate.reason }, 'Single chapter: blocked before chapter generation');
    return;
  }

  const parsedChapters = parseChaptersFromOutline(book.outline);
  const parsed = parsedChapters.find((p) => p.number === chapterNumber);
  if (!parsed) {
    throw new Error(
      `Chapter ${chapterNumber} not found in outline (parse chapter lines like "1. Title" or "Chapter 1: Title").`
    );
  }

  const existingChapters = await getChaptersByBookId(bookId);
  await processOneChapter(book, parsed, existingChapters);
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
      const { bookId, chapterNumber } = job.data;
      if (chapterNumber != null && chapterNumber !== undefined) {
        await processSingleChapter(bookId, chapterNumber);
      } else {
        await processBookChapters(bookId);
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Chapter job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Chapter job failed'));
  return worker;
}
