/**
 * Deterministic cohort funnel engine — per-cohort continuity.
 *
 * Phase 6H — the data-acquisition layer and the (unchanged) per-cohort funnel
 * analysis now live in the Canonical Lead Intelligence Repository
 * (cohortFunnelRepository). This module no longer queries campaign_touchpoints /
 * leads / visitor_sessions / audit_events directly; it delegates entirely to the
 * repository and re-exports the contract types for back-compat. Funnel behaviour
 * is byte-identical (cohort keying, the five-stage walk, dropoff, attribution
 * breaks, revenue lineage, confidence, ordering, top-100 cap).
 */

import {
  getCohortFunnelIntelligence,
  type CohortKind,
  type CohortFunnelReport,
} from '../leadIntelligence/cohortFunnelRepository';

export type {
  CohortKind,
  CohortStage,
  CohortStageCount,
  Cohort,
  CohortFunnelReport,
} from '../leadIntelligence/cohortFunnelRepository';

export async function buildCohortFunnelReport(
  companyId: string,
  kind: CohortKind = 'session',
): Promise<CohortFunnelReport> {
  return getCohortFunnelIntelligence(companyId, kind);
}
