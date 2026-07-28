/**
 * J-C302 — Momentum Intelligence Engine (deterministic contributor). Descriptive momentum from
 * observed activity: activity momentum, progression velocity, acceleration/deceleration, inactivity
 * periods, resumed activity. NO prediction — only observed behaviour. Abstains without touchpoints.
 */

import type { JourneyEngineOutput, JourneyIntelligenceContext } from './engineTypes';
import { emptyOutput, orderedTouchpoints, DAY } from './engineTypes';
import { mkEvidence, clamp01, decayFactor, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runMomentum(ctx: JourneyIntelligenceContext): JourneyEngineOutput {
  const tps = orderedTouchpoints(ctx.raw);
  if (tps.length < 1) return emptyOutput('momentum');
  const src = ctx.raw?.source ?? 'journey_capture';
  const firstAt = tps[0].observedAt, lastAt = tps[tps.length - 1].observedAt;
  const spanDays = Math.max(1, (Date.parse(lastAt) - Date.parse(firstAt)) / DAY);
  const rate = tps.length / spanDays;                                   // touchpoints per day

  // acceleration: recent-half rate vs earlier-half rate (observed, not forecast).
  const mid = Math.floor(tps.length / 2);
  const earlier = tps.slice(0, mid), recent = tps.slice(mid);
  const rateOf = (arr: typeof tps) => { if (arr.length < 2) return arr.length; const d = Math.max(1, (Date.parse(arr[arr.length - 1].observedAt) - Date.parse(arr[0].observedAt)) / DAY); return arr.length / d; };
  const eRate = rateOf(earlier), rRate = rateOf(recent);
  const trend = rRate > eRate * 1.15 ? 'accelerating' : rRate < eRate * 0.85 ? 'decelerating' : 'steady';

  // inactivity gaps + resumed activity.
  let gaps = 0; let resumed = false;
  for (let i = 1; i < tps.length; i++) { const g = Date.parse(tps[i].observedAt) - Date.parse(tps[i - 1].observedAt); if (g > 30 * DAY) { gaps++; if (i === tps.length - 1) resumed = true; } }

  const recency = decayFactor(lastAt, ctx.asOf, 30);
  const momentum = clamp01(0.6 * recency + 0.4 * clamp01(rate));         // recency-weighted observed activity
  const at = lastAt;
  const ev: EvidenceRef[] = [
    mkEvidence('momentum', { label: 'rate_per_day', value: Number(rate.toFixed(4)), source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('momentum', { label: 'trend', value: trend, source: src, observedAt: at, kind: 'inferred' }),
  ];
  const o: JourneyEngineOutput = { ...emptyOutput('momentum'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'momentum', contributor: 'momentum', method: 'deterministic', value: momentum, confidence: clamp01(0.4 + 0.1 * Math.min(tps.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'momentum', conclusion: trend, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`rate=${rate.toFixed(3)}/day, recency=${recency}, gaps=${gaps}, resumed=${resumed}`], unknowns: [] }));
  return o;
}
