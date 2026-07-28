/**
 * CI-C310 — Canonical Company Intelligence Assembly (the ONE owner). Orchestrates every engine +
 * the profile-adoption baseline, merges evidence/contributions/facets/edges/reasoning, and calls the
 * canonical `buildCompanyUnderstanding` (score blend + contradiction detection) + one `projectCompany`.
 * No engine assembles independently; no engine owns Company Understanding. Deterministic (asOf-anchored).
 */

import type { CompanyIntelligenceContext, CompanyEngineOutput } from './engineTypes';
import { runTechnology } from './technology';
import { runProduct } from './product';
import { runGrowth } from './growth';
import { runExecutive } from './executive';
import { runCustomerPartner } from './customerPartner';
import { runFinancial } from './financial';
import { runCompetitive } from './competitive';
import { runRisk } from './risk';
import { runEnrichment } from './enrichment';
import { runCrossEngine } from './crossEngine';
import { buildCompanyUnderstanding } from '../builder';
import { projectCompany } from '../projection';
import { companyFromProfile } from '../fromProfile';
import { COMPANY_FACET_NAMES } from '../types';
import type { CompanyUnderstanding, CompanyProjection, CompanyFacets, CompanyFacetName } from '../types';
import { normalizeEvidence } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

export interface CompanyAssemblyResult { understanding: CompanyUnderstanding; projection: CompanyProjection; engines: CompanyEngineOutput[]; }

/** Merge facet fragments (baseline profile + engines): per facet, highest-confidence non-null wins. */
function mergeFacets(fragments: Array<Partial<CompanyFacets>>): Partial<CompanyFacets> {
  const merged = {} as Partial<CompanyFacets>;
  for (const name of COMPANY_FACET_NAMES) {
    let best: CompanyFacets[CompanyFacetName] | undefined;
    for (const frag of fragments) {
      const f = frag[name];
      if (!f || f.value === null) continue;
      if (!best || f.confidence > best.confidence) best = f;
    }
    if (best) (merged as any)[name] = best;
  }
  return merged;
}

export function assembleCompanyUnderstanding(ctx: CompanyIntelligenceContext): CompanyAssemblyResult {
  const primaries: CompanyEngineOutput[] = [
    runTechnology(ctx), runProduct(ctx), runGrowth(ctx), runExecutive(ctx),
    runCustomerPartner(ctx), runFinancial(ctx), runCompetitive(ctx), runRisk(ctx),
    runEnrichment(ctx), // CI-D404 — abstain-safe (absent enrichment ⇒ Phase C output preserved)
  ];
  const derived: CompanyEngineOutput[] = [runCrossEngine(primaries, ctx)];
  const engines = [...primaries, ...derived];

  const baseline = ctx.profile ? companyFromProfile(ctx.profile) : { facets: {}, evidence: [] as EvidenceRef[], worldView: {} };
  const evidence = normalizeEvidence([...baseline.evidence, ...engines.flatMap((e) => e.evidence)]);
  const contributions = engines.flatMap((e) => e.contributions);
  const edges: GraphEdge[] = engines.flatMap((e) => e.edges);
  const reasoning = engines.flatMap((e) => e.reasoning);
  const facets = mergeFacets([baseline.facets, ...engines.map((e) => e.facets)]);

  const understanding = buildCompanyUnderstanding({ key: ctx.key, builtAt: ctx.asOf, facets, evidence, contributions, reasoning, edges, worldView: baseline.worldView });
  const projection = projectCompany(understanding, ctx.asOf);
  return { understanding, projection, engines };
}
