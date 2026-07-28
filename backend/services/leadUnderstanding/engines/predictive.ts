/**
 * LI-D304 — Predictive Intelligence (deterministic; operates on a built Understanding).
 * Deterministic probability estimates derived from canonical score dimensions — NOT a black-box
 * model. Every prediction exposes confidence, the evidence it rests on, assumptions, and an
 * uncertainty band. Abstains (null probability) when the driving dimensions abstain.
 */

import type { LeadUnderstanding, EvidenceRef, ScoreDimension } from '../types';
import { clamp01 } from './engineTypes';

export type PredictionName = 'buying' | 'conversion' | 'churn' | 'expansion' | 'response' | 'meeting' | 'opportunity_creation';
export interface Prediction { name: PredictionName; probability: number | null; confidence: number; evidence: EvidenceRef[]; assumptions: string[]; uncertainty: number; }
export interface LeadPredictions { predictions: Record<PredictionName, Prediction>; }

// Each prediction = a weighted blend of driving dimensions; abstains if all drivers abstain.
const MODELS: Record<PredictionName, { drivers: Array<[ScoreDimension, number]>; assume: string; invert?: boolean }> = {
  buying: { drivers: [['intent', 0.4], ['opportunity', 0.35], ['urgency', 0.25]], assume: 'buying ≈ intent+opportunity+urgency' },
  conversion: { drivers: [['intent', 0.4], ['icp', 0.3], ['priority', 0.3]], assume: 'conversion ≈ intent+fit+priority' },
  churn: { drivers: [['intent', 1.0]], assume: 'churn ≈ 1 − engagement (proxy: low intent)', invert: true },
  expansion: { drivers: [['opportunity', 0.6], ['icp', 0.4]], assume: 'expansion ≈ opportunity+fit' },
  response: { drivers: [['intent', 0.6], ['urgency', 0.4]], assume: 'response ≈ intent+urgency' },
  meeting: { drivers: [['urgency', 0.4], ['intent', 0.35], ['priority', 0.25]], assume: 'meeting ≈ urgency+intent+priority' },
  opportunity_creation: { drivers: [['priority', 0.5], ['opportunity', 0.5]], assume: 'oppty ≈ priority+opportunity' },
};

function predictOne(u: LeadUnderstanding, name: PredictionName): Prediction {
  const m = MODELS[name];
  let num = 0, wSum = 0, conf = 0, n = 0;
  const evidence: EvidenceRef[] = [];
  for (const [dim, w] of m.drivers) {
    const d = u.score.dimensions[dim];
    if (d.abstained || d.value === null) continue;
    num += w * d.value; wSum += w; conf += d.confidence; n++;
    for (const c of Object.values(u.facets)) for (const e of c.evidence) if (!evidence.find((x) => x.id === e.id) && evidence.length < 12) evidence.push(e);
  }
  if (wSum === 0) return { name, probability: null, confidence: 0, evidence: [], assumptions: [m.assume, 'insufficient evidence ⇒ abstain'], uncertainty: 1 };
  let probability = clamp01(num / wSum);
  if (m.invert) probability = clamp01(1 - probability);
  const confidence = clamp01((conf / Math.max(1, n)) * (n / m.drivers.length)); // dampened by missing drivers
  return { name, probability, confidence, evidence: evidence.slice(0, 8), assumptions: [m.assume], uncertainty: clamp01(1 - confidence) };
}

export function predict(u: LeadUnderstanding): LeadPredictions {
  const predictions = {} as Record<PredictionName, Prediction>;
  (Object.keys(MODELS) as PredictionName[]).forEach((name) => { predictions[name] = predictOne(u, name); });
  return { predictions };
}
