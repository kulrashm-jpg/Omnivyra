/**
 * Campaign Enrichment Service
 * Deterministic transformation of topic-level recommendations into campaign-ready guidance.
 * Does NOT modify trend scoring or alignment pipeline.
 */

export type RecommendationEnrichmentInput = {
  context?: string | null;
  aspect?: string | null;
  facets?: string[];
  sub_angles?: string[];
  audience_personas?: string[];
  messaging_hooks?: string[];
  estimated_reach?: string | number | null;
  formats?: string[];
  /** Theme title (fallback when context/aspect absent). */
  title?: string | null;
  /** Theme summary (used to infer sub-angles when absent). */
  summary?: string | null;
};

export type DurationValue = '2_weeks' | '4_weeks' | '8_weeks' | '12_weeks';

/** Allowed durations for campaign planning. */
export const ALLOWED_DURATION_WEEKS = [2, 4, 8, 12] as const;

export type IntensityMode = 'educational' | 'trust_building' | 'conversion_acceleration';

export type DurationSuggestion = {
  value: DurationValue;
  weeks: 2 | 4 | 8 | 12;
  rationale: string | null;
};

/** Backward compatibility: map legacy "8_12_weeks" to 8 weeks. */
export function normalizeDurationValue(value: string): DurationValue {
  if (value === '8_12_weeks') return '8_weeks';
  if (ALLOWED_DURATION_WEEKS.some((w) => value === `${w}_weeks`)) return value as DurationValue;
  return '8_weeks';
}

/** Backward compatibility: normalize weeks to allowed value (2|4|8|12). */
export function normalizeDurationWeeks(weeks: number): 2 | 4 | 8 | 12 {
  if (weeks <= 2) return 2;
  if (weeks <= 4) return 4;
  if (weeks <= 8) return 8;
  return 12;
}

export type MomentumLevel = 'low' | 'medium' | 'high' | 'peak';

export type WeeklyGuidance = {
  week_number: number;
  intent: string;
  psychological_movement: string;
  content_objective: string;
  momentum_level: MomentumLevel;
};

export type ContentMix = {
  educational_pct: number;
  authority_pct: number;
  engagement_pct: number;
  conversion_pct: number;
};

export type TransitionGuidelines = {
  start_signal: string;
  continuation_signal: string;
  transition_signal: string;
  closing_signal: string;
};

export type CampaignEnrichedRecommendation = {
  campaign_duration_weeks: number;
  weekly_guidance: WeeklyGuidance[];
  progression_model: IntensityMode;
  content_mix: ContentMix;
  transition_guidelines: TransitionGuidelines;
  duration_suggestion: DurationSuggestion;
};

// --- Parsing helpers ---

function parseReach(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const s = String(value).trim().toUpperCase();
  if (!s) return 0;
  const kMatch = s.match(/^([\d.]+)\s*K$/i);
  if (kMatch) return parseFloat(kMatch[1]) * 1000;
  const mMatch = s.match(/^([\d.]+)\s*M$/i);
  if (mMatch) return parseFloat(mMatch[1]) * 1_000_000;
  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isNaN(num) ? 0 : num;
}

function safeCount(arr: unknown[] | null | undefined): number {
  return Array.isArray(arr) ? arr.length : 0;
}

