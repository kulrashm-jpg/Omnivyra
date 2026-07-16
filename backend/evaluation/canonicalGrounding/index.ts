/**
 * RF-3A — Golden Dataset Equivalence Harness (orchestrator + public API).
 *
 * OFFLINE evaluation infrastructure. Reuses the real grounding transforms, the
 * Foundation F-12 cache, and F-03 request context. Performs NO production
 * execution, NO live AI call (unless an operator injects a live runner), and
 * NEVER enables a rollout flag. Call runEquivalenceHarness() to produce the
 * evidence; call the report emitters to serialise it.
 */
import { getTraceId, runWithRequestExecutionContext } from '../../../lib/platform/requestContext';
import { DEFAULT_CLASSIFICATION_CONFIG, DEFAULT_EXECUTION_PARAMS } from './config';
import { loadGoldenDataset } from './dataset';
import { WORKLOADS } from './workloads';
import { executeArm, offlineAiRunner } from './execute';
import { compareArms } from './analysis';
import type {
  AiRunner, Classification, ClassificationConfig, DatasetEntry, ExecutionParams,
  HarnessResult, QualityScores, RunCapture, WorkloadComparison, WorkloadDef,
} from './types';

export type QualityScorer = (
  workload: WorkloadDef,
  entry: DatasetEntry,
  arms: { legacy: RunCapture; canonical: RunCapture },
) => QualityScores;

export interface HarnessOptions {
  aiRunner?: AiRunner;         // default OFFLINE (no provider call)
  params?: ExecutionParams;    // held constant across both arms
  config?: ClassificationConfig;
  dataset?: DatasetEntry[];
  workloads?: WorkloadDef[];
  qualityScorer?: QualityScorer;
}

const SEVERITY: Record<Classification, number> = {
  SAFE_TO_ENFORCE: 0, KEEP_IN_SHADOW: 1, REQUIRES_ENGINEERING_CHANGES: 2,
};

async function runOne(
  workload: WorkloadDef, entry: DatasetEntry,
  aiRunner: AiRunner, params: ExecutionParams, config: ClassificationConfig, scorer?: QualityScorer,
): Promise<WorkloadComparison> {
  return runWithRequestExecutionContext(
    {
      requestId: `req-${workload.key}-${entry.id}`,
      correlationId: `corr-${entry.id}`,
      traceId: `trace-${workload.key}-${entry.id}`,
    },
    async () => {
      // Identical execution params for both arms; canonical run twice for a
      // deterministic-replay check on identical inputs.
      const legacy = await executeArm(workload, entry, 'legacy', aiRunner, params);
      const canonical = await executeArm(workload, entry, 'canonical', aiRunner, params);
      const canonicalReplay = await executeArm(workload, entry, 'canonical', aiRunner, params);
      const deterministic =
        canonical.prompt === canonicalReplay.prompt &&
        JSON.stringify(canonical.grounding) === JSON.stringify(canonicalReplay.grounding);
      const quality = scorer ? scorer(workload, entry, { legacy, canonical }) : undefined;
      return compareArms({ workload, entry, legacy, canonical, deterministic, quality, config, traceId: getTraceId() });
    },
  );
}

/** Run the full offline equivalence evaluation. Deterministic given fixtures. */
export async function runEquivalenceHarness(opts: HarnessOptions = {}): Promise<HarnessResult> {
  const aiRunner = opts.aiRunner ?? offlineAiRunner;
  const params = opts.params ?? DEFAULT_EXECUTION_PARAMS;
  const config = opts.config ?? DEFAULT_CLASSIFICATION_CONFIG;
  const dataset = opts.dataset ?? loadGoldenDataset();
  const workloads = opts.workloads ?? WORKLOADS;

  const comparisons: WorkloadComparison[] = [];
  for (const workload of workloads) {
    for (const entry of dataset) {
      comparisons.push(await runOne(workload, entry, aiRunner, params, config, opts.qualityScorer));
    }
  }

  const byClassification: Record<Classification, number> = {
    SAFE_TO_ENFORCE: 0, KEEP_IN_SHADOW: 0, REQUIRES_ENGINEERING_CHANGES: 0,
  };
  const byWorkload: Record<string, Classification> = {};
  for (const c of comparisons) {
    byClassification[c.classification]++;
    const prev = byWorkload[c.workload];
    if (!prev || SEVERITY[c.classification] > SEVERITY[prev]) byWorkload[c.workload] = c.classification;
  }

  return {
    generatedForParams: params,
    datasetSize: dataset.length,
    workloadCount: workloads.length,
    comparisons,
    summary: { byClassification, byWorkload },
  };
}

export { loadGoldenDataset } from './dataset';
export { WORKLOADS } from './workloads';
export { offlineAiRunner } from './execute';
export { toJson, toCsv, toMarkdown } from './report';
export { DEFAULT_EXECUTION_PARAMS, DEFAULT_CLASSIFICATION_CONFIG } from './config';
export * from './types';
