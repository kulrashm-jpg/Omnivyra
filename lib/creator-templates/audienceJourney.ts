/**
 * Audience Journey Engine — the deterministic planning layer between
 * Communication Strategy and Content Architecture. It determines WHO the content
 * speaks to, WHERE they are in their journey, and HOW trust should progressively
 * build — BEFORE the architecture sequences anything. Pure + read-only: input is
 * ONLY a CommunicationStrategyResult + a ContentIntelligence; no AI, no
 * generation, no rewriting, no rendering, no side effects, no randomness.
 * Additive — it exposes recommendations others MAY consume; it changes nothing.
 */

import type { ContentIntelligence, KnowledgeItem } from './contentIntelligence';
import type { CommunicationStrategyResult } from './communicationStrategy';
import type { StoryBlueprintId } from './storyBlueprint';

export type AwarenessStage = 'Unaware' | 'Problem Aware' | 'Solution Aware' | 'Product Aware' | 'Brand Aware' | 'Evaluation' | 'Decision' | 'Customer' | 'Advocate';
export type KnowledgeLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
export type TrustLevel = 'Low' | 'Medium' | 'High' | 'Very High';
export type DecisionStage = 'Discover' | 'Learn' | 'Evaluate' | 'Compare' | 'Validate' | 'Purchase' | 'Implement' | 'Expand' | 'Recommend';
export type BuyerType = 'Executive' | 'Founder' | 'Marketing' | 'Sales' | 'Technical' | 'Developer' | 'HR' | 'Finance' | 'Procurement' | 'Operations' | 'Customer' | 'Community' | 'Investor' | 'Student' | 'General Audience';
export type CtaIntensity = 'Soft' | 'Medium' | 'Strong' | 'Urgent';

export interface AudienceJourney {
  id: string;
  journeyName: string;
  description: string;
  buyerType: BuyerType;
  awarenessStage: AwarenessStage;
  knowledgeLevel: KnowledgeLevel;
  trustLevel: TrustLevel;
  decisionStage: DecisionStage;
  buyingIntent: 'None' | 'Low' | 'Medium' | 'High';
  primaryObjective: string;
  primaryObstacle: string;
  primaryQuestions: string[];
  emotionalDrivers: string[];
  logicalDrivers: string[];
  requiredEvidence: string[];
  ctaIntensity: CtaIntensity;
  recommendedContentOrder: string[];
  recommendedBlueprints: StoryBlueprintId[];
  recommendedCampaignGoals: string[];
  recommendedPlatforms: string[];
  // Filled at classification time:
  decisionReasons: string[];
  confidence: number;
  signals: string[];
}

interface Rule { when: (s: JourneySignals) => boolean; points: number; reason: string; signal: string; }
interface JourneyDef extends Omit<AudienceJourney, 'decisionReasons' | 'confidence' | 'signals'> { rules: Rule[]; }

/* ── Signals (from Strategy + Intelligence ONLY) ───────────────────────── */

export interface JourneySignals {
  painPoints: number; solutions: number; benefits: number; products: number; services: number;
  comparisons: number; statistics: number; statisticsHigh: number; caseStudies: number;
  testimonials: number; socialProof: number; pricing: number; faqs: number; ctas: number;
  frameworks: number; timelines: number; processes: number; references: number; claims: number;
  quotes: number; keywords: number; audiences: number; industries: number;
  strategyId: string; intent: string; goal: string; audienceStyle: string;
  technical: boolean; executive: boolean; caseStudyCue: boolean;
}

const n = (arr: KnowledgeItem[]) => arr.length;
const high = (arr: KnowledgeItem[]) => arr.filter((i) => i.importance === 'HIGH').length;

