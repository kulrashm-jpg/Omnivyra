/**
 * V-C308 — Visitor Consumer Readiness (pure; assessment only). Verifies Visitor Understanding is ready
 * to serve as the canonical UPSTREAM source for future downstream programs (Journey / Intent /
 * Qualification / Opportunity / Decision / Customer / Automation) — WITHOUT implementing any of them.
 * Readiness = the visitor satisfies the platform's consumption surface: structural CanonicalEntity
 * shape, references-only graph publication, deterministic assembly, valid explainable reasoning, and a
 * stable projection. Each downstream consumes identically through the unmodified Platform API, so a
 * single structural readiness gates them all.
 */

import type { VisitorIntelligenceContext } from './engineTypes';
import { assembleVisitorIntelligence } from './assembly';
import { validateVisitorCrossUnderstanding } from './crossUnderstanding';
import { validateReasoning } from '../../intelligence/canonical';

export const VISITOR_DOWNSTREAM_CONSUMERS = ['journey', 'intent', 'qualification', 'opportunity', 'decision', 'customer', 'automation'] as const;
export type VisitorDownstreamConsumer = typeof VISITOR_DOWNSTREAM_CONSUMERS[number];

export interface VisitorConsumerReadiness {
  exposesCanonicalSurface: boolean;   // {graph, reasoning, contradictions, builtAt} — a CanonicalEntityUnderstanding
  referencesOnly: boolean;
  deterministic: boolean;
  explainable: boolean;
  projectable: boolean;
  graphCitizen: boolean;              // visitor root + references-only edges (traversable by the platform)
  consumers: Record<VisitorDownstreamConsumer, boolean>;
  ready: boolean;
}

export function assessVisitorConsumerReadiness(ctx: VisitorIntelligenceContext): VisitorConsumerReadiness {
  const a = assembleVisitorIntelligence(ctx);
  const b = assembleVisitorIntelligence(ctx);
  const u = a.understanding;

  const exposesCanonicalSurface = !!u.graph?.root && Array.isArray(u.graph.edges) && Array.isArray(u.reasoning) && Array.isArray(u.contradictions) && typeof u.builtAt === 'string';
  const cross = validateVisitorCrossUnderstanding(u);
  const referencesOnly = cross.referencesOnly && cross.ownsNoForeignNode;
  const deterministic = JSON.stringify(a.understanding) === JSON.stringify(b.understanding);
  const explainable = u.reasoning.every((t) => validateReasoning(t).valid);
  const projectable = a.projection.key.visitorId === u.key.visitorId;
  const graphCitizen = u.graph.root.type === 'visitor' && u.graph.edges.every((e) => e.from.type === 'visitor');

  const ready = exposesCanonicalSurface && referencesOnly && deterministic && explainable && projectable && graphCitizen;
  const consumers = Object.fromEntries(VISITOR_DOWNSTREAM_CONSUMERS.map((c) => [c, ready])) as Record<VisitorDownstreamConsumer, boolean>;
  return { exposesCanonicalSurface, referencesOnly, deterministic, explainable, projectable, graphCitizen, consumers, ready };
}
