import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import dotenv from 'dotenv';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Load project `.env` explicitly so cwd / injected shell vars do not shadow `GOOGLE_SHEET_TAB` etc.
dotenv.config({ path: path.join(projectRoot, '.env'), override: true });

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  /** Empty for local Docker Redis; set for Redis Cloud / ACL */
  REDIS_PASSWORD: z.string().default(''),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_SPREADSHEET_ID: z.string().min(1),
  /** Tab name at bottom of the spreadsheet (e.g. Sheet1 or Book_generetor) */
  GOOGLE_SHEET_TAB: z.string().min(1).trim().default('Sheet1'),
  /** A1 range without tab (e.g. A1:G200) */
  GOOGLE_SHEET_RANGE: z.string().default('A1:G200'),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  NOTIFY_EMAIL: z.string().email(),
  TEAMS_WEBHOOK_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  POLL_INTERVAL_MS: z.coerce.number().default(15000),
  ENABLE_BACKGROUND_JOBS: booleanFromEnv.default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.LLM_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
  console.error('Invalid environment variables: ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  process.exit(1);
}

if (parsed.data.LLM_PROVIDER === 'openai' && !parsed.data.OPENAI_API_KEY) {
  console.error('Invalid environment variables: OPENAI_API_KEY is required when LLM_PROVIDER=openai');
  process.exit(1);
}

const placeholderSupabase =
  parsed.data.SUPABASE_URL.includes('example.supabase.co') ||
  parsed.data.SUPABASE_SERVICE_ROLE_KEY === 'placeholder-key';
if (placeholderSupabase && process.env.VITEST !== 'true') {
  console.error(
    'Invalid Supabase config: replace SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env with your project URL and service role key (Dashboard → Settings → API). example.supabase.co does not resolve (ENOTFOUND).'
  );
  process.exit(1);
}

export const env = parsed.data;

/** Options for BullMQ / ioredis (password omitted when unset). */
export function redisConnectionOptions() {
  const o = { host: env.REDIS_HOST, port: env.REDIS_PORT };
  if (env.REDIS_PASSWORD?.trim()) o.password = env.REDIS_PASSWORD.trim();
  return o;
}
