import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { enqueuePublishedJobsForReconciliation, runPublishReconciliationWorker } from '../../../../backend/services/publishReconciliationService';

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // ROUTE-AUTH-001: fail CLOSED. The check used to run only when the secret was
  // configured, so an unset secret meant anyone could drive the worker.
  const expected = process.env.PUBLISHING_WORKER_SECRET;
  if (!expected) return res.status(503).json({ error: 'Worker secret not configured' });
  const provided = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : '';
  if (!provided || !secretMatches(provided, expected)) return res.status(401).json({ error: 'Invalid worker secret' });
  const shouldEnqueue = req.body?.enqueue !== false;
  const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId = typeof req.body?.website_id === 'string' ? req.body.website_id : null;
  const limit = Number(req.body?.limit || 10);
  const queued = shouldEnqueue
    ? await enqueuePublishedJobsForReconciliation({ companyId, websiteId, limit })
    : { queued: 0 };
  const result = await runPublishReconciliationWorker({
    workerId: typeof req.body?.worker_id === 'string' ? req.body.worker_id : 'api-reconciliation-worker',
    limit: Number.isFinite(limit) ? limit : 10,
  });
  return res.status(200).json({ queued, result });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/publishing/reconcile/run' });
