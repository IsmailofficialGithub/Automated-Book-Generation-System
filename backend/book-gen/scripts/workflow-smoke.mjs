/**
 * Smoke-test Redis + API + optional full HTTP workflow (sync → books → queue outline).
 * Requires: Redis up; app running (`npm run dev`) with ENABLE_BACKGROUND_JOBS=true.
 *
 * Usage:
 *   node scripts/workflow-smoke.mjs
 *   SKIP_SYNC=1 node scripts/workflow-smoke.mjs
 *   BOOK_ID=<uuid> node scripts/workflow-smoke.mjs   # skip /books, use this id for triggers
 *
 * Default: queues outline only (safe). Use --full to also POST chapters + compile (may race; use after outline+chapters succeed).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Redis from 'ioredis';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });

const port = process.env.PORT || 3000;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const skipSync = process.env.SKIP_SYNC === '1' || process.argv.includes('--skip-sync');
const bookIdFromEnv = process.env.BOOK_ID?.trim();
const queueFull =
  process.env.WORKFLOW_QUEUE === 'full' || process.argv.includes('--full');

function redisOpts() {
  const o = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
  };
  if (process.env.REDIS_PASSWORD?.trim()) o.password = process.env.REDIS_PASSWORD.trim();
  return o;
}

async function main() {
  console.log('=== workflow-smoke ===\n');

  const redis = new Redis(redisOpts());
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error(`unexpected PING reply: ${pong}`);
    console.log('1) Redis PING:', pong);
  } finally {
    redis.disconnect();
  }

  let health;
  try {
    const res = await fetch(`${base}/health`);
    health = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\n2) GET /health failed (${base}). Start the app: npm run dev\n`, e.message);
    process.exit(1);
  }

  console.log('2) GET /health:', health);
  if (!health.backgroundJobs) {
    console.error('\nSet ENABLE_BACKGROUND_JOBS=true in .env and restart the server.');
    process.exit(1);
  }

  if (skipSync) {
    console.log('\n3) POST /sync-sheet: skipped (SKIP_SYNC=1 or --skip-sync)');
  } else {
    try {
      const res = await fetch(`${base}/sync-sheet`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('3) POST /sync-sheet failed:', res.status, body);
        process.exit(1);
      }
      console.log('3) POST /sync-sheet:', body);
    } catch (e) {
      console.error('3) POST /sync-sheet error:', e.message);
      process.exit(1);
    }
  }

  let bookId = bookIdFromEnv;
  if (!bookId) {
    try {
      const res = await fetch(`${base}/books`);
      const body = await res.json();
      if (!res.ok) {
        console.error('4) GET /books failed:', res.status, body);
        process.exit(1);
      }
      const first = body.books?.[0];
      bookId = first?.id;
      console.log('4) GET /books: count =', body.books?.length ?? 0, bookId ? `→ using ${bookId}` : '');
    } catch (e) {
      console.error('4) GET /books error:', e.message);
      process.exit(1);
    }
  } else {
    console.log('4) GET /books: skipped (BOOK_ID set)');
  }

  if (!bookId) {
    console.log('\nNo book in DB. Add a row in Google Sheets (with title + notes_on_outline_before), sync again, or set BOOK_ID.');
    console.log('WORKFLOW_SMOKE_PARTIAL_OK (Redis + health + jobs; no book to queue)');
    return;
  }

  const triggers = [['5) POST /trigger/outline', `${base}/trigger/outline`]];
  if (queueFull) {
    triggers.push(
      ['6) POST /trigger/chapters', `${base}/trigger/chapters`],
      ['7) POST /trigger/compile', `${base}/trigger/compile`]
    );
  } else {
    console.log('\n(Use --full or WORKFLOW_QUEUE=full to queue chapters + compile too.)');
  }

  for (const [label, url] of triggers) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    console.log(`${label}:`, res.status, body);
    if (!res.ok) {
      console.error('\nTrigger failed. Fix DB/queues or check worker logs.');
      process.exit(1);
    }
  }

  console.log(
    '\nWORKFLOW_SMOKE_OK — job(s) queued (workers run async; watch server logs). Approve chapters + final-review before compile.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
