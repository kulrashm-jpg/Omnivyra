/**
 * INT-001 Phase 2 — Qualification Engine.
 *
 * Produces the lead score broken into five weighted sections (intent, persona,
 * company fit, behavior, urgency). Every section exposes score, weight and a
 * human-readable reason. The total is always reproducible:
 *   totalScore === Math.round(Σ section.weightedScore)
 * where weightedScore = round2(score * weight).
 */

import type {
  LeadCaptureSnapshot,
  IntentIntelligence,
  PersonaIntelligence,
  QualificationIntelligence,
  QualificationSection,
} from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';
import { emailDomainOf } from './personaEngine';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface QualificationInputs {
  snapshot: LeadCaptureSnapshot;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
}

function companyFitSection(inputs: QualificationInputs, config: LeadIntelligenceEngineConfig): { score: number; reason: string } {
  const cfg = config.qualification.companyFit;
  const { lead } = inputs.snapshot;
  const personaCfg = config.persona;
  let score = 0;
  const parts: string[] = [];

  const size = (lead.companySize ?? '').trim();
  if (size && cfg.enterpriseSizes.includes(size)) {
    score += cfg.enterprisePoints;
    parts.push(`enterprise company size (${size})`);
  } else if (size && cfg.midMarketSizes.includes(size)) {
    score += cfg.midMarketPoints;
    parts.push(`mid-market company size (${size})`);
  } else if (size) {
    score += cfg.smallCompanyPoints;
    parts.push(`company size stated (${size})`);
  }

  const domain = emailDomainOf(lead.email);
  if (domain && !personaCfg.freeEmailDomains.includes(domain)) {
    score += cfg.corporateDomainPoints;
    parts.push(`corporate email domain (${domain})`);
  }

  if ((lead.industry ?? '').trim()) {
    score += cfg.industryKnownPoints;
    parts.push(`industry known (${lead.industry})`);
  }
  if ((lead.companyName ?? '').trim()) {
    score += cfg.companyNamePoints;
    parts.push(`company named (${lead.companyName})`);
  }

  return {
    score: clamp(score, 0, 100),
    reason: parts.length > 0 ? `Fit signals: ${parts.join('; ')}` : 'No company-fit signals captured',
  };
}

function behaviorSection(behavior: BehaviorAnalysis, config: LeadIntelligenceEngineConfig): { score: number; reason: string } {
  const cfg = config.qualification.behavior;
  let score = 0;
  const parts: string[] = [];

  if (behavior.totalEvents > 0) {
    score += Math.min(behavior.totalEvents * cfg.pointsPerEvent, cfg.eventCap);
    parts.push(`${behavior.totalEvents} events`);
  }
  if (behavior.distinctPages.length > 0) {
    score += Math.min(behavior.distinctPages.length * cfg.pointsPerDistinctPage, cfg.distinctPageCap);
    parts.push(`${behavior.distinctPages.length} distinct pages`);
  }
  if (behavior.deepScrollCount > 0) {
    score += cfg.deepScrollBonus;
    parts.push('deep scroll engagement');
  }
  if (behavior.downloadCount > 0) {
    score += cfg.downloadBonus;
    parts.push('downloaded content');
  }

  return {
    score: clamp(score, 0, 100),
    reason: parts.length > 0 ? `Engagement: ${parts.join(', ')}` : 'No behavioural events captured',
  };
}

function urgencySection(behavior: BehaviorAnalysis, config: LeadIntelligenceEngineConfig): { score: number; reason: string } {
  const cfg = config.qualification.urgency;
  let score = 0;
  const parts: string[] = [];

  if (behavior.daysSinceLastActivity !== null) {
    const tier = cfg.recency.find((t) => behavior.daysSinceLastActivity! <= t.withinDays);
    if (tier) {
      score += tier.points;
      parts.push(`active within ${tier.withinDays} day(s)`);
    }
  }
  if (behavior.lastSessionCategories.has('demo') || behavior.lastSessionCategories.has('pricing')) {
    score += cfg.demoOrPricingLastSessionPoints;
    parts.push('demo/pricing viewed in latest session');
  }
  if (behavior.acceleratingVisits) {
    score += cfg.acceleratingVisitsPoints;
    parts.push('visit pace accelerating');
  }

  return {
    score: clamp(score, 0, 100),
    reason: parts.length > 0 ? `Urgency signals: ${parts.join(', ')}` : 'No urgency signals captured',
  };
}

export function buildQualification(
  inputs: QualificationInputs,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): QualificationIntelligence {
  const config = resolveEngineConfig(configOverride);
  const weights = config.qualification.weights;
  const behavior = precomputed ?? analyzeBehavior(inputs.snapshot, config);

  const companyFit = companyFitSection(inputs, config);
  const behaviorScore = behaviorSection(behavior, config);
  const urgency = urgencySection(behavior, config);

  const personaScore = clamp(Math.round(inputs.persona.confidence * 100), 0, 100);

  const sections: QualificationSection[] = [
    {
      key: 'intent',
      score: clamp(inputs.intent.score, 0, 100),
      weight: weights.intent,
      weightedScore: round2(clamp(inputs.intent.score, 0, 100) * weights.intent),
      reason:
        inputs.intent.contributions.length > 0
          ? `Intent ${inputs.intent.score}/100 from ${inputs.intent.contributions.map((c) => c.label).join(', ')}`
          : 'No intent signals captured',
    },
    {
      key: 'persona',
      score: personaScore,
      weight: weights.persona,
      weightedScore: round2(personaScore * weights.persona),
      reason:
        inputs.persona.persona === 'Unknown'
          ? 'Persona unknown'
          : `Persona ${inputs.persona.persona} at ${Math.round(inputs.persona.confidence * 100)}% confidence`,
    },
    { key: 'companyFit', score: companyFit.score, weight: weights.companyFit, weightedScore: round2(companyFit.score * weights.companyFit), reason: companyFit.reason },
    { key: 'behavior', score: behaviorScore.score, weight: weights.behavior, weightedScore: round2(behaviorScore.score * weights.behavior), reason: behaviorScore.reason },
    { key: 'urgency', score: urgency.score, weight: weights.urgency, weightedScore: round2(urgency.score * weights.urgency), reason: urgency.reason },
  ];

  const totalScore = clamp(Math.round(sections.reduce((sum, s) => sum + s.weightedScore, 0)), 0, 100);
  const bands = config.qualification.bands;
  const band = totalScore >= bands.hot ? 'hot' : totalScore >= bands.warm ? 'warm' : totalScore >= bands.cool ? 'cool' : 'cold';

  return { totalScore, band, sections };
}

/** Recompute the total from the sections — used to assert reproducibility. */
export function recomputeQualificationTotal(qualification: QualificationIntelligence): number {
  const sum = qualification.sections.reduce((acc, s) => acc + s.weightedScore, 0);
  return clamp(Math.round(sum), 0, 100);
}
