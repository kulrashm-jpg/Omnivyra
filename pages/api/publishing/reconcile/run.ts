import type { NextApiRequest, NextApiResponse } from 'next';
import { enqueuePublishedJobsForReconciliation, runPublishReconciliationWorker } from '../../../../backend/services/publishReconciliationService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.PUBLISHING_WORKER_SECRET;
  if (expected) {
    const provided = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : '';
    if (provided !== expected) return res.status(401).json({ error: 'Invalid worker secret' });
  }
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
