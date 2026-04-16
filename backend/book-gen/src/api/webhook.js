import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { syncSheetToDatabase } from '../services/sheetsReader.js';
import { supabase } from '../db/supabaseClient.js';
import { getBookById, setFinalReview } from '../db/booksRepo.js';
import { getChaptersByBookId, approveChapter } from '../db/chaptersRepo.js';

const uuid = z.string().uuid();

const app = Fastify({ logger: false });

const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
await app.register(cors, {
  origin: corsOrigins.length ? corsOrigins : true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
});

app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  backgroundJobs: env.ENABLE_BACKGROUND_JOBS,
}));

app.get('/books', async (req, reply) => {
  const { data, error } = await supabase
    .from('books')
    .select('id, title, book_output_status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    logger.error({ err: error }, 'GET /books failed');
    return reply.status(500).send({ error: error.message });
  }
  return reply.send({ books: data ?? [] });
});

app.get('/books/:bookId', async (req, reply) => {
  const bookId = uuid.safeParse(req.params.bookId);
  if (!bookId.success) return reply.status(400).send({ error: 'Invalid bookId' });
  try {
    const book = await getBookById(bookId.data);
    const chapters = await getChaptersByBookId(bookId.data);
    return reply.send({ book, chapters });
  } catch (err) {
    logger.error({ err }, 'GET /books/:bookId failed');
    return reply.status(404).send({ error: err.message });
  }
});

const finalReviewBody = z.object({
  status: z.enum(['yes', 'no', 'no_notes_needed']),
  notes: z.string().nullable().optional(),
});

app.post('/books/:bookId/final-review', async (req, reply) => {
  const bookId = uuid.safeParse(req.params.bookId);
  if (!bookId.success) return reply.status(400).send({ error: 'Invalid bookId' });
  const parsed = finalReviewBody.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
  try {
    await setFinalReview(bookId.data, {
      status: parsed.data.status,
      notes: parsed.data.notes,
    });
    return reply.send({ success: true });
  } catch (err) {
    logger.error({ err }, 'POST /books/:bookId/final-review failed');
    return reply.status(500).send({ error: err.message });
  }
});

app.post('/books/:bookId/chapters/:chapterId/approve', async (req, reply) => {
  const bookId = uuid.safeParse(req.params.bookId);
  const chapterId = uuid.safeParse(req.params.chapterId);
  if (!bookId.success || !chapterId.success) {
    return reply.status(400).send({ error: 'Invalid bookId or chapterId' });
  }
  const { data: row, error } = await supabase
    .from('chapters')
    .select('book_id')
    .eq('id', chapterId.data)
    .single();
  if (error || !row) return reply.status(404).send({ error: 'Chapter not found' });
  if (row.book_id !== bookId.data) return reply.status(400).send({ error: 'Chapter does not belong to this book' });
  try {
    await approveChapter(chapterId.data);
    return reply.send({ success: true });
  } catch (err) {
    logger.error({ err }, 'POST approve chapter failed');
    return reply.status(500).send({ error: err.message });
  }
});

app.post('/sync-sheet', async (req, reply) => {
  try {
    const result = await syncSheetToDatabase(supabase);
    return reply.send({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, '/sync-sheet failed');
    return reply.status(500).send({ success: false, error: err.message });
  }
});

const jobsDisabled = () => ({
  error:
    'Queue triggers require ENABLE_BACKGROUND_JOBS=true and a running Redis instance (BullMQ).',
});

app.post('/trigger/outline', async (req, reply) => {
  if (!env.ENABLE_BACKGROUND_JOBS) return reply.status(503).send(jobsDisabled());
  const parsed = z.object({ bookId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid bookId' });
  const { outlineQueue } = await import('../workers/outlineWorker.js');
  await outlineQueue.add('generate-outline', { bookId: parsed.data.bookId }, { removeOnComplete: true });
  return reply.send({ success: true, message: 'Outline job queued' });
});

app.post('/trigger/chapters', async (req, reply) => {
  if (!env.ENABLE_BACKGROUND_JOBS) return reply.status(503).send(jobsDisabled());
  const parsed = z.object({ bookId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid bookId' });
  const { chapterQueue } = await import('../workers/chapterWorker.js');
  await chapterQueue.add('generate-chapters', { bookId: parsed.data.bookId }, { removeOnComplete: true });
  return reply.send({ success: true, message: 'Chapter job queued' });
});

app.post('/trigger/compile', async (req, reply) => {
  if (!env.ENABLE_BACKGROUND_JOBS) return reply.status(503).send(jobsDisabled());
  const parsed = z.object({ bookId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid bookId' });
  const { compileQueue } = await import('../workers/compileWorker.js');
  await compileQueue.add('compile-book', { bookId: parsed.data.bookId }, { removeOnComplete: true });
  return reply.send({ success: true, message: 'Compile job queued' });
});

export async function startApiServer() {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'API server started');
}
