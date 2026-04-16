import { Worker, Queue } from 'bullmq';
import { env, redisConnectionOptions } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateOutline } from '../core/llmService.js';
import { canStartOutline, evaluateOutlineGate } from '../core/stateMachine.js';
import { getBooksReadyForOutline, saveOutline, logNote, getBookById } from '../db/booksRepo.js';
import { notifyOutlineReady, notifyError } from '../services/notificationService.js';

const connection = redisConnectionOptions();
export const outlineQueue = new Queue('outline', { connection });

async function processBook(book) {
  const { canProceed, reason } = canStartOutline(book);

  if (!canProceed) {
    logger.info({ bookId: book.id, reason }, 'Outline stage: skipping');
    return;
  }

  if (book.outline) {
    const gate = evaluateOutlineGate(book);
    if (gate.needsRegeneration) {
      logger.info({ bookId: book.id }, 'Regenerating outline with editor notes');
      const newOutline = await generateOutline(
        book.title,
        book.notes_on_outline_before,
        book.notes_on_outline_after,
        book.outline
      );
      await saveOutline(book.id, newOutline, Date.now());
      await logNote(book.id, 'outline_after', book.notes_on_outline_after);
      await notifyOutlineReady(book.title, book.id);
    }
    return;
  }

  logger.info({ bookId: book.id, title: book.title }, 'Generating outline');

  try {
    const outline = await generateOutline(book.title, book.notes_on_outline_before);
    await saveOutline(book.id, outline, 1);
    await notifyOutlineReady(book.title, book.id);
    logger.info({ bookId: book.id }, 'Outline saved and notification sent');
  } catch (err) {
    logger.error({ err, bookId: book.id }, 'Outline generation failed');
    await notifyError(book.title, 'outline', err);
  }
}

export async function pollAndEnqueueOutlineJobs() {
  const books = await getBooksReadyForOutline();

  for (const book of books) {
    await outlineQueue.add(
      'generate-outline',
      { bookId: book.id },
      {
        jobId: `outline-${book.id}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }

  if (books.length) logger.info({ count: books.length }, 'Outline jobs enqueued');
}

export function startOutlineWorker() {
  const worker = new Worker(
    'outline',
    async (job) => {
      const book = await getBookById(job.data.bookId);
      await processBook(book);
    },
    { connection, concurrency: 2 }
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Outline job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Outline job failed'));

  return worker;
}
