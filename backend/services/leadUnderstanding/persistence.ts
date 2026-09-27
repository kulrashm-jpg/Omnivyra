/**
 * LI-B108 — Canonical persistence contract (pure shape builder; NO writer wired in Phase B).
 * The ONE persistence record for the shadow store `lead_understanding_shadow` (additive migration,
 * dormant). A compatibility adapter maps the canonical understanding to legacy consumer shapes so
 * existing consumers keep working during the shadow → authoritative transition.
 */

import type { LeadUnderstanding, LeadProjection, LeadUnderstandingShadowRecord, LeadCompatAdapter, ScoreDimension } from './types';

/** Build the canonical shadow persistence record (not yet written anywhere — contract only). */
export function toShadowRecord(u: LeadUnderstanding, projection: LeadProjection, parity: number | null): LeadUnderstandingShadowRecord {
  return {
    company_id: u.key.companyId,
    lead_key: u.key.leadKey,
    version: u.version,
    understanding: u,
    projection,
    parity,
    built_at: u.builtAt,
  };
}

/**
 * PI-SCORE-PROVENANCE-001 — the DURABLE evaluation record.
 *
 * `toShadowRecord` above targets `lead_understanding_shadow`, which has never
 * existed as a table: its migration sorts below the baseline's ledger position,
 * so canonical replay skips it and it is absent from production. It stays where
 * it is as the Phase-B contract it was written to be; this is the record that
 * is actually written, and it lives HERE rather than in a new module so there
 * remains ONE persistence shape builder for lead understanding, not two.
 *
 * ─── IT COPIES; IT DOES NOT COMPUTE ───────────────────────────────────────
 * Every score below is read straight off `u.score`. No weight, no threshold, no
 * rounding, no normalisation, no default. A persistence layer that transformed
 * a score would become a second scoring implementation that silently disagrees
 * with the first, and the disagreement would surface as a customer seeing one
 * number in the API and a different one in their history.
 *
 * Nulls are carried through deliberately: an abstained dimension is a refusal to
 * judge, and `?? 0` here would forge a verdict the evaluator declined to give.
 */
export interface ScoreEvaluationRecord {
  readonly organization_id: string;
  readonly prospect_id: string;
  readonly person_id: string | null;
  readonly account_id: string | null;
  readonly icp_id: string | null;
  readonly icp_version: number | null;
  readonly rules_version: string;
  readonly scored_at: string;
  readonly score_intent: number | null;
  readonly score_icp: number | null;
  readonly score_urgency: number | null;
  readonly score_opportunity: number | null;
  readonly score_priority: number | null;
  readonly score_overall: number | null;
  readonly confidence: number;
  readonly contributions: unknown;
  readonly evidence: unknown;
  readonly reasoning: unknown;
  readonly facets: unknown;
  readonly context_gaps: unknown;
  readonly input_digest: string;
}

export interface ScoreEvaluationSubject {
  readonly organizationId: string;
  readonly prospectId: string;
  readonly personId: string | null;
  readonly accountId: string | null;
  readonly icpId: string | null;
  readonly icpVersion: number | null;
  readonly rulesVersion: string;
  readonly asOf: string;
  readonly contextGaps: unknown;
  /** Deterministic digest of the evaluation INPUTS. Supplied, never derived here. */
  readonly inputDigest: string;
}

export function toScoreEvaluationRecord(
  u: LeadUnderstanding,
  subject: ScoreEvaluationSubject,
): ScoreEvaluationRecord {
  const d = u.score.dimensions;
  return {
    organization_id: subject.organizationId,
    prospect_id: subject.prospectId,
    person_id: subject.personId,
    account_id: subject.accountId,
    icp_id: subject.icpId,
    icp_version: subject.icpVersion,
    rules_version: subject.rulesVersion,
    scored_at: subject.asOf,
    score_intent: d.intent.value,
    score_icp: d.icp.value,
    score_urgency: d.urgency.value,
    score_opportunity: d.opportunity.value,
    score_priority: d.priority.value,
    score_overall: u.score.overall,
    confidence: u.score.confidence,
    // The evaluator's own structures, verbatim. Re-shaping them would make the
    // stored explanation differ from the returned one.
    contributions: Object.values(d).map((dim) => ({
      dimension: dim.dimension, value: dim.value, confidence: dim.confidence,
      method: dim.method, contributors: dim.contributors,
      calibrated: dim.calibrated, abstained: dim.abstained,
    })),
    evidence: u.reasoning.flatMap((r) => r.because ?? []),
    reasoning: u.reasoning,
    facets: u.facets,
    context_gaps: subject.contextGaps ?? [],
    input_digest: subject.inputDigest,
  };
}

/**
 * Reference compat adapter: canonical → the legacy `scores` shape consumers read today. Consumers
 * remain operational because they can read this exact shape whether backed by legacy or canonical.
 */
export const legacyScoresAdapter: LeadCompatAdapter<Partial<Record<ScoreDimension | 'total', number | null>>> = {
  fromUnderstanding(u: LeadUnderstanding) {
    return {
      intent: u.score.dimensions.intent.value,
      icp: u.score.dimensions.icp.value,
      urgency: u.score.dimensions.urgency.value,
      opportunity: u.score.dimensions.opportunity.value,
      priority: u.score.dimensions.priority.value,
      total: u.score.overall,
    };
  },
};
