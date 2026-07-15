import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Internal Render Worker — Step-R5 scheduled/cron entrypoint.
 *
 *   POST /api/internal/render-worker   (header: x-internal-worker-token)
 *     → run ONE bounded, lease-safe worker tick over the R4 render
 *       queue. Stateless + idempotent + horizontally scalable: any
 *       number of concurrent invocations are safe (R4 lease = exactly
 *       once). Returns worker metrics only.
 *
 * SAFETY
 *   - Internal-only: requires INTERNAL_WORKER_TOKEN (fail-closed: env
 *     unset OR token mismatch ⇒ 401/503, never runs).
 *   - Flag-gated: ENABLE_CREATOR_RENDERING + ENABLE_CREATOR_RENDER_QUEUE.
 *   - Scheduler-isolated: lives under /api/internal, imports nothing
 *     from backend/scheduler; the post scheduler never calls this.
 *   - Fail-closed: never throws; bounded window; backpressure under load.
 *   - Image-only / R3 sync untouched (worker just drives R4).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  isCreatorRenderingEnabled,
  isCreatorRenderQueueEnabled,
  processQueuedRenderJob,
  createRenderProviderRegistry,
  runRenderWorkerTick,
  GLOBAL_GOVERNANCE_SENTINEL,
} from '@/backend/services/creator/rendering';

const ACTIVE_STATES = ['claimed', 'rendering', 'processing', 'moderation'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Internal auth (fail-closed) ───────────────────────────────────────
  const expected = String(process.env.INTERNAL_WORKER_TOKEN ?? '').trim();
  const provided = String(req.headers['x-internal-worker-token'] ?? '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'Worker token not configured.', code: 'WORKER_DISABLED' });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized worker.', code: 'WORKER_UNAUTHORIZED' });
  }

  if (!isCreatorRenderingEnabled() || !isCreatorRenderQueueEnabled()) {
    return res.status(200).json({ ran: false, code: 'RENDER_QUEUE_DISABLED' });
  }

  // ── Step-R6: global governance kill-switch pre-check (additive) ───────
  // Pure pre-gate OUTSIDE the R5 worker core (renderWorker.ts untouched).
  try {
    const { data: g } = await supabase
      .from('creator_render_governance_state').select('emergency_stop, queue_paused')
      .eq('organization_id', GLOBAL_GOVERNANCE_SENTINEL).maybeSingle();
    if ((g as any)?.emergency_stop === true) {
      return res.status(200).json({ ran: false, code: 'GOVERNANCE_HALTED', event: 'emergency_stop_active' });
    }
    if ((g as any)?.queue_paused === true) {
      return res.status(200).json({ ran: false, code: 'GOVERNANCE_HALTED', event: 'queue_paused' });
    }
  } catch {
    // Fail-closed: if governance can't be read, do NOT run the worker.
    return res.status(200).json({ ran: false, code: 'GOVERNANCE_UNAVAILABLE' });
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const workerId = `rw:${process.pid}:${Date.now()}`;
  const now = () => new Date().toISOString();

  const countInFlight = async (): Promise<Record<string, number>> => {
    const { data } = await supabase
      .from('creator_render_queue_job')
      .select('provider_key')
      .in('queue_state', ACTIVE_STATES)
      .limit(500);
    const map: Record<string, number> = {};
    for (const r of (data as any[]) ?? []) {
      const k = String(r.provider_key || 'unknown');
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  };
  const countStaleLeases = async (): Promise<number> => {
    const { data } = await supabase
      .from('creator_render_queue_job')
      .select('id')
      .in('queue_state', ACTIVE_STATES)
      .lt('lease_expires_at', now())
      .limit(500);
    return Array.isArray(data) ? data.length : 0;
  };

  try {
    const metrics = await runRenderWorkerTick(
      {
        now: () => Date.now(),
        countInFlight,
        countStaleLeases,
        processOne: async (leaseOwner: string) => {
          const r = await processQueuedRenderJob(
            { supabase, ownedDbTable, now, providerRegistry: createRenderProviderRegistry() },
            leaseOwner,
          );
          return { ok: r.ok, status: r.status, events: r.events, reason: r.reason };
        },
      },
      {
        workerId,
        maxJobs: Number.isFinite(body.max_jobs as number) ? Number(body.max_jobs) : undefined,
        maxMillis: Number.isFinite(body.max_millis as number) ? Number(body.max_millis) : undefined,
        globalConcurrency: Number.isFinite(body.global_concurrency as number) ? Number(body.global_concurrency) : undefined,
        providerConcurrency: Number.isFinite(body.provider_concurrency as number) ? Number(body.provider_concurrency) : undefined,
      },
    );
    return res.status(200).json({ ran: true, metrics });
  } catch (e) {
    // Hard fail-closed: a worker tick can never 500 the cron loop.
    return res.status(200).json({
      ran: false, code: 'WORKER_TICK_ERROR',
      error: e instanceof Error ? e.message : 'unexpected',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/internal/render-worker' });
