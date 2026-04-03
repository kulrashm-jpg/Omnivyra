/**
 * Shared decision-ranking utilities for report services.
 *
 * These three functions were duplicated verbatim in snapshotReportService,
 * performanceReportService, and growthReportService. Single source of truth here.
 */

import type { PersistedDecisionObject } from './decisionObjectService';

export function impactScore(decision: PersistedDecisionObject): number {
  return Math.max(
    Number(decision.impact_traffic ?? 0),
    Number(decision.impact_conversion ?? 0),
    Number(decision.impact_revenue ?? 0),
  );
}

export function rankByImpactConfidence(
  a: PersistedDecisionObject,
  b: PersistedDecisionObject,
): number {
  const impactDelta = impactScore(b) - impactScore(a);
  if (impactDelta !== 0) return impactDelta;
  const confidenceDelta =
    Number(b.confidence_score ?? 0) - Number(a.confidence_score ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  return Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0);
}

export function isOpportunitySignal(decision: PersistedDecisionObject): boolean {
  const text =
    `${decision.title} ${decision.description} ${decision.recommendation}`.toLowerCase();
  return /(opportun|improv|scale|expand|grow|capture|optimiz|leverage|uplift|increase)/i.test(
    text,
  );
}
