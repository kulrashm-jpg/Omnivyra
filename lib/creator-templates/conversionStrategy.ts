/**
 * Conversion Strategy — the final deterministic strategic layer between the
 * Visual Messaging Plan and Template Selection. It does NOT generate content,
 * change communication, redesign templates, or render. It determines HOW the
 * communication should move the audience toward the intended action. Pure: input
 * is the upstream understanding (Intelligence + Strategy + Journey + Message +
 * Visual Plan); no AI, no randomness, no rendering. Same inputs → byte-identical
 * strategy. It contains NO pixels / templates / fonts / colors / coordinates.
 */

import type { ContentIntelligence, KnowledgeItem } from './contentIntelligence';
import type { CommunicationStrategyResult } from './communicationStrategy';
import type { AudienceJourneyResult } from './audienceJourney';
import type { MessageDocument } from './messageFoundation';
import { buildVisualMessagingPlan, type VisualMessagingPlan } from './visualMessagingPlan';
import type { TemplateAssetFamily } from './types';
import { packageIntelligence, packageToArchitectureBody, type ContentPackage } from './contentPackage';
import { classifyStrategy } from './communicationStrategy';
import { classifyAudienceJourney } from './audienceJourney';
import { extractMessageDocument } from './messageExtraction';

export type ConversionGoal =
  | 'Awareness' | 'Education' | 'Engagement' | 'Lead Generation' | 'Newsletter Signup' | 'Event Registration'
  | 'Consultation' | 'Demo Request' | 'Trial' | 'Purchase' | 'Upsell' | 'Cross Sell' | 'Retention' | 'Advocacy'
  | 'Community' | 'Recruitment' | 'Hiring' | 'Support' | 'Feedback' | 'Survey';
export type TrustRequirement = 'None' | 'Basic' | 'Medium' | 'High' | 'Critical';
export type CtaIntensity = 'Soft' | 'Medium' | 'Strong' | 'Urgent';
export type CtaPlacement = 'Opening' | 'Middle' | 'Closing' | 'Repeated' | 'Single';
export type CtaStyle = 'Educational' | 'Exploratory' | 'Consultative' | 'Commercial' | 'Urgent' | 'Community';
export type ObjectionType = 'Price' | 'Complexity' | 'Trust' | 'Risk' | 'Implementation' | 'Time' | 'Competition' | 'Compatibility' | 'Authority' | 'Need' | 'Budget' | 'Resources' | 'Urgency';
export type Importance = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConversionStep {
  id: string;
  stage: string;
  purpose: string;
  expectedAction: string;
  requiredEvidence: string[];
  recommendedMessage: string;
  recommendedVisualSupport: string;
  priority: number;
  importance: Importance;
  notes: string;
}

export interface ConversionStrategy {
  id: string;
  conversionGoal: ConversionGoal;
  primaryConversion: string;
  secondaryConversions: string[];
  conversionStage: string;
  conversionJourney: string;
  trustRequirement: TrustRequirement;
  proofRequirement: string[];
  objectionLevel: 'Low' | 'Medium' | 'High';
  likelyObjections: ObjectionType[];
  urgencyLevel: 'Low' | 'Medium' | 'High';
  ctaIntensity: CtaIntensity;
  ctaPlacement: CtaPlacement;
  ctaStyle: CtaStyle;
  conversionSequence: ConversionStep[];
  requiredAssets: string[];
  recommendedFollowUps: string[];
  recommendedChannels: string[];
  recommendedCampaignGoals: string[];
  recommendedPlatforms: string[];
  decisionReasons: string[];
  confidence: number;
  signals: string[];
  metadata: Record<string, unknown>;
}

const n = (arr: KnowledgeItem[]) => arr.length;

