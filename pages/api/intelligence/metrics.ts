import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import {
  evaluateStrategyPerformance,
  computeAndPersistQualityMetrics,
  getQualityMetrics,
} from '../../../backend/services/intelligenceCoreEngine';

/**
 * GET /api/intelligence/metrics
 * Returns strategy performance, quality metrics.
 * Query: ?companyId, ?windowDays, ?refresh=true
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.query.companyId as string);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const windowDays = Math.min(90, Math.max(1, parseInt(String(req.query.windowDays ?? 30), 10) || 30));
    const refresh = String(req.query.refresh ?? '').toLowerCase() === 'true';

    const [strategyPerformance, qualityHistory] = await Promise.all([
      evaluateStrategyPerformance(companyId, { windowDays }),
      getQualityMetrics(companyId, { limit: 7 }),
    ]);

    let qualityLatest: Record<string, number | string> | null = null;
    if (refresh) {
      const fresh = await computeAndPersistQualityMetrics(companyId);
      qualityLatest = {
        signal_accuracy: fresh.signal_accuracy,
        opportunity_accuracy: fresh.opportunity_accuracy,
        recommendation_success_rate: fresh.recommendation_success_rate,
        theme_success_rate: fresh.theme_success_rate,
        computed_at: fresh.computed_at,
      };
    } else if (qualityHistory.length > 0) {
      const byType = new Map<string, number>();
      for (const m of qualityHistory) {
        if (!byType.has(m.metric_type)) byType.set(m.metric_type, m.metric_value);
      }
      qualityLatest = Object.fromEntries(byType);
    }

    return res.status(200).json({
      strategy_performance: strategyPerformance,
      quality_metrics: qualityLatest,
      quality_history: qualityHistory,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch metrics';
    console.error('[intelligence/metrics]', message);
    return res.status(500).json({ error: message });
  }
}
