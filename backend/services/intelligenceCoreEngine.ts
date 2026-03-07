/**
 * Intelligence Core Engine
 * Unified orchestrator for the intelligence platform.
 * All cross-module calls flow through this service.
 *
 * Pipeline: ingestion → analysis → strategy → learning → simulation
 */

function logStage(
  event:
    | 'ingestion_started'
    | 'ingestion_completed'
    | 'analysis_started'
    | 'analysis_completed'
    | 'strategy_generated'
    | 'learning_processed'
    | 'optimization_completed'
    | 'simulation_completed'
    | 'simulation_skipped'
    | 'cycle_completed',
  data: { companyId: string; duration_ms?: number; [k: string]: unknown }
) {
  console.log(JSON.stringify({ event, ...data }));
}

import { ingestSignals } from './intelligenceIngestionModule';
import { analyzeSignals, getInsights, clusterSignals, getCorrelations } from './intelligenceAnalysisModule';
import {
  generateStrategies,
  getRecommendations,
  getOpportunities,
} from './intelligenceStrategyModule';
import {
  processLearning,
  evaluateStrategyPerformance,
  computeAndPersistQualityMetrics,
  getQualityMetrics,
} from './intelligenceLearningModule';
import {
  runSimulations,
  getSimulationRuns,
  MAX_SIMULATION_RUNS_PER_HOUR,
} from './intelligenceSimulationModule';
import { canRunOptimization, runOptimizationForCompany } from './optimizationOrchestrationService';
import {
  canRunCycle,
  canRunLearning,
  recordExecution,
  recordExecutionSkipped,
} from './intelligenceExecutionController';

export { MAX_SIMULATION_RUNS_PER_HOUR };

export type IntelligenceCycleOptions = {
  companyId: string;
  apiSourceId?: string | null;
  windowHours?: number;
  runIngestion?: boolean;
  runAnalysis?: boolean;
  runStrategy?: boolean;
  runLearning?: boolean;
  runOptimization?: boolean;
  runSimulation?: boolean;
  buildGraph?: boolean;
  persistThemes?: boolean;
  persistSimulationRuns?: boolean;
};

export type IntelligenceCycleResult = {
  ingestion?: { signals_inserted: number; signals_skipped: number };
  analysis?: { insights: unknown; correlations: unknown; signals: unknown[] };
  strategy?: Awaited<ReturnType<typeof generateStrategies>>;
  learning?: Awaited<ReturnType<typeof processLearning>>;
  optimization?: Awaited<ReturnType<typeof runOptimizationForCompany>> | { skipped: string };
  simulation?: Awaited<ReturnType<typeof runSimulations>> | { skipped: string };
  cycle_skipped?: string;
};

/**
 * Run full intelligence cycle.
 * Each phase is optional via options; defaults run analysis, strategy, learning.
 */
