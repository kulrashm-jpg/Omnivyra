/**
 * INT-001 Phase 2 — Recommendation Engine.
 *
 * Consumes qualification (plus intent/persona/segments/behaviour) and answers
 * the operator questions: why valuable, product interest, objections, content,
 * owner, channel, contact time, meeting/close probability, next best action.
 * Every recommendation carries a confidence and an explanation. Deterministic.
 */

import type {
  IntentIntelligence,
  LeadCaptureSnapshot,
  LeadRecommendations,
  PageCategory,
  PersonaIntelligence,
  QualificationIntelligence,
  RecommendationItem,
  SegmentAssignment,
} from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const capConf = (n: number): number => round2(Math.min(0.95, Math.max(0.05, n)));

export interface RecommendationInputs {
  snapshot: LeadCaptureSnapshot;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
  qualification: QualificationIntelligence;
  segments: SegmentAssignment[];
}

const CATEGORY_INTEREST_LABEL: Partial<Record<PageCategory, string>> = {
  pricing: 'Core product (pricing-stage evaluation)',
  enterprise: 'Enterprise plan',
  demo: 'Guided demo / trial',
  documentation: 'API / technical integration',
  security: 'Security & compliance posture',
  comparison: 'Competitive replacement',
  case_study: 'Proven-outcome use cases',
};

function topCategories(b: BehaviorAnalysis): Array<{ category: PageCategory; count: number }> {
  return [...b.categoryPages.entries()]
    .map(([category, set]) => ({ category, count: set.size }))
    .filter((e) => e.count > 0)
    .sort((a, z) => (z.count - a.count) || a.category.localeCompare(z.category));
}

