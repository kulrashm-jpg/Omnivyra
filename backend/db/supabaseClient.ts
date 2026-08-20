import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkEnvIsolationOnce } from '../../lib/env/namespace';
import { installSupabaseTransportProbe } from '../../lib/platform/supabaseTransportProbe';

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
  // WRITER-CERT-004 — cert-aware env file (ENV_FILE > .env.cert > .env.local).
  // Backward compatible: .env.cert is absent in normal setups → loads .env.local.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _fs = require('fs') as typeof import('fs');
  const _envFile = (process.env.ENV_FILE && String(process.env.ENV_FILE).trim())
    ? String(process.env.ENV_FILE).trim()
    : (_fs.existsSync(`${process.cwd()}/.env.cert`) ? `${process.cwd()}/.env.cert` : `${process.cwd()}/.env.local`);
  dotenv.config({ path: _envFile });
  dotenv.config();
}

function getSupabaseConfig(): { url: string; key: string } {
  ensureServerEnvLoaded();

  // Server clients MUST read SUPABASE_URL explicitly. The previous
  // `?? NEXT_PUBLIC_SUPABASE_URL` fallback hid env-drift: a deploy where
  // SUPABASE_URL was unset would silently validate tokens against the
  // public URL, which works only as long as both point to the same project.
  // Fail fast instead — a missing SUPABASE_URL is a deploy bug, not a
  // recoverable runtime state.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is missing in environment variables. Set SUPABASE_URL (not NEXT_PUBLIC_SUPABASE_URL) in your deployment env (Vercel/Railway Settings → Environment Variables).');
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

  // Warn-only cross-environment contamination check. Never blocks startup.
  checkEnvIsolationOnce();

  // W6-4 (audit B-44): pooler READINESS — when SUPABASE_POOLER_URL is set,
  // PostgREST traffic routes through it (supavisor/pgbouncer endpoint)
  // instead of the direct project URL. No SQL or client-behavior change;
  // unset (default) = today's direct URL byte-for-byte. The active mode is
  // exported via getDbConnectionDiagnostics() for the scale-up runbook.
  const poolerUrl = String(process.env.SUPABASE_POOLER_URL ?? '').trim();
  _dbConnectionMode = poolerUrl ? 'pooler' : 'direct';
  // Passive transport diagnostic. Idempotent, observer-only: it subscribes to
  // undici diagnostics channels and cannot alter any request. Client options
  // below are unchanged.
  installSupabaseTransportProbe();
  _client = createClient(poolerUrl || url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

let _dbConnectionMode: 'direct' | 'pooler' = 'direct';

/** W6-4 diagnostics: which connection path the admin client uses. */
export function getDbConnectionDiagnostics(): { mode: 'direct' | 'pooler'; poolerConfigured: boolean } {
  return {
    mode: _dbConnectionMode,
    poolerConfigured: Boolean(String(process.env.SUPABASE_POOLER_URL ?? '').trim()),
  };
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
