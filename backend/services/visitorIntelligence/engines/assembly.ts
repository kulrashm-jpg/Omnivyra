/**
 * V-B (assembly) — Canonical Visitor Intelligence Assembly (the ONE owner). Orchestrates every Phase-B
 * enrichment engine over the Phase-A ingestion baseline, merges evidence/contributions/facets/edges/
 * reasoning, and calls the canonical `buildVisitorUnderstanding` (score blend + contradiction
 * detection) + one `projectVisitor` + the health summary + the confidence framework. No engine
 * assembles independently; no engine owns Visitor Understanding. Deterministic (asOf-anchored).
 */

import type { VisitorIntelligenceContext, VisitorEngineOutput } from './engineTypes';
import { runBehavioral } from './behavioral';
import { runEngagement } from './engagement';
import { runSession } from './session';
import { runActivityPattern } from './activityPattern';
import { runAcquisition } from './acquisition';
import { visitorConfidence, type VisitorConfidence } from './confidence';
import { visitorHealthSummary, type VisitorHealthSummary } from './healthSummary';
import { buildVisitorUnderstanding } from '../builder';
import { projectVisitor } from '../projection';
import { visitorFromRaw } from '../fromRaw';
import { VISITOR_FACET_NAMES } from '../types';
import type { VisitorUnderstanding, VisitorProjection, VisitorFacets, VisitorFacetName } from '../types';
import { normalizeEvidence } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

export interface VisitorAssemblyResult {
  understanding: VisitorUnderstanding;
  projection: VisitorProjection;
  engines: VisitorEngineOutput[];
  health: VisitorHealthSummary;
  confidence: VisitorConfidence;
}

/** Merge facet fragments (baseline + engines): per facet, highest-confidence non-null wins. */
function mergeFacets(fragments: Array<Partial<VisitorFacets>>): Partial<VisitorFacets> {
  const merged = {} as Partial<VisitorFacets>;
  for (const name of VISITOR_FACET_NAMES) {
    let best: VisitorFacets[VisitorFacetName] | undefined;
    for (const frag of fragments) { const f = frag[name]; if (!f || f.value === null) continue; if (!best || f.confidence > best.confidence) best = f; }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleVisitorIntelligence(ctx: VisitorIntelligenceContext): VisitorAssemblyResult {
  const engines: VisitorEngineOutput[] = [
    runBehavioral(ctx), runEngagement(ctx), runSession(ctx), runActivityPattern(ctx), runAcquisition(ctx),
  ];

  const baseline = ctx.raw ? visitorFromRaw(ctx.raw) : { key: ctx.key, facets: {} as Partial<VisitorFacets>, evidence: [] as EvidenceRef[], edges: [] as GraphEdge[] };
  const evidence = normalizeEvidence([...baseline.evidence, ...engines.flatMap((e) => e.evidence)]);
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = [...baseline.edges, ...engines.flatMap((e) => e.edges)];
  const reasoning = engines.flatMap((e) => e.reasoning);
  const facets = mergeFacets([baseline.facets, ...engines.map((e) => e.facets)]);

  const key = ctx.raw ? baseline.key : ctx.key;
  const understanding = buildVisitorUnderstanding({ key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, edges });
  const projection = projectVisitor(understanding, ctx.asOf);
  const health = visitorHealthSummary(understanding, ctx.asOf);
  const confidence = visitorConfidence(evidence, understanding.contradictions, ctx.asOf);
  return { understanding, projection, engines, health, confidence };
}
