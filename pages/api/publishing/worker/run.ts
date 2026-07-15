import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { runPublishingWorker } from '../../../../backend/services/publishingJobService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.PUBLISHING_WORKER_SECRET;
  if (expected) {
    const provided = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : '';
    if (provided !== expected) return res.status(401).json({ error: 'Invalid worker secret' });
  }
  const limit = Number(req.body?.limit || req.query.limit || 5);
  const workerId = typeof req.body?.worker_id === 'string' ? req.body.worker_id : 'api-publishing-worker';
  const result = await runPublishingWorker({ workerId, limit: Number.isFinite(limit) ? limit : 5 });
  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/publishing/worker/run' });
