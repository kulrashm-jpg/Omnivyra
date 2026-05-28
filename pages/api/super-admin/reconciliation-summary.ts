/**
 * GET /api/super-admin/reconciliation-summary?windowHours=24
 *
 * Aggregates reconciliation outcomes from the persisted snapshots stored on
 * `scheduled_posts.creator_attachment_metadata.reconciliation_snapshots`.
 * Returns counts grouped by (drift kind × platform), plus per-platform
 * lookup-failure rate (the share of reconciliations classified as
 * unverifiable — typically a proxy for OAuth-expiry / API-version / rate-limit
 * pressure).
 *
 * READ-ONLY. No row mutation. No platform calls. Aggregation is bounded to
 * rows published within the requested window; default 24 hours.
 *
 * This is a snapshot-based view, not a true time-series rollup. It tells
 * the operator "of recently published rows, what does the reconciliation
 * state look like RIGHT NOW." For long-running production observability,
 * route the `reconciliation.*` telemetry from `logPipelineEvent` into a
 * dedicated observability backend (DataDog / Grafana / etc.) and build
 * dashboards there — this endpoint is the in-app safety net.
 *
 * Auth: requireCapability(CONTENT_PUBLISH).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { CONTENT_PUBLISH } from '../../../shared/contracts/security/SecurityCapabilities';
import type { ReconciliationSnapshot, DriftKind } from '../../../backend/services/providerReconciliation/types';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 720; // 30 days; bounded to keep the scan cheap
const SCAN_ROW_CAP = 5_000;   // cap rows scanned in a single request

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:reconciliation-summary', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: 'operator reads reconciliation summary',
  });
  if (guard.ok !== true) return;

  const windowHoursRaw = Number(req.query.windowHours);
  const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0
    ? Math.min(MAX_WINDOW_HOURS, windowHoursRaw)
    : DEFAULT_WINDOW_HOURS;
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const { data: rows, error } = await supabase
      .from('scheduled_posts')
      .select('id, platform, creator_attachment_metadata')
      .eq('status', 'published')
      .gt('published_at', sinceIso)
      .limit(SCAN_ROW_CAP);

    if (error) throw new Error(`DB scan error: ${error.message}`);

    // Aggregate per (platform, kind).
    const perPlatform: Record<string, {
      total_rows: number;
      with_snapshot: number;
      kinds: Partial<Record<DriftKind, number>>;
      unverifiable_rate?: number;
    }> = {};

    let totalScanned = 0;
    let totalWithSnapshot = 0;
    const overallKinds: Partial<Record<DriftKind, number>> = {};

    for (const row of (rows ?? []) as Array<{
      id: string;
      platform: string;
      creator_attachment_metadata: unknown;
    }>) {
      totalScanned++;
      const platform = String(row.platform ?? 'unknown');
      const bucket = perPlatform[platform] ?? { total_rows: 0, with_snapshot: 0, kinds: {} };
      bucket.total_rows++;

      const latest = pickLatestSnapshot(row.creator_attachment_metadata);
      if (latest) {
        bucket.with_snapshot++;
        totalWithSnapshot++;
        bucket.kinds[latest.kind] = (bucket.kinds[latest.kind] ?? 0) + 1;
        overallKinds[latest.kind] = (overallKinds[latest.kind] ?? 0) + 1;
      }

      perPlatform[platform] = bucket;
    }

    // Compute per-platform unverifiable_rate (snapshot-relative).
    for (const platform of Object.keys(perPlatform)) {
      const b = perPlatform[platform];
      const unverifiable = b.kinds.unverifiable ?? 0;
      b.unverifiable_rate = b.with_snapshot > 0
        ? Math.round((unverifiable / b.with_snapshot) * 1000) / 1000
        : 0;
    }

    const lookupFailureRate = totalWithSnapshot > 0
      ? Math.round(((overallKinds.unverifiable ?? 0) / totalWithSnapshot) * 1000) / 1000
      : 0;
    const coverageRate = totalScanned > 0
      ? Math.round((totalWithSnapshot / totalScanned) * 1000) / 1000
      : 0;

    return res.status(200).json({
      window: { hours: windowHours, since_iso: sinceIso, row_cap: SCAN_ROW_CAP },
      totals: {
        scanned_rows: totalScanned,
        rows_with_snapshot: totalWithSnapshot,
        coverage_rate: coverageRate,
        lookup_failure_rate: lookupFailureRate,
        kinds: overallKinds,
      },
      per_platform: perPlatform,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'reconciliation summary failed' });
  }
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
