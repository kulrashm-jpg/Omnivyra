/**
 * LI-C201 — Persona & ICP Intelligence (deterministic contributor).
 * Classifies seniority / department / buying-committee role from title evidence and computes ICP
 * fit from structured match flags. Emits identity + professional + qualification(icp) facets and an
 * `icp` score contribution. Abstains when neither identity nor ICP evidence is present.
 */

import type { EngineOutput, LeadIntelligenceContext } from './engineTypes';
import { emptyOutput, mkEvidence, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, IdentityValue, ProfessionalValue } from '../types';

const ENGINE = 'persona_icp';

function seniorityOf(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/\b(chief|c[eoft]o|founder|owner|president)\b/.test(t)) return 'c_level';
  if (/\b(svp|vp|vice president|head of)\b/.test(t)) return 'vp';
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\b(manager|lead)\b/.test(t)) return 'manager';
  if (title.trim()) return 'individual_contributor';
  return undefined;
}
function committeeRole(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/\b(chief|c[eoft]o|founder|owner|vp|svp|head of|director)\b/.test(t)) return 'decision_maker';
  if (/\b(procurement|purchasing|buyer)\b/.test(t)) return 'procurement';
  if (/\b(engineer|architect|developer|analyst|technical)\b/.test(t)) return 'technical_evaluator';
  if (title.trim()) return 'influencer';
  return undefined;
}
function departmentOf(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/\b(market|growth|demand|brand)\b/.test(t)) return 'marketing';
  if (/\b(sales|revenue|account)\b/.test(t)) return 'sales';
  if (/\b(engineer|developer|it|technical|architect|devops)\b/.test(t)) return 'engineering';
  if (/\b(finance|account|procurement)\b/.test(t)) return 'finance';
  if (/\b(product)\b/.test(t)) return 'product';
  return undefined;
}

export function runPersonaIcp(ctx: LeadIntelligenceContext): EngineOutput {
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;
  const id = ctx.identity;
  const evidence: EvidenceRef[] = [];

  if (id?.title) {
    const seniority = seniorityOf(id.title);
    const department = id.department ?? departmentOf(id.title);
    const role = committeeRole(id.title);
    const titleEv = mkEvidence(ENGINE, { label: 'title', value: id.title, source: id.source ?? 'enrichment', observedAt: id.observedAt ?? ctx.asOf, kind: 'structured' });
    evidence.push(titleEv);
    const identityVal: IdentityValue = { person: id.email, email: id.email, role: id.title, organization: id.organization, geography: id.geography, seniority, department };
    const profVal: ProfessionalValue = { buyingCommitteeRole: role, decisionAuthority: seniority === 'c_level' || seniority === 'vp' ? 'high' : seniority === 'director' ? 'medium' : 'low' };
    out.facets.identity = facet(identityVal, [titleEv]);
    out.facets.professional = facet(profVal, [titleEv]);
    out.reasoning.push(reasoningTrace({ claim: 'buying_committee_role', conclusion: role ?? null, because: [titleEv], confidence: 0.7, method: 'deterministic', assumptions: ['role inferred from title keywords'], unknowns: role ? [] : ['no title signal'] }));
  }

  // ICP fit from structured match flags.
  if (ctx.icp) {
    const flags = [ctx.icp.industryMatch, ctx.icp.sizeMatch, ctx.icp.geoMatch];
    const known = flags.filter((f) => f !== undefined);
    if (known.length) {
      const value = clamp01(known.filter(Boolean).length / known.length);
      const icpEv = mkEvidence(ENGINE, { label: 'icp_fit', value, source: ctx.icp.source ?? 'company_profile', observedAt: ctx.icp.observedAt ?? ctx.asOf, kind: 'structured' });
      evidence.push(icpEv);
      out.contributions.push({ dimension: 'icp', contributor: ENGINE, method: 'deterministic', value, confidence: clamp01(0.5 + 0.5 * (known.length / 3)), evidence: [icpEv], asOf: ctx.icp.observedAt ?? ctx.asOf });
      out.facets.qualification = facet({ framework: 'hybrid', fields: { icp_fit: { value: String(value), known: true } } }, [icpEv]);
      out.reasoning.push(reasoningTrace({ claim: 'icp_fit', conclusion: value, because: [icpEv], confidence: 0.8, method: 'deterministic' }));
    }
  }

  out.evidence = evidence;
  out.abstained = evidence.length === 0;
  return out;
}
