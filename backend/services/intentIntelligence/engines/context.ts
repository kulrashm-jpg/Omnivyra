/**
 * I-C305 — Context Intelligence Engine (deterministic contributor). Explains how upstream context
 * (Visitor / Journey / Lead / Company / Offering) CONTRIBUTES to the interpretation — representing only
 * their contribution, never duplicating upstream ownership (they appear as references). Abstains when
 * no upstream context is referenced.
 */

import type { IntentEngineOutput, IntentIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runContext(ctx: IntentIntelligenceContext): IntentEngineOutput {
  const base = baselineOf(ctx);
  const id = base?.facets.identity?.value;
  // Upstream references contributing context (identity actor/object + any explicit upstream refs).
  const refs: Array<[string, string | undefined | null]> = [
    ['actor', id?.actorRef], ['object', id?.objectRef],
    ['visitor', ctx.upstream?.visitorRef], ['journey', ctx.upstream?.journeyRef],
    ['lead', ctx.upstream?.leadRef], ['company', ctx.upstream?.companyRef], ['offering', ctx.upstream?.offeringRef],
  ];
  const present = refs.filter(([, v]) => v != null && v !== '');
  if (!present.length) return emptyOutput('context');
  const src = ctx.raw?.source ?? 'intent_capture', at = ctx.asOf;

  const ev: EvidenceRef[] = present.map(([k, v]) => mkEvidence('context', { label: `context:${k}`, value: String(v), source: src, observedAt: at, kind: 'structured' }));
  const breadth = clamp01(present.length / 5);
  const o: IntentEngineOutput = { ...emptyOutput('context'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'breadth', contributor: 'context', method: 'deterministic', value: breadth, confidence: clamp01(0.4 + 0.1 * Math.min(present.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'context_contribution', conclusion: present.length, because: ev, confidence: 0.55, method: 'deterministic', assumptions: [`upstream contributing: ${present.map(([k]) => k).join(', ')} (references only — no re-ownership)`], unknowns: [] }));
  return o;
}
