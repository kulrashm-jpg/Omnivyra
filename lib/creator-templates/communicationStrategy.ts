/**
 * Communication Strategy Engine — the deterministic classification layer between
 * Content Intelligence and Content Architecture. It decides HOW the content
 * should communicate (intent / goal / audience style / tone) BEFORE the
 * architecture decides how to sequence it. Pure: input is ONLY a
 * `ContentIntelligence`; no AI, no reasoning, no randomness, no side effects.
 * Additive — it modifies nothing downstream; it only exposes recommendations
 * (blueprints / campaign goals / platforms / flow) that others MAY consume.
 */

import type { ContentIntelligence, KnowledgeItem } from './contentIntelligence';
import type { StoryBlueprintId } from './storyBlueprint';

export type CommunicationIntent = 'inform' | 'educate' | 'persuade' | 'inspire' | 'convert' | 'compare' | 'build_trust' | 'recruit' | 'announce';
export type AudienceStyle = 'general' | 'practitioner' | 'executive' | 'technical' | 'community';

export interface CommunicationStrategy {
  id: string;
  name: string;
  description: string;
  category: string;
  communicationIntent: CommunicationIntent;
  communicationGoal: string;
  primaryAudienceStyle: AudienceStyle;
  tonePattern: string;
  recommendedBlueprints: StoryBlueprintId[];
  recommendedCampaignGoals: string[];
  recommendedPlatforms: string[];
  recommendedContentTypes: string[];
  // Filled at classification time (empty in the static catalog):
  decisionReasons: string[];
  confidence: number;
  signals: string[];
}

interface Rule { when: (s: StrategySignals) => boolean; points: number; reason: string; signal: string; }

interface StrategyDef extends Omit<CommunicationStrategy, 'decisionReasons' | 'confidence' | 'signals'> {
  rules: Rule[];
}

/* ── Signals derived from Content Intelligence (counts + cues) ──────────── */

export interface StrategySignals {
  statistics: number; statisticsHigh: number; comparisons: number; painPoints: number; solutions: number;
  ctas: number; timelines: number; quotes: number; testimonials: number; socialProof: number; caseStudies: number;
  frameworks: number; products: number; services: number; benefits: number; pricing: number; competitors: number;
  processes: number; faqs: number; claims: number; risks: number; references: number; keywords: number;
  audiences: number; industries: number; numbers: number;
  // keyword cues (deterministic regex over extracted text)
  hiring: boolean; event: boolean; webinar: boolean; announcement: boolean; research: boolean; trend: boolean;
  opinion: boolean; myth: boolean; checklist: boolean; roadmap: boolean; objection: boolean; community: boolean;
  execSummary: boolean; story: boolean; transformation: boolean; decision: boolean;
  executiveAudience: boolean; caseStudy: boolean;
}

const n = (arr: KnowledgeItem[]) => arr.length;
const high = (arr: KnowledgeItem[]) => arr.filter((i) => i.importance === 'HIGH').length;

