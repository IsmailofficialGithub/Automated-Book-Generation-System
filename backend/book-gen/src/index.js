import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startApiServer } from './api/webhook.js';
import { syncSheetToDatabase } from './services/sheetsReader.js';
import { supabase } from './db/supabaseClient.js';

async function runPollingLoop() {
  const { pollAndEnqueueOutlineJobs } = await import('./workers/outlineWorker.js');
  const { pollAndEnqueueChapterJobs } = await import('./workers/chapterWorker.js');
  const { pollAndEnqueueCompileJobs } = await import('./workers/compileWorker.js');

  logger.info('Polling cycle starting');
  try {
    await syncSheetToDatabase(supabase);
    await pollAndEnqueueOutlineJobs();
    await pollAndEnqueueChapterJobs();
    await pollAndEnqueueCompileJobs();
  } catch (err) {
    logger.error({ err }, 'Polling cycle error');
  }
}

async function main() {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Book Generation System starting');

  await startApiServer();

  if (!env.ENABLE_BACKGROUND_JOBS) {
    logger.info(
      'Background jobs are disabled (ENABLE_BACKGROUND_JOBS=false) — API + sheet sync only; Redis not required'
    );
    return;
  }

  const { startOutlineWorker } = await import('./workers/outlineWorker.js');
  const { startChapterWorker } = await import('./workers/chapterWorker.js');
  const { startCompileWorker } = await import('./workers/compileWorker.js');

  startOutlineWorker();
  startChapterWorker();
  startCompileWorker();
  await runPollingLoop();
  setInterval(runPollingLoop, env.POLL_INTERVAL_MS);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start API server');
  process.exit(1);
});
