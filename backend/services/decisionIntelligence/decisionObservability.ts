/**
 * decisionObservability.ts — decision observability (PMF-007R §8).
 *
 * A deterministic read model + fail-safe telemetry over a decision set: decision
 * count, priority distribution, confidence distribution, decision age, the
 * relationship graph, and consumption metrics. Read-only; reuses the HARDEN-001
 * registry. Pure projection (given an injected `now` for age).
 */

import { recordRawCounter } from '../../observability';
import type { DecisionObject } from './decisionObjectModel';
import { deriveDecisionRelationships, type RelationshipType } from './decisionRelationships';

export interface DecisionSnapshot {
  count: number;
  byImpact: Record<string, number>;
  byStatus: Record<string, number>;
  confidenceDistribution: { high: number; medium: number; low: number };
  ageMs: { min: number | null; max: number | null; avg: number | null };
  relationshipCounts: Record<RelationshipType, number>;
  relationshipTotal: number;
}

function confBucket(c: number): 'high' | 'medium' | 'low' {
  return c >= 80 ? 'high' : c >= 50 ? 'medium' : 'low';
}

/** Build the decision snapshot. Read-only; deterministic (given `nowMs`). */
export function buildDecisionSnapshot(decisions: DecisionObject[], nowMs: number): DecisionSnapshot {
  const byImpact: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const confidenceDistribution = { high: 0, medium: 0, low: 0 };
  const ages: number[] = [];

  for (const d of decisions) {
    byImpact[d.businessImpact] = (byImpact[d.businessImpact] ?? 0) + 1;
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    confidenceDistribution[confBucket(d.confidence)]++;
    const created = Date.parse(d.createdAt);
    if (Number.isFinite(created)) ages.push(Math.max(0, nowMs - created));
  }

  const rels = deriveDecisionRelationships(decisions);
  const relationshipCounts = { blocks: 0, depends_on: 0, supersedes: 0, duplicates: 0, conflicts_with: 0, related_to: 0 } as Record<RelationshipType, number>;
  for (const r of rels) relationshipCounts[r.type]++;

  return {
    count: decisions.length,
    byImpact, byStatus, confidenceDistribution,
    ageMs: ages.length ? { min: Math.min(...ages), max: Math.max(...ages), avg: Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) } : { min: null, max: null, avg: null },
    relationshipCounts, relationshipTotal: rels.length,
  };
}

/** §8 — record decision telemetry (count, priority/confidence distribution). Fail-safe. */
export function recordDecisionTelemetry(decisions: DecisionObject[]): void {
  try {
    recordRawCounter('decision.count', decisions.length, {});
    for (const d of decisions) {
      recordRawCounter('decision.priority_distribution', 1, { impact: d.businessImpact });
      recordRawCounter('decision.confidence_distribution', 1, { bucket: confBucket(d.confidence) });
    }
  } catch { /* fail-safe */ }
}

/** §8 — record a decision-consumption observation (a downstream module consumed decisions). Fail-safe. */
export function recordDecisionConsumption(consumer: string, count: number): void {
  try { recordRawCounter('decision.consumption', count, { consumer }); } catch { /* fail-safe */ }
}
