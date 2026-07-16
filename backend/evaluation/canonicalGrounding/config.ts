/**
 * RF-3A — configurable execution parameters + classification rules.
 * Everything an operator may tune lives here (rules are CONFIGURABLE, not
 * hard-coded in the classifier). Env overrides are read once, deterministically.
 */
import type { ExecutionParams, ClassificationConfig } from './types';

/** Held-constant across Run A (legacy) and Run B (canonical) — identical params. */
export const DEFAULT_EXECUTION_PARAMS: ExecutionParams = {
  provider: process.env.EVAL_PROVIDER || 'openai',
  model: process.env.EVAL_MODEL || 'gpt-4o-mini',
  temperature: Number(process.env.EVAL_TEMPERATURE ?? 0),
  seed: Number(process.env.EVAL_SEED ?? 1_729),
  maxRetries: Number(process.env.EVAL_MAX_RETRIES ?? 0),
  timeoutMs: Number(process.env.EVAL_TIMEOUT_MS ?? 30_000),
  charsPerToken: Number(process.env.EVAL_CHARS_PER_TOKEN ?? 4),
  costPer1kTokens: Number(process.env.EVAL_COST_PER_1K ?? 0.00015), // gpt-4o-mini input est.
};

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  maxOverwritesForEnforce: Number(process.env.EVAL_MAX_OVERWRITES ?? 0),
  maxPromptGrowthRatioForEnforce: Number(process.env.EVAL_MAX_PROMPT_GROWTH ?? 0.25),
  maxCostDeltaUsdForEnforce: Number(process.env.EVAL_MAX_COST_DELTA ?? 0.01),
  requireDeterministic: (process.env.EVAL_REQUIRE_DETERMINISTIC ?? 'true') !== 'false',
  requireQualityForEnforce: (process.env.EVAL_REQUIRE_QUALITY ?? 'true') !== 'false',
};
