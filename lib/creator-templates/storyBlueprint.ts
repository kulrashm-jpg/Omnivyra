/**
 * Story Blueprint — the deterministic NARRATIVE-STRUCTURE layer (metadata only).
 *
 * A Story Blueprint is the communication structure of an asset — NOT a visual
 * layout, NOT rendering, NOT slide geometry. Every existing CreatorTemplate maps
 * to exactly one blueprint, derived deterministically from the template's own
 * signals (explicit metadata wins; else category / purpose / layout / name /
 * tags). Pure: no AI, no DB, no rendering. Same template → same blueprint.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';

export type StoryBlueprintId =
  | 'educational' | 'thought-leadership' | 'checklist' | 'step-by-step' | 'problem-solution'
  | 'before-after' | 'case-study' | 'framework' | 'storytelling' | 'comparison'
  | 'product-walkthrough' | 'customer-journey' | 'timeline' | 'statistics' | 'faq'
  | 'myth-vs-fact' | 'transformation' | 'process' | 'roadmap' | 'decision-guide';

export type CommunicationGoal = 'educate' | 'persuade' | 'inspire' | 'compare' | 'convert' | 'inform';

export interface StoryBlueprint {
  id: StoryBlueprintId;
  label: string;
  communicationGoal: CommunicationGoal;
  /** Slide-role labels — the narrative flow (labels only, never geometry). */
  narrativeFlow: string[];
  recommendedCampaignGoals: string[];
  recommendedPlatforms: string[];
  recommendedAudiences: string[];
}

const F = (label: string, communicationGoal: CommunicationGoal, narrativeFlow: string[], goals: string[], platforms: string[], audiences: string[], id: StoryBlueprintId): StoryBlueprint =>
  ({ id, label, communicationGoal, narrativeFlow, recommendedCampaignGoals: goals, recommendedPlatforms: platforms, recommendedAudiences: audiences });

/** The canonical Story Blueprint catalog (deterministic, ordered). */
export const STORY_BLUEPRINTS: Record<StoryBlueprintId, StoryBlueprint> = {
  'educational': F('Educational', 'educate', ['Hook', 'Concept', 'Explanation', 'Example', 'Key Takeaway', 'CTA'], ['awareness', 'education'], ['linkedin', 'instagram'], ['practitioners', 'general'], 'educational'),
  'thought-leadership': F('Thought Leadership', 'persuade', ['Bold Claim', 'Context', 'Insight', 'Evidence', 'Implication', 'CTA'], ['awareness', 'authority'], ['linkedin'], ['executive', 'decision-makers'], 'thought-leadership'),
  'checklist': F('Checklist', 'educate', ['Promise', 'Item 1', 'Item 2', 'Item 3', 'Recap', 'CTA'], ['education', 'engagement'], ['instagram', 'linkedin'], ['practitioners'], 'checklist'),
  'step-by-step': F('Step-by-Step', 'educate', ['Goal', 'Step 1', 'Step 2', 'Step 3', 'Result', 'CTA'], ['education', 'activation'], ['instagram', 'youtube'], ['practitioners', 'beginners'], 'step-by-step'),
  'problem-solution': F('Problem → Solution', 'persuade', ['Problem', 'Cause', 'Solution', 'Benefits', 'CTA'], ['product_launch', 'conversion'], ['linkedin', 'facebook'], ['decision-makers'], 'problem-solution'),
  'before-after': F('Before → After', 'inspire', ['Before', 'Turning Point', 'After', 'Proof', 'CTA'], ['conversion', 'awareness'], ['instagram', 'facebook'], ['general'], 'before-after'),
  'case-study': F('Case Study', 'persuade', ['Challenge', 'Approach', 'Execution', 'Results', 'Lessons', 'CTA'], ['conversion', 'authority'], ['linkedin'], ['executive', 'decision-makers'], 'case-study'),
  'framework': F('Framework', 'educate', ['Premise', 'Pillar 1', 'Pillar 2', 'Pillar 3', 'How to Apply', 'CTA'], ['authority', 'education'], ['linkedin'], ['practitioners', 'executive'], 'framework'),
  'storytelling': F('Storytelling', 'inspire', ['Setup', 'Tension', 'Climax', 'Resolution', 'Moral', 'CTA'], ['awareness', 'brand'], ['instagram', 'linkedin'], ['general'], 'storytelling'),
  'comparison': F('Comparison', 'compare', ['Frame', 'Option A', 'Option B', 'Trade-offs', 'Verdict', 'CTA'], ['conversion', 'consideration'], ['linkedin', 'youtube'], ['decision-makers'], 'comparison'),
  'product-walkthrough': F('Product Walkthrough', 'convert', ['Overview', 'Capability', 'In Action', 'Outcome', 'CTA'], ['product_launch', 'activation'], ['youtube', 'linkedin'], ['practitioners', 'decision-makers'], 'product-walkthrough'),
  'customer-journey': F('Customer Journey', 'persuade', ['Awareness', 'Consideration', 'Decision', 'Onboarding', 'Advocacy'], ['retention', 'conversion'], ['linkedin', 'facebook'], ['decision-makers'], 'customer-journey'),
  'timeline': F('Timeline', 'inform', ['Origin', 'Milestone 1', 'Milestone 2', 'Milestone 3', 'Today', 'CTA'], ['brand', 'awareness'], ['linkedin', 'instagram'], ['general'], 'timeline'),
  'statistics': F('Statistics', 'inform', ['Headline Stat', 'Context', 'Stat 2', 'Stat 3', 'So What', 'CTA'], ['awareness', 'authority'], ['linkedin', 'twitter'], ['executive', 'analysts'], 'statistics'),
  'faq': F('FAQ', 'inform', ['Topic', 'Q1', 'Q2', 'Q3', 'Where to Learn More', 'CTA'], ['education', 'support'], ['instagram', 'facebook'], ['general', 'beginners'], 'faq'),
  'myth-vs-fact': F('Myth vs Fact', 'persuade', ['Common Belief', 'Myth', 'Fact', 'Why It Matters', 'CTA'], ['awareness', 'education'], ['instagram', 'linkedin'], ['general'], 'myth-vs-fact'),
  'transformation': F('Transformation', 'inspire', ['Starting Point', 'Catalyst', 'Change', 'New Reality', 'CTA'], ['conversion', 'brand'], ['instagram', 'linkedin'], ['general'], 'transformation'),
  'process': F('Process', 'educate', ['Input', 'Stage 1', 'Stage 2', 'Stage 3', 'Output', 'CTA'], ['education', 'activation'], ['linkedin', 'youtube'], ['practitioners'], 'process'),
  'roadmap': F('Roadmap', 'inform', ['Vision', 'Now', 'Next', 'Later', 'Outcome', 'CTA'], ['authority', 'retention'], ['linkedin'], ['executive', 'decision-makers'], 'roadmap'),
  'decision-guide': F('Decision Guide', 'compare', ['Decision', 'Criteria', 'Path A', 'Path B', 'Recommendation', 'CTA'], ['consideration', 'conversion'], ['linkedin', 'youtube'], ['decision-makers'], 'decision-guide'),
};

