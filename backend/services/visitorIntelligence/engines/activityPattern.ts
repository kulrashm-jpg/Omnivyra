/**
 * V-B204 — Visitor Activity Pattern Engine (deterministic contributor). Represents activity patterns:
 * first seen, last seen, activity trend, activity stability, repeat frequency, dormant periods.
 * Descriptive only — no prediction. Abstains without temporal activity data.
 */

import type { VisitorEngineOutput, VisitorIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { mkEvidence, clamp01, decayFactor, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const DAY = 86_400_000;

export function runActivityPattern(ctx: VisitorIntelligenceContext): VisitorEngineOutput {
  const r = ctx.raw; if (!r) return emptyOutput('activity_pattern');
  const hist = (ctx.history?.sessions ?? []).filter((s) => s.at).map((s) => s.at).sort();
  const first = r.firstSeenAt ?? hist[0];
  const last = r.lastSeenAt ?? hist[hist.length - 1];
  if (!first && !last && hist.length === 0) return emptyOutput('activity_pattern');
  const src = r.source ?? 'visitor_capture', at = r.asOf ?? ctx.asOf;

  // Activity trend from inter-visit intervals: shrinking intervals ⇒ increasing, growing ⇒ declining.
  let trend = 'stable';
  if (hist.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < hist.length; i++) gaps.push(Date.parse(hist[i]) - Date.parse(hist[i - 1]));
    const firstHalf = gaps.slice(0, Math.floor(gaps.length / 2));
    const secondHalf = gaps.slice(Math.floor(gaps.length / 2));
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const a = avg(firstHalf), b = avg(secondHalf);
    trend = b < a * 0.8 ? 'increasing' : b > a * 1.2 ? 'declining' : 'stable';
  }
  const dormantDays = last ? Math.floor(Math.max(0, Date.parse(ctx.asOf) - Date.parse(last)) / DAY) : null;

  const ev: EvidenceRef[] = [];
  const add = (l: string, v: string | number | undefined | null) => { if (v != null && v !== '') ev.push(mkEvidence('activity', { label: l, value: v, source: src, observedAt: at, kind: 'inferred' })); };
  add('first_seen', first); add('last_seen', last); add('trend', trend); add('repeat_sessions', r.sessionCount ?? hist.length); add('dormant_days', dormantDays);
  if (!ev.length) return emptyOutput('activity_pattern');

  const o: VisitorEngineOutput = { ...emptyOutput('activity_pattern'), abstained: false, evidence: ev };

  // recency = decay of last-seen; loyalty = repeat span + trend (stable/increasing ⇒ higher).
  const recency = last ? decayFactor(last, ctx.asOf, 30) : 0.5;
  o.contributions.push({ dimension: 'recency', contributor: 'activity_pattern', method: 'deterministic', value: clamp01(recency), confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  const trendScore = trend === 'increasing' ? 0.9 : trend === 'stable' ? 0.6 : 0.3;
  const loyalty = clamp01(0.5 * clamp01((r.sessionCount ?? hist.length) / 6) + 0.5 * trendScore);
  o.contributions.push({ dimension: 'loyalty', contributor: 'activity_pattern', method: 'deterministic', value: loyalty, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });

  o.reasoning.push(reasoningTrace({ claim: 'activity_pattern', conclusion: trend, because: ev, confidence: 0.55, method: 'deterministic', assumptions: [`repeat=${r.sessionCount ?? hist.length}, dormant_days=${dormantDays ?? 'n/a'}`], unknowns: hist.length >= 3 ? [] : ['insufficient history for trend ⇒ assumed stable'] }));
  return o;
}
