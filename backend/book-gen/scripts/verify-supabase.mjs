/**
 * Verifies DB migration tables + storage bucket `book-outputs`.
 * Usage: node scripts/verify-supabase.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

if (url.includes('example.supabase.co') || key === 'placeholder-key') {
  console.error(
    'Replace SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env with your real Supabase project values, then run again.'
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const tables = ['books', 'chapters', 'outline_drafts', 'notes_log'];
let ok = true;

for (const t of tables) {
  const { error } = await supabase.from(t).select('*').limit(1);
  if (error) {
    console.error(`Table "${t}": FAIL — ${error.message}`);
    ok = false;
  } else {
    console.log(`Table "${t}": OK (readable)`);
  }
}

const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
if (bucketErr) {
  console.error(`Storage listBuckets: FAIL — ${bucketErr.message}`);
  ok = false;
} else {
  const b = buckets?.find((x) => x.id === 'book-outputs');
  if (!b) {
    console.error('Storage: bucket "book-outputs" not found. Create it in Dashboard → Storage (or SQL from step.md).');
    ok = false;
  } else {
    console.log(`Storage bucket "book-outputs": OK (public=${b.public === true})`);
  }
}

if (!ok) process.exit(1);
console.log('\nSUPABASE_VERIFY_OK');
