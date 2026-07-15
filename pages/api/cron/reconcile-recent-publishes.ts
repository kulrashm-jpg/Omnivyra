import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/cron/reconcile-recent-publishes
 *
 * Periodic reconciliation scan. Picks recently-published scheduled_posts
 * rows and runs `reconcileRow` against each. Telemetry-only — never mutates
 * row state or platform-side state.
 *
 * SELECTION CRITERIA
 * ─────────────────────────────────────────────────────────────────────────
 * - `status = 'published'` (only verify rows that claim to be on the platform)
 * - `platform_post_id IS NOT NULL` (have something to look up)
 * - `social_account_id IS NOT NULL` (have a token source)
 * - `published_at > now() - RECONCILIATION_SCAN_WINDOW_MS` (default 1 hour)
 * - Sorted by `published_at ASC` so newest publishes are picked up sooner on
 *   subsequent runs (LIFO would starve older rows under sustained load)
 * - Bounded to `RECONCILIATION_BATCH_SIZE` (default 50) per run
 *
 * SKIP COOLDOWN
 * ─────────────────────────────────────────────────────────────────────────
 * If a row's most recent reconciliation snapshot is fresher than
 * `RECONCILIATION_SKIP_COOLDOWN_MS` (default 15 min), skip it. This prevents
 * back-to-back cron ticks from re-reconciling the same rows. The check is
 * per-row, not global, so a slow reconciliation pass doesn't block the next
 * tick from picking up newly-published rows.
 *
 * PROVIDER THROTTLING
 * ─────────────────────────────────────────────────────────────────────────
 * Simple delay (`RECONCILIATION_PER_REQUEST_DELAY_MS`, default 200ms) between
 * lookups. Not per-platform rate-budget aware (that's the next operational
 * layer). The delay + bounded batch keeps the cron well within typical
 * platform rate limits at the scales the system runs today.
 *
 * REPLAY SAFETY
 * ─────────────────────────────────────────────────────────────────────────
 * - `reconcileRow` is read-only; running it N times produces N identical
 *   telemetry events + N appended snapshots (capped at 25 most-recent per
 *   row). Replays are idempotent in semantic terms.
 * - The cron's per-minute `runJob`-style idempotency is NOT wrapped here
 *   because reconciliation has no shared-resource contention with itself —
 *   parallel ticks just produce more telemetry, not incorrect state.
 *
 * Protected by CRON_SECRET.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { reconcileRow } from '../../../backend/services/providerReconciliation/reconcileRow';
import type { ReconciliationSnapshot, DriftKind } from '../../../backend/services/providerReconciliation/types';

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;       // 1 hour
const DEFAULT_SKIP_COOLDOWN_MS = 15 * 60 * 1000; // 15 min
const DEFAULT_BATCH = 50;
const DEFAULT_DELAY_MS = 200;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Per-environment activation gate. The vercel.json cron schedule fires
  // globally across environments; this gate keeps the cron a no-op in any
  // environment that hasn't explicitly enabled reconciliation. Default OFF
  // so deploying the cron schedule to prod does not automatically start
  // hitting platform APIs from prod.
  const enabled = String(process.env.RECONCILIATION_CRON_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    return res.status(200).json({
      disabled: true,
      reason: 'RECONCILIATION_CRON_ENABLED is not "true" in this environment',
    });
  }

  const windowMs = numberEnv('RECONCILIATION_SCAN_WINDOW_MS', DEFAULT_WINDOW_MS);
  const skipCooldownMs = numberEnv('RECONCILIATION_SKIP_COOLDOWN_MS', DEFAULT_SKIP_COOLDOWN_MS);
  const batchSize = Math.max(1, Math.min(500, numberEnv('RECONCILIATION_BATCH_SIZE', DEFAULT_BATCH)));
  const perRequestDelayMs = Math.max(0, numberEnv('RECONCILIATION_PER_REQUEST_DELAY_MS', DEFAULT_DELAY_MS));

  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const cooldownCutoffMs = Date.now() - skipCooldownMs;

  const results = {
    scanned: 0,
    reconciled: 0,
    skipped_cooldown: 0,
    skipped_other: 0,
    errors: 0,
    kinds: {} as Record<string, number>,
    platforms: {} as Record<string, number>,
    window_iso: sinceIso,
    batch_size: batchSize,
  };

  try {
    const { data: candidates, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, platform, platform_post_id, social_account_id, published_at, creator_attachment_metadata')
      .eq('status', 'published')
      .not('platform_post_id', 'is', null)
      .not('social_account_id', 'is', null)
      .gt('published_at', sinceIso)
      .order('published_at', { ascending: true })
      .limit(batchSize);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!candidates?.length) {
      return res.status(200).json({ ...results, message: 'No recent published rows in window' });
    }

    results.scanned = candidates.length;

    for (const candidate of candidates as Array<{
      id: string;
      platform: string;
      platform_post_id: string;
      social_account_id: string;
      published_at: string;
      creator_attachment_metadata: unknown;
    }>) {
      // Skip-cooldown check: peek at the most recent snapshot inline.
      const lastSnapshot = pickLatestSnapshot(candidate.creator_attachment_metadata);
      if (lastSnapshot && Date.parse(lastSnapshot.timestamp) > cooldownCutoffMs) {
        results.skipped_cooldown++;
        continue;
      }

      try {
        const r = await reconcileRow({ rowId: candidate.id });
        if (!r.ran) {
          results.skipped_other++;
          continue;
        }
        results.reconciled++;
        const kind = r.analysis?.kind ?? 'unverifiable';
        results.kinds[kind] = (results.kinds[kind] ?? 0) + 1;
        const platform = r.analysis?.platform ?? candidate.platform ?? 'unknown';
        results.platforms[platform] = (results.platforms[platform] ?? 0) + 1;
      } catch {
        // Foundation contract: reconcileRow never throws (provider lookups
        // catch and return unverifiable). A throw here is unexpected and
        // counted as an error without halting the batch.
        results.errors++;
      }

      if (perRequestDelayMs > 0) {
        await sleep(perRequestDelayMs);
      }
    }

    console.log('[cron/reconcile-recent-publishes]', results);
    return res.status(200).json(results);
  } catch (err: any) {
    console.error('[cron/reconcile-recent-publishes] fatal:', err?.message);
    return res.status(500).json({ error: err?.message, partial: results });
  }
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pickLatestSnapshot(metadata: unknown): ReconciliationSnapshot | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const list = (metadata as Record<string, unknown>).reconciliation_snapshots;
  if (!Array.isArray(list) || list.length === 0) return null;
  const candidates = list as ReconciliationSnapshot[];
  let latest: ReconciliationSnapshot | null = null;
  for (const s of candidates) {
    if (!s || typeof s.timestamp !== 'string') continue;
    if (!latest || Date.parse(s.timestamp) > Date.parse(latest.timestamp)) latest = s;
  }
  return latest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export for callers that want type access; keeps the cron self-contained
// in terms of imports.
export type { DriftKind };

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/reconcile-recent-publishes' });
