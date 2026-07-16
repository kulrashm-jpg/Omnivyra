/**
 * RF-3A — Golden Dataset Equivalence Harness: shared types.
 *
 * OFFLINE EVALUATION INFRASTRUCTURE ONLY. Nothing here runs production
 * workloads, calls a live AI provider, touches a database, or enables any
 * rollout flag. It reuses the REAL grounding transforms (assimilateContext /
 * overlayCanonicalOntoProfile / toBriefGrounding) driven by injected,
 * deterministic fixtures so Legacy vs Canonical grounding can be compared under
 * byte-identical conditions.
 */

export type CompanySize = 'small' | 'medium' | 'enterprise';
export type Completeness = 'none' | 'sparse' | 'rich';
export type Activity = 'active' | 'dormant';

/** One deterministic, reproducible company fixture. */
export interface DatasetEntry {
  id: string;
  size: CompanySize;
  industry: string;
  completeness: Completeness;
  websiteEnabled: boolean;
  marketIntel: boolean;
  activity: Activity;
  /** Fixed clock (ms) — makes canonical assembly + freshness deterministic. */
  now: number;
  /** Full profile fixture (incl. report_settings.market_pulse / .discovered_metadata). */
  profile: Record<string, unknown>;
  /** Recent content fixture (drives content-history grounding + activity). */
  recentContent: { title: string; published_at?: string | null }[];
}

/** Which profile grounding fields a workload's prompt actually consumes. */
export interface WorkloadDef {
  key: string;
  label: string;
  /** grounding fields this workload reads (for completeness / prompt projection). */
  fields: string[];
  /** additive = injects a canonical facts block (brief-suggestions) rather than
   *  backfilling profile fields. */
  additive?: boolean;
}

/** Held-constant execution parameters (identical for Run A and Run B). */
export interface ExecutionParams {
  provider: string;
  model: string;
  temperature: number;
  seed: number;
  maxRetries: number;
  timeoutMs: number;
  /** token estimate divisor (chars per token) + cost per 1k tokens (USD). */
  charsPerToken: number;
  costPer1kTokens: number;
}

/** Pluggable AI runner. DEFAULT is offline/no-op — the harness NEVER calls a
 *  real provider unless a runner is explicitly injected by the operator. */
export interface AiRunResult {
  text: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  retries: number;
  error: string | null;
}
export type AiRunner = (prompt: string, params: ExecutionParams) => Promise<AiRunResult>;

/** Everything captured for a single grounded execution (Run A or Run B). */
export interface RunCapture {
  arm: 'legacy' | 'canonical';
  grounding: Record<string, unknown>;
  prompt: string;
  promptChars: number;
  groundingLatencyMs: number;
  assemblyLatencyMs: number;
  executionLatencyMs: number;
  cacheColdHit: boolean;
  cacheWarmHit: boolean;
  fallbackUsed: boolean;
  contextAvailable: boolean;
  overwriteCount: number;
  backfillCount: number;
  contextCompleteness: number; // 0..1 over the workload's consumed fields
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  error: string | null;
  retryCount: number;
}

/** Machine-readable quality scores (hooks; default 'pending'). */
export interface QualityScores {
  factualCorrectness: number | 'pending';
  relevance: number | 'pending';
  completeness: number | 'pending';
  brandConsistency: number | 'pending';
  instructionFollowing: number | 'pending';
  hallucination: number | 'pending';
  campaignUsefulness: number | 'pending';
  contentQuality: number | 'pending';
  reviewer: string;
}

export type Classification = 'SAFE_TO_ENFORCE' | 'KEEP_IN_SHADOW' | 'REQUIRES_ENGINEERING_CHANGES';

/** Per (workload, entry) comparison of Run A vs Run B. */
export interface WorkloadComparison {
  workload: string;
  entryId: string;
  size: CompanySize;
  completeness: Completeness;
  legacy: RunCapture;
  canonical: RunCapture;
  delta: {
    promptCharsDelta: number;
    promptChanged: boolean;
    backfilledFields: string[];
    overwrittenFields: string[];
    missingFieldsLegacy: string[];
    missingFieldsCanonical: string[];
    completenessDelta: number;
    groundingLatencyDeltaMs: number;
    tokensInDelta: number;
    estCostDeltaUsd: number;
    deterministic: boolean;
  };
  quality: QualityScores;
  classification: Classification;
  classificationReasons: string[];
  traceId?: string;
}

/** Configurable classification thresholds/rules (NOT hard-coded). */
export interface ClassificationConfig {
  maxOverwritesForEnforce: number;
  maxPromptGrowthRatioForEnforce: number; // e.g. 0.25 = +25%
  maxCostDeltaUsdForEnforce: number;
  requireDeterministic: boolean;
  requireQualityForEnforce: boolean; // if true, 'pending' quality → KEEP_IN_SHADOW
}

export interface HarnessResult {
  generatedForParams: ExecutionParams;
  datasetSize: number;
  workloadCount: number;
  comparisons: WorkloadComparison[];
  summary: {
    byClassification: Record<Classification, number>;
    byWorkload: Record<string, Classification>;
  };
}