export async function runIntelligenceCycle(
  options: IntelligenceCycleOptions
): Promise<IntelligenceCycleResult> {
  const {
    companyId,
    apiSourceId,
    windowHours = 24,
    runIngestion = false,
    runAnalysis = true,
    runStrategy = true,
    runLearning = true,
    runOptimization = false,
    runSimulation = false,
    buildGraph = false,
    persistThemes = false,
    persistSimulationRuns = false,
  } = options;

  const result: IntelligenceCycleResult = {};
  const cycleStart = Date.now();
  const isCycle = runAnalysis || runStrategy || runLearning;

  if (isCycle) {
    try {
      const allowed = await canRunCycle(companyId);
      if (!allowed) {
        try {
          await recordExecutionSkipped(companyId, 'intelligence_cycle', 'max_cycles_per_hour');
        } catch (_) {}
        return { cycle_skipped: 'Cycle limit exceeded: max cycles per hour' };
      }
    } catch (ctrlErr) {
      console.warn('[intelligenceCore] execution controller check failed', (ctrlErr as Error)?.message);
    }
  }

  if (runIngestion && apiSourceId) {
    const ingestStart = Date.now();
    logStage('ingestion_started', { companyId, apiSourceId });
    try {
      const ingest = await ingestSignals(apiSourceId, companyId);
      result.ingestion = ingest;
      logStage('ingestion_completed', {
        companyId,
        duration_ms: Date.now() - ingestStart,
        signals_inserted: ingest.signals_inserted,
        signals_skipped: ingest.signals_skipped,
      });
    } catch (e) {
      logStage('ingestion_completed', {
        companyId,
        duration_ms: Date.now() - ingestStart,
        error: (e as Error)?.message,
      });
      console.warn('[intelligenceCore] ingestion failed', (e as Error)?.message);
    }
  }

  if (runAnalysis) {
    const analysisStart = Date.now();
    logStage('analysis_started', { companyId });
    try {
      const analysis = await analyzeSignals(companyId, { windowHours });
      result.analysis = analysis;
      logStage('analysis_completed', {
        companyId,
        duration_ms: Date.now() - analysisStart,
        clusters: analysis.insights?.trend_clusters?.length ?? 0,
      });
    } catch (e) {
      const errMsg = (e as Error)?.message;
      logStage('analysis_completed', {
        companyId,
        duration_ms: Date.now() - analysisStart,
        error: errMsg,
      });
      console.warn('[intelligenceCore] analysis failed', errMsg);
    }
  }

  if (runStrategy) {
    const strategyStart = Date.now();
    try {
      result.strategy = await generateStrategies(companyId, {
        windowHours,
        buildGraph,
        persistThemes,
      });
      logStage('strategy_generated', {
        companyId,
        duration_ms: Date.now() - strategyStart,
        opportunities: result.strategy?.opportunities?.length ?? 0,
        recommendations: result.strategy?.recommendations?.length ?? 0,
      });
    } catch (e) {
      logStage('strategy_generated', {
        companyId,
        duration_ms: Date.now() - strategyStart,
        error: (e as Error)?.message,
      });
      console.warn('[intelligenceCore] strategy failed', (e as Error)?.message);
      result.strategy = undefined;
    }
  }

  if (runLearning) {
    const learningStart = Date.now();
    try {
      const learningAllowed = await canRunLearning(companyId);
      if (learningAllowed) {
        result.learning = await processLearning(companyId);
        try {
          await recordExecution(companyId, 'learning_cycle', {
            latencyMs: Date.now() - learningStart,
          });
        } catch (recErr) {
          console.warn('[intelligenceCore] recordExecution learning failed', (recErr as Error)?.message);
        }
        logStage('learning_processed', {
          companyId,
          duration_ms: Date.now() - learningStart,
        });
      } else {
        try {
          await recordExecutionSkipped(companyId, 'learning_cycle', 'max_learning_runs_per_hour');
        } catch (_) {}
        result.learning = undefined;
      }
    } catch (e) {
      logStage('learning_processed', {
        companyId,
        duration_ms: Date.now() - learningStart,
        error: (e as Error)?.message,
      });
      console.warn('[intelligenceCore] learning failed', (e as Error)?.message);
      result.learning = undefined;
    }
  }

  if (runOptimization) {
    const optAllowed = await canRunOptimization(companyId);
    if (optAllowed) {
      try {
        result.optimization = await runOptimizationForCompany(companyId);
        logStage('optimization_completed', {
          companyId,
          duration_ms: Date.now() - cycleStart,
        });
      } catch (e) {
        console.warn('[intelligenceCore] optimization failed', (e as Error)?.message);
        result.optimization = { skipped: (e as Error)?.message ?? 'Optimization failed' };
      }
    } else {
      await recordExecutionSkipped(companyId, 'optimization_run', 'max_optimizations_per_day');
      result.optimization = { skipped: 'Optimization limit exceeded: max 4 per day' };
    }
  }

  if (runSimulation) {
    try {
      result.simulation = await runSimulations(companyId, {
        persistRuns: persistSimulationRuns,
      });
      logStage('simulation_completed', {
        companyId,
        duration_ms: Date.now() - cycleStart,
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (msg.includes('throttle') || msg.includes('limit')) {
        result.simulation = { skipped: msg };
        logStage('simulation_skipped', { companyId, reason: msg });
      } else {
        console.warn('[intelligenceCore] simulation failed', msg);
        result.simulation = { skipped: msg };
      }
    }
  }

  if (isCycle) {
    try {
      await recordExecution(companyId, 'intelligence_cycle', {
        latencyMs: Date.now() - cycleStart,
      });
    } catch (recErr) {
      console.warn('[intelligenceCore] recordExecution cycle failed', (recErr as Error)?.message);
    }
  }

  logStage('cycle_completed', {
    companyId,
    duration_ms: Date.now() - cycleStart,
  });

  return result;
}

/**
 * Trigger ingestion only (for queue worker).
 */
export { ingestSignals } from './intelligenceIngestionModule';

/**
 * Trigger analysis.
 */
export { analyzeSignals, getInsights, clusterSignals, getCorrelations } from './intelligenceAnalysisModule';

/**
 * Trigger strategy generation.
 */
export { generateStrategies, getRecommendations, getOpportunities } from './intelligenceStrategyModule';

/**
 * Trigger learning.
 */
export { processLearning, evaluateStrategyPerformance, computeAndPersistQualityMetrics, getQualityMetrics } from './intelligenceLearningModule';

/**
 * Trigger optimization.
 */
export { canRunOptimization, runOptimizationForCompany } from './optimizationOrchestrationService';

/**
 * Trigger simulation.
 */
export { runSimulations, getSimulationRuns } from './intelligenceSimulationModule';
