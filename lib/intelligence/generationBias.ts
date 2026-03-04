/**
 * Predictive Generation Bias — additive prompt guidance from strategic memory.
 * Safe v1: no model change, no prompt rewrite; only extra instruction appended when signals are strong.
 */

import type { StrategicMemoryProfile } from './strategicMemory';

const CTA_HIGH_ACCEPTANCE = 0.7;
const DISCOVERABILITY_HIGH_ACCEPTANCE = 0.7;
const HOOK_LOW_ACCEPTANCE = 0.3;

const CTA_INSTRUCTION = 'Ensure the content ends with a clear, strong call-to-action.';
const DISCOVERABILITY_INSTRUCTION = 'Include strong keyword signals and relevant hashtags.';
const HOOK_INSTRUCTION = 'Keep the opening natural; avoid overly aggressive hooks.';

export interface GenerationBiasResult {
  extra_instruction?: string;
}

/**
 * Derives optional extra instruction from action acceptance rates.
 * Only returns non-empty when profile has strong signals; no profile or weak signals → no bias.
 */
export function deriveGenerationBias(
  profile?: StrategicMemoryProfile | null
): GenerationBiasResult {
  if (!profile?.action_acceptance_rate || typeof profile.action_acceptance_rate !== 'object') {
    return {};
  }

  const rate = profile.action_acceptance_rate;
  const parts: string[] = [];

  const cta = Number(rate.IMPROVE_CTA);
  if (Number.isFinite(cta) && cta > CTA_HIGH_ACCEPTANCE) {
    parts.push(CTA_INSTRUCTION);
  }

  const discoverability = Number(rate.ADD_DISCOVERABILITY);
  if (Number.isFinite(discoverability) && discoverability > DISCOVERABILITY_HIGH_ACCEPTANCE) {
    parts.push(DISCOVERABILITY_INSTRUCTION);
  }

  const hook = Number(rate.IMPROVE_HOOK);
  if (Number.isFinite(hook) && hook < HOOK_LOW_ACCEPTANCE) {
    parts.push(HOOK_INSTRUCTION);
  }

  const extra_instruction = parts.length > 0 ? parts.join(' ') : undefined;
  return extra_instruction ? { extra_instruction } : {};
}

export interface ActiveGenerationBiasFlags {
  cta_bias: boolean;
  discoverability_bias: boolean;
  hook_softening_bias: boolean;
}

/**
 * Returns which generation biases are active for observability (read-only).
 * Same thresholds as deriveGenerationBias.
 */
export function getActiveGenerationBiasFlags(
  profile?: StrategicMemoryProfile | null
): ActiveGenerationBiasFlags {
  if (!profile?.action_acceptance_rate || typeof profile.action_acceptance_rate !== 'object') {
    return { cta_bias: false, discoverability_bias: false, hook_softening_bias: false };
  }
  const rate = profile.action_acceptance_rate;
  const cta = Number(rate.IMPROVE_CTA);
  const discoverability = Number(rate.ADD_DISCOVERABILITY);
  const hook = Number(rate.IMPROVE_HOOK);
  return {
    cta_bias: Number.isFinite(cta) && cta > CTA_HIGH_ACCEPTANCE,
    discoverability_bias: Number.isFinite(discoverability) && discoverability > DISCOVERABILITY_HIGH_ACCEPTANCE,
    hook_softening_bias: Number.isFinite(hook) && hook < HOOK_LOW_ACCEPTANCE,
  };
}
