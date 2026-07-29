/**
 * Q-C (assembly) — Canonical Qualification Intelligence Assembly (the ONE owner). Orchestrates every
 * Phase-C enrichment engine over the Phase-B evaluation baseline, merges evidence/contributions/facets/
 * reasoning, and calls the canonical `buildQualificationUnderstanding` (score blend + contradiction
 * detection) + one `projectQualification` + the health summary. No engine assembles independently; no
 * engine owns Qualification Understanding. Deterministic (asOf-anchored).
 */

import type { QualificationIntelligenceContext, QualificationEngineOutput } from './engineTypes';
import { runCriteria } from './criteria';
import { runEvidence } from './evidence';
import { runConfidence } from './confidence';
import { runPolicy } from './policy';
import { runContext } from './context';
import { runEvaluation } from './evaluation';
import { qualificationHealthSummary, type QualificationHealthSummary } from './healthSummary';
import { buildQualificationUnderstanding } from '../builder';
import { projectQualification } from '../projection';
import { qualificationFromPolicy } from '../fromPolicy';
import { QUALIFICATION_FACET_NAMES } from '../types';
import type { QualificationUnderstanding, QualificationProjection, QualificationFacets, QualificationFacetName } from '../types';
import { normalizeEvidence } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

export interface QualificationAssemblyResult {
  understanding: QualificationUnderstanding;
  projection: QualificationProjection;
  engines: QualificationEngineOutput[];
  health: QualificationHealthSummary;
}

/** Merge facet fragments (baseline + engines): per facet, highest-confidence non-null wins. */
function mergeFacets(fragments: Array<Partial<QualificationFacets>>): Partial<QualificationFacets> {
  const merged = {} as Partial<QualificationFacets>;
  for (const name of QUALIFICATION_FACET_NAMES) {
    let best: QualificationFacets[QualificationFacetName] | undefined;
    for (const frag of fragments) { const f = frag[name]; if (!f || f.value === null) continue; if (!best || f.confidence > best.confidence) best = f; }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleQualificationIntelligence(ctx: QualificationIntelligenceContext): QualificationAssemblyResult {
  const engines: QualificationEngineOutput[] = [
    runCriteria(ctx), runEvidence(ctx), runConfidence(ctx), runPolicy(ctx), runContext(ctx), runEvaluation(ctx),
  ];

  const baseline = ctx.raw ? qualificationFromPolicy(ctx.raw) : { key: ctx.key, facets: {} as Partial<QualificationFacets>, evidence: [] as EvidenceRef[], edges: [] as GraphEdge[], reasoning: [] };
  const evidence = normalizeEvidence([...baseline.evidence, ...engines.flatMap((e) => e.evidence)]);
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = baseline.edges;                            // references-only edges from Phase-B ingestion (unchanged)
  const reasoning = [...baseline.reasoning, ...engines.flatMap((e) => e.reasoning)];
  const facets = mergeFacets([baseline.facets, ...engines.map((e) => e.facets)]);

  const key = ctx.raw ? baseline.key : ctx.key;
  const understanding = buildQualificationUnderstanding({ key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, edges });
  const projection = projectQualification(understanding, ctx.asOf);
  const health = qualificationHealthSummary(understanding);
  return { understanding, projection, engines, health };
}
