/**
 * decisionIntelligenceService.ts — the canonical Decision Intelligence entry (PMF-007R).
 *
 * Produces canonical Decision Objects from a served recommendation result: map →
 * telemetry → events → export. This is the single façade future platform capabilities
 * call to consume decisions instead of parsing recommendation text. Additive,
 * deterministic (injected clock), fail-safe.
 */

import type { DecisionObject } from './decisionObjectModel';
import { mapRecommendationsToDecisions } from './decisionMapping';
import { exportDecisions, type DecisionExport } from './decisionExport';
import { recordDecisionTelemetry } from './decisionObservability';
import { emitDecisionEvent, resolveDecisionCorrelationId } from './decisionEvents';

export interface ProduceDecisionsContext {
  companyId: string;
  knowledgeVersion: number | null;
  createdAt: string;
  runtime?: 'platform' | 'legacy';
  correlationId?: string;
  /** Emit DecisionCreated events (default true). */
  emitEvents?: boolean;
  /** Record decision telemetry (default true). */
  recordTelemetry?: boolean;
}

export interface ProducedDecisions {
  decisions: DecisionObject[];
  export: DecisionExport;
}

/**
 * Derive canonical Decision Objects from a recommendation result. Never throws
 * (returns an empty set on failure); additive — does not touch the recommendation.
 */
export async function produceDecisionsFromRecommendation(result: unknown, ctx: ProduceDecisionsContext): Promise<ProducedDecisions> {
  try {
    const decisions = mapRecommendationsToDecisions(result, {
      companyId: ctx.companyId, knowledgeVersion: ctx.knowledgeVersion, runtime: ctx.runtime, createdAt: ctx.createdAt,
    });
    const exp = exportDecisions(decisions, { companyId: ctx.companyId, exportedAt: ctx.createdAt });

    if (ctx.recordTelemetry !== false) recordDecisionTelemetry(decisions);
    if (ctx.emitEvents !== false && decisions.length) {
      const cid = ctx.correlationId ?? (await resolveDecisionCorrelationId(null, ctx.companyId));
      for (const d of decisions) {
        void emitDecisionEvent({ event: 'DecisionCreated', outcome: 'allowed', correlationId: cid, companyId: ctx.companyId, decisionId: d.decisionId, decisionType: d.decisionType });
      }
    }
    return { decisions, export: exp };
  } catch {
    return { decisions: [], export: { schemaVersion: '1.0', exportedAt: ctx.createdAt, companyId: ctx.companyId, count: 0, decisions: [], relationships: [] } };
  }
}
