import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import {
  simulateRecommendationImpact,
  modelScenarios,
  predictOutcomeProbability,
  rankStrategies,
  getSimulationRuns,
  runFullSimulation,
} from '../../../backend/services/simulationOrchestrationService';

/**
 * GET: Run simulation by type or fetch past runs.
 * POST: Run full simulation suite.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.query.companyId ?? req.body?.companyId) as string;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const raw = req.method === 'GET' ? req.query.recommendationIds : req.body?.recommendationIds;
    const recIds = raw
      ? Array.isArray(raw)
        ? (raw as string[]).filter(Boolean)
        : typeof raw === 'string'
          ? raw.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined
      : undefined;

    if (req.method === 'GET') {
      const runType = req.query.runType as string | undefined;
      const simType = (req.query.simType ?? runType) as string | undefined;
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? 20), 10) || 20));

      if (req.query.history === 'true' || req.query.history === '1') {
        const runs = await getSimulationRuns(companyId, { runType: simType, limit });
        return res.status(200).json({ runs });
      }

      if (simType === 'impact' || simType === 'impact_simulation') {
        const result = await simulateRecommendationImpact(companyId, {
          recommendationIds: recIds,
          persistRun: req.query.persist === 'true',
        });
        return res.status(200).json(result);
      }
      if (simType === 'scenarios' || simType === 'scenario') {
        const results = await modelScenarios(companyId);
        return res.status(200).json({ scenarios: results });
      }
      if (simType === 'forecast') {
        const result = await predictOutcomeProbability(companyId, {
          recommendationIds: recIds,
          persistRun: req.query.persist === 'true',
        });
        return res.status(200).json(result);
      }
      if (simType === 'compare' || simType === 'comparison' || simType === 'ranking') {
        const result = await rankStrategies(companyId, {
          recommendationIds: recIds,
          persistRun: req.query.persist === 'true',
        });
        return res.status(200).json(result);
      }

      const runs = await getSimulationRuns(companyId, { runType: simType, limit });
      return res.status(200).json({ runs });
    }

    if (req.method === 'POST') {
      const persistRuns = req.body?.persistRuns === true || req.query.persist === 'true';
      const result = await runFullSimulation({
        companyId,
        recommendationIds: recIds,
        persistRuns,
      });
      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Simulation failed';
    console.error('[intelligence/simulation]', message);
    return res.status(500).json({ error: message });
  }
}
