/**
 * OI-C314 — Canonical Offering Intelligence Assembly (the ONE owner). Orchestrates every engine + the
 * seed-adoption baseline, merges evidence/contributions/facets/edges/reasoning, and calls the
 * canonical `buildOfferingUnderstanding` (score blend + contradiction detection) + one
 * `projectOffering`. No engine assembles independently; no engine owns Offering Understanding.
 * Deterministic (asOf-anchored).
 */

import type { OfferingIntelligenceContext, OfferingEngineOutput } from './engineTypes';
import { runFeature, runPricing, runPackaging, runPositioning } from './intrinsic1';
import { runIntegration, runCompliance, runCategoryCapability } from './intrinsic2';
import { runMarketFit, runPersona, runAdoption, runLifecycle, runCompetitive } from './market';
import { runCrossEngine } from './crossEngine';
import { buildOfferingUnderstanding } from '../builder';
import { projectOffering } from '../projection';
import { offeringFromSeed } from '../fromSeed';
import { OFFERING_FACET_NAMES } from '../types';
import type { OfferingUnderstanding, OfferingProjection, OfferingFacets, OfferingFacetName } from '../types';
import { normalizeEvidence } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

export interface OfferingAssemblyResult { understanding: OfferingUnderstanding; projection: OfferingProjection; engines: OfferingEngineOutput[]; }

/** Merge facet fragments (seed baseline + engines): per facet, highest-confidence non-null wins. */
function mergeFacets(fragments: Array<Partial<OfferingFacets>>): Partial<OfferingFacets> {
  const merged = {} as Partial<OfferingFacets>;
  for (const name of OFFERING_FACET_NAMES) {
    let best: OfferingFacets[OfferingFacetName] | undefined;
    for (const frag of fragments) { const f = frag[name]; if (!f || f.value === null) continue; if (!best || f.confidence > best.confidence) best = f; }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleOfferingUnderstanding(ctx: OfferingIntelligenceContext): OfferingAssemblyResult {
  const primaries: OfferingEngineOutput[] = [
    runFeature(ctx), runPricing(ctx), runPackaging(ctx), runPositioning(ctx),
    runIntegration(ctx), runCompliance(ctx), runCategoryCapability(ctx),
    runMarketFit(ctx), runPersona(ctx), runAdoption(ctx), runLifecycle(ctx), runCompetitive(ctx),
  ];
  const derived: OfferingEngineOutput[] = [runCrossEngine(primaries, ctx)];
  const engines = [...primaries, ...derived];

  const baseline = ctx.seed ? offeringFromSeed(ctx.seed) : { key: ctx.key, facets: {}, evidence: [] as EvidenceRef[], offeringType: undefined };
  const evidence = normalizeEvidence([...baseline.evidence, ...engines.flatMap((e) => e.evidence)]);
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = engines.flatMap((e) => e.edges);
  const reasoning = engines.flatMap((e) => e.reasoning);
  const facets = mergeFacets([baseline.facets, ...engines.map((e) => e.facets)]);

  const key = ctx.seed ? baseline.key : ctx.key;
  const understanding = buildOfferingUnderstanding({ key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, edges, offeringType: baseline.offeringType });
  const projection = projectOffering(understanding, ctx.asOf);
  return { understanding, projection, engines };
}