export function toJourneySignals(strategy: CommunicationStrategyResult, intel: ContentIntelligence): JourneySignals {
  const cats: Array<keyof ContentIntelligence> = ['products', 'services', 'audiences', 'industries', 'benefits', 'painPoints', 'solutions', 'processes', 'frameworks', 'keywords', 'entities'];
  const text = cats.flatMap((c) => (intel[c] as KnowledgeItem[])).map((i) => i.text.toLowerCase()).join(' ');
  const has = (re: RegExp) => re.test(text);
  const sel = strategy.selectedStrategy;
  return {
    painPoints: n(intel.painPoints), solutions: n(intel.solutions), benefits: n(intel.benefits),
    products: n(intel.products), services: n(intel.services), comparisons: n(intel.comparisons),
    statistics: n(intel.statistics), statisticsHigh: high(intel.statistics), caseStudies: n(intel.caseStudies),
    testimonials: n(intel.testimonials), socialProof: n(intel.socialProof), pricing: n(intel.pricing),
    faqs: n(intel.faqs), ctas: n(intel.ctas), frameworks: n(intel.frameworks), timelines: n(intel.timelines),
    processes: n(intel.processes), references: n(intel.references), claims: n(intel.claims), quotes: n(intel.quotes),
    keywords: n(intel.keywords), audiences: n(intel.audiences), industries: n(intel.industries),
    strategyId: sel.id, intent: sel.communicationIntent, goal: sel.communicationGoal, audienceStyle: sel.primaryAudienceStyle,
    technical: has(/\bapi\b|\bsdk\b|\bcode\b|\bdeveloper|\bintegration|\bdeploy|\bendpoint|\bschema\b/),
    executive: sel.primaryAudienceStyle === 'executive' || has(/\bceo|\bcto|\bcmo|\bexecutive|\bboard\b|\broi\b/),
    caseStudyCue: sel.id === 'case-study' || n(intel.caseStudies) > 0,
  };
}

/* ── Journey catalog ───────────────────────────────────────────────────── */

function J(id: string, name: string, buyer: BuyerType, awareness: AwarenessStage, knowledge: KnowledgeLevel, trust: TrustLevel, decision: DecisionStage, intent: AudienceJourney['buyingIntent'], objective: string, obstacle: string, questions: string[], emotional: string[], logical: string[], evidence: string[], cta: CtaIntensity, order: string[], blueprints: StoryBlueprintId[], goals: string[], platforms: string[], rules: Rule[]): JourneyDef {
  return { id, journeyName: name, description: `${name} audience journey`, buyerType: buyer, awarenessStage: awareness, knowledgeLevel: knowledge, trustLevel: trust, decisionStage: decision, buyingIntent: intent, primaryObjective: objective, primaryObstacle: obstacle, primaryQuestions: questions, emotionalDrivers: emotional, logicalDrivers: logical, requiredEvidence: evidence, ctaIntensity: cta, recommendedContentOrder: order, recommendedBlueprints: blueprints, recommendedCampaignGoals: goals, recommendedPlatforms: platforms, rules };
}
const R = (when: Rule['when'], points: number, reason: string, signal: string): Rule => ({ when, points, reason, signal });

