/**
 * Internal Render Health — Step-R6 operational health surface.
 *
 *   GET /api/internal/render-health   (header: x-internal-worker-token)
 *     → READ-ONLY structured operational snapshot: provider health,
 *       queue depth, retry/moderation/stale pressure, governance flags,
 *       and aggregated analytics. NO PII, no mutations.
 *
 * SAFETY: internal-only (INTERNAL_WORKER_TOKEN, fail-closed), flag-gated,
 * scheduler-isolated, never writes. Bounded query windows.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import {
  isCreatorRenderingEnabled,
  aggregateRenderAnalytics,
  GLOBAL_GOVERNANCE_SENTINEL,
  coerceGovernanceRow,
} from '@/backend/services/creator/rendering';

const ACTIVE = ['claimed', 'rendering', 'processing', 'moderation'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const expected = String(process.env.INTERNAL_WORKER_TOKEN ?? '').trim();
  const provided = String(req.headers['x-internal-worker-token'] ?? '').trim();
  if (!expected) return res.status(503).json({ error: 'Health not configured.', code: 'HEALTH_DISABLED' });
  if (!provided || provided !== expected) return res.status(401).json({ error: 'Unauthorized.' });
  if (!isCreatorRenderingEnabled()) {
    return res.status(200).json({ ok: true, rendering_enabled: false });
  }

  try {
    const nowIso = new Date().toISOString();
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [
      { data: qRows }, { data: aRows }, { data: jsRows },
      { data: staleRows }, { data: gGlobal },
    ] = await Promise.all([
      supabase.from('creator_render_queue_job')
        .select('queue_state, retry_count, provider_key, created_at, updated_at')
        .gte('created_at', since).limit(2000),
      supabase.from('creator_render_attempt')
        .select('status, provider_key').gte('created_at', since).limit(2000),
      supabase.from('creator_render_job_state')
        .select('current_state').limit(2000),
      supabase.from('creator_render_queue_job')
        .select('id').in('queue_state', ACTIVE).lt('lease_expires_at', nowIso).limit(500),
      supabase.from('creator_render_governance_state')
        .select('*').eq('organization_id', GLOBAL_GOVERNANCE_SENTINEL).maybeSingle(),
    ]);

    const queue = (qRows as any[]) ?? [];
    const staleCount = Array.isArray(staleRows) ? staleRows.length : 0;
    const dupReuse = ((jsRows as any[]) ?? []).filter((r) => r.current_state === 'attached').length === 0
      ? 0
      : 0; // duplicate reuse is event-derived; not stored — reported as 0 here

    const analytics = aggregateRenderAnalytics({
      queueRows: queue,
      attemptRows: (aRows as any[]) ?? [],
      jobStateRows: (jsRows as any[]) ?? [],
      staleLeaseCount: staleCount,
      duplicateReuseCount: dupReuse,
    });

    const depthByState: Record<string, number> = {};
    const inFlightByProvider: Record<string, number> = {};
    for (const r of queue) {
      depthByState[r.queue_state] = (depthByState[r.queue_state] || 0) + 1;
      if (ACTIVE.includes(r.queue_state)) {
        const k = String(r.provider_key || 'unknown');
        inFlightByProvider[k] = (inFlightByProvider[k] || 0) + 1;
      }
    }
    const globalGov = gGlobal ? coerceGovernanceRow(gGlobal, GLOBAL_GOVERNANCE_SENTINEL) : null;

    return res.status(200).json({
      ok: true,
      generated_at: nowIso,
      governance: {
        global_emergency_stop: globalGov?.emergency_stop ?? false,
        global_queue_paused: globalGov?.queue_paused ?? false,
      },
      queue: {
        depth_by_state: depthByState,
        in_flight_by_provider: inFlightByProvider,
        queued: depthByState['queued'] ?? 0,
        retry_scheduled: depthByState['retry_scheduled'] ?? 0,
      },
      pressure: {
        retry_rate: analytics.retry_rate,
        moderation_block_rate: analytics.moderation_block_rate,
        stale_lease_rate: analytics.stale_lease_rate,
        provider_failure_rate: analytics.provider_failure_rate,
        stale_leases: staleCount,
      },
      analytics,
    });
  } catch (e) {
    // Read-only probe: never 500 a health check loop.
    return res.status(200).json({ ok: false, code: 'HEALTH_PROBE_ERROR', error: e instanceof Error ? e.message : 'unexpected' });
  }
}