interface ConvSignals {
  pricing: number; ctas: number; testimonials: number; caseStudies: number; comparisons: number;
  statistics: number; benefits: number; painPoints: number; references: number; faqs: number; competitors: number;
  strategyId: string; communicationGoal: string; decisionStage: string; trustLevel: string; buyerType: string;
  awarenessStage: string; ctaIntensity: CtaIntensity; technical: boolean; urgencyCue: boolean; newsletterCue: boolean;
  consultationCue: boolean; demoCue: boolean; trialCue: boolean; surveyCue: boolean; eventCue: boolean;
}

function toSignals(intel: ContentIntelligence, strategy: CommunicationStrategyResult, journey: AudienceJourneyResult): ConvSignals {
  const text = ['benefits', 'painPoints', 'solutions', 'ctas', 'keywords'].flatMap((c) => intel[c as keyof ContentIntelligence] as KnowledgeItem[]).map((i) => i.text.toLowerCase()).join(' ');
  const has = (re: RegExp) => re.test(text);
  return {
    pricing: n(intel.pricing), ctas: n(intel.ctas), testimonials: n(intel.testimonials), caseStudies: n(intel.caseStudies),
    comparisons: n(intel.comparisons), statistics: n(intel.statistics), benefits: n(intel.benefits), painPoints: n(intel.painPoints),
    references: n(intel.references), faqs: n(intel.faqs), competitors: n(intel.competitors),
    strategyId: strategy.selectedStrategy.id, communicationGoal: strategy.selectedStrategy.communicationGoal,
    decisionStage: journey.selectedJourney.decisionStage, trustLevel: journey.selectedJourney.trustLevel,
    buyerType: journey.selectedJourney.buyerType, awarenessStage: journey.selectedJourney.awarenessStage,
    ctaIntensity: journey.selectedJourney.ctaIntensity as CtaIntensity,
    technical: has(/\bapi\b|\bsdk\b|\bdeveloper|\bintegrat/),
    urgencyCue: has(/\blimited|\bnow\b|\btoday\b|\bhurry|\bdeadline|\bending soon|\blast chance/),
    newsletterCue: has(/\bnewsletter|\bsubscribe\b|\bweekly\b/), consultationCue: has(/\bconsult|\btalk to (us|sales)|\bbook a call/),
    demoCue: has(/\bdemo\b|\bsee it in action|\bwalkthrough/), trialCue: has(/\btrial\b|\btry (it )?free|\bfree trial/),
    surveyCue: has(/\bsurvey\b|\bfeedback\b|\bpoll\b/),
    eventCue: has(/\bevent\b|\bregister\b|\brsvp\b|\bwebinar\b|\bsave your seat\b|\blive session\b|\bworkshop\b/),
  };
}

/* ── Conversion goal (deterministic cascade — first match wins) ────────── */

const GOAL_RULES: Array<{ goal: ConversionGoal; when: (s: ConvSignals) => boolean; reason: string }> = [
  { goal: 'Hiring', when: (s) => s.strategyId === 'hiring' || s.strategyId === 'recruitment', reason: 'Hiring strategy' },
  { goal: 'Event Registration', when: (s) => s.eventCue && (s.strategyId === 'event-promotion' || s.strategyId === 'webinar' || s.ctas > 0), reason: 'Event/webinar registration' },
  { goal: 'Survey', when: (s) => s.surveyCue, reason: 'Survey/feedback language' },
  { goal: 'Support', when: (s) => s.strategyId === 'faq' || (s.faqs >= 2 && s.decisionStage === 'Implement'), reason: 'FAQ/support content' },
  { goal: 'Retention', when: (s) => s.buyerType === 'Customer' || s.decisionStage === 'Implement', reason: 'Existing-customer journey' },
  { goal: 'Advocacy', when: (s) => s.decisionStage === 'Recommend', reason: 'Advocate stage' },
  { goal: 'Newsletter Signup', when: (s) => s.newsletterCue, reason: 'Newsletter language' },
  { goal: 'Consultation', when: (s) => s.consultationCue, reason: 'Consultation language' },
  { goal: 'Demo Request', when: (s) => s.demoCue && s.pricing === 0, reason: 'Demo language' },
  { goal: 'Trial', when: (s) => s.trialCue, reason: 'Free-trial language' },
  { goal: 'Purchase', when: (s) => s.pricing > 0 && s.ctas > 0 && (s.decisionStage === 'Purchase' || s.decisionStage === 'Compare'), reason: 'Pricing + CTA at decision' },
  { goal: 'Lead Generation', when: (s) => s.ctas > 0 && (s.benefits > 0 || s.painPoints > 0), reason: 'CTA with benefits/pains' },
  { goal: 'Engagement', when: (s) => s.communicationGoal === 'engagement', reason: 'Engagement goal' },
  { goal: 'Education', when: (s) => s.communicationGoal === 'education', reason: 'Education goal' },
];

