import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/content/generation-status/[jobId]
 *
 * Poll the status of a content generation job.
 * Returns job status, progress, result (if completed), or error (if failed).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

/** Run a guard against a scratch response so its denial can be re-shaped. */
function captureResponse(): { res: NextApiResponse; denial: { status: number; body: unknown } } {
  const denial = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) { denial.status = code; return this; },
    json(body: unknown) { denial.body = body; return this; },
  } as unknown as NextApiResponse;
  return { res, denial };
}

/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — the owning company recorded on the job by its
 * producer: content/creator adapters and the BOLT creator-row bridge write
 * data.company_id; BOLT topic jobs (bolt-content-jobs) write
 * data.campaign.company_id.
 */
function jobOwnerCompanyId(data: any): string | null {
  const candidates = [data?.company_id, data?.campaign?.company_id, data?.bolt_payload?.company_id];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';

  if (!jobId) {
    return res.status(400).json({ error: 'jobId required' });
  }

  // ROUTE-AUTH-001: authenticate BEFORE any queue lookup, so an anonymous
  // caller cannot probe which job ids exist.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const { getContentQueue } = await import('../../../../backend/queue/contentGenerationQueues');

    // Try each queue to find the job
    const queueNames = [
      'content-blog',
      'content-post',
      'content-whitepaper',
      'content-story',
      'content-newsletter',
      'content-engagement',
      'creator-video',
      'creator-carousel',
      'creator-story',
      'bolt-content-jobs',
    ];
    // OPT-010 A1: look the job up in all queues CONCURRENTLY instead of one
    // Redis round-trip at a time (the common queue, bolt-content-jobs, is last
    // in the list, so the serial walk hit the 10-hop worst case routinely).
    // Priority is preserved exactly: results are scanned in queueNames order,
    // so if the same id ever existed in two queues the earlier one still wins.
    const lookups = await Promise.all(
      queueNames.map((queueName) =>
        getContentQueue(queueName).getJob(jobId).catch(() => null),
      ),
    );
    let job = null;
    for (const found of lookups) {
      if (found) { job = found; break; }
    }

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // ROUTE-AUTH-001: job ids are guessable (content-addressed via
    // makeStableJobId over company_id + topic, or BullMQ's sequential default
    // ids), and the result carries the tenant's generated content. Authorize against the company recorded on the
    // job. A job with no owner, or owned by a company the caller cannot access,
    // answers exactly like a missing job.
    const ownerCompanyId = jobOwnerCompanyId(job.data);
    if (!ownerCompanyId) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const probe = captureResponse();
    const ctx = await enforceCompanyAccess({ req, res: probe.res, companyId: ownerCompanyId });
    if (!ctx) {
      if (probe.denial.status === 401 || probe.denial.status >= 500) {
        return res.status(probe.denial.status).json(probe.denial.body);
      }
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const progress = (job.progress as number) || 0;
    const result = job.returnvalue;
    const error = job.failedReason;

    return res.status(200).json({
      jobId: job.id,
      status: state,
      progress,
      result: state === 'completed' ? result : undefined,
      error: state === 'failed' ? error : undefined,
      createdAt: new Date(job.timestamp).toISOString(),
    });
  } catch (err) {
    console.error('[content/generation-status]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to get job status',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/content/generation-status/:jobId' });
