
/**
 * Internal Metrics Endpoint — RISK 5: Observability
 *
 * Exposes key operational metrics for monitoring dashboards and alerts.
 *
 * Metrics:
 *   - Cache hit/miss ratio (exact + near-match)
 *   - GPT calls per minute
 *   - Queue depths (waiting + active + delayed)
 *   - Worker latency (last job duration)
 *   - Redis memory usage
 *
 * Protected by INTERNAL_METRICS_SECRET env var.
 * In production, route this through Grafana / Datadog / your APM of choice.
 *
 * GET /api/internal/metrics
 * Header: x-metrics-secret: <INTERNAL_METRICS_SECRET>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getQueue, getEngagementPollingQueue, getPostingQueue, getAiHeavyQueue } from '../../../backend/queue/bullmqClient';
import { getMetricsSnapshot, resetMetrics } from '../../../backend/services/metricsCollector';

const METRICS_SECRET = process.env.INTERNAL_METRICS_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: require secret header in production
  if (METRICS_SECRET) {
    const provided = req.headers['x-metrics-secret'];
    if (provided !== METRICS_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const [publishCounts, engagementCounts, postingCounts, aiHeavyCounts, metricsSnapshot] =
      await Promise.allSettled([
        getQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
        getEngagementPollingQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
        getPostingQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
        getAiHeavyQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
        getMetricsSnapshot(),
      ]);

    const resolve = (r: PromiseSettledResult<unknown>) =>
      r.status === 'fulfilled' ? r.value : { error: 'unavailable' };

    const metrics = resolve(metricsSnapshot) as Awaited<ReturnType<typeof getMetricsSnapshot>>;

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      queues: {
        publish: resolve(publishCounts),
        'engagement-polling': resolve(engagementCounts),
        posting: resolve(postingCounts),
        'ai-heavy': resolve(aiHeavyCounts),
      },
      ai: {
        callsPerMinute: metrics.gptCallsPerMinute,
        cacheHitRate: metrics.cacheHitRate,
        cacheExactHits: metrics.cacheExactHits,
        cacheNearHits: metrics.cacheNearHits,
        cacheMisses: metrics.cacheMisses,
        avgLatencyMs: metrics.avgLatencyMs,
        templateHitRate: metrics.templateHitRate,
      },
      redis: {
        memoryUsedMb: metrics.redisMemoryMb,
        connected: metrics.redisConnected,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
