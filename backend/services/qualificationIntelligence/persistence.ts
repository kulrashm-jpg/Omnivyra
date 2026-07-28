/**
 * Q-B201 (persistence) — Canonical Qualification persistence contract (pure shape builder; NO writer
 * wired in Phase B). A compat adapter maps the canonical understanding to a legacy qualification-field
 * shape so consumers can be served the projection during adoption — Qualification is the sole owner;
 * consumers reference it.
 */

import type { QualificationUnderstanding, QualificationProjection, QualificationUnderstandingShadowRecord } from './types';

export function toShadowRecord(u: QualificationUnderstanding, projection: QualificationProjection, parity: number | null): QualificationUnderstandingShadowRecord {
  return { company_id: u.key.companyId, qualification_id: u.key.qualificationId, version: u.version, understanding: u, projection, parity, built_at: u.builtAt };
}

export interface LegacyQualificationFields {
  company_id: string; qualification_id: string;
  actor_ref: string | null; actor_type: string | null; object_ref: string | null;
  status: string | null; policy_id: string | null; policy_version: number | null;
  satisfied: string[]; unsatisfied: string[]; abstained: boolean; confidence: number;
}
export function toLegacyFields(u: QualificationUnderstanding): LegacyQualificationFields {
  const id = u.facets.identity.value;
  const conf = u.facets.confidence.value;
  const evalv = u.facets.evaluation.value;
  return {
    company_id: u.key.companyId,
    qualification_id: u.key.qualificationId,
    actor_ref: id?.actorRef ?? null,
    actor_type: id?.actorType ?? null,
    object_ref: id?.objectRef ?? null,
    status: u.facets.state.value?.status ?? null,
    policy_id: u.facets.policy.value?.policyId ?? null,
    policy_version: u.facets.policy.value?.policyVersion ?? null,
    satisfied: evalv?.satisfied ?? [],
    unsatisfied: evalv?.unsatisfied ?? [],
    abstained: conf?.abstained ?? u.facets.state.value?.status == null,
    confidence: conf?.confidence ?? u.score.confidence,
  };
}
