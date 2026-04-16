import dns from 'node:dns';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Avoids intermittent `TypeError: fetch failed` to Supabase on Windows (IPv6-first DNS).
dns.setDefaultResultOrder('ipv4first');

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);