function classifyGoal(s: ConvSignals): { goal: ConversionGoal; reason: string } {
  const hit = GOAL_RULES.find((r) => r.when(s));
  if (hit) return { goal: hit.goal, reason: hit.reason };
  return { goal: 'Awareness', reason: 'Default awareness (no conversion signal)' };
}

const STAGE_OF_GOAL: Partial<Record<ConversionGoal, string>> = {
  Awareness: 'Top of Funnel', Education: 'Top of Funnel', Engagement: 'Top of Funnel',
  'Lead Generation': 'Middle of Funnel', 'Newsletter Signup': 'Middle of Funnel', 'Event Registration': 'Middle of Funnel',
  Consultation: 'Bottom of Funnel', 'Demo Request': 'Bottom of Funnel', Trial: 'Bottom of Funnel', Purchase: 'Bottom of Funnel',
  Upsell: 'Post-Purchase', 'Cross Sell': 'Post-Purchase', Retention: 'Post-Purchase', Advocacy: 'Post-Purchase',
  Hiring: 'Recruitment', Recruitment: 'Recruitment', Support: 'Post-Purchase', Survey: 'Post-Purchase', Feedback: 'Post-Purchase', Community: 'Engagement',
};

/* ── Trust / objections / CTA / channels / assets ──────────────────────── */

const TRUST_MAP: Record<string, TrustRequirement> = { Low: 'Basic', Medium: 'Medium', High: 'High', 'Very High': 'Critical' };

function proofRequirement(s: ConvSignals, journey: AudienceJourneyResult): string[] {
  const req = new Set<string>(journey.selectedJourney.requiredEvidence);
  if (s.testimonials > 0) req.add('Testimonials');
  if (s.statistics > 0) req.add('Statistics');
  if (s.caseStudies > 0) req.add('Case Studies');
  if (s.comparisons > 0) req.add('Comparisons');
  if (s.pricing > 0) req.add('Pricing');
  if (s.references > 0) req.add('References');
  if (s.faqs > 0) req.add('FAQs');
  return Array.from(req).sort();
}

function objections(s: ConvSignals): ObjectionType[] {
  const out = new Set<ObjectionType>();
  if (s.pricing > 0) { out.add('Price'); out.add('Budget'); }
  if (s.competitors > 0 || s.comparisons > 0) out.add('Competition');
  if (s.technical) { out.add('Complexity'); out.add('Implementation'); out.add('Compatibility'); }
  if (s.trustLevel === 'Low' || s.trustLevel === 'Medium') { out.add('Trust'); out.add('Risk'); }
  if (s.painPoints > 0) out.add('Need');
  if (s.decisionStage === 'Purchase' || s.decisionStage === 'Compare') { out.add('Time'); out.add('Resources'); }
  return Array.from(out).sort();
}

