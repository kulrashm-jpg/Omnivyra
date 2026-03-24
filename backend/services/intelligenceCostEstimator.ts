/**
 * Intelligence Cost Estimator
 *
 * Estimates the cost (USD) of a single intelligence job execution based on:
 *   1. AI token usage — model pricing applied to input/output tokens
 *   2. Compute time   — server-side CPU cost approximation
 *
 * When token counts are not known (most runners don't report them today),
 * the estimator derives them from duration using heuristics:
 *   - input_tokens  ≈ 1 000 tokens per second of execution
 *   - output_tokens ≈   200 tokens per second of execution
 *
 * These heuristics are conservative and designed for LLM-heavy pipelines.
 * Pass real token counts from the runner result to get precise figures.
 */

// ── Model pricing (USD per 1 000 tokens) ──────────────────────────────────────

export interface ModelPricing {
  input:  number;  // USD / 1k input tokens
  output: number;  // USD / 1k output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o':              { input: 0.0025,  output: 0.01   },
  'gpt-4o-mini':         { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':         { input: 0.01,    output: 0.03   },
  'gpt-4':               { input: 0.03,    output: 0.06   },
  'gpt-3.5-turbo':       { input: 0.0005,  output: 0.0015 },
  'claude-opus-4-6':     { input: 0.015,   output: 0.075  },
  'claude-sonnet-4-6':   { input: 0.003,   output: 0.015  },
  'claude-haiku-4-5':    { input: 0.00025, output: 0.00125 },
};

// Default pricing when model is unknown
const DEFAULT_PRICING: ModelPricing = MODEL_PRICING['gpt-4o-mini'];

// Server compute cost: $0.018/hour ≈ $0.000005/second
const COMPUTE_COST_PER_SECOND_USD = 0.000005;

// Heuristic token rates when actual counts are unavailable
const HEURISTIC_INPUT_TOKENS_PER_SECOND  = 1000;
const HEURISTIC_OUTPUT_TOKENS_PER_SECOND =  200;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CostEstimate {
  input_tokens:       number;
  output_tokens:      number;
  ai_cost_usd:        number;
  compute_cost_usd:   number;
  estimated_cost_usd: number;
  is_estimated:       boolean;   // true when token counts were inferred from duration
}

// ── Core estimator ────────────────────────────────────────────────────────────

/**
 * Estimates the cost of one job execution.
 *
 * @param model        - Model ID used by the job (from global config or override)
 * @param duration_ms  - Actual execution time in milliseconds
 * @param input_tokens - Actual input tokens consumed (optional — triggers heuristic if absent)
 * @param output_tokens - Actual output tokens generated (optional)
 */
export function estimateJobCost(params: {
  model:          string | null | undefined;
  duration_ms:    number;
  input_tokens?:  number;
  output_tokens?: number;
}): CostEstimate {
  const { model, duration_ms } = params;
  const durationSec = Math.max(0, duration_ms) / 1000;

  const pricing = (model && MODEL_PRICING[model]) ? MODEL_PRICING[model] : DEFAULT_PRICING;

  const isEstimated = params.input_tokens == null || params.output_tokens == null;
  const inputTokens  = params.input_tokens  ?? Math.round(durationSec * HEURISTIC_INPUT_TOKENS_PER_SECOND);
  const outputTokens = params.output_tokens ?? Math.round(durationSec * HEURISTIC_OUTPUT_TOKENS_PER_SECOND);

  const aiCostUsd      = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  const computeCostUsd = durationSec * COMPUTE_COST_PER_SECOND_USD;
  const totalCostUsd   = aiCostUsd + computeCostUsd;

  return {
    input_tokens:       inputTokens,
    output_tokens:      outputTokens,
    ai_cost_usd:        round8(aiCostUsd),
    compute_cost_usd:   round8(computeCostUsd),
    estimated_cost_usd: round8(totalCostUsd),
    is_estimated:       isEstimated,
  };
}

/** Round to 8 decimal places to match NUMERIC(12,8) column precision. */
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

/** Format a USD cost for display: "$0.00042" or "$1.23". */
export function fmtCostUsd(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)  return `$${usd.toFixed(5)}`;
  if (usd < 1)     return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
