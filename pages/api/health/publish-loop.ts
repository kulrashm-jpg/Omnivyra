/**
 * Publish-Loop Health Endpoint  (BETA-004 · RULE 8)
 *
 * GET /api/health/publish-loop
 *
 * Reports the live health of the four stages the customer publish loop depends on:
 *   - scheduler   : is anything being enqueued? (last queue_jobs heartbeat)
 *   - worker      : is the BullMQ 'publish' worker process actually alive?
 *                   (detected CROSS-PROCESS via Redis — so a Vercel request can tell
 *                    whether the separate Railway worker replica is up)
 *   - queue       : depth of the 'publish' queue (waiting/active/delayed/failed)
 *   - publishing  : real publish outcomes in the last hour (published vs failed)
 *
 * Each stage returns Healthy | Warning | Failed plus the relevant metric. The
 * overall status is the worst of the four. Every stage is independently guarded
 * so one failing probe never masks the others.
 *
 * 🔴 NODE RUNTIME ONLY. On-demand only — do NOT poll aggressively (it touches Redis;
 * see the internal daily-cap topology). Intended for an admin dashboard / SRE check.
 */

export const runtime = 'nodejs';

import type { NextApiRequest, NextApiResponse } from 'next';
import { getQueue } from '../../../backend/queue/bullmqClient';
import { supabase } from '../../../backend/db/supabaseClient';

type StageStatus = 'healthy' | 'warning' | 'failed';

interface PublishLoopHealth {
  timestamp: string;
  status: StageStatus;
  scheduler: { status: StageStatus; lastHeartbeat: string | null; note: string };
  worker: { status: StageStatus; activeWorkers: number; note: string };
  queue: {
    status: StageStatus;
    depth: { waiting: number; active: number; delayed: number; failed: number; completed: number };
    note: string;
  };
  publishing: {
    status: StageStatus;
    lastHourPublished: number;
    lastHourFailed: number;
    successRate: number | null;
    note: string;
  };
}

const worst = (a: StageStatus, b: StageStatus): StageStatus =>
  a === 'failed' || b === 'failed' ? 'failed' : a === 'warning' || b === 'warning' ? 'warning' : 'healthy';

export default async function handler(req: NextApiRequest, res: NextApiResponse<PublishLoopHealth>) {
  const timestamp = new Date().toISOString();
  const nowMs = Date.now();

  // ── queue + worker (Redis) ────────────────────────────────────────────────
  let queue: PublishLoopHealth['queue'] = {
    status: 'failed',
    depth: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
    note: 'not probed',
  };
  let worker: PublishLoopHealth['worker'] = { status: 'failed', activeWorkers: 0, note: 'not probed' };
  try {
    const q = getQueue();
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    const depth = {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    };
    // Warning if jobs are waiting with no progress, or a meaningful failed backlog.
    const queueStatus: StageStatus = depth.failed > 25 ? 'warning' : 'healthy';
    queue = {
      status: queueStatus,
      depth,
      note: depth.failed > 25 ? `${depth.failed} failed jobs retained — review` : 'queue reachable',
    };

    const workers = await q.getWorkers();
    const activeWorkers = Array.isArray(workers) ? workers.length : 0;
    worker = {
      status: activeWorkers > 0 ? 'healthy' : 'failed',
      activeWorkers,
      note:
        activeWorkers > 0
          ? `${activeWorkers} publish worker(s) connected`
          : 'NO publish worker connected — scheduled posts will queue but never publish',
    };
  } catch (err: any) {
    const msg = err?.message || 'redis/queue unreachable';
    queue = { ...queue, status: 'failed', note: msg };
    worker = { ...worker, status: 'failed', note: `cannot determine workers: ${msg}` };
  }

  // ── scheduler heartbeat (DB: most recent enqueue) ─────────────────────────
  let scheduler: PublishLoopHealth['scheduler'] = { status: 'warning', lastHeartbeat: null, note: 'not probed' };
  try {
    const { data, error } = await supabase
      .from('queue_jobs')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const last = data?.created_at ?? null;
    const ageMs = last ? nowMs - new Date(last).getTime() : null;
    // A recent enqueue proves the scheduler path is live. Old/none is not necessarily
    // broken (nothing may be due) — so it degrades to 'warning' (idle), never 'failed'.
    const fresh = ageMs !== null && ageMs < 6 * 3600 * 1000;
    scheduler = {
      status: fresh ? 'healthy' : 'warning',
      lastHeartbeat: last,
      note: fresh ? 'recent enqueue activity' : 'no enqueue in last 6h (idle or scheduler not running)',
    };
  } catch (err: any) {
    scheduler = { status: 'failed', lastHeartbeat: null, note: err?.message || 'queue_jobs unreadable' };
  }

  // ── publishing outcomes (DB: last hour) ───────────────────────────────────
  let publishing: PublishLoopHealth['publishing'] = {
    status: 'warning',
    lastHourPublished: 0,
    lastHourFailed: 0,
    successRate: null,
    note: 'not probed',
  };
  try {
    const sinceIso = new Date(nowMs - 3600 * 1000).toISOString();
    const [pub, fail] = await Promise.all([
      supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published')
        .gte('updated_at', sinceIso),
      supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('updated_at', sinceIso),
    ]);
    const published = pub.count ?? 0;
    const failed = fail.count ?? 0;
    const total = published + failed;
    const successRate = total > 0 ? Math.round((published / total) * 100) : null;
    // No activity → can't assert health (warning/unknown). High failure share → warning.
    const status: StageStatus =
      total === 0 ? 'warning' : successRate !== null && successRate < 50 ? 'warning' : 'healthy';
    publishing = {
      status,
      lastHourPublished: published,
      lastHourFailed: failed,
      successRate,
      note:
        total === 0
          ? 'no publish attempts in last hour (idle)'
          : `${published}/${total} succeeded in last hour`,
    };
  } catch (err: any) {
    publishing = { ...publishing, status: 'failed', note: err?.message || 'scheduled_posts unreadable' };
  }

  const overall = [scheduler.status, worker.status, queue.status, publishing.status].reduce(worst, 'healthy');
  const body: PublishLoopHealth = { timestamp, status: overall, scheduler, worker, queue, publishing };

  // Healthy/Warning → 200; Failed → 503 (matches /api/health/internal convention).
  res.status(overall === 'failed' ? 503 : 200).json(body);
}