export const STORY_BLUEPRINT_IDS = Object.keys(STORY_BLUEPRINTS) as StoryBlueprintId[];

/* ── Deterministic resolution (every template → exactly one blueprint) ─── */

// Keyword → blueprint, scanned in order (first match wins) over the template's
// searchable signals. Ordered most-specific first.
const KEYWORD_MAP: Array<[RegExp, StoryBlueprintId]> = [
  [/myth|fact[- ]?check|misconception/, 'myth-vs-fact'],
  [/before\s*(&|and|→|->|to)?\s*after|before-after/, 'before-after'],
  [/case\s*study|customer\s*story|success\s*story/, 'case-study'],
  [/product\s*(walk|tour|demo)|walkthrough|feature\s*tour/, 'product-walkthrough'],
  [/customer\s*journey|buyer\s*journey|lifecycle/, 'customer-journey'],
  [/problem\s*(&|and|→|->|to)?\s*solution|pain[- ]?point/, 'problem-solution'],
  [/step[- ]?by[- ]?step|how[- ]?to|tutorial|guide\b/, 'step-by-step'],
  [/check\s*list|checklist|do['’]?s?\s*and\s*don/, 'checklist'],
  [/thought\s*leadership|opinion|hot\s*take|perspective/, 'thought-leadership'],
  [/compar|versus|\bvs\b|a\/b|head[- ]?to[- ]?head/, 'comparison'],
  [/decision\s*(guide|matrix|tree)|which\s*to\s*choose/, 'decision-guide'],
  [/framework|pillars?|model\b|methodology/, 'framework'],
  [/timeline|history|evolution|over\s*the\s*years/, 'timeline'],
  [/roadmap|what['’]?s\s*next|future\s*plans?/, 'roadmap'],
  [/transformation|glow[- ]?up|reinvent/, 'transformation'],
  [/process|pipeline|workflow|stages?\b/, 'process'],
  [/stat(istic)?s?\b|metrics?|by\s*the\s*numbers|data\s*viz/, 'statistics'],
  [/\bfaq\b|frequently\s*asked|questions?\s*answered/, 'faq'],
  [/story(telling)?|narrative|anecdote/, 'storytelling'],
  [/educat|explain|teach|lesson|101\b|learn\b/, 'educational'],
];

const FAMILY_DEFAULT: Record<TemplateAssetFamily, StoryBlueprintId> = {
  image: 'thought-leadership',
  carousel: 'educational',
  infographic: 'statistics',
};

function signalText(t: CreatorTemplate): string {
  const m = (t.metadata ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).join(' ') : '');
  return [
    t.name, t.category, t.description,
    t.renderingContract.purposeKey ?? '', t.renderingContract.subtype ?? '', t.renderingContract.infographicLayout ?? '',
    arr(t.tags), arr(m.keywords), arr(m.recommendedUseCases),
  ].join(' ').toLowerCase();
}

/** Resolve the single Story Blueprint for a template (explicit metadata wins). */
export function resolveStoryBlueprint(t: CreatorTemplate): StoryBlueprint {
  const explicit = (t.metadata as Record<string, unknown> | undefined)?.storyBlueprint;
  if (typeof explicit === 'string' && explicit in STORY_BLUEPRINTS) return STORY_BLUEPRINTS[explicit as StoryBlueprintId];
  const text = signalText(t);
  for (const [re, id] of KEYWORD_MAP) if (re.test(text)) return STORY_BLUEPRINTS[id];
  return STORY_BLUEPRINTS[FAMILY_DEFAULT[t.assetFamily] ?? 'educational'];
}

/** The deterministic metadata block a template carries / the AI compiler emits. */
export interface StoryBlueprintMetadata {
  storyBlueprint: StoryBlueprintId;
  communicationGoal: CommunicationGoal;
  narrativeFlow: string[];
  recommendedCampaignGoals: string[];
  recommendedIndustries: string[];
  recommendedPlatforms: string[];
  recommendedAudiences: string[];
  primarySlideStructure: string;
}

/** Build the deterministic Story Blueprint metadata for a template. */
export function buildStoryBlueprintMetadata(t: CreatorTemplate): StoryBlueprintMetadata {
  const bp = resolveStoryBlueprint(t);
  const m = (t.metadata ?? {}) as Record<string, unknown>;
  const industries = Array.isArray(m.recommendedIndustries) ? m.recommendedIndustries.map(String)
    : Array.isArray(m.keywords) ? m.keywords.map(String).slice(0, 3) : [];
  return {
    storyBlueprint: bp.id,
    communicationGoal: bp.communicationGoal,
    narrativeFlow: bp.narrativeFlow,
    recommendedCampaignGoals: bp.recommendedCampaignGoals,
    recommendedIndustries: industries,
    recommendedPlatforms: bp.recommendedPlatforms,
    recommendedAudiences: bp.recommendedAudiences,
    primarySlideStructure: bp.narrativeFlow.join(' → '),
  };
}

/* ── Coverage (collections / design systems / observability) ───────────── */

/** A reasonable "core" coverage target for a well-rounded system. */
export const CORE_BLUEPRINTS: StoryBlueprintId[] = ['educational', 'thought-leadership', 'problem-solution', 'case-study', 'comparison', 'statistics'];

export interface BlueprintCoverage {
  present: StoryBlueprintId[];
  /** Blueprints used more than once (potential redundancy). */
  duplicates: StoryBlueprintId[];
  /** Target blueprints not present. */
  missing: StoryBlueprintId[];
}

/**
 * Deterministic blueprint coverage for a set of templates. `target` defaults to
 * the core set; pass an explicit target (e.g. required blueprints) to override.
 */
export function blueprintCoverage(templates: CreatorTemplate[], target: StoryBlueprintId[] = CORE_BLUEPRINTS): BlueprintCoverage {
  const counts = new Map<StoryBlueprintId, number>();
  for (const t of templates) {
    const id = resolveStoryBlueprint(t).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const present = Array.from(counts.keys()).sort();
  const duplicates = present.filter((id) => (counts.get(id) ?? 0) > 1).sort();
  const missing = target.filter((id) => !counts.has(id)).sort();
  return { present, duplicates, missing };
}

/* ── Blueprint-aware recommendation reasons (deterministic) ────────────── */

export interface BlueprintContext {
  campaignGoal?: string;
  platform?: string;
  audience?: string;
  industry?: string;
}

function cap(s: string): string { return s ? s[0]!.toUpperCase() + s.slice(1) : s; }
function humanize(s: string): string { return s.replace(/[_-]+/g, ' ').split(' ').map(cap).join(' '); }

/**
 * Deterministic reasons explaining why a template's blueprint fits a context.
 * No AI — each reason fires from a rule over the blueprint + context.
 */
export function blueprintReasons(t: CreatorTemplate, ctx: BlueprintContext): string[] {
  const bp = resolveStoryBlueprint(t);
  const reasons: string[] = [];
  const goal = (ctx.campaignGoal ?? '').toLowerCase();
  const platform = (ctx.platform ?? '').toLowerCase();
  const audience = (ctx.audience ?? '').toLowerCase();

  if (goal && bp.recommendedCampaignGoals.some((g) => goal.includes(g) || g.includes(goal.replace(/\s+/g, '_')))) {
    reasons.push(`This ${bp.label} structure performs well for ${humanize(ctx.campaignGoal!)} campaigns`);
  }
  if (platform && bp.recommendedPlatforms.includes(platform)) {
    reasons.push(`Optimized for ${cap(platform)}`);
  }
  if (audience && bp.recommendedAudiences.some((a) => audience.includes(a) || a.includes(audience))) {
    reasons.push(`Matches ${humanize(ctx.audience!)} audiences`);
  }
  if (!reasons.length) {
    reasons.push(`Best communication structure: ${bp.label}`);
  }
  return reasons;
}
