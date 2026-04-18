import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase Admin Client — lazy singleton.
 * Uses service role key (bypasses RLS). Backend / Railway only.
 *
 * Validation is deferred to first use so that Next.js can bundle API routes
 * on Vercel without requiring SUPABASE_SERVICE_ROLE_KEY at build time.
 * The error will still surface clearly at request time if the key is absent.
 */
let _client: SupabaseClient | null = null;
let _serverEnvLoaded = false;
let _trackDbOp:
  | ((count: number, type: 'read' | 'write') => void)
  | null
  | undefined;

function ensureServerEnvLoaded(): void {
  if (_serverEnvLoaded) return;
  _serverEnvLoaded = true;

  // Keep dotenv on the runtime path only so Next build doesn't need to analyze it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv') as typeof import('dotenv');
  dotenv.config({ path: `${process.cwd()}/.env.local` });
  dotenv.config();
}

function getSupabaseConfig(): { url: string; key: string } {
  ensureServerEnvLoaded();

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is missing in environment variables. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in .env.local');
  }
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Add it to your deployment environment variables (Vercel/Railway Settings → Environment Variables).');
  }

  return { url, key };
}

function trackDbOperation(count: number, type: 'read' | 'write'): void {
  if (_trackDbOp === null) return;

  if (_trackDbOp === undefined) {
    try {
      // Keep the large Redis protection module off the hot import path.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const usageProtection = require('../../lib/redis/usageProtection') as typeof import('../../lib/redis/usageProtection');
      _trackDbOp = usageProtection.trackDbOp;
    } catch {
      _trackDbOp = null;
      return;
    }
  }

  _trackDbOp?.(count, type);
}

function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const { url, key } = getSupabaseConfig();

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Proxy so all existing `supabase.from(...)` call sites work unchanged.
// The underlying client is created on first property access (i.e. first actual use).
// BUG#7 fix: intercept .select() / write methods so advisory DB counters are tracked.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getAdminClient();
    const val = Reflect.get(client, prop, receiver);
    if (prop === 'from' && typeof val === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return function (...fromArgs: any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = (val as Function).apply(client, fromArgs);
        return new Proxy(builder, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          get(bTarget: any, bProp: any) {
            const method = bTarget[bProp];
            if (typeof method !== 'function') return method;
            if (bProp === 'select') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return function (...a: any[]) { trackDbOperation(1, 'read'); return method.apply(bTarget, a); };
            }
            if (bProp === 'insert' || bProp === 'upsert' || bProp === 'update' || bProp === 'delete') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return function (...a: any[]) { trackDbOperation(1, 'write'); return method.apply(bTarget, a); };
            }
            return method.bind(bTarget);
          },
        });
      };
    }
    return val;
  },
});
