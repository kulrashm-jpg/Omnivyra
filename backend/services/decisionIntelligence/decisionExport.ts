/**
 * decisionExport.ts — canonical decision export + adapters (PMF-007R §6).
 *
 * Other modules consume Decision Objects (machine-readable) instead of parsing
 * recommendation text. This provides the canonical export envelope and backward-
 * compatibility adapters both directions: recommendations → decisions (the canonical
 * derivation) and decisions → recommendation text (recommendation text is now a
 * PRESENTATION layer over Decision Objects). Pure/deterministic.
 */

import type { DecisionObject } from './decisionObjectModel';
import { DECISION_SCHEMA_VERSION } from './decisionObjectModel';
import { explainDecision, type DecisionExplanation } from './decisionExplainability';
import { deriveDecisionRelationships, type DecisionRelationship } from './decisionRelationships';
import { mapRecommendationsToDecisions, type DecisionMappingContext } from './decisionMapping';

export interface DecisionExport {
  schemaVersion: string;
  exportedAt: string;
  companyId: string;
  count: number;
  decisions: Array<DecisionObject & { explanation: DecisionExplanation }>;
  relationships: DecisionRelationship[];
}

export interface ExportOptions {
  companyId: string;
  exportedAt: string;
  includeExplanations?: boolean; // default true
  includeRelationships?: boolean; // default true
}

/** Build the canonical, machine-readable decision export. Deterministic. */
export function exportDecisions(decisions: DecisionObject[], opts: ExportOptions): DecisionExport {
  const withExpl = decisions.map((d) => ({ ...d, explanation: (opts.includeExplanations === false ? undefined : explainDecision(d)) as DecisionExplanation }));
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    exportedAt: opts.exportedAt,
    companyId: opts.companyId,
    count: decisions.length,
    decisions: withExpl,
    relationships: opts.includeRelationships === false ? [] : deriveDecisionRelationships(decisions),
  };
}

/** Canonical derivation: a served recommendation result → Decision Objects. Re-export. */
export { mapRecommendationsToDecisions as recommendationResultToDecisions };

/**
 * Backward-compat adapter: Decision Objects → recommendation-style text lines. This is
 * the presentation layer over Decision Objects — a consumer that still wants text gets
 * it from the canonical decisions rather than the reverse. Deterministic.
 */
export function decisionsToRecommendationText(decisions: DecisionObject[]): string[] {
  return decisions
    .slice()
    .sort((a, b) => a.priority - b.priority || a.decisionId.localeCompare(b.decisionId))
    .map((d) => `[${d.businessImpact.toUpperCase()}] ${d.title} — ${d.recommendedAction} (confidence ${d.confidence}, ${d.urgency} urgency)`);
}

/** Build a full export directly from a recommendation result. Convenience. Deterministic. */
export function exportFromRecommendationResult(result: unknown, ctx: DecisionMappingContext & { exportedAt: string }): DecisionExport {
  const decisions = mapRecommendationsToDecisions(result, ctx);
  return exportDecisions(decisions, { companyId: ctx.companyId, exportedAt: ctx.exportedAt });
}