function ctaPlacement(stage: string): CtaPlacement {
  if (stage === 'Top of Funnel') return 'Closing';
  if (stage === 'Bottom of Funnel') return 'Repeated';
  if (stage === 'Recruitment') return 'Closing';
  return 'Middle';
}
function ctaStyle(goal: ConversionGoal, urgency: boolean): CtaStyle {
  if (urgency) return 'Urgent';
  if (goal === 'Purchase' || goal === 'Upsell' || goal === 'Cross Sell' || goal === 'Trial') return 'Commercial';
  if (goal === 'Demo Request' || goal === 'Consultation') return 'Consultative';
  if (goal === 'Education' || goal === 'Awareness') return 'Educational';
  if (goal === 'Community' || goal === 'Hiring' || goal === 'Recruitment') return 'Community';
  return 'Exploratory';
}

function requiredAssets(goal: ConversionGoal): string[] {
  const M: Partial<Record<ConversionGoal, string[]>> = {
    'Lead Generation': ['Landing Page', 'Lead Magnet', 'Email Sequence'],
    'Newsletter Signup': ['Newsletter', 'Lead Magnet'],
    'Event Registration': ['Landing Page', 'Email Sequence', 'Calendar'],
    'Demo Request': ['Demo Video', 'Pricing Page', 'Case Study'],
    Trial: ['Landing Page', 'Onboarding Guide', 'FAQ'],
    Purchase: ['Pricing Page', 'Comparison Sheet', 'FAQ', 'Case Study'],
    Consultation: ['Calendar', 'Case Study', 'Pricing Page'],
    Education: ['Blog', 'Guide', 'Checklist'],
    Awareness: ['Blog', 'Video'],
    Retention: ['Guide', 'FAQ', 'Newsletter'],
    Advocacy: ['Case Study', 'Community'],
    Hiring: ['Careers Page', 'Culture Video'],
    Support: ['FAQ', 'Help Center'],
  };
  return M[goal] ?? ['Landing Page'];
}

function channels(goal: ConversionGoal, platforms: string[]): string[] {
  const base = new Set<string>(platforms.map((p) => p[0]!.toUpperCase() + p.slice(1)));
  base.add('Email');
  if (goal === 'Demo Request' || goal === 'Consultation' || goal === 'Purchase') base.add('Sales Call');
  if (goal === 'Event Registration') base.add('Webinar');
  if (goal === 'Community' || goal === 'Advocacy' || goal === 'Hiring') base.add('Community');
  if (goal === 'Lead Generation' || goal === 'Purchase') base.add('Remarketing');
  return Array.from(base).sort();
}

/* ── Conversion sequence (from the upstream journey content order) ─────── */

const ACTION_OF_STAGE: Array<[RegExp, string]> = [
  [/hook|attention|cover/, 'Capture attention'], [/problem|pain/, 'Recognize the problem'],
  [/solution|approach|insight/, 'Understand the solution'], [/evidence|proof|stat|result/, 'Believe the proof'],
  [/trust|testimon|case/, 'Build trust'], [/offer|pricing|value/, 'Consider the offer'],
  [/cta|follow|action|next|recap/, 'Take the action'], [/story|narrative/, 'Engage with the story'],
  [/framework|criteria/, 'Grasp the structure'], [/summary|takeaway/, 'Retain the message'],
  [/example|demo|in action/, 'See it work'], [/comparison|verdict/, 'Decide between options'],
];
const actionFor = (stage: string): string => { const lc = stage.toLowerCase(); const hit = ACTION_OF_STAGE.find(([re]) => re.test(lc)); return hit ? hit[1] : 'Process the message'; };

/* ── Builder ───────────────────────────────────────────────────────────── */

export interface ConversionInput {
  intel: ContentIntelligence;
  strategy: CommunicationStrategyResult;
  journey: AudienceJourneyResult;
  message: MessageDocument;
  plan: VisualMessagingPlan;
  assetFamily: TemplateAssetFamily;
}

