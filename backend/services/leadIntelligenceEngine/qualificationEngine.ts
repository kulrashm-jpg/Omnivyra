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
  LeadEvolutionIntelligence,
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
  /**
   * WS-2 M3 — optional evolution context. Consumed as EVIDENCE ONLY: it adds
   * no points anywhere. Intent level is already a weighted section, funnel
   * depth is derived from the very page visits the behaviour section scores,
   * and multi-session activity is already scored by intent's loyalty/cadence
   * signals. Scoring any of it again here would double-count the same evidence
   * under a different name and silently inflate every qualified lead.
   */
  evolution?: LeadEvolutionIntelligence;
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
    parts.push(
      behavior.downloadedAssets.length > 0
        ? `downloaded ${behavior.downloadedAssets.slice(0, 2).join(', ')}`
        : 'downloaded content',
    );
  }
  // WS-2 M2: video and search are engagement types this section did not
  // previously observe at all, so they earn points here — unlike the M1 signals
  // below, which are intent-scored and therefore evidence-only.
  if (behavior.videoCompleteCount > 0) {
    score += cfg.videoBonus;
    parts.push(`completed ${behavior.videoCompleteCount} video(s)`);
  } else if (behavior.videoStartCount > 0) {
    parts.push(`started ${behavior.videoStartCount} video(s)`);
  }
  if (behavior.searchQueries.length > 0) {
    score += cfg.searchBonus;
    parts.push(`searched for ${behavior.searchQueries.slice(0, 2).map((q) => `"${q}"`).join(', ')}`);
  }
  // WS-2 M1 (5): measured engagement time, now that sessions carry duration.
  // Evidence-only for the same non-double-counting reason as urgency.
  if (behavior.totalSessionDurationMs !== null && behavior.totalSessionDurationMs > 0) {
    parts.push(`${Math.round(behavior.totalSessionDurationMs / 1000)}s measured on site`);
  }
  if (behavior.exitPages.length > 0) {
    parts.push(`last left from ${behavior.exitPages[0]}`);
  }
  // WS-2 M2: device/location describe the reading, not the engagement level —
  // evidence only, exactly as the M1 loyalty signals are treated.
  if (behavior.primaryDeviceCategory) {
    parts.push(
      behavior.multiDevice === true
        ? `across ${behavior.deviceCategories.join(' + ')}`
        : `on ${behavior.primaryDeviceCategory}`,
    );
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
  // WS-2 M1 (5): the durable return signal now reaches urgency reasoning.
  // Reported as evidence only — it does not add points here, because intent
  // already scores loyalty and cadence and urgency must not double-count it.
  if (behavior.returningVisitor === true) {
    parts.push(
      behavior.visitCount !== null
        ? `returning visitor (visit #${behavior.visitCount})`
        : 'returning visitor',
    );
  }
  if (behavior.minTimeBetweenSessionsMs !== null) {
    const days = Math.round((behavior.minTimeBetweenSessionsMs / 86_400_000) * 10) / 10;
    parts.push(`returned after ${days} day(s) at the shortest gap`);
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

  // WS-2 M3: evolution enriches the REASONING of the existing sections. The
  // scores are untouched — see the note on QualificationInputs.evolution.
  const evo = inputs.evolution;
  if (evo) {
    const trendNote =
      evo.intent.trend === 'accelerating' ? 'intent accelerating'
        : evo.intent.trend === 'growing' ? 'intent growing'
          : evo.intent.trend === 'decaying' ? `intent decaying (${evo.intent.decayFromPeak} pts below peak ${evo.intent.peakScore})`
            : evo.intent.trend === 'dormant' ? 'intent dormant'
              : null;
    if (trendNote) urgency.reason += `; ${trendNote}`;
    if (evo.journey.state === 'stagnant' || evo.journey.state === 'dormant') {
      urgency.reason += `; journey ${evo.journey.state} for ${evo.journey.stagnantDays} day(s)`;
    } else if (evo.journey.state === 'accelerating') {
      urgency.reason += '; return cadence accelerating';
    }
    behaviorScore.reason += `; funnel stage ${evo.funnel.stage}`;
    if (evo.funnel.furthestStage !== evo.funnel.stage) {
      behaviorScore.reason += ` (furthest reached: ${evo.funnel.furthestStage})`;
    }
    if (evo.intent.checkpoints.length > 1) {
      behaviorScore.reason += `; observed across ${evo.intent.checkpoints.length} sessions over ${evo.intent.persistenceDays ?? 0} day(s)`;
    }
  }

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
