/**
 * LI-D303 — Behavioral Intelligence (deterministic contributor).
 * Models LONGITUDINAL behaviour: engagement evolution, buying-stage transitions, historical momentum,
 * content affinity. Produces the engagement facet + an `intent` momentum contribution. Deterministic
 * (asOf-anchored). Abstains without behavioural history.
 */

import type { EngineOutput, LeadIntelligenceContext, BehaviouralEvent, BuyingStage } from './engineTypes';
import { emptyOutput, mkEvidence, decayFactor, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, EngagementValue } from '../types';

const ENGINE = 'behavioral';
const STAGE_RANK: Record<BuyingStage, number> = { awareness: 0, consideration: 1, evaluation: 2, decision: 3, customer: 4 };

export function runBehavioral(ctx: LeadIntelligenceContext): EngineOutput {
  const hist = ctx.behaviouralHistory ?? [];
  if (!hist.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;

  const sorted = [...hist].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const evidence: EvidenceRef[] = sorted.map((h: BehaviouralEvent) => mkEvidence(ENGINE, { label: `behaviour:${h.label}`, value: h.stage ?? h.value ?? h.label, source: h.source, observedAt: h.observedAt, kind: 'observed' }));
  out.evidence = evidence;
  out.abstained = false;

  // Buying-stage transition: highest stage reached + whether it advanced over time.
  const stages = sorted.map((h) => h.stage).filter(Boolean) as BuyingStage[];
  const peakStage = stages.length ? stages.reduce((a, b) => (STAGE_RANK[b] > STAGE_RANK[a] ? b : a)) : undefined;
  const advanced = stages.length >= 2 && STAGE_RANK[stages[stages.length - 1]] > STAGE_RANK[stages[0]];

  // Historical momentum: decayed recent activity vs total (fresh window weighs more).
  let recentW = 0, totalW = 0;
  for (const h of sorted) { const d = decayFactor(h.observedAt, ctx.asOf, 30); recentW += d; totalW += 1; }
  const momentum = totalW ? clamp01(recentW / totalW) : 0;

  const engagement: EngagementValue = {
    channelPreferences: [...new Set(sorted.map((h) => h.source))],
    responsiveness: momentum > 0.6 ? 'high' : momentum > 0.3 ? 'medium' : 'low',
    contentAffinity: [...new Set(sorted.map((h) => h.label))],
  };
  out.facets.engagement = facet(engagement, evidence);
  out.contributions.push({ dimension: 'intent', contributor: ENGINE, method: 'deterministic', value: momentum, confidence: clamp01(0.4 + 0.1 * Math.min(hist.length, 4)), evidence, asOf: ctx.asOf });

  out.reasoning.push(reasoningTrace({
    claim: 'engagement_evolution', conclusion: advanced ? 'advancing' : peakStage ?? 'steady', because: evidence,
    confidence: clamp01(0.4 + 0.1 * Math.min(hist.length, 5)), method: 'deterministic',
    assumptions: [`peak_stage=${peakStage ?? 'unknown'}`, `momentum=${momentum}`], unknowns: stages.length ? [] : ['no stage labels'],
  }));
  return out;
}
