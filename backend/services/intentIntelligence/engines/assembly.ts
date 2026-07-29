/**
 * I-C (assembly) — Canonical Intent Intelligence Assembly (the ONE owner). Orchestrates every Phase-C
 * enrichment engine over the Phase-B ingestion baseline, merges evidence/contributions/facets/reasoning,
 * and calls the canonical `buildIntentUnderstanding` (score blend + contradiction detection) + one
 * `projectIntent` + the health summary. No engine assembles independently; no engine owns Intent
 * Understanding. Deterministic (asOf-anchored).
 */

import type { IntentIntelligenceContext, IntentEngineOutput } from './engineTypes';
import { runObjective } from './objective';
import { runEvidence } from './evidence';
import { runConfidence } from './confidence';
import { runConflict } from './conflict';
import { runContext } from './context';
import { runInterpretation } from './interpretation';
import { intentHealthSummary, type IntentHealthSummary } from './healthSummary';
import { buildIntentUnderstanding } from '../builder';
import { projectIntent } from '../projection';
import { intentFromEvidence } from '../fromEvidence';
import { INTENT_FACET_NAMES } from '../types';
import type { IntentUnderstanding, IntentProjection, IntentFacets, IntentFacetName } from '../types';
import { normalizeEvidence } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

export interface IntentAssemblyResult {
  understanding: IntentUnderstanding;
  projection: IntentProjection;
  engines: IntentEngineOutput[];
  health: IntentHealthSummary;
}

/** Merge facet fragments (baseline + engines): per facet, highest-confidence non-null wins. */
function mergeFacets(fragments: Array<Partial<IntentFacets>>): Partial<IntentFacets> {
  const merged = {} as Partial<IntentFacets>;
  for (const name of INTENT_FACET_NAMES) {
    let best: IntentFacets[IntentFacetName] | undefined;
    for (const frag of fragments) { const f = frag[name]; if (!f || f.value === null) continue; if (!best || f.confidence > best.confidence) best = f; }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleIntentIntelligence(ctx: IntentIntelligenceContext): IntentAssemblyResult {
  const engines: IntentEngineOutput[] = [
    runObjective(ctx), runEvidence(ctx), runConfidence(ctx), runConflict(ctx), runContext(ctx), runInterpretation(ctx),
  ];

  const baseline = ctx.raw ? intentFromEvidence(ctx.raw) : { key: ctx.key, facets: {} as Partial<IntentFacets>, evidence: [] as EvidenceRef[], edges: [] as GraphEdge[], reasoning: [] };
  const evidence = normalizeEvidence([...baseline.evidence, ...engines.flatMap((e) => e.evidence)]);
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = baseline.edges;                            // references-only edges from Phase-B ingestion (unchanged)
  const reasoning = [...baseline.reasoning, ...engines.flatMap((e) => e.reasoning)];
  const facets = mergeFacets([baseline.facets, ...engines.map((e) => e.facets)]);

  const key = ctx.raw ? baseline.key : ctx.key;
  const understanding = buildIntentUnderstanding({ key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, edges });
  const projection = projectIntent(understanding, ctx.asOf);
  const health = intentHealthSummary(understanding);
  return { understanding, projection, engines, health };
}
