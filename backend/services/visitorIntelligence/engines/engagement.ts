/**
 * V-B202 — Engagement Intelligence (deterministic contributor). Represents visitor engagement: page +
 * content engagement, interaction intensity, visit consistency, activity richness, engagement
 * confidence. Evidence-backed only. Abstains without engagement signals.
 */

import type { VisitorEngineOutput, VisitorIntelligenceContext } from './engineTypes';
import { emptyOutput, ord } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runEngagement(ctx: VisitorIntelligenceContext): VisitorEngineOutput {
  const r = ctx.raw; if (!r) return emptyOutput('engagement');
  const src = r.source ?? 'visitor_capture', at = r.asOf ?? ctx.asOf;
  const hasSignals = !!(r.engagementLevel || (r.engagementSignals?.length) || (r.engagementEvents?.length) || r.pageCount != null || r.durationSeconds != null);
  if (!hasSignals) return emptyOutput('engagement');

  const ev: EvidenceRef[] = [];
  const add = (l: string, v: string | number | undefined) => { if (v != null && v !== '') ev.push(mkEvidence('engagement', { label: l, value: v, source: src, observedAt: at, kind: 'inferred' })); };
  add('level', r.engagementLevel); add('signals', (r.engagementSignals ?? []).join('; ') || undefined);
  add('events', (r.engagementEvents ?? []).length || undefined); add('pages', r.pageCount); add('duration_s', r.durationSeconds);
  if (!ev.length) return emptyOutput('engagement');

  const o: VisitorEngineOutput = { ...emptyOutput('engagement'), abstained: false, evidence: ev };
  o.facets.engagement = facet({ level: r.engagementLevel, signals: r.engagementSignals }, ev);

  // interaction intensity = declared level + normalized page/duration/event activity
  const intensity = clamp01(0.5 * ord(r.engagementLevel)
    + 0.2 * clamp01((r.pageCount ?? 0) / 15)
    + 0.15 * clamp01((r.durationSeconds ?? 0) / 900)
    + 0.15 * clamp01((r.engagementEvents?.length ?? 0) / 6));
  o.contributions.push({ dimension: 'engagement', contributor: 'engagement', method: 'deterministic', value: intensity, confidence: clamp01(0.45 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });

  o.reasoning.push(reasoningTrace({ claim: 'engagement_intensity', conclusion: intensity, because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['level + page/duration/event activity'], unknowns: r.engagementLevel ? [] : ['declared engagement level unknown'] }));
  return o;
}
