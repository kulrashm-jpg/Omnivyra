import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/cron/integration-health-sweep
 *
 * Periodically revalidates stale `company_integrations` rows so silent
 * failures (revoked tokens, deleted WordPress users, expired
 * Application Passwords, etc.) surface within a day instead of waiting
 * for an operator to notice.
 *
 * Schedule: daily — wire externally via Vercel cron in `vercel.json`,
 * Railway cron, or a GitHub Actions `schedule:` workflow that POSTs to
 * this URL with the CRON_SECRET. Idempotent; safe to run more often.
 *
 * Auth: CRON_SECRET bearer (same convention as
 * pages/api/cron/anomaly-sweep.ts), plus a super-admin escape hatch for
 * manual triggering.
 *
 * Safety bounds (intentionally conservative — must not hammer providers):
 *   - Selects at most `BATCH_SIZE` integrations per run (default 25).
 *   - Runs them sequentially (concurrency=1). Provider rate-limit
 *     friendly; if the sweep needs to be faster, raise BATCH_SIZE
 *     rather than parallelize.
 *   - Each individual health check has its own provider-imposed
 *     timeout inside the CMS adapter; this handler also bounds the
 *     whole run with SWEEP_TIMEOUT_MS.
 *   - Targets only rows where `status='connected'` AND
 *     `last_tested_at IS NULL OR last_tested_at < NOW() - 24h`.
 *
 * Emits `integration_activity_events` rows when the timeline table
 * exists (Phase 13.5 migration); silently no-ops if it doesn't yet.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import { runIntegrationHealthCheckWithRetry } from '../../../backend/services/integrationHealthRetry';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';

const BATCH_SIZE = 25;
const STALE_HOURS = 24;
const SWEEP_TIMEOUT_MS = 4 * 60 * 1000; // 4 min — must finish well inside any Vercel 5-min function ceiling

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  return false;
}

interface StaleRow {
  id: string;
  company_id: string;
  website_connection_id: string | null;
  type: string;
  last_tested_at: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const sweepStartedAt = Date.now();
  const cutoffIso = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

  // Select candidate rows. Two-pass to cover the (last_tested_at IS NULL)
  // case which is not expressible alongside the comparison in a single
  // PostgREST filter without `.or()`.
  const [stalePass, neverPass] = await Promise.all([
    supabase
      .from('company_integrations')
      .select('id, company_id, website_connection_id, type, last_tested_at')
      .eq('status', 'connected')
      .not('website_connection_id', 'is', null)
      .lt('last_tested_at', cutoffIso)
      .order('last_tested_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE),
    supabase
      .from('company_integrations')
      .select('id, company_id, website_connection_id, type, last_tested_at')
      .eq('status', 'connected')
      .not('website_connection_id', 'is', null)
      .is('last_tested_at', null)
      .limit(BATCH_SIZE),
  ]);

  if (stalePass.error || neverPass.error) {
    console.error('[integration-health-sweep] query failed', {
      stale: stalePass.error?.message,
      never: neverPass.error?.message,
    });
    return res.status(500).json({ error: 'QUERY_FAILED' });
  }

  // Dedupe and cap at BATCH_SIZE total.
  const seen = new Set<string>();
  const candidates: StaleRow[] = [];
  for (const row of [...(neverPass.data ?? []), ...(stalePass.data ?? [])]) {
    if (candidates.length >= BATCH_SIZE) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    candidates.push(row as StaleRow);
  }

  const results: Array<{
    integration_id: string;
    company_id: string;
    type: string;
    outcome: 'healthy' | 'recovered' | 'failed' | 'error';
    message?: string;
  }> = [];

  for (const row of candidates) {
    // Bound the whole sweep so a single hanging provider can't lock the
    // function past the platform's request ceiling.
    if (Date.now() - sweepStartedAt > SWEEP_TIMEOUT_MS) {
      console.warn('[integration-health-sweep] timeout reached, exiting early');
      break;
    }
    if (!row.website_connection_id) continue;

    try {
      const result = await runIntegrationHealthCheckWithRetry({
        companyId: row.company_id,
        connectionId: row.website_connection_id,
        integrationId: row.id,
        provider: row.type,
      });
      results.push({
        integration_id: row.id,
        company_id: row.company_id,
        type: row.type,
        outcome: result.status === 'healthy' ? (row.last_tested_at ? 'healthy' : 'recovered') : 'failed',
        message: result.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        integration_id: row.id,
        company_id: row.company_id,
        type: row.type,
        outcome: 'error',
        message,
      });
    }
  }

  const summary = {
    ok: true,
    scanned: candidates.length,
    healthy: results.filter((r) => r.outcome === 'healthy' || r.outcome === 'recovered').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    error: results.filter((r) => r.outcome === 'error').length,
    elapsed_ms: Date.now() - sweepStartedAt,
    timed_out: Date.now() - sweepStartedAt > SWEEP_TIMEOUT_MS,
  };

  console.log(JSON.stringify({
    level: 'INFO',
    event: 'integration_health_sweep_complete',
    ...summary,
    ts: new Date().toISOString(),
  }));
  return res.status(200).json({ ...summary, results });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/integration-health-sweep' });
