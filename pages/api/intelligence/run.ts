import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { runIntelligenceCycle } from '../../../backend/services/intelligenceCoreEngine';

/**
 * POST /api/intelligence/run
 * Runs intelligence cycle via unified orchestrator.
 * Body: { companyId?, apiSourceId?, windowHours?, runIngestion?, runAnalysis?, runStrategy?, runLearning?, runOptimization?, runSimulation?, buildGraph?, persistThemes?, persistSimulationRuns? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.body?.companyId as string);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const {
      apiSourceId,
      windowHours,
      runIngestion,
      runAnalysis,
      runStrategy,
      runLearning,
      runOptimization,
      runSimulation,
      buildGraph,
      persistThemes,
      persistSimulationRuns,
    } = req.body ?? {};

    const result = await runIntelligenceCycle({
      companyId,
      apiSourceId: apiSourceId ?? null,
      windowHours: typeof windowHours === 'number' ? windowHours : 24,
      runIngestion: runIngestion === true,
      runAnalysis: runAnalysis !== false,
      runStrategy: runStrategy !== false,
      runLearning: runLearning !== false,
      runOptimization: runOptimization === true,
      runSimulation: runSimulation === true,
      buildGraph: buildGraph === true,
      persistThemes: persistThemes === true,
      persistSimulationRuns: persistSimulationRuns === true,
    });

    return res.status(200).json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Intelligence cycle failed';
    console.error('[intelligence/run]', message);
    return res.status(500).json({ error: message });
  }
}
