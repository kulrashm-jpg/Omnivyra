import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';
import {
  summarizeCreatorRenderMetrics,
  listCreatorRenderMetrics,
  summarizeDurableCreatorRenderMetrics,
  listDurableCreatorRenderMetrics,
  purgeOldCreatorRenderMetrics,
} from '../../../backend/services/creatorRenderObservability';
import {
  getCreatorRenderDeadLetterQueue,
  getCreatorRenderQueue,
  isDurableCreatorRenderQueueConfigured,
  reconcileCreatorRenderQueue,
  recoverOrphanedCreatorRenderJobs,
  replayCreatorRenderDeadLetterJob,
} from '../../../backend/services/creatorRenderDurableQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await isSuperAdmin(user.id))) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.method === 'POST') {
    if (!isDurableCreatorRenderQueueConfigured()) return res.status(503).json({ error: 'CREATOR_RENDER_REDIS_UNCONFIGURED' });
    const action = String(req.body?.action ?? '').trim();
    if (action === 'replay_dlq') {
      const jobId = String(req.body?.jobId ?? '').trim();
      if (!jobId) return res.status(400).json({ error: 'Missing jobId' });
      const result = await replayCreatorRenderDeadLetterJob(jobId);
      return res.status(200).json({ ok: result.status !== 'failed', action, result });
    }
    if (action === 'recover_orphans') {
      const result = await recoverOrphanedCreatorRenderJobs({ olderThanMs: Number(req.body?.olderThanMs ?? 15 * 60_000) || 15 * 60_000 });
      return res.status(200).json({ ok: true, action, result });
    }
    if (action === 'reconcile') {
      const result = await reconcileCreatorRenderQueue({ staleActiveMs: Number(req.body?.staleActiveMs ?? 15 * 60_000) || 15 * 60_000 });
      return res.status(200).json({ ok: true, action, result });
    }
    if (action === 'purge_old_metrics') {
      const result = await purgeOldCreatorRenderMetrics({ olderThanDays: Number(req.body?.olderThanDays ?? 30) || 30 });
      return res.status(200).json({ ok: true, action, result });
    }
    return res.status(400).json({ error: 'Unsupported action' });
  }

  let queue: Record<string, unknown> = { configured: isDurableCreatorRenderQueueConfigured() };
  if (isDurableCreatorRenderQueueConfigured()) {
    const renderQueue = getCreatorRenderQueue();
    const deadLetterQueue = getCreatorRenderDeadLetterQueue();
    queue = {
      configured: true,
      counts: await renderQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
      dead_letter_counts: await deadLetterQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
    };
  }

  return res.status(200).json({
    ok: true,
    queue,
    metrics: summarizeCreatorRenderMetrics(),
    durable_metrics_24h: await summarizeDurableCreatorRenderMetrics(),
    drilldown: await listDurableCreatorRenderMetrics({
      auditId: typeof req.query.auditId === 'string' ? req.query.auditId : null,
      metricName: typeof req.query.metric === 'string' ? req.query.metric : null,
      limit: Number(req.query.limit ?? 100) || 100,
    }),
    recent: listCreatorRenderMetrics().slice(-100),
  });
}