export function buildRecommendations(
  inputs: RecommendationInputs,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): LeadRecommendations {
  const config = resolveEngineConfig(configOverride);
  const recCfg = config.recommendation;
  const b = precomputed ?? analyzeBehavior(inputs.snapshot, config);
  const { snapshot, intent, persona, qualification, segments } = inputs;
  const hasSegment = (s: SegmentAssignment['segment']): boolean => segments.some((x) => x.segment === s);
  const dataRichness = capConf(0.3 + Math.min(b.totalEvents, 10) * 0.04 + (snapshot.lead.jobTitle ? 0.1 : 0) + (snapshot.lead.companyName ? 0.1 : 0));

  // Why valuable — top weighted qualification sections.
  const topSections = [...qualification.sections].sort((a, z) => (z.weightedScore - a.weightedScore) || a.key.localeCompare(z.key)).slice(0, 2);
  const whyValuable: RecommendationItem = {
    value:
      qualification.totalScore > 0
        ? `Scored ${qualification.totalScore}/100 (${qualification.band}); strongest signals: ${topSections.map((s) => `${s.key} ${s.score}/100`).join(', ')}`
        : 'No captured signals establish value yet',
    confidence: capConf(qualification.totalScore / 100 + 0.2),
    explanation: topSections.map((s) => s.reason).join(' · ') || 'No qualification signals captured',
  };

  // Product interest — declared interest first, else dominant page category.
  const declared = (snapshot.lead.primaryInterest ?? '').trim();
  const top = topCategories(b).find((e) => CATEGORY_INTEREST_LABEL[e.category]);
  const likelyProductInterest: RecommendationItem = declared
    ? { value: declared, confidence: capConf(0.75), explanation: `Lead declared "${declared}" as their primary interest at capture` }
    : top
      ? { value: CATEGORY_INTEREST_LABEL[top.category]!, confidence: capConf(0.35 + top.count * 0.1), explanation: `Most-visited signal category: ${top.category} (${top.count} page(s))` }
      : { value: 'Unknown', confidence: 0.1, explanation: 'No declared interest and no categorized page visits' };

  // Objections — driven by segments/behaviour.
  const objections: string[] = [];
  const objectionReasons: string[] = [];
  if (hasSegment('Price Shoppers')) { objections.push('Price sensitivity'); objectionReasons.push('pricing-focused browsing'); }
  if (hasSegment('Competitor Evaluators')) { objections.push('Committed to a competitor'); objectionReasons.push('comparison pages visited'); }
  if (hasSegment('Technical Evaluators')) { objections.push('Integration complexity'); objectionReasons.push('deep documentation review'); }
  if (hasSegment('Enterprise Buyers') || hasSegment('Procurement')) { objections.push('Security/compliance review requirements'); objectionReasons.push('enterprise/security interest'); }
  if (objections.length === 0) { objections.push('Insufficient perceived urgency'); objectionReasons.push('no objection-specific signals; defaulting to urgency risk'); }
  const likelyObjections: RecommendationItem<string[]> = {
    value: objections,
    confidence: capConf(0.25 + (objectionReasons.length - 1) * 0.15),
    explanation: `Derived from: ${objectionReasons.join(', ')}`,
  };

  // Content — what the persona/segments have NOT seen yet but would need next.
  const content: string[] = [];
  const pagesOf = (c: PageCategory): number => b.categoryPages.get(c)?.size ?? 0;
  if (persona.persona === 'Developer' || persona.persona === 'CTO' || hasSegment('Technical Evaluators')) content.push('Technical integration guide / API docs');
  if (hasSegment('Enterprise Buyers') || hasSegment('Procurement')) content.push('Security & compliance whitepaper');
  if (pagesOf('case_study') === 0) content.push('Customer case study matching their industry');
  if (pagesOf('pricing') > 0 && pagesOf('demo') === 0) content.push('Demo / trial invitation');
  if (content.length === 0) content.push('Product overview and getting-started guide');
  const recommendedContent: RecommendationItem<string[]> = {
    value: content,
    confidence: dataRichness,
    explanation: 'Selected from persona/segment needs minus content categories already consumed',
  };

  // Owner — routing by qualification band + persona.
  let owner = 'Marketing nurture';
  let ownerWhy = 'Low qualification — keep warming via automated nurture';
  if (qualification.band === 'hot' && (hasSegment('Enterprise Buyers') || hasSegment('Decision Makers'))) {
    owner = 'Senior Account Executive';
    ownerWhy = 'Hot lead with enterprise/decision-maker profile warrants senior sales ownership';
  } else if (qualification.band === 'hot' || qualification.band === 'warm') {
    owner = persona.persona === 'Developer' || persona.persona === 'CTO' ? 'Solutions Engineer' : 'Account Executive';
    ownerWhy = persona.persona === 'Developer' || persona.persona === 'CTO'
      ? 'Technical evaluator — pair with a solutions engineer'
      : 'Sales-ready qualification band';
  }
  const recommendedOwner: RecommendationItem = { value: owner, confidence: capConf(0.3 + qualification.totalScore / 200), explanation: ownerWhy };

  // Channel.
  let channel = 'Email';
  let channelWhy = 'Default first-touch channel with captured email';
  const urgencyScore = qualification.sections.find((s) => s.key === 'urgency')?.score ?? 0;
  if (qualification.band === 'hot' && urgencyScore >= 50 && snapshot.lead.id !== null) {
    channel = 'Phone call';
    channelWhy = 'Hot + urgent — call while interest is live';
  } else if (hasSegment('Enterprise Buyers') && persona.persona !== 'Unknown') {
    channel = 'LinkedIn + Email';
    channelWhy = 'Enterprise buyer — multi-thread via LinkedIn alongside email';
  }
  const bestChannel: RecommendationItem = { value: channel, confidence: capConf(0.3 + urgencyScore / 200), explanation: channelWhy };

  // Contact time — modal activity hour (UTC), earliest hour wins ties.
  let bestContactTime: RecommendationItem;
  if (b.hourHistogram.size > 0) {
    let bestHour = -1;
    let bestCount = -1;
    for (const [hour, count] of [...b.hourHistogram.entries()].sort((a, z) => a[0] - z[0])) {
      if (count > bestCount) { bestHour = hour; bestCount = count; }
    }
    bestContactTime = {
      value: `${String(bestHour).padStart(2, '0')}:00–${String((bestHour + 1) % 24).padStart(2, '0')}:00 UTC`,
      confidence: capConf(0.2 + Math.min(bestCount, 8) * 0.06),
      explanation: `Lead was most active around ${String(bestHour).padStart(2, '0')}:00 UTC (${bestCount} event(s))`,
    };
  } else {
    bestContactTime = { value: 'Weekday mornings (recipient local time)', confidence: 0.1, explanation: 'No activity timestamps captured; using general default' };
  }

  // Probabilities — bounded linear maps from qualification (reproducible).
  const meetP = round2(Math.min(recCfg.meetingProbability.max, recCfg.meetingProbability.base + qualification.totalScore * recCfg.meetingProbability.perQualificationPoint));
  const companyFitScore = qualification.sections.find((s) => s.key === 'companyFit')?.score ?? 0;
  const closeP = round2(Math.min(
    recCfg.closeProbability.max,
    recCfg.closeProbability.base + qualification.totalScore * recCfg.closeProbability.perQualificationPoint + companyFitScore * recCfg.closeProbability.companyFitFactor,
  ));
  const meetingProbability: RecommendationItem<number> = {
    value: meetP,
    confidence: dataRichness,
    explanation: `Linear map of qualification ${qualification.totalScore}/100 onto configured meeting-probability curve`,
  };
  const closeProbability: RecommendationItem<number> = {
    value: closeP,
    confidence: round2(Math.max(0.05, dataRichness - 0.1)),
    explanation: `Qualification ${qualification.totalScore}/100 plus company fit ${companyFitScore}/100 on configured close-probability curve`,
  };

  // Next best action.
  let action = 'Add to nurture sequence and monitor for new activity';
  let actionWhy = 'Signals too weak for direct outreach';
  if (qualification.band === 'hot') {
    action = pagesOf('demo') > 0 ? 'Book the demo now — direct outreach within 24h' : 'Direct outreach within 24h offering a tailored demo';
    actionWhy = 'Hot qualification band with live intent';
  } else if (qualification.band === 'warm') {
    action = 'Personalized follow-up referencing the pages they explored';
    actionWhy = 'Warm lead — relevance-led touch keeps momentum';
  } else if (qualification.band === 'cool') {
    action = 'Send the top recommended content and re-score after next visit';
    actionWhy = 'Cool lead — earn attention with content before outreach';
  }
  const nextBestAction: RecommendationItem = { value: action, confidence: capConf(0.3 + qualification.totalScore / 150), explanation: actionWhy };

  return {
    whyValuable,
    likelyProductInterest,
    likelyObjections,
    recommendedContent,
    recommendedOwner,
    bestChannel,
    bestContactTime,
    meetingProbability,
    closeProbability,
    nextBestAction,
  };
}
