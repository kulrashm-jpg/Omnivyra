/**
 * LI-C205 — Qualification Intelligence (deterministic contributor).
 * Assesses BANT+MEDDIC-style dimensions from structured inputs, preserving explicit unknowns
 * (`known:false`). Emits a qualification facet + an `urgency` contribution built only from the
 * timing/urgency values that are known AND scaleable. Every conclusion cites evidence; abstains
 * when nothing is known.
 */

import type { EngineOutput, LeadIntelligenceContext, QualificationDimension } from './engineTypes';
import { emptyOutput, mkEvidence, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, QualificationValue } from '../types';

const ENGINE = 'qualification';
const DIMS: QualificationDimension[] = ['budget', 'authority', 'need', 'timing', 'urgency', 'procurement', 'org_readiness', 'competitive', 'strategic', 'maturity', 'expansion', 'implementation'];
// crude ordinal for known textual values → 0..1 (deterministic). `null` when the input places
// nowhere on the scale — absent, empty or unrecognised. It used to return 0.5, which is a value
// nobody observed: a fabricated midpoint that then blended into a real score.
function ordinal(v?: string): number | null {
  const s = (v ?? '').toLowerCase();
  if (/high|strong|ready|immediate|confirmed|yes/.test(s)) return 1;
  if (/medium|moderate|likely|some/.test(s)) return 0.6;
  if (/low|weak|none|no|unlikely/.test(s)) return 0.2;
  return null;
}

export function runQualification(ctx: LeadIntelligenceContext): EngineOutput {
  const q = ctx.qualification;
  if (!q) return emptyOutput(ENGINE);
  const known = DIMS.filter((d) => q[d]?.known);
  if (!known.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;

  const evidence: EvidenceRef[] = [];
  const fields: Record<string, { value: string | null; known: boolean }> = {};
  for (const d of DIMS) {
    const input = q[d];
    fields[d] = { value: input?.known ? input.value ?? null : null, known: !!input?.known };
    if (input?.known) evidence.push(mkEvidence(ENGINE, { label: `qual:${d}`, value: input.value ?? true, source: input.source ?? 'crm', observedAt: input.observedAt ?? ctx.asOf, kind: 'structured' }));
  }
  out.evidence = evidence;
  const qualVal: QualificationValue = { framework: 'hybrid', fields };
  out.facets.qualification = facet(qualVal, evidence, { unknowns: DIMS.filter((d) => !q[d]?.known).map((d) => `qual:${d}`) });

  // Urgency contribution only from the halves that genuinely exist (never fabricate). The guard
  // fires when EITHER field is known, so the mean is taken over the known halves alone — averaging
  // an unknown half in at a midpoint would have made half of this contribution invented. A field
  // marked known whose value places nowhere on the ordinal scale places nothing either, which can
  // leave no half at all: then there is no urgency to contribute and the dimension abstains.
  const timingKnown = q.timing?.known || q.urgency?.known;
  if (timingKnown) {
    const scaled = [q.urgency, q.timing]
      .filter((f) => f?.known)
      .map((f) => ordinal(f?.value))
      .filter((n): n is number => n !== null);
    if (scaled.length) {
      const val = clamp01(scaled.reduce((a, b) => a + b, 0) / scaled.length);
      out.contributions.push({ dimension: 'urgency', contributor: ENGINE, method: 'deterministic', value: val, confidence: clamp01(0.5 + 0.1 * known.length), evidence, asOf: ctx.asOf });
    }
  }
  out.reasoning.push(reasoningTrace({ claim: 'qualification_completeness', conclusion: clamp01(known.length / DIMS.length), because: evidence, confidence: clamp01(0.4 + 0.05 * known.length), method: 'deterministic', unknowns: DIMS.filter((d) => !q[d]?.known).map((d) => `qual:${d}`) }));
  return out;
}