export function toSignals(intel: ContentIntelligence): StrategySignals {
  const cats: Array<keyof ContentIntelligence> = ['entities', 'products', 'services', 'audiences', 'industries', 'competitors', 'features', 'benefits', 'painPoints', 'solutions', 'statistics', 'metrics', 'numbers', 'testimonials', 'caseStudies', 'socialProof', 'quotes', 'ctas', 'faqs', 'processes', 'frameworks', 'comparisons', 'timelines', 'pricing', 'keywords', 'claims', 'risks', 'references'];
  const text = cats.flatMap((c) => (intel[c] as KnowledgeItem[])).map((i) => i.text.toLowerCase()).join(' ');
  const has = (re: RegExp) => re.test(text);
  return {
    statistics: n(intel.statistics), statisticsHigh: high(intel.statistics), comparisons: n(intel.comparisons),
    painPoints: n(intel.painPoints), solutions: n(intel.solutions), ctas: n(intel.ctas), timelines: n(intel.timelines),
    quotes: n(intel.quotes), testimonials: n(intel.testimonials), socialProof: n(intel.socialProof), caseStudies: n(intel.caseStudies),
    frameworks: n(intel.frameworks), products: n(intel.products), services: n(intel.services), benefits: n(intel.benefits),
    pricing: n(intel.pricing), competitors: n(intel.competitors), processes: n(intel.processes), faqs: n(intel.faqs),
    claims: n(intel.claims), risks: n(intel.risks), references: n(intel.references), keywords: n(intel.keywords),
    audiences: n(intel.audiences), industries: n(intel.industries), numbers: n(intel.numbers),
    hiring: has(/\bhiring|\bwe['’]?re hiring|\bjoin (our|the) team|\bopen role|\bcareers?\b|\brecruit/),
    event: has(/\bevent\b|\bregister\b|\brsvp\b|\bjoin us\b/), webinar: has(/\bwebinar|\blive session|\bworkshop\b/),
    announcement: has(/\bannouncing|\bintroducing|\bnow available|\blaunch(ing)?\b|\bnew release/),
    research: has(/\bresearch|\bstudy\b|\bsurvey\b|\bwhitepaper|\bfindings?\b/), trend: has(/\btrend|\bin 202\d\b|\bwhat['’]?s next|\bemerging/),
    opinion: has(/\bi think|\bin my opinion|\bhot take|\bunpopular opinion|\bwe believe/), myth: has(/\bmyth|\bfact[- ]?check|\bmisconception/),
    checklist: has(/\bchecklist|\bdo['’]?s and don|\b\d+ things\b|\bsteps to\b/), roadmap: has(/\broadmap|\bwhat['’]?s coming\b/),
    objection: has(/\bobjection|\bbut what if|\bconcern|\bskeptic|\bwhy not\b/), community: has(/\bcommunity|\bmembers?\b|\btogether\b|\bjoin our\b/),
    execSummary: has(/\bexecutive summary|\bkey takeaways?\b|\btl;?dr\b|\bbottom line\b/), story: has(/\bstory|\bjourney\b|\bonce\b|\bnarrative/),
    transformation: has(/\btransformation|\bbefore (&|and) after|\bglow[- ]?up|\bturned\b/), decision: has(/\bwhich to choose|\bdecision\b|\bshould you\b|\bhow to choose/),
    executiveAudience: has(/\bexecutive|\bceo|\bcto|\bcmo|\bvp\b|\bleader|\bc[- ]?suite/),
    caseStudy: has(/\bcase study\b|\bchallenge\b|\bhow .* (scaled|grew|achieved|saved|increased)|\bcustomer story\b/),
  };
}

/* ── Strategy catalog (static) ─────────────────────────────────────────── */

function S(id: string, name: string, category: string, intent: CommunicationIntent, goal: string, audience: AudienceStyle, tone: string, blueprints: StoryBlueprintId[], goals: string[], platforms: string[], types: string[], rules: Rule[]): StrategyDef {
  return { id, name, description: `${name} communication strategy`, category, communicationIntent: intent, communicationGoal: goal, primaryAudienceStyle: audience, tonePattern: tone, recommendedBlueprints: blueprints, recommendedCampaignGoals: goals, recommendedPlatforms: platforms, recommendedContentTypes: types, rules };
}
const R = (when: Rule['when'], points: number, reason: string, signal: string): Rule => ({ when, points, reason, signal });

const CATALOG: StrategyDef[] = [
  S('problem-solution', 'Problem → Solution', 'persuasion', 'persuade', 'conversion', 'practitioner', 'persuasive', ['problem-solution'], ['product_launch', 'conversion'], ['linkedin', 'facebook'], ['carousel', 'image'], [
    R((s) => s.painPoints > 0 && s.solutions > 0, 3, 'Pain points paired with solutions', 'painPoints+solutions'),
    R((s) => s.ctas > 0, 1, 'Has a call-to-action', 'ctas')]),
  S('statistics-driven', 'Statistics Driven', 'evidence', 'inform', 'authority', 'executive', 'data-driven', ['statistics'], ['awareness', 'authority'], ['linkedin', 'twitter'], ['infographic', 'carousel'], [
    R((s) => s.statisticsHigh > 0, 3, 'High-importance statistics present', 'statisticsHigh'),
    R((s) => s.statistics >= 2, 2, 'Multiple statistics', 'statistics'),
    R((s) => s.comparisons > 0, 1, 'Comparative framing', 'comparisons')]),
  S('case-study', 'Case Study', 'evidence', 'persuade', 'conversion', 'executive', 'authoritative', ['case-study'], ['conversion', 'authority'], ['linkedin'], ['carousel', 'image'], [
    R((s) => s.caseStudies > 0 || s.caseStudy, 3, 'Case study detected', 'caseStudies'),
    R((s) => s.testimonials > 0 && s.statistics > 0, 4, 'Testimonial + measurable results', 'testimonials+statistics')]),
  S('social-proof', 'Social Proof', 'trust', 'build_trust', 'conversion', 'general', 'reassuring', ['case-study', 'thought-leadership'], ['conversion', 'consideration'], ['instagram', 'linkedin'], ['image', 'carousel'], [
    R((s) => s.quotes > 0 && s.testimonials > 0, 3, 'Quotes with testimonials', 'quotes+testimonials'),
    R((s) => s.socialProof > 0, 2, 'Social proof present', 'socialProof')]),
  S('testimonial', 'Testimonial', 'trust', 'build_trust', 'conversion', 'general', 'authentic', ['case-study'], ['conversion'], ['instagram', 'linkedin'], ['image'], [
    R((s) => s.testimonials >= 2, 3, 'Multiple testimonials', 'testimonials')]),
  S('comparison', 'Comparison', 'consideration', 'compare', 'conversion', 'practitioner', 'objective', ['comparison'], ['consideration', 'conversion'], ['linkedin', 'youtube'], ['carousel', 'infographic'], [
    R((s) => s.competitors > 0 && s.comparisons > 0, 3, 'Competitors with comparisons', 'competitors+comparisons'),
    R((s) => s.comparisons >= 2, 2, 'Multiple comparisons', 'comparisons')]),
  S('product-marketing', 'Product Marketing', 'conversion', 'convert', 'conversion', 'practitioner', 'benefit-led', ['product-walkthrough', 'problem-solution'], ['product_launch', 'conversion'], ['instagram', 'linkedin'], ['carousel', 'image'], [
    R((s) => s.products > 0 && s.benefits > 0 && s.ctas > 0, 3, 'Products + benefits + CTA', 'products+benefits+ctas'),
    R((s) => s.pricing > 0, 1, 'Pricing present', 'pricing')]),
  S('feature-launch', 'Feature Launch', 'conversion', 'announce', 'awareness', 'practitioner', 'energetic', ['product-walkthrough'], ['product_launch'], ['linkedin', 'twitter'], ['carousel', 'image'], [
    R((s) => s.announcement && s.products > 0, 3, 'Announcement of a product/feature', 'announcement+products'),
    R((s) => s.benefits > 0, 1, 'Benefits present', 'benefits')]),
  S('announcement', 'Announcement', 'awareness', 'announce', 'awareness', 'general', 'celebratory', ['storytelling'], ['awareness', 'product_launch'], ['linkedin', 'instagram'], ['image', 'carousel'], [
    R((s) => s.announcement, 3, 'Announcement language detected', 'announcement')]),
  S('process', 'Process', 'education', 'educate', 'education', 'practitioner', 'instructional', ['process', 'step-by-step'], ['education', 'activation'], ['linkedin', 'youtube'], ['carousel', 'infographic'], [
    R((s) => s.processes >= 2, 3, 'Ordered steps / process', 'processes')]),
  S('framework', 'Framework', 'authority', 'educate', 'authority', 'executive', 'structured', ['framework'], ['authority', 'education'], ['linkedin'], ['carousel', 'infographic'], [
    R((s) => s.frameworks > 0, 3, 'Framework detected', 'frameworks')]),
  S('decision-guide', 'Decision Guide', 'consideration', 'compare', 'consideration', 'practitioner', 'advisory', ['decision-guide', 'comparison'], ['consideration', 'conversion'], ['linkedin', 'youtube'], ['carousel'], [
    R((s) => s.decision, 3, 'Decision-guidance language', 'decision'),
    R((s) => s.comparisons > 0, 1, 'Comparisons present', 'comparisons')]),
  S('timeline', 'Timeline', 'narrative', 'inform', 'awareness', 'general', 'chronological', ['timeline'], ['brand', 'awareness'], ['linkedin', 'instagram'], ['infographic', 'carousel'], [
    R((s) => s.timelines >= 2, 3, 'Multiple dated milestones', 'timelines')]),
  S('data-narrative', 'Data Narrative', 'evidence', 'inform', 'authority', 'executive', 'analytical', ['statistics'], ['authority', 'awareness'], ['linkedin'], ['infographic'], [
    R((s) => s.statistics >= 2 && s.timelines > 0, 3, 'Statistics over time', 'statistics+timelines')]),
  S('faq', 'FAQ', 'education', 'inform', 'education', 'general', 'helpful', ['faq'], ['education', 'support'], ['instagram', 'facebook'], ['carousel'], [
    R((s) => s.faqs >= 2, 3, 'Multiple questions', 'faqs')]),
  S('myth-vs-fact', 'Myth vs Fact', 'education', 'persuade', 'awareness', 'general', 'corrective', ['myth-vs-fact'], ['awareness', 'education'], ['instagram', 'linkedin'], ['carousel', 'image'], [
    R((s) => s.myth, 3, 'Myth/fact-check language', 'myth')]),
  S('checklist', 'Checklist', 'education', 'educate', 'engagement', 'practitioner', 'actionable', ['checklist'], ['education', 'engagement'], ['instagram', 'linkedin'], ['carousel'], [
    R((s) => s.checklist, 3, 'Checklist language', 'checklist')]),
  S('educational', 'Educational', 'education', 'educate', 'awareness', 'practitioner', 'explanatory', ['educational'], ['awareness', 'education'], ['linkedin', 'instagram'], ['carousel'], [
    R((s) => s.benefits > 0 && s.frameworks === 0 && s.caseStudies === 0, 2, 'Explanatory benefit content', 'benefits'),
    R((s) => s.keywords >= 5, 1, 'Topic-rich content', 'keywords')]),
  S('thought-leadership', 'Thought Leadership', 'authority', 'persuade', 'authority', 'executive', 'opinionated', ['thought-leadership'], ['awareness', 'authority'], ['linkedin'], ['image', 'carousel'], [
    R((s) => s.opinion, 3, 'Opinion / perspective language', 'opinion'),
    R((s) => s.executiveAudience, 1, 'Executive audience', 'executiveAudience')]),
  S('authority-building', 'Authority Building', 'authority', 'build_trust', 'authority', 'executive', 'credible', ['thought-leadership', 'framework'], ['authority'], ['linkedin'], ['carousel'], [
    R((s) => s.frameworks > 0 && s.statistics > 0, 2, 'Framework backed by data', 'frameworks+statistics'),
    R((s) => s.references > 0, 1, 'Cited references', 'references')]),
  S('storytelling', 'Storytelling', 'narrative', 'inspire', 'engagement', 'general', 'narrative', ['storytelling'], ['awareness', 'brand'], ['instagram', 'linkedin'], ['carousel', 'image'], [
    R((s) => s.story, 3, 'Narrative language', 'story')]),
  S('transformation', 'Transformation', 'narrative', 'inspire', 'conversion', 'general', 'aspirational', ['transformation', 'before-after'], ['conversion', 'brand'], ['instagram', 'linkedin'], ['carousel', 'image'], [
    R((s) => s.transformation, 3, 'Before/after transformation', 'transformation')]),
  S('customer-journey', 'Customer Journey', 'narrative', 'persuade', 'retention', 'practitioner', 'guided', ['customer-journey'], ['retention', 'conversion'], ['linkedin', 'facebook'], ['carousel', 'infographic'], [
    R((s) => s.processes > 0 && s.benefits > 0, 2, 'Staged journey with outcomes', 'processes+benefits')]),
  S('hiring', 'Hiring', 'recruitment', 'recruit', 'recruitment', 'community', 'inviting', ['storytelling', 'thought-leadership'], ['recruitment'], ['linkedin', 'instagram'], ['image', 'carousel'], [
    R((s) => s.hiring, 3, 'Hiring / recruiting language', 'hiring')]),
  S('recruitment', 'Recruitment', 'recruitment', 'recruit', 'recruitment', 'community', 'inviting', ['storytelling'], ['recruitment'], ['linkedin'], ['carousel'], [
    R((s) => s.hiring && s.community, 3, 'Recruiting + culture/community', 'hiring+community')]),
  S('community-building', 'Community Building', 'engagement', 'inspire', 'engagement', 'community', 'warm', ['storytelling'], ['engagement', 'brand'], ['instagram', 'facebook'], ['image', 'carousel'], [
    R((s) => s.community, 3, 'Community language', 'community')]),
  S('event-promotion', 'Event Promotion', 'conversion', 'convert', 'engagement', 'general', 'urgent', ['storytelling'], ['engagement', 'awareness'], ['instagram', 'linkedin'], ['image', 'carousel'], [
    R((s) => s.event, 3, 'Event / registration language', 'event'),
    R((s) => s.ctas > 0, 1, 'Has a CTA', 'ctas')]),
  S('webinar', 'Webinar', 'conversion', 'convert', 'engagement', 'practitioner', 'inviting', ['storytelling'], ['engagement', 'education'], ['linkedin'], ['image', 'carousel'], [
    R((s) => s.webinar, 3, 'Webinar / workshop language', 'webinar')]),
  S('roadmap', 'Roadmap', 'authority', 'inform', 'retention', 'executive', 'forward-looking', ['roadmap'], ['authority', 'retention'], ['linkedin'], ['carousel', 'infographic'], [
    R((s) => s.roadmap, 3, 'Roadmap language', 'roadmap'),
    R((s) => s.timelines > 0, 1, 'Time-phased', 'timelines')]),
  S('executive-summary', 'Executive Summary', 'authority', 'inform', 'authority', 'executive', 'concise', ['statistics', 'framework'], ['authority'], ['linkedin'], ['infographic', 'image'], [
    R((s) => s.execSummary, 3, 'Executive-summary language', 'execSummary')]),
  S('trend-commentary', 'Trend Commentary', 'authority', 'inform', 'awareness', 'executive', 'observant', ['thought-leadership', 'statistics'], ['awareness', 'authority'], ['linkedin', 'twitter'], ['image', 'carousel'], [
    R((s) => s.trend, 3, 'Trend language', 'trend')]),
  S('opinion', 'Opinion', 'authority', 'persuade', 'engagement', 'executive', 'bold', ['thought-leadership'], ['engagement', 'awareness'], ['linkedin', 'twitter'], ['image'], [
    R((s) => s.opinion, 3, 'Opinion language', 'opinion')]),
  S('research-summary', 'Research Summary', 'evidence', 'inform', 'authority', 'executive', 'rigorous', ['statistics', 'framework'], ['authority', 'awareness'], ['linkedin'], ['infographic', 'carousel'], [
    R((s) => s.research && s.statistics > 0, 3, 'Research backed by data', 'research+statistics'),
    R((s) => s.references > 0, 1, 'Cited references', 'references')]),
  S('objection-handling', 'Objection Handling', 'persuasion', 'persuade', 'conversion', 'practitioner', 'reassuring', ['faq', 'problem-solution'], ['conversion', 'consideration'], ['linkedin'], ['carousel'], [
    R((s) => s.objection, 3, 'Objection-handling language', 'objection'),
    R((s) => s.faqs > 0, 1, 'Q&A structure', 'faqs')]),
  S('brand-awareness', 'Brand Awareness', 'awareness', 'inspire', 'awareness', 'general', 'evocative', ['storytelling', 'thought-leadership'], ['awareness', 'brand'], ['instagram', 'linkedin'], ['image', 'carousel'], [
    R((s) => s.statistics === 0 && s.painPoints === 0 && s.keywords >= 3, 1, 'Broad brand content', 'keywords')]),
];

/* ── Classification + scoring ──────────────────────────────────────────── */

export interface ScoredStrategy {
  strategy: CommunicationStrategy;
  score: number;
  matchedRules: string[];
  matchedSignals: string[];
}

export interface CommunicationStrategyResult {
  selectedStrategy: CommunicationStrategy;
  candidateStrategies: ScoredStrategy[];
  decisionLog: string[];
  matchedSignals: string[];
  confidence: number;
  reason: string;
}

function scoreStrategy(def: StrategyDef, s: StrategySignals): ScoredStrategy {
  let score = 0; const matchedRules: string[] = []; const matchedSignals: string[] = [];
  for (const r of def.rules) {
    if (r.when(s)) { score += r.points; matchedRules.push(r.reason); matchedSignals.push(r.signal); }
  }
  const strategy: CommunicationStrategy = {
    ...def, recommendedBlueprints: def.recommendedBlueprints, decisionReasons: matchedRules,
    signals: Array.from(new Set(matchedSignals)), confidence: 0,
  };
  delete (strategy as Partial<StrategyDef>).rules;
  return { strategy, score, matchedRules, matchedSignals: Array.from(new Set(matchedSignals)) };
}

/** Classify the communication strategy from Content Intelligence (deterministic). */
export function classifyStrategy(intel: ContentIntelligence): CommunicationStrategyResult {
  const s = toSignals(intel);
  const scored = CATALOG.map((def) => scoreStrategy(def, s))
    .sort((a, b) => (b.score - a.score) || (a.strategy.id < b.strategy.id ? -1 : a.strategy.id > b.strategy.id ? 1 : 0));

  // Default to Educational when nothing scores (deterministic floor).
  const top = scored[0] && scored[0].score > 0 ? scored[0] : scored.find((x) => x.strategy.id === 'educational')!;
  const runnerUp = scored.find((x) => x.strategy.id !== top.strategy.id && x.score > 0);
  const confidence = top.score <= 0 ? 0 : Math.round((top.score / (top.score + (runnerUp?.score ?? 0))) * 100) / 100;
  const selected: CommunicationStrategy = { ...top.strategy, confidence };

  const decisionLog = top.matchedRules.length ? top.matchedRules.map((r) => `${selected.name}: ${r}`) : [`${selected.name}: default (no strong signal)`];
  const reason = `Selected ${selected.name} — ${top.matchedRules[0] ?? 'default communication strategy'} (confidence ${confidence}).`;
  return { selectedStrategy: selected, candidateStrategies: scored, decisionLog, matchedSignals: top.matchedSignals, confidence, reason };
}

/* ── Catalog access / search / summary ─────────────────────────────────── */

export function listStrategies(): CommunicationStrategy[] {
  return CATALOG.map((d) => { const c = { ...d, decisionReasons: [], confidence: 0, signals: [] } as CommunicationStrategy & Partial<StrategyDef>; delete c.rules; return c; });
}

export function resolveStrategy(id: string): CommunicationStrategy | null {
  return listStrategies().find((s) => s.id === id) ?? null;
}

export function searchStrategies(query: string): CommunicationStrategy[] {
  const q = query.toLowerCase().trim();
  if (!q) return listStrategies();
  return listStrategies().filter((s) => `${s.id} ${s.name} ${s.category} ${s.communicationGoal} ${s.communicationIntent}`.toLowerCase().includes(q));
}

export interface StrategySummary {
  strategy: string;
  whySelected: string;
  matchedEvidence: string[];
  confidence: number;
  communicationGoal: string;
  recommendedBlueprint: StoryBlueprintId | null;
  recommendedCampaignGoals: string[];
  recommendedPlatforms: string[];
}

export function summarizeStrategy(result: CommunicationStrategyResult): StrategySummary {
  const sel = result.selectedStrategy;
  return {
    strategy: sel.name,
    whySelected: result.reason,
    matchedEvidence: result.matchedSignals,
    confidence: result.confidence,
    communicationGoal: sel.communicationGoal,
    recommendedBlueprint: sel.recommendedBlueprints[0] ?? null,
    recommendedCampaignGoals: sel.recommendedCampaignGoals,
    recommendedPlatforms: sel.recommendedPlatforms,
  };
}

/**
 * Architecture-facing surface — what the Content Architecture MAY consume (it is
 * not required to, and is not modified): the communication goal/intent/audience
 * style + the recommended narrative flow (the top blueprint's role labels are
 * resolved by the caller via the Story Blueprint module).
 */
export function strategyArchitectureHints(result: CommunicationStrategyResult): {
  communicationGoal: string; communicationIntent: CommunicationIntent; primaryAudienceStyle: AudienceStyle;
  decisionReasons: string[]; recommendedBlueprints: StoryBlueprintId[];
} {
  const s = result.selectedStrategy;
  return { communicationGoal: s.communicationGoal, communicationIntent: s.communicationIntent, primaryAudienceStyle: s.primaryAudienceStyle, decisionReasons: s.decisionReasons, recommendedBlueprints: s.recommendedBlueprints };
}
