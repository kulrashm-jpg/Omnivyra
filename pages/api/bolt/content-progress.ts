import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/bolt/content-progress?run_id=<id>
 *
 * Returns per-topic job progress for a BOLT run that uses the
 * queue-based content generation path. Used by the UI to render
 * a live progress bar like "42 of 60 topics scheduled · ~4 min remaining".
 *
 * Response shape:
 * {
 *   run_id: string,
 *   total:  number,   // total bolt_content_jobs for this run
 *   done:   number,   // status = 'done'
 *   failed: number,   // status = 'failed'
 *   queued: number,   // status in ('pending','queued')
 *   active: number,   // status in ('generating_master','generating_variants','scheduling')
 *   posts_scheduled: number,
 *   posts_skipped:   number,
 *   estimated_seconds_remaining: number | null,
 *   is_complete: boolean,
 *   jobs: Array<{ id, topic, content_type, status, platform_count }>
 * }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const runId = typeof req.query.run_id === 'string' ? req.query.run_id.trim() : null;
  if (!runId) {
    return res.status(400).json({ error: 'run_id is required' });
  }

  try {
    // Verify run exists and get company_id for access check.
    // Select only guaranteed columns first; new columns added by migration may not exist yet.
    const { data: run, error: runError } = await supabase
      .from('bolt_execution_runs')
      .select('id, company_id, status')
      .eq('id', runId)
      .maybeSingle();

    if (runError || !run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Separately query new progress columns (added by migration — may not exist yet)
    let postsScheduled = 0;
    let postsSkipped = 0;
    try {
      const { data: runExtra } = await supabase
        .from('bolt_execution_runs')
        .select('posts_scheduled, posts_skipped')
        .eq('id', runId)
        .maybeSingle();
      postsScheduled = (runExtra as any)?.posts_scheduled ?? 0;
      postsSkipped   = (runExtra as any)?.posts_skipped   ?? 0;
    } catch { /* columns not yet migrated — use 0 */ }

    const companyId = (run as any).company_id as string;
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    // Fetch all bolt_content_jobs for this run
    const { data: jobs, error: jobsError } = await supabase
      .from('bolt_content_jobs')
      .select('id, topic, content_type, status, daily_plan_ids, created_at, started_at, completed_at')
      .eq('run_id', runId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });

    if (jobsError) {
      // Table may not exist yet (migration not applied) — return empty state
      // so the frontend treats it as "no queued jobs" and navigates immediately.
      if (jobsError.code === '42P01' || jobsError.message?.includes('does not exist')) {
        return res.status(200).json({
          run_id: runId, total: 0, done: 0, failed: 0, active: 0, queued: 0,
          posts_scheduled: 0, posts_skipped: 0,
          estimated_seconds_remaining: null, is_complete: true, jobs: [],
        });
      }
      return res.status(500).json({ error: 'Failed to fetch content jobs' });
    }

    const jobList = (jobs ?? []) as Array<{
      id: string;
      topic: string;
      content_type: string;
      status: string;
      daily_plan_ids: string[];
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
    }>;

    const total  = jobList.length;
    const done   = jobList.filter((j) => j.status === 'done').length;
    const failed = jobList.filter((j) => j.status === 'failed').length;
    const active = jobList.filter((j) =>
      ['generating_master', 'generating_variants', 'scheduling'].includes(j.status)
    ).length;
    const queued = jobList.filter((j) => ['pending', 'queued'].includes(j.status)).length;

    // Estimate time remaining based on average completion time of done jobs
    let estimatedSecondsRemaining: number | null = null;
    const completedJobs = jobList.filter((j) => j.status === 'done' && j.started_at && j.completed_at);
    if (completedJobs.length > 0 && queued + active > 0) {
      const avgMs = completedJobs.reduce((sum, j) => {
        const s = new Date(j.started_at!).getTime();
        const e = new Date(j.completed_at!).getTime();
        return sum + (e - s);
      }, 0) / completedJobs.length;
      // Workers process up to 3 in parallel
      const WORKER_CONCURRENCY = 3;
      const remainingJobs = queued + active;
      const parallelBatches = Math.ceil(remainingJobs / WORKER_CONCURRENCY);
      estimatedSecondsRemaining = Math.round((avgMs * parallelBatches) / 1000);
    }

    // A job is complete when all have reached a terminal state (done/failed).
    // Also detect stale runs: if jobs have been stuck in queued/pending for 3+ minutes
    // with no active or done jobs, workers likely aren't processing — treat as complete
    // so the UI doesn't hang indefinitely.
    let isComplete = total === 0 || done + failed >= total;
    if (!isComplete && total > 0 && active === 0 && done === 0 && queued > 0) {
      const oldestCreated = jobList.reduce((oldest, j) => {
        const t = new Date(j.created_at).getTime();
        return t < oldest ? t : oldest;
      }, Infinity);
      const staleMs = Date.now() - oldestCreated;
      if (staleMs > 3 * 60 * 1000) {
        console.warn('[bolt/content-progress] Stale jobs detected — no worker progress after 3 min', {
          run_id: runId, total, queued, staleMs,
        });
        isComplete = true;
      }
    }

    return res.status(200).json({
      run_id:    runId,
      total,
      done,
      failed,
      active,
      queued,
      posts_scheduled: postsScheduled,
      posts_skipped:   postsSkipped,
      estimated_seconds_remaining: estimatedSecondsRemaining,
      is_complete: isComplete,
      jobs: jobList.map((j) => ({
        id:           j.id,
        topic:        j.topic,
        content_type: j.content_type,
        status:       j.status,
        platform_count: Array.isArray(j.daily_plan_ids) ? j.daily_plan_ids.length : 0,
      })),
    });
  } catch (err) {
    console.error('[bolt/content-progress] error:', (err as Error)?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/bolt/content-progress' });