const CATALOG: JourneyDef[] = [
  J('unaware', 'Unaware', 'General Audience', 'Unaware', 'Beginner', 'Low', 'Discover', 'None',
    'Spark recognition of a latent problem', 'No awareness of the problem',
    ['Is this relevant to me?'], ['curiosity'], ['relevance'], ['Statistics'], 'Soft',
    ['Hook', 'Story', 'Insight', 'Example', 'Summary'], ['storytelling', 'thought-leadership'], ['awareness', 'brand'], ['instagram', 'linkedin'], [
    R((s) => s.painPoints === 0 && s.solutions === 0 && s.products === 0 && s.pricing === 0, 1, 'No problem/solution/product framing', 'broad')]),
  J('problem-aware', 'Problem Aware', 'General Audience', 'Problem Aware', 'Beginner', 'Low', 'Learn', 'Low',
    'Help the reader name and understand their problem', 'Underestimating the problem',
    ['Why does this matter?', 'How bad is it?'], ['frustration', 'hope'], ['cause-and-effect'], ['Statistics'], 'Soft',
    ['Problem', 'Impact', 'Cause', 'Insight', 'CTA'], ['problem-solution', 'educational'], ['awareness', 'education'], ['linkedin', 'instagram'], [
    R((s) => s.painPoints > 0 && s.pricing === 0, 3, 'Pain points without buying signals', 'painPoints'),
    R((s) => s.benefits > 0 && s.comparisons === 0, 1, 'Educational benefit framing', 'benefits')]),
  J('solution-aware', 'Solution Aware', 'Marketing', 'Solution Aware', 'Intermediate', 'Medium', 'Evaluate', 'Medium',
    'Show that a solution category exists and works', 'Skepticism that it will work for them',
    ['How does this solve it?', 'Will it work for me?'], ['relief'], ['mechanism'], ['Statistics', 'Implementation Steps'], 'Medium',
    ['Problem', 'Solution', 'How it works', 'Proof', 'CTA'], ['problem-solution', 'process'], ['consideration', 'education'], ['linkedin'], [
    R((s) => s.solutions > 0 && s.benefits > 0 && s.comparisons === 0 && s.pricing === 0, 3, 'Solutions + benefits, pre-comparison', 'solutions+benefits')]),
  J('product-aware', 'Product Aware', 'Marketing', 'Product Aware', 'Intermediate', 'Medium', 'Compare', 'Medium',
    'Differentiate the product', 'Unsure why this product over others',
    ['Why this one?', 'How is it different?'], ['confidence'], ['differentiation'], ['Comparison', 'Statistics'], 'Medium',
    ['Overview', 'Capability', 'Differentiation', 'Proof', 'CTA'], ['product-walkthrough', 'comparison'], ['consideration', 'product_launch'], ['linkedin', 'instagram'], [
    R((s) => s.products > 0 && s.benefits > 0 && (s.pricing > 0 || s.comparisons > 0), 3, 'Product + benefits + comparison/pricing', 'products+benefits')]),
  J('evaluation', 'Evaluation', 'Executive', 'Evaluation', 'Advanced', 'High', 'Compare', 'High',
    'Win the head-to-head evaluation', 'Risk of choosing wrong',
    ['How does it compare?', 'What proof is there?'], ['assurance'], ['evidence', 'comparison'], ['Statistics', 'Case Studies', 'Comparison'], 'Strong',
    ['Criteria', 'Comparison', 'Evidence', 'Verdict', 'CTA'], ['comparison', 'case-study'], ['conversion', 'consideration'], ['linkedin'], [
    R((s) => s.statistics > 0 && (s.caseStudies > 0 || s.testimonials > 0) && s.comparisons > 0, 4, 'Statistics + proof + comparison', 'statistics+caseStudies+comparisons'),
    R((s) => s.strategyId === 'statistics-driven' || s.strategyId === 'comparison', 1, 'Evaluative strategy', 'strategy')]),
  J('decision', 'Decision', 'Executive', 'Decision', 'Advanced', 'High', 'Purchase', 'High',
    'Convert the ready buyer', 'Final hesitation / friction',
    ['What does it cost?', 'How do I start?'], ['urgency'], ['ROI', 'price'], ['Pricing', 'Guarantees', 'ROI'], 'Strong',
    ['Value', 'Pricing', 'Proof', 'Guarantee', 'CTA'], ['problem-solution'], ['conversion', 'product_launch'], ['linkedin', 'facebook'], [
    R((s) => s.pricing > 0 && s.ctas > 0, 4, 'Pricing + call-to-action', 'pricing+ctas'),
    R((s) => s.strategyId === 'product-marketing', 1, 'Conversion strategy', 'strategy')]),
  J('validation', 'Validation (Trust)', 'Executive', 'Evaluation', 'Advanced', 'Very High', 'Validate', 'High',
    'Remove the last doubt with proof', 'Trust deficit',
    ['Who else uses this?', 'Did it actually work?'], ['reassurance'], ['social proof'], ['Testimonials', 'Case Studies', 'References'], 'Strong',
    ['Claim', 'Evidence', 'Testimonial', 'Result', 'CTA'], ['case-study'], ['conversion', 'consideration'], ['linkedin', 'instagram'], [
    // Proof WITHOUT a comparison → validation; with a comparison it is an evaluation.
    R((s) => s.testimonials > 0 && (s.caseStudies > 0 || s.caseStudyCue) && s.comparisons === 0, 4, 'Testimonials + case studies (no comparison)', 'testimonials+caseStudies'),
    R((s) => s.socialProof > 0 && s.comparisons === 0, 1, 'Social proof present', 'socialProof')]),
  J('customer', 'Customer (Onboarding)', 'Customer', 'Customer', 'Intermediate', 'High', 'Implement', 'None',
    'Help existing customers succeed', 'Activation friction',
    ['How do I set this up?', 'Where do I get help?'], ['competence'], ['how-to'], ['Implementation Steps'], 'Soft',
    ['Goal', 'Steps', 'Tips', 'Support', 'CTA'], ['process', 'faq'], ['retention', 'support'], ['linkedin', 'youtube'], [
    R((s) => s.faqs > 0 && (s.processes > 0 || s.strategyId === 'faq'), 3, 'FAQs + implementation steps', 'faqs+processes')]),
  J('advocate', 'Advocate', 'Community', 'Advocate', 'Advanced', 'Very High', 'Recommend', 'None',
    'Turn happy customers into referrers', 'Lack of a reason to share',
    ['Why should I recommend this?'], ['pride', 'belonging'], ['shared values'], ['Testimonials', 'References'], 'Soft',
    ['Story', 'Impact', 'Community', 'Invite'], ['storytelling'], ['engagement', 'brand'], ['instagram', 'facebook'], [
    R((s) => s.testimonials > 0 && s.socialProof > 0 && s.ctas === 0, 3, 'Proof-rich, low-pressure', 'testimonials+socialProof')]),
  J('executive', 'Executive Brief', 'Executive', 'Evaluation', 'Advanced', 'High', 'Evaluate', 'Medium',
    'Give leaders the bottom line fast', 'Limited time / high scrutiny',
    ['What is the ROI?', 'What is the risk?'], ['confidence'], ['ROI', 'evidence'], ['Statistics', 'ROI', 'References'], 'Medium',
    ['Bottom line', 'Evidence', 'Implication', 'CTA'], ['statistics', 'framework'], ['authority', 'conversion'], ['linkedin'], [
    R((s) => s.executive && (s.statistics > 0 || s.frameworks > 0), 3, 'Executive audience with data/frameworks', 'executive'),
    R((s) => s.strategyId === 'research-summary' || s.strategyId === 'executive-summary', 1, 'Executive strategy', 'strategy')]),
  J('developer', 'Developer / Technical', 'Developer', 'Solution Aware', 'Expert', 'Medium', 'Learn', 'Medium',
    'Show a technical audience exactly how it works', 'Doubt about technical fit',
    ['How does it integrate?', 'What are the constraints?'], ['mastery'], ['architecture', 'how-to'], ['Implementation Steps', 'References'], 'Soft',
    ['Context', 'How it works', 'Steps', 'Caveats', 'CTA'], ['process', 'step-by-step'], ['education', 'activation'], ['linkedin', 'youtube'], [
    R((s) => s.technical && s.processes > 0, 3, 'Technical process content', 'technical+processes'),
    R((s) => s.technical, 1, 'Technical signals', 'technical')]),
  J('candidate', 'Candidate (Hiring)', 'HR', 'Brand Aware', 'Beginner', 'Medium', 'Discover', 'Low',
    'Attract and excite potential hires', 'Unfamiliarity / fit doubt',
    ['What is it like to work here?', 'Why should I apply?'], ['belonging', 'ambition'], ['culture', 'opportunity'], ['Testimonials'], 'Medium',
    ['Hook', 'Culture', 'Opportunity', 'Proof', 'CTA'], ['storytelling', 'thought-leadership'], ['recruitment'], ['linkedin', 'instagram'], [
    R((s) => s.strategyId === 'hiring' || s.strategyId === 'recruitment', 4, 'Hiring strategy', 'strategy')]),
  J('event-awareness', 'Event Awareness', 'General Audience', 'Brand Aware', 'Beginner', 'Medium', 'Discover', 'Low',
    'Drive registrations / attendance', 'Low urgency to act',
    ['What is it?', 'Why attend?', 'When?'], ['anticipation', 'fomo'], ['agenda', 'value'], ['Statistics'], 'Strong',
    ['Hook', 'What/When', 'Value', 'Speakers', 'CTA'], ['storytelling'], ['engagement', 'awareness'], ['instagram', 'linkedin'], [
    R((s) => s.strategyId === 'event-promotion' || s.strategyId === 'webinar', 4, 'Event/webinar strategy', 'strategy')]),
  J('expert', 'Expert Deep-Dive', 'Technical', 'Solution Aware', 'Expert', 'High', 'Evaluate', 'Medium',
    'Earn credibility with an expert audience', 'High bar for substance',
    ['Is this rigorous?', 'What is the evidence?'], ['respect'], ['rigor', 'evidence'], ['Statistics', 'References', 'Comparison'], 'Soft',
    ['Premise', 'Framework', 'Evidence', 'Application', 'CTA'], ['framework', 'statistics'], ['authority', 'education'], ['linkedin'], [
    R((s) => s.frameworks > 0 && s.statistics > 0 && s.references > 0, 3, 'Framework + data + references', 'frameworks+statistics+references')]),
];

