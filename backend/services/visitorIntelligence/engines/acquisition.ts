/**
 * V-B205 — Acquisition Intelligence (deterministic contributor). Enriches acquisition understanding:
 * acquisition consistency, source confidence, campaign confidence, referral stability, entry quality.
 * NO attribution modelling — it describes the acquisition evidence, it does not credit conversions.
 * Abstains without acquisition/referral signals.
 */

import type { VisitorEngineOutput, VisitorIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runAcquisition(ctx: VisitorIntelligenceContext): VisitorEngineOutput {
  const r = ctx.raw; if (!r) return emptyOutput('acquisition');
  const hasAcq = !!(r.acquisitionSource || r.medium || r.campaign || r.referrer || r.referrerDomain || r.entryPage || (r.utm && Object.keys(r.utm).length));
  if (!hasAcq) return emptyOutput('acquisition');
  const src = r.source ?? 'visitor_capture', at = r.asOf ?? ctx.asOf;

  const ev: EvidenceRef[] = [];
  const add = (l: string, v: string | undefined) => { if (v) ev.push(mkEvidence('acquisition', { label: l, value: v, source: src, observedAt: at, kind: 'structured' })); };
  add('source', r.acquisitionSource); add('medium', r.medium); add('campaign', r.campaign);
  add('referrer', r.referrer ?? r.referrerDomain); add('referrer_type', r.referrerType); add('entry_page', r.entryPage);
  if (r.utm) for (const [k, v] of Object.entries(r.utm).sort()) add(`utm_${k}`, v);
  if (!ev.length) return emptyOutput('acquisition');

  const o: VisitorEngineOutput = { ...emptyOutput('acquisition'), abstained: false, evidence: ev };
  o.facets.acquisition = facet({ source: r.acquisitionSource, medium: r.medium, campaign: r.campaign, entryPage: r.entryPage, landingContext: r.landingContext, utm: r.utm }, ev);
  if (r.referrer || r.referrerDomain || r.referrerType) o.facets.referral = facet({ referrer: r.referrer, referrerDomain: r.referrerDomain, referrerType: r.referrerType }, ev);

  // entry quality = completeness/consistency of the acquisition signal (descriptive, NOT attribution).
  const signals = [r.acquisitionSource, r.medium, r.campaign, r.referrer ?? r.referrerDomain, r.entryPage].filter(Boolean).length;
  const utmCount = r.utm ? Object.keys(r.utm).length : 0;
  const quality = clamp01(0.15 * signals + 0.1 * utmCount);
  o.contributions.push({ dimension: 'reach', contributor: 'acquisition', method: 'deterministic', value: quality, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });

  o.reasoning.push(reasoningTrace({ claim: 'acquisition_quality', conclusion: quality, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`signals=${signals}, utm=${utmCount} (descriptive, no attribution)`], unknowns: r.campaign ? [] : ['campaign unknown'] }));
  return o;
}
