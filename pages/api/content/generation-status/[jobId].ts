/**
 * GET /api/content/generation-status/[jobId]
 *
 * Poll the status of a content generation job.
 * Returns job status, progress, result (if completed), or error (if failed).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';

  if (!jobId) {
    return res.status(400).json({ error: 'jobId required' });
  }

  try {
    const { getContentQueue } = await import('../../../../backend/queue/contentGenerationQueues');

    // Try each queue to find the job
    const queueNames = ['content-blog', 'content-post', 'content-whitepaper', 'content-story', 'content-newsletter', 'content-engagement'];
    let job = null;

    for (const queueName of queueNames) {
      const queue = getContentQueue(queueName);
      job = await queue.getJob(jobId);
      if (job) break;
    }

    if (!job) {
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
