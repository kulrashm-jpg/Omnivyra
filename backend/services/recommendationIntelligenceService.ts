/**
 * Recommendation Intelligence Enrichment Layer.
 * Runs AFTER recommendationPolishService and BEFORE recommendation card rendering.
 * Deterministic only. No external API. No scoring changes.
 */

import type { CompanyProfile } from './companyProfileService';
import type { PolishFlags } from './recommendationPolishService';
import { sanitizeTopicForDisplay } from './recommendationPolishService';

export type RecommendationIntelligence = {
  problem_being_solved: string;
  gap_being_filled: string;
  why_now: string;
  authority_reason: string | null;
  expected_transformation: string;
  campaign_angle: string;
};

export type EnrichedRecommendation = {
  topic: string;
  [key: string]: unknown;
} & {
  intelligence: RecommendationIntelligence;
};

const normalizeList = (v: unknown): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  return s.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
};

const firstNonEmpty = (...vals: (string | null | undefined)[]): string =>
  vals.find((v) => v && String(v).trim())?.trim() ?? '';

/** RULE A — Problem extraction: priority core_problem_statement > pain_symptoms > campaign_focus > content_themes. Topic-aware so each card has unique content. */
function buildProblemBeingSolved(profile: CompanyProfile | null, topic: string): string {
  const audience = firstNonEmpty(
    profile?.target_audience,
    profile?.target_customer_segment,
    profile?.ideal_customer_profile,
    (profile?.target_audience_list ?? [])[0]
  ) || 'audience';
  const problem =
    firstNonEmpty(profile?.core_problem_statement) ||
    (normalizeList(profile?.pain_symptoms).join('; ') || firstNonEmpty(profile?.campaign_focus)) ||
    firstNonEmpty(profile?.content_themes) ||
    'key challenges';
  const topicPart = topic && topic.trim() ? ` — with focus on ${topic.trim()}` : '';
  return `Helping ${audience} overcome ${problem}${topicPart}`;
}

/** RULE B — Gap identification: awareness_gap first, else polish_flags.diamond_candidate */
function buildGapBeingFilled(
  flags: PolishFlags | undefined,
  profile: CompanyProfile | null
): string {
  const awarenessGap = (profile as { awareness_gap?: string | null })?.awareness_gap;
  if (awarenessGap && String(awarenessGap).trim().length > 0) {
    return `Audience lacks awareness of: ${String(awarenessGap).trim()}`;
  }
  if (flags?.diamond_candidate) {
    return 'Underserved but high-alignment opportunity.';
  }
  return 'Existing demand lacking clear authority-driven guidance.';
}

/** RULE C — Why now: popularity + alignment reasoning */
function buildWhyNow(
  rec: { volume?: number; frequency?: number } & Record<string, unknown>,
  volumeMax: number,
  alignmentHigh: boolean
): string {
  const vol = Number(rec.volume ?? 0) || 0;
  const isPopularityHigh = volumeMax > 0 && vol >= volumeMax * 0.5;
  if (isPopularityHigh) {
    return 'Audience attention already exists; opportunity is differentiation.';
  }
  if (alignmentHigh) {
    return 'Early-stage opportunity before saturation.';
  }
  return 'Growing demand with room for positioning.';
}

/** RULE D — Authority reason when authority_elevated */
function buildAuthorityReason(
  flags: PolishFlags | undefined,
  topic: string,
  profile: CompanyProfile | null
): string | null {
  if (!flags?.authority_elevated || !profile?.authority_domains) return null;
  const domains = profile.authority_domains;
  const match = Array.isArray(domains) ? domains[0] : String(domains).trim();
  if (!match) return null;
  return `Company has credibility in ${match}.`;
}

/** RULE E — Expected transformation: pain_state -> desired_outcome. Topic-aware so each card has unique content. */
function buildExpectedTransformation(profile: CompanyProfile | null, topic: string): string {
  const painState =
    firstNonEmpty(profile?.life_with_problem) ||
    (normalizeList(profile?.pain_symptoms).join('; ') || firstNonEmpty(profile?.core_problem_statement)) ||
    'current friction';
  const desiredOutcome =
    firstNonEmpty(profile?.desired_transformation) ||
    firstNonEmpty(profile?.life_after_solution) ||
    firstNonEmpty(profile?.campaign_focus) ||
    'desired outcome';
  const topicPart = topic && topic.trim() ? ` through ${topic.trim()}` : '';
  return `Move audience from ${painState} toward ${desiredOutcome}${topicPart}`;
}

/** RULE F — Campaign angle: deterministic mapping from polish flags */
function buildCampaignAngle(flags: PolishFlags | undefined): string {
  if (flags?.diamond_candidate) {
    return 'Gap exposure → Education → Conversion';
  }
  if (flags?.authority_elevated) {
    return 'Pain → Awareness → Authority → Solution';
  }
  if (flags?.is_generic_reframed) {
    return 'Reframe → Differentiation → Trust';
  }
  return 'Pain → Awareness → Authority → Solution';
}

/**
 * Enriches each recommendation with strategic intelligence fields.
 * Runs after polishing. On failure, returns original recommendations.
 */
export function enrichRecommendationIntelligence(
  recommendations: Array<Record<string, unknown> & { topic: string }>,
  profile: CompanyProfile | null
): EnrichedRecommendation[] {
  if (!recommendations || recommendations.length === 0) {
    return [];
  }

  try {
    const volumeMax = Math.max(
      ...recommendations.map((r) => Number(r.volume ?? 0) || 0),
      1
    );

    return recommendations.map((rec) => {
      const topic = String(rec.topic || '').trim();
      const polishedTitle = typeof rec.polished_title === 'string' ? rec.polished_title.trim() : '';
      const displayTopic = polishedTitle || sanitizeTopicForDisplay(topic) || topic;
      const flags = rec.polish_flags as PolishFlags | undefined;
      const vol = Number(rec.volume ?? 0) || 0;
      const alignmentHigh = (rec.diamond_score as number ?? 0) >= 0.5 || flags?.diamond_candidate === true;

      const problemBeingSolved = buildProblemBeingSolved(profile, displayTopic);
      const expectedTransformation = buildExpectedTransformation(profile, displayTopic);

      const intelligence: RecommendationIntelligence = {
        problem_being_solved: problemBeingSolved,
        gap_being_filled: buildGapBeingFilled(flags, profile),
        why_now: buildWhyNow(rec, volumeMax, alignmentHigh),
        authority_reason: buildAuthorityReason(flags, displayTopic, profile),
        expected_transformation: expectedTransformation,
        campaign_angle: buildCampaignAngle(flags),
      };

      return {
        ...rec,
        intelligence,
      } as EnrichedRecommendation;
    });
  } catch {
    return recommendations.map((rec) => ({
      ...rec,
      intelligence: {
        problem_being_solved: 'Helping audience overcome key challenges',
        gap_being_filled: 'Existing demand lacking clear authority-driven guidance.',
        why_now: 'Growing demand with room for positioning.',
        authority_reason: null,
        expected_transformation: 'Move audience from current friction toward desired outcome',
        campaign_angle: 'Pain → Awareness → Authority → Solution',
      } as RecommendationIntelligence,
    })) as EnrichedRecommendation[];
  }
}