export function buildConversionStrategy(input: ConversionInput): ConversionStrategy {
  const s = toSignals(input.intel, input.strategy, input.journey);
  const { goal, reason } = classifyGoal(s);
  const stage = STAGE_OF_GOAL[goal] ?? 'Middle of Funnel';
  const trust = TRUST_MAP[s.trustLevel] ?? 'Medium';
  const proof = proofRequirement(s, input.journey);
  const objs = objections(s);
  const urgency: ConversionStrategy['urgencyLevel'] = s.urgencyCue || goal === 'Event Registration' ? 'High' : (goal === 'Purchase' || goal === 'Demo Request' || goal === 'Trial') ? 'Medium' : 'Low';
  const placement = ctaPlacement(stage);
  const style = ctaStyle(goal, s.urgencyCue);

  // Conversion sequence from the journey's recommended content order.
  const order = input.journey.selectedJourney.recommendedContentOrder;
  const planUnits = input.plan.slides.length ? input.plan.slides : input.plan.sections;
  const conversionSequence: ConversionStep[] = order.map((label, i) => {
    const unit = planUnits[Math.min(i, Math.max(0, planUnits.length - 1))];
    const isCta = /cta|action|follow|recap/i.test(label);
    return {
      id: `cs-${i}`, stage: label, purpose: `Move the audience: ${label}`, expectedAction: actionFor(label),
      requiredEvidence: /evidence|proof|stat|trust/i.test(label) ? proof : [],
      recommendedMessage: unit?.headline ?? (i === 0 ? input.message.mainMessage : ''),
      recommendedVisualSupport: unit?.recommendedVisual ?? 'Illustration',
      priority: isCta ? 5 : Math.max(1, 4 - Math.floor(i / 2)),
      importance: i === 0 || isCta ? 'HIGH' : 'MEDIUM', notes: `${label} → ${unit?.recommendedHierarchy ?? 'Supporting'}`,
    };
  });

  const objectionLevel: ConversionStrategy['objectionLevel'] = objs.length >= 5 ? 'High' : objs.length >= 2 ? 'Medium' : 'Low';
  const signals = Array.from(new Set([goal, `stage:${stage}`, `trust:${trust}`, ...objs.map((o) => `obj:${o}`)]));
  const decisionReasons = [reason, `Trust ${trust} from ${s.trustLevel} journey`, `${objs.length} likely objection(s)`];
  // Confidence: presence of conversion signals (CTA + proof + clear stage).
  const confidence = Math.round((Math.min(1, (s.ctas > 0 ? 0.4 : 0.1) + (proof.length ? 0.3 : 0) + (goal !== 'Awareness' ? 0.3 : 0.1))) * 100) / 100;

  return {
    id: `conv-${goal.toLowerCase().replace(/\s+/g, '-')}`,
    conversionGoal: goal, primaryConversion: goal,
    secondaryConversions: goal === 'Purchase' ? ['Demo Request', 'Newsletter Signup'] : goal === 'Lead Generation' ? ['Newsletter Signup'] : goal === 'Awareness' ? ['Engagement'] : [],
    conversionStage: stage, conversionJourney: input.journey.selectedJourney.journeyName,
    trustRequirement: trust, proofRequirement: proof, objectionLevel, likelyObjections: objs, urgencyLevel: urgency,
    ctaIntensity: s.ctaIntensity, ctaPlacement: placement, ctaStyle: style,
    conversionSequence, requiredAssets: requiredAssets(goal), recommendedFollowUps: requiredAssets(goal).slice(0, 2),
    recommendedChannels: channels(goal, input.strategy.selectedStrategy.recommendedPlatforms),
    recommendedCampaignGoals: input.strategy.selectedStrategy.recommendedCampaignGoals,
    recommendedPlatforms: input.strategy.selectedStrategy.recommendedPlatforms,
    decisionReasons, confidence, signals,
    metadata: { strategy: s.strategyId, journey: input.journey.selectedJourney.id, blueprint: input.plan.storyBlueprint },
  };
}

/* ── Package bridge ────────────────────────────────────────────────────── */