/* ── Classification + scoring ──────────────────────────────────────────── */

export interface ScoredJourney { journey: AudienceJourney; score: number; matchedRules: string[]; matchedSignals: string[]; }
export interface AudienceJourneyResult {
  selectedJourney: AudienceJourney;
  candidateJourneys: ScoredJourney[];
  decisionLog: string[];
  matchedSignals: string[];
  confidence: number;
  reason: string;
}

function publicJourney(def: JourneyDef, decisionReasons: string[], signals: string[], confidence: number): AudienceJourney {
  const j = { ...def, decisionReasons, signals, confidence } as AudienceJourney & Partial<JourneyDef>;
  delete j.rules;
  return j;
}

function scoreJourney(def: JourneyDef, s: JourneySignals): ScoredJourney {
  let score = 0; const matchedRules: string[] = []; const matchedSignals: string[] = [];
  for (const r of def.rules) if (r.when(s)) { score += r.points; matchedRules.push(r.reason); matchedSignals.push(r.signal); }
  return { journey: publicJourney(def, matchedRules, Array.from(new Set(matchedSignals)), 0), score, matchedRules, matchedSignals: Array.from(new Set(matchedSignals)) };
}

/** Classify the audience journey from Communication Strategy + Content Intelligence. */
export function classifyAudienceJourney(strategy: CommunicationStrategyResult, intel: ContentIntelligence): AudienceJourneyResult {
  const s = toJourneySignals(strategy, intel);
  const scored = CATALOG.map((def) => scoreJourney(def, s))
    .sort((a, b) => (b.score - a.score) || (a.journey.id < b.journey.id ? -1 : a.journey.id > b.journey.id ? 1 : 0));

  const top = scored[0] && scored[0].score > 0 ? scored[0] : scored.find((x) => x.journey.id === 'problem-aware')!;
  const runnerUp = scored.find((x) => x.journey.id !== top.journey.id && x.score > 0);
  const confidence = top.score <= 0 ? 0 : Math.round((top.score / (top.score + (runnerUp?.score ?? 0))) * 100) / 100;
  const selected = publicJourney(CATALOG.find((d) => d.id === top.journey.id)!, top.matchedRules, top.matchedSignals, confidence);
  const decisionLog = top.matchedRules.length ? top.matchedRules.map((r) => `${selected.journeyName}: ${r}`) : [`${selected.journeyName}: default (no strong signal)`];
  const reason = `Selected ${selected.journeyName} (${selected.awarenessStage} · ${selected.decisionStage}) — ${top.matchedRules[0] ?? 'default'} (confidence ${confidence}).`;
  return { selectedJourney: selected, candidateJourneys: scored, decisionLog, matchedSignals: top.matchedSignals, confidence, reason };
}

