/**
 * LI-D301 — Advanced Lead Enrichment (deterministic contributor).
 * Turns verified enrichment (executive profile, certifications, skills, org history, publications,
 * patents, speaking, advisory, public influence) into professional/identity facets — every field
 * carries evidence + provenance. Abstains when no enrichment. No fabrication (only supplied fields).
 */

import type { EngineOutput, LeadIntelligenceContext, EnrichmentInput } from './engineTypes';
import { emptyOutput, mkEvidence, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, ProfessionalValue, IdentityValue } from '../types';

const ENGINE = 'enrichment';
const listFields: Array<keyof EnrichmentInput> = ['certifications', 'skills', 'organizationHistory', 'roleEvolution', 'careerProgression', 'publications', 'patents', 'speaking', 'authoredContent', 'advisoryRoles'];

export function runEnrichment(ctx: LeadIntelligenceContext): EngineOutput {
  const e = ctx.enrichment;
  if (!e) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;
  const src = e.source ?? 'enrichment_provider';
  const at = e.observedAt ?? ctx.asOf;
  const evidence: EvidenceRef[] = [];

  for (const key of listFields) {
    const arr = e[key] as string[] | undefined;
    if (arr && arr.length) evidence.push(mkEvidence(ENGINE, { label: `enrich:${key}`, value: arr.join('; '), source: src, observedAt: at, kind: 'external' }));
  }
  if (e.executiveProfile) evidence.push(mkEvidence(ENGINE, { label: 'enrich:executive_profile', value: e.executiveProfile, source: src, observedAt: at, kind: 'external' }));
  if (e.publicInfluence) evidence.push(mkEvidence(ENGINE, { label: 'enrich:public_influence', value: e.publicInfluence, source: src, observedAt: at, kind: 'external' }));
  if (e.verifiedContact !== undefined) evidence.push(mkEvidence(ENGINE, { label: 'enrich:verified_contact', value: e.verifiedContact, source: src, observedAt: at, kind: 'structured' }));
  if (!evidence.length) return emptyOutput(ENGINE);
  out.evidence = evidence;
  out.abstained = false;

  const prof: ProfessionalValue = { responsibilities: e.roleEvolution, kpis: undefined };
  out.facets.professional = facet(prof, evidence.filter((x) => /role_evolution|executive_profile|skills|certifications/.test(x.label)), { assumptions: ['from verified enrichment provider'] });
  const idVal: IdentityValue = { organization: e.organizationHistory?.[0], tenure: e.careerProgression?.length ? `${e.careerProgression.length}_roles` : undefined };
  if (idVal.organization || idVal.tenure) out.facets.identity = facet(idVal, evidence.filter((x) => /organization_history|career_progression/.test(x.label)));

  out.reasoning.push(reasoningTrace({
    claim: 'professional_profile', conclusion: e.executiveProfile ? 'executive' : 'enriched', because: evidence,
    confidence: clamp01(0.5 + 0.05 * evidence.length), method: 'deterministic',
    assumptions: ['verified provider evidence'], unknowns: e.verifiedContact ? [] : ['contact not verified'],
  }));
  return out;
}