function deriveSubAngleCount(input: RecommendationEnrichmentInput): number {
  const explicit = safeCount(input.sub_angles);
  if (explicit > 0) return explicit;
  const summary = (input.summary || '').trim();
  if (!summary) return 1;
  const parts = summary.split(/[,;]|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  return Math.max(1, Math.min(parts.length, 4));
}

function formatDiversity(formats: string[] | null | undefined): number {
  if (!Array.isArray(formats) || formats.length === 0) return 0;
  const unique = new Set(formats.map((f) => String(f).toLowerCase().trim()).filter(Boolean));
  return unique.size;
}

// --- Decision rules ---

const PSYCHOLOGICAL_KEYWORDS = [
  'psychological', 'transformation', 'mindset', 'growth', 'career', 'personal',
  'identity', 'resilience', 'wellness', 'confidence', 'leadership', 'challenge',
];

function isPsychologicalOrTransformational(input: RecommendationEnrichmentInput): boolean {
  const text = [
    input.context,
    input.aspect,
    input.title,
    input.summary,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return PSYCHOLOGICAL_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Duration decision logic:
 * - 12 weeks: broad psychological/transformational OR high reach + high complexity + multiple facets/sub-angles
 * - 8 weeks: broad strategic but lower complexity than 12-week tier
 * - 4 weeks: medium complexity (focused)
 * - 2 weeks: narrow tactical scope
 */
function resolveDuration(input: RecommendationEnrichmentInput): DurationSuggestion {
  const reach = parseReach(input.estimated_reach);
  const facetCount = safeCount(input.facets);
  const subAngleCount = deriveSubAngleCount(input);
  const personaCount = safeCount(input.audience_personas);
  const hookCount = safeCount(input.messaging_hooks);
  const formatCount = formatDiversity(input.formats);

  const complexityScore =
    (facetCount * 3) +
    (subAngleCount * 2) +
    (personaCount > 0 ? 2 : 0) +
    (hookCount >= 2 ? 1 : 0) +
    (formatCount >= 2 ? 1 : 0);

  const isHighReach = reach >= 50000 || (reach >= 10000 && facetCount >= 2);
  const isBroad = facetCount >= 3 || subAngleCount >= 3;
  const isVeryHighComplexity = facetCount >= 3 && subAngleCount >= 3 && (personaCount > 0 || formatCount >= 2);
  const isMedium = facetCount >= 2 || subAngleCount >= 2 || complexityScore >= 5;

  // 12 weeks: broad psychological/transformational OR high reach + high complexity + multiple facets/sub-angles
  if (isPsychologicalOrTransformational(input) && isBroad) {
    return { value: '12_weeks', weeks: 12, rationale: 'Broad psychological or transformational topic.' };
  }
  if (isHighReach && isVeryHighComplexity) {
    return { value: '12_weeks', weeks: 12, rationale: 'High reach, high complexity, multiple facets and sub-angles.' };
  }

  // 8 weeks: broad strategic but lower complexity than 12-week tier
  if (isHighReach && isBroad) {
    return { value: '8_weeks', weeks: 8, rationale: 'Broad strategic topic with high reach.' };
  }
  if (isBroad && isMedium) {
    return { value: '8_weeks', weeks: 8, rationale: 'Broad strategic topic, moderate complexity.' };
  }

  // 4 weeks: medium complexity (focused)
  if (isMedium || complexityScore >= 4) {
    return { value: '4_weeks', weeks: 4, rationale: 'Medium complexity: multiple facets or angles.' };
  }

  // 2 weeks: narrow tactical scope
  return { value: '2_weeks', weeks: 2, rationale: 'Narrow topic, tactical execution.' };
}

/** Intensity mode from duration and facet breadth. */
function resolveIntensity(durationWeeks: number, input: RecommendationEnrichmentInput): IntensityMode {
  const facetCount = safeCount(input.facets);
  const subAngleCount = deriveSubAngleCount(input);

  if (durationWeeks <= 2) return 'conversion_acceleration';
  if (durationWeeks >= 8 || facetCount >= 3 || subAngleCount >= 3) return 'educational';
  return 'trust_building';
}

/** Content mix percentages from progression model. */
function resolveContentMix(intensity: IntensityMode): ContentMix {
  switch (intensity) {
    case 'educational':
      return { educational_pct: 45, authority_pct: 30, engagement_pct: 20, conversion_pct: 5 };
    case 'trust_building':
      return { educational_pct: 35, authority_pct: 35, engagement_pct: 20, conversion_pct: 10 };
    case 'conversion_acceleration':
      return { educational_pct: 25, authority_pct: 25, engagement_pct: 25, conversion_pct: 25 };
    default:
      return { educational_pct: 35, authority_pct: 30, engagement_pct: 25, conversion_pct: 10 };
  }
}

type WeekTemplate = { intent: string; psychological_movement: string; content_objective: string };

/** 12-week progression: Awareness → Education → Trust → Decision → Action */
const TWELVE_WEEK_PROGRESSION: WeekTemplate[] = [
  { intent: 'Surface the problem', psychological_movement: 'Awareness', content_objective: 'Frame the core tension or unmet need' },
  { intent: 'Deepen problem resonance', psychological_movement: 'Awareness', content_objective: 'Validate pain points and aspirations' },
  { intent: 'Position relevance', psychological_movement: 'Problem framing', content_objective: 'Connect problem to audience context' },
  { intent: 'Introduce solutions', psychological_movement: 'Education', content_objective: 'Present frameworks or approaches' },
  { intent: 'Build proof', psychological_movement: 'Authority', content_objective: 'Share evidence, data, case studies' },
  { intent: 'Demonstrate expertise', psychological_movement: 'Authority', content_objective: 'Establish credibility and depth' },
  { intent: 'Foster trust', psychological_movement: 'Trust', content_objective: 'Invite dialogue and address concerns' },
  { intent: 'Show application', psychological_movement: 'Application', content_objective: 'How-to, practical examples' },
  { intent: 'Reinforce value', psychological_movement: 'Application', content_objective: 'Differentiate and consolidate learning' },
  { intent: 'Set up decision', psychological_movement: 'Decision preparation', content_objective: 'Clarify options and next steps' },
  { intent: 'Reduce friction', psychological_movement: 'Conversion preparation', content_objective: 'Overcome objections, create urgency' },
  { intent: 'Drive action', psychological_movement: 'Action / Consolidation', content_objective: 'Clear CTA and recap' },
];

/** Momentum signal per week: low → medium → high → peak */
function getMomentumLevel(
  durationWeeks: number,
  weekNumber: number,
  psychologicalMovement: string
): MomentumLevel {
  if (durationWeeks === 2) {
    return weekNumber === 1 ? 'medium' : 'peak';
  }
  if (durationWeeks === 4) {
    const map: Record<number, MomentumLevel> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'peak' };
    return map[weekNumber] ?? 'medium';
  }
  if (durationWeeks === 8) {
    const m = psychologicalMovement.toLowerCase();
    if (m.includes('awareness')) return 'low';
    if (m.includes('education')) return 'medium';
    if (m.includes('trust')) return 'high';
    if (m.includes('conversion')) return 'peak';
    return 'medium';
  }
  if (durationWeeks === 12) {
    if (weekNumber <= 3) return 'low';
    if (weekNumber <= 6) return 'medium';
    if (weekNumber <= 9) return 'high';
    return 'peak';
  }
  return 'medium';
}

/** 8-week progression: Awareness → Education → Trust → Conversion */
const EIGHT_WEEK_PROGRESSION: WeekTemplate[] = [
  { intent: 'Surface the problem', psychological_movement: 'Awareness', content_objective: 'Frame the core tension or unmet need' },
  { intent: 'Position relevance', psychological_movement: 'Awareness', content_objective: 'Connect problem to audience context' },
  { intent: 'Introduce solutions', psychological_movement: 'Education', content_objective: 'Present frameworks or approaches' },
  { intent: 'Build proof and authority', psychological_movement: 'Education', content_objective: 'Evidence, case studies, expertise' },
  { intent: 'Foster trust', psychological_movement: 'Trust', content_objective: 'Invite dialogue, address concerns' },
  { intent: 'Show application', psychological_movement: 'Trust', content_objective: 'Practical examples and how-to' },
  { intent: 'Set up decision', psychological_movement: 'Conversion', content_objective: 'Reduce friction, create urgency' },
  { intent: 'Drive action', psychological_movement: 'Conversion', content_objective: 'Clear CTA and consolidation' },
];

/** Week-by-week intent, psychological movement, content objective. */
function buildWeeklyGuidance(
  durationWeeks: number,
  intensity: IntensityMode
): WeeklyGuidance[] {
  let templates: WeekTemplate[];
  if (durationWeeks === 12) {
    templates = TWELVE_WEEK_PROGRESSION;
  } else if (durationWeeks === 8) {
    templates = EIGHT_WEEK_PROGRESSION;
  } else {
    templates = getWeeklyTemplates(intensity);
  }

  const guidance: WeeklyGuidance[] = [];
  for (let w = 1; w <= durationWeeks; w++) {
    const idx = Math.min(w - 1, templates.length - 1);
    const t = templates[idx];
    guidance.push({
      week_number: w,
      intent: t.intent,
      psychological_movement: t.psychological_movement,
      content_objective: t.content_objective,
      momentum_level: getMomentumLevel(durationWeeks, w, t.psychological_movement),
    });
  }
  return guidance;
}

function getWeeklyTemplates(intensity: IntensityMode): WeekTemplate[] {
  switch (intensity) {
    case 'educational':
      return [
        { intent: 'Introduce core concept', psychological_movement: 'Awareness', content_objective: 'Establish relevance' },
        { intent: 'Deepen understanding', psychological_movement: 'Interest', content_objective: 'Provide proof and examples' },
        { intent: 'Address objections', psychological_movement: 'Consideration', content_objective: 'Build authority' },
        { intent: 'Reinforce value', psychological_movement: 'Preference', content_objective: 'Differentiate' },
      ];
    case 'trust_building':
      return [
        { intent: 'Open with relevance', psychological_movement: 'Awareness', content_objective: 'Signal expertise' },
        { intent: 'Build credibility', psychological_movement: 'Interest', content_objective: 'Proof and testimonials' },
        { intent: 'Engage and invite', psychological_movement: 'Consideration', content_objective: 'Two-way dialogue' },
        { intent: 'Move to action', psychological_movement: 'Preference → Action', content_objective: 'Conversion prompt' },
      ];
    case 'conversion_acceleration':
      return [
        { intent: 'Capture attention', psychological_movement: 'Awareness', content_objective: 'Quick value + CTA' },
        { intent: 'Convert', psychological_movement: 'Action', content_objective: 'Conversion-focused content' },
      ];
    default:
      return [
        { intent: 'Introduce', psychological_movement: 'Awareness', content_objective: 'Establish relevance' },
        { intent: 'Engage', psychological_movement: 'Interest', content_objective: 'Provide value' },
        { intent: 'Convert', psychological_movement: 'Action', content_objective: 'Clear CTA' },
      ];
  }
}

/** Transition signals for baton passing. */
function buildTransitionGuidelines(intensity: IntensityMode): TransitionGuidelines {
  switch (intensity) {
    case 'educational':
      return {
        start_signal: 'Open with a question or tension that resonates with the audience.',
        continuation_signal: 'Reference prior week: "Building on last week\'s theme..."',
        transition_signal: 'Shift angle: "Now let\'s look at..." or "Another dimension..."',
        closing_signal: 'Recap key takeaways; end with one clear next step or CTA.',
      };
    case 'trust_building':
      return {
        start_signal: 'Lead with a shared challenge or aspiration.',
        continuation_signal: 'Connect to previous content: "As we discussed..."',
        transition_signal: 'Pivot: "What this means for you..." or "Here\'s the shift..."',
        closing_signal: 'Summarize value; offer a low-friction next action.',
      };
    case 'conversion_acceleration':
      return {
        start_signal: 'State the offer or outcome upfront.',
        continuation_signal: 'Reinforce urgency: "Limited time..." or "Don\'t miss..."',
        transition_signal: 'Remove friction: "Here\'s how to get started."',
        closing_signal: 'Single, unmistakable CTA.',
      };
    default:
      return {
        start_signal: 'Open with relevance to the audience.',
        continuation_signal: 'Connect to prior content.',
        transition_signal: 'Shift to new angle or phase.',
        closing_signal: 'Clear summary and CTA.',
      };
  }
}

/**
 * Enrich a recommendation with campaign-ready guidance.
 * Pure deterministic logic; no external calls.
 */
export function enrichRecommendation(input: RecommendationEnrichmentInput): CampaignEnrichedRecommendation {
  const durationSuggestion = resolveDuration(input);
  const { weeks: durationWeeks } = durationSuggestion;
  const progressionModel = resolveIntensity(durationWeeks, input);
  const contentMix = resolveContentMix(progressionModel);
  const weeklyGuidance = buildWeeklyGuidance(durationWeeks, progressionModel);
  const transitionGuidelines = buildTransitionGuidelines(progressionModel);

  return {
    campaign_duration_weeks: durationWeeks,
    weekly_guidance: weeklyGuidance,
    progression_model: progressionModel,
    content_mix: contentMix,
    transition_guidelines: transitionGuidelines,
    duration_suggestion: durationSuggestion,
  };
}