export function packageConversionStrategy(pkg: ContentPackage, assetFamily: TemplateAssetFamily): ConversionStrategy {
  // Reuse the full upstream chain (no new extraction, no AI).
  const intel = packageIntelligence(pkg);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content: packageToArchitectureBody(pkg), source: 'extraction', id: pkg.id });
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily, planId: `vmp-${pkg.id}-${assetFamily}` });
  return buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily });
}

/* ── Bridges / search / summary ────────────────────────────────────────── */

/** Visual bridge — conversion hints the Visual Messaging Plan/templates may use. */
export function conversionVisualHints(conv: ConversionStrategy): {
  ctaEmphasis: CtaIntensity; evidencePriority: string[]; trustEmphasis: TrustRequirement; offerPlacement: CtaPlacement; conversionOrder: string[];
} {
  return { ctaEmphasis: conv.ctaIntensity, evidencePriority: conv.proofRequirement, trustEmphasis: conv.trustRequirement, offerPlacement: conv.ctaPlacement, conversionOrder: conv.conversionSequence.map((c) => c.stage) };
}

/** Template bridge — explicit conversion guidance (no template-architecture change). */
export function planToTemplateConversionFields(conv: ConversionStrategy): Record<string, unknown> {
  const cta = conv.conversionSequence.find((c) => /cta|action|follow/i.test(c.stage));
  return {
    cta: cta?.recommendedMessage ?? '', cta_intensity: conv.ctaIntensity, cta_placement: conv.ctaPlacement, cta_style: conv.ctaStyle,
    offer: conv.primaryConversion, proof: conv.proofRequirement, trust: conv.trustRequirement,
    conversion_sequence: conv.conversionSequence.map((c) => c.stage),
  };
}

export interface ConversionSummary {
  primaryConversion: string; journey: string; trustLevel: TrustRequirement; evidenceRequired: string[];
  cta: { intensity: CtaIntensity; placement: CtaPlacement; style: CtaStyle }; requiredAssets: string[];
  channels: string[]; confidence: number; reasons: string[];
}
export function summarizeConversionStrategy(conv: ConversionStrategy): ConversionSummary {
  return {
    primaryConversion: conv.primaryConversion, journey: conv.conversionJourney, trustLevel: conv.trustRequirement,
    evidenceRequired: conv.proofRequirement, cta: { intensity: conv.ctaIntensity, placement: conv.ctaPlacement, style: conv.ctaStyle },
    requiredAssets: conv.requiredAssets, channels: conv.recommendedChannels, confidence: conv.confidence, reasons: conv.decisionReasons,
  };
}

const SEARCH_ALIASES: Array<[RegExp, (c: ConversionStrategy) => unknown]> = [
  [/\bcta\b|action/, (c) => ({ intensity: c.ctaIntensity, placement: c.ctaPlacement, style: c.ctaStyle })],
  [/\bobjection/, (c) => c.likelyObjections],
  [/\btrust/, (c) => ({ requirement: c.trustRequirement, proof: c.proofRequirement })],
  [/required asset|\basset/, (c) => c.requiredAssets],
  [/landing page/, (c) => c.requiredAssets.filter((a) => /landing/i.test(a))],
  [/\bdemo/, (c) => (c.conversionGoal === 'Demo Request' ? [c.conversionGoal] : [])],
  [/\bproof|evidence/, (c) => c.proofRequirement],
  [/\bchannel/, (c) => c.recommendedChannels],
];
/** Deterministic search over the conversion strategy. */
export function searchConversionStrategy(conv: ConversionStrategy, query: string): unknown {
  const q = query.toLowerCase().replace(/^find\s+/, '').trim();
  for (const [re, sel] of SEARCH_ALIASES) if (re.test(q)) return sel(conv);
  return conv.conversionSequence.filter((c) => `${c.stage} ${c.purpose} ${c.recommendedMessage}`.toLowerCase().includes(q));
}