/* ── Catalog access / search / summary ─────────────────────────────────── */

export function listJourneys(): AudienceJourney[] {
  return CATALOG.map((d) => publicJourney(d, [], [], 0));
}
export function resolveJourney(id: string): AudienceJourney | null {
  return listJourneys().find((j) => j.id === id) ?? null;
}
export function searchJourneys(query: string): AudienceJourney[] {
  const q = query.toLowerCase().trim();
  if (!q) return listJourneys();
  return listJourneys().filter((j) => `${j.id} ${j.journeyName} ${j.buyerType} ${j.awarenessStage} ${j.decisionStage} ${j.knowledgeLevel} ${j.trustLevel}`.toLowerCase().includes(q));
}

export interface AudienceJourneySummary {
  journey: string; audience: BuyerType; awarenessStage: AwarenessStage; knowledgeLevel: KnowledgeLevel;
  trustLevel: TrustLevel; decisionStage: DecisionStage; buyingIntent: string; ctaIntensity: CtaIntensity;
  evidenceNeeded: string[]; recommendedContentOrder: string[]; recommendedBlueprint: StoryBlueprintId | null;
  confidence: number; reason: string;
}
export function summarizeAudienceJourney(result: AudienceJourneyResult): AudienceJourneySummary {
  const j = result.selectedJourney;
  return {
    journey: j.journeyName, audience: j.buyerType, awarenessStage: j.awarenessStage, knowledgeLevel: j.knowledgeLevel,
    trustLevel: j.trustLevel, decisionStage: j.decisionStage, buyingIntent: j.buyingIntent, ctaIntensity: j.ctaIntensity,
    evidenceNeeded: j.requiredEvidence, recommendedContentOrder: j.recommendedContentOrder,
    recommendedBlueprint: j.recommendedBlueprints[0] ?? null, confidence: result.confidence, reason: result.reason,
  };
}

/** What the Content Architecture MAY consume (it is not modified, not required to). */
export function journeyArchitectureHints(result: AudienceJourneyResult): {
  awarenessStage: AwarenessStage; decisionStage: DecisionStage; knowledgeLevel: KnowledgeLevel; trustLevel: TrustLevel;
  recommendedContentOrder: string[]; requiredEvidence: string[]; ctaIntensity: CtaIntensity; primaryQuestions: string[];
  decisionReasons: string[]; recommendedBlueprints: StoryBlueprintId[];
} {
  const j = result.selectedJourney;
  return {
    awarenessStage: j.awarenessStage, decisionStage: j.decisionStage, knowledgeLevel: j.knowledgeLevel, trustLevel: j.trustLevel,
    recommendedContentOrder: j.recommendedContentOrder, requiredEvidence: j.requiredEvidence, ctaIntensity: j.ctaIntensity,
    primaryQuestions: j.primaryQuestions, decisionReasons: j.decisionReasons, recommendedBlueprints: j.recommendedBlueprints,
  };
}
