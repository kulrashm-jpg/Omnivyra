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
