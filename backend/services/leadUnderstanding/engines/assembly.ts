/**
 * LI-C209 — Canonical Lead Intelligence Assembly (the ONE owner).
 * Orchestrates every engine, merges their evidence/contributions/facets/edges/reasoning, and calls
 * the canonical `buildLeadUnderstanding` (which combines scores + detects contradictions) + a single
 * `projectLead`. NO engine assembles independently; NO engine owns the Understanding or projection.
 * Deterministic (asOf drives builtAt/projectedAt).
 */

import type { LeadIntelligenceContext, EngineOutput } from './engineTypes';
import { runPersonaIcp } from './personaIcp';
import { runBuyingSignal } from './buyingSignal';
import { runIntent } from './intent';
import { runRelationship } from './relationship';
import { runQualification } from './qualification';
import { runPrioritization } from './prioritization';
import { runRecommendation } from './recommendation';
import { runCrossEngine } from './crossEngine';
import { buildLeadUnderstanding } from '../projection';
import { projectLead } from '../projection';
import { buildLeadGraph, node } from '../graph';
import { normalizeEvidence } from '../evidence';
import { nullFacet } from '../facets';
import { LEAD_FACET_NAMES } from '../types';
import type { LeadUnderstanding, LeadProjection, LeadFacets, LeadFacetName, EvidenceRef, GraphEdge } from '../types';

export interface AssemblyResult { understanding: LeadUnderstanding; projection: LeadProjection; engines: EngineOutput[]; }

/** Merge facet fragments across engines: per facet, the highest-confidence non-null wins (deterministic). */
function mergeFacets(engines: EngineOutput[]): Partial<LeadFacets> {
  const merged = {} as Partial<LeadFacets>;
  for (const name of LEAD_FACET_NAMES) {
    let best: LeadFacets[LeadFacetName] | undefined;
    for (const e of engines) {
      const f = e.facets[name];
      if (!f || f.value === null) continue;
      if (!best || f.confidence > best.confidence || (f.confidence === best.confidence && e.engine < '￿')) best = f;
    }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleLeadUnderstanding(ctx: LeadIntelligenceContext): AssemblyResult {
  // 1 — primary engines (independent evidence producers).
  const primaries: EngineOutput[] = [
    runPersonaIcp(ctx), runBuyingSignal(ctx), runIntent(ctx), runRelationship(ctx), runQualification(ctx),
  ];
  // 2 — derived engines (synthesize evidence the primaries already produced).
  const derived: EngineOutput[] = [
    runPrioritization(primaries, ctx), runRecommendation(primaries, ctx), runCrossEngine(primaries, ctx),
  ];
  const engines = [...primaries, ...derived];

  // 3 — merge (dedupe evidence, flatten contributions/edges/reasoning, resolve facets by confidence).
  const evidence: EvidenceRef[] = normalizeEvidence(engines.flatMap((e) => e.evidence));
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = engines.flatMap((e) => e.edges);
  const reasoning = engines.flatMap((e) => e.reasoning);
  const facets: Partial<LeadFacets> = mergeFacets(engines);
  const graph = buildLeadGraph(node('lead', ctx.key.leadKey), edges);

  // 4 — the ONE canonical owner builds the Understanding + projection.
  const understanding = buildLeadUnderstanding({ key: ctx.key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, graph });
  const projection = projectLead(understanding, ctx.asOf);
  return { understanding, projection, engines };
}

export { nullFacet }; // re-export for consumers that want the abstain primitive
