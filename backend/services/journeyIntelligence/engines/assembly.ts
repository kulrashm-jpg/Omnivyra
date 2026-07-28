/**
 * J-C (assembly) — Canonical Journey Intelligence Assembly (the ONE owner). Orchestrates every Phase-C
 * enrichment engine over the Phase-B ingestion baseline, merges evidence/contributions/facets/reasoning,
 * and calls the canonical `buildJourneyUnderstanding` (score blend + contradiction detection) + one
 * `projectJourney` + the health summary. No engine assembles independently; no engine owns Journey
 * Understanding. Deterministic (asOf-anchored).
 */

import type { JourneyIntelligenceContext, JourneyEngineOutput } from './engineTypes';
import { runProgression } from './progression';
import { runMomentum } from './momentum';
import { runContinuity } from './continuity';
import { runCompletion } from './completion';
import { runMilestone } from './milestone';
import { runTransition } from './transition';
import { journeyHealthSummary, type JourneyHealthSummary } from './healthSummary';
import { buildJourneyUnderstanding } from '../builder';
import { projectJourney } from '../projection';
import { journeyFromRaw } from '../fromRaw';
import { JOURNEY_FACET_NAMES } from '../types';
import type { JourneyUnderstanding, JourneyProjection, JourneyFacets, JourneyFacetName } from '../types';
import { normalizeEvidence } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

export interface JourneyAssemblyResult {
  understanding: JourneyUnderstanding;
  projection: JourneyProjection;
  engines: JourneyEngineOutput[];
  health: JourneyHealthSummary;
}

/** Merge facet fragments (baseline + engines): per facet, highest-confidence non-null wins. */
function mergeFacets(fragments: Array<Partial<JourneyFacets>>): Partial<JourneyFacets> {
  const merged = {} as Partial<JourneyFacets>;
  for (const name of JOURNEY_FACET_NAMES) {
    let best: JourneyFacets[JourneyFacetName] | undefined;
    for (const frag of fragments) { const f = frag[name]; if (!f || f.value === null) continue; if (!best || f.confidence > best.confidence) best = f; }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleJourneyIntelligence(ctx: JourneyIntelligenceContext): JourneyAssemblyResult {
  const engines: JourneyEngineOutput[] = [
    runProgression(ctx), runMomentum(ctx), runContinuity(ctx), runCompletion(ctx), runMilestone(ctx), runTransition(ctx),
  ];

  const baseline = ctx.raw ? journeyFromRaw(ctx.raw) : { key: ctx.key, facets: {} as Partial<JourneyFacets>, evidence: [] as EvidenceRef[], edges: [] as GraphEdge[] };
  const evidence = normalizeEvidence([...baseline.evidence, ...engines.flatMap((e) => e.evidence)]);
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = baseline.edges;                            // references-only edges from Phase-B ingestion (unchanged)
  const reasoning = engines.flatMap((e) => e.reasoning);
  const facets = mergeFacets([baseline.facets, ...engines.map((e) => e.facets)]);

  const key = ctx.raw ? baseline.key : ctx.key;
  const understanding = buildJourneyUnderstanding({ key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, edges });
  const projection = projectJourney(understanding, ctx.asOf);
  const health = journeyHealthSummary(understanding);
  return { understanding, projection, engines, health };
}
