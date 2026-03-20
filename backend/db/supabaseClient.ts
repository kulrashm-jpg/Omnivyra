import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load .env.local for server (helps during Next.js hot reload / env reload)
dotenv.config({ path: `${process.cwd()}/.env.local` });
dotenv.config();

/**
 * Supabase Admin Client — lazy singleton.
 * Uses service role key (bypasses RLS). Backend / Railway only.
 *
 * Validation is deferred to first use so that Next.js can bundle API routes
 * on Vercel without requiring SUPABASE_SERVICE_ROLE_KEY at build time.
 * The error will still surface clearly at request time if the key is absent.
 */
let _client: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is missing in environment variables. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in .env.local');
  }
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing in environment variables. Set it in .env.local (Railway only — never add to Vercel)');
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Proxy so all existing `supabase.from(...)` call sites work unchanged.
// The underlying client is created on first property access (i.e. first actual use).
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getAdminClient(), prop, receiver);
  },
});
