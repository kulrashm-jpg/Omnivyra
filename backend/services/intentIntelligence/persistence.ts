/**
 * I-B201 (persistence) — Canonical Intent persistence contract (pure shape builder; NO writer wired in
 * Phase B). A compat adapter maps the canonical understanding to a legacy intent-field shape so
 * consumers can be served the projection during adoption — Intent is the sole owner; consumers
 * reference it.
 */

import type { IntentUnderstanding, IntentProjection, IntentUnderstandingShadowRecord } from './types';

export function toShadowRecord(u: IntentUnderstanding, projection: IntentProjection, parity: number | null): IntentUnderstandingShadowRecord {
  return { company_id: u.key.companyId, intent_id: u.key.intentId, version: u.version, understanding: u, projection, parity, built_at: u.builtAt };
}

export interface LegacyIntentFields {
  company_id: string; intent_id: string;
  actor_ref: string | null; actor_type: string | null; object_ref: string | null;
  primary_objective: string | null; competing_objectives: string[]; abstained: boolean; confidence: number; uncertainty: number;
}
export function toLegacyFields(u: IntentUnderstanding): LegacyIntentFields {
  const id = u.facets.identity.value;
  const conf = u.facets.confidence.value;
  const primary = u.facets.primaryIntent.value?.objective ?? null;
  return {
    company_id: u.key.companyId,
    intent_id: u.key.intentId,
    actor_ref: id?.actorRef ?? null,
    actor_type: id?.actorType ?? null,
    object_ref: id?.objectRef ?? null,
    primary_objective: primary,
    competing_objectives: (u.facets.competingIntents.value?.candidates ?? []).map((c) => c.objective).filter((o) => o !== primary),
    abstained: conf?.abstained ?? primary === null,
    confidence: conf?.confidence ?? u.score.confidence,
    uncertainty: conf?.uncertainty ?? 1,
  };
}
