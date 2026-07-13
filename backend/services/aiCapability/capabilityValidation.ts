/**
 * capabilityValidation.ts — the ONE validation framework (AIC-001 §6).
 *
 * A single layer for schema, business, grounding, hallucination, confidence, and
 * policy validation. No capability-specific validators. Built-in checks are pure
 * and deterministic; business/policy rules are injected per capability so custom
 * rules compose through this framework rather than around it.
 */

import type {
  CapabilitySource, ValidationCheck, ValidationSummary,
} from './capabilityContracts';
import type { CapabilityDefinition } from './capabilityRegistry';

/** Required top-level keys per output contract (schema validation). */
export const OUTPUT_CONTRACTS: Record<string, string[]> = {
  content: ['body'],
  plan: ['items'],
  analysis: ['summary'],
  recommendations: ['recommendations'],
};

/** A custom rule returns null when satisfied, or a failure message. Pure/deterministic. */
export type CapabilityRule = (result: unknown, ctx: ValidationContext) => string | null;

export interface ValidationContext {
  sources: CapabilitySource[];
  confidence: number;
  input: Record<string, unknown>;
  knowledgeAvailable: boolean;
}

export interface ValidationRules {
  business?: CapabilityRule;
  policy?: CapabilityRule;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function nonEmpty(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true;
}

/** Deterministically validate a capability's output. Never throws. */
export function validateCapabilityOutput(
  def: CapabilityDefinition,
  result: unknown,
  ctx: ValidationContext,
  rules: ValidationRules = {},
): ValidationSummary {
  const v = def.validation;
  const checks: ValidationCheck[] = [];
  const required = OUTPUT_CONTRACTS[def.outputContract] ?? [];

  // §6 — schema: result is an object with all required keys present + non-empty.
  if (v.schema) {
    const obj = isPlainObject(result) ? result : null;
    const missing = obj ? required.filter((k) => !(k in obj) || !nonEmpty(obj[k])) : required.slice();
    checks.push({ name: `schema:${def.outputContract}`, kind: 'schema', ok: !!obj && missing.length === 0, message: obj ? (missing.length ? `missing/empty: ${missing.join(',')}` : null) : 'result_not_object' });
  }

  // §6 — grounding: an output must be backed by at least one source.
  if (v.grounding) {
    checks.push({ name: 'grounding:sources', kind: 'grounding', ok: ctx.sources.length > 0, message: ctx.sources.length ? null : 'no_sources' });
  }

  // §6 — hallucination: required keys must be non-empty (no fabricated-empty payload)
  // and the payload must not be wholly empty.
  if (v.hallucination) {
    const obj = isPlainObject(result) ? result : null;
    const emptyPayload = !obj || Object.keys(obj).length === 0;
    checks.push({ name: 'hallucination:non_empty', kind: 'hallucination', ok: !emptyPayload, message: emptyPayload ? 'empty_payload' : null });
  }

  // §6 — confidence threshold.
  checks.push({ name: 'confidence:threshold', kind: 'confidence', ok: ctx.confidence >= v.confidenceThreshold, message: ctx.confidence >= v.confidenceThreshold ? null : `below_${v.confidenceThreshold}` });

  // §6 — business rule (injected; only when enabled).
  if (v.business && rules.business) {
    const msg = rules.business(result, ctx);
    checks.push({ name: 'business:rule', kind: 'business', ok: msg == null, message: msg });
  }

  // §6 — policy rule (injected; only when enabled).
  if (v.policy && rules.policy) {
    const msg = rules.policy(result, ctx);
    checks.push({ name: 'policy:rule', kind: 'policy', ok: msg == null, message: msg });
  }

  const failures = checks.filter((c) => !c.ok).length;
  return { ok: failures === 0, checks, failures };
}
