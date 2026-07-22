/**
 * Strategic Recommendation Intelligence — deterministic enrichment layer.
 * Runs AFTER recommendationPolishService and BEFORE recommendation card rendering.
 * Deterministic only. No external API. No scoring changes.
 *
 * ── PRODUCT-RESTORE-001 (restoration, not redesign) ──────────────────────────
 * This module RESTORES the producer of the six strategic narrative fields
 * (`problem_being_solved`, `gap_being_filled`, `why_now`, `authority_reason`,
 * `expected_transformation`, `campaign_angle`) that was destroyed as collateral in
 * the 901-file bulk commit `6cd30522` ("Bolt Creator") on 2026-05-16. See
 * PRODUCT-ARCH-001 for the evidence that the removal was never a product decision.
 *
 * CANONICAL REFERENCE: `git show 6cd30522^:backend/services/recommendationIntelligenceService.ts`.
 * Rules A–F below are reproduced VERBATIM from that implementation — same priority
 * orders, same thresholds, same literal strings, same `catch` fallback. Only the
 * DEVIATIONS listed below differ, and each is naming-only:
 *
 *   D1. Module renamed `recommendationIntelligenceService` →
 *       `strategicRecommendationIntelligenceService`. The historical filename was
 *       taken over by an unrelated SEO/growth analytics service; restoring into it
 *       would re-create the exact ambiguity that let this capability disappear
 *       silently. (PRODUCT-RESTORE-001 Phase 1.)
 *   D2. Type `RecommendationIntelligence` → `StrategicRecommendationIntelligence`,
 *       and `EnrichedRecommendation` → `StrategicallyEnrichedRecommendation`.
 *       Explicit domain names, per Phase 1. Shapes are byte-identical.
 *   D3. Dropped one dead local in `enrichRecommendationIntelligence`: the historical
 *       body declared `const vol = Number(rec.volume ?? 0) || 0;` and never read it
 *       (`buildWhyNow` computes its own `vol` from `rec`). Removing an unread
 *       assignment is provably behaviour-identical and avoids a no-unused-vars
 *       violation in the restored file.
 *
 * NO other deviation at restoration time. In particular the business rules, their
 * input priority chains, the 0.5 popularity/alignment thresholds, the exact output
 * sentences, and the non-null `catch` fallback were unchanged. Every
 * `CompanyProfile` field the rules read was verified to still exist on the current type.
 *
 * ── SUBSEQUENT AUTHORIZED ENHANCEMENT ────────────────────────────────────────
 *   PRODUCT-IMPLEMENTATION-003 (B′) — RULE B only. `gap_being_filled` became
 *   recommendation-aware: the historical company-level core is now composed with a
 *   per-recommendation qualifier (corroboration / demand position / polish flags)
 *   and anchored to the topic. Core selection logic is verbatim; nothing fabricated.
 *
 *   PRODUCT-IMPLEMENTATION-002 (D′) — RULE D only. `authority_reason` became
 *   recommendation-aware: it now selects the authority domain most relevant to the
 *   topic (deterministically, with stable-hash tie-breaking) and anchors the
 *   sentence to that topic, instead of always emitting `domains[0]`. Rules A, B, C,
 *   E and F remain historically verbatim. Null-return conditions, schema,
 *   serialization and determinism are unchanged — see
 *   `backend/tests/support/strategicNarrativeCompatibility.ts`, whose contracts
 *   gate this and every future narrative change.
 */

import type { CompanyProfile } from './companyProfileService';
import type { PolishFlags } from './recommendationPolishService';
import { sanitizeTopicForDisplay } from './recommendationPolishService';

/** The six strategic narrative fields carried on `card.intelligence`. */
export type StrategicRecommendationIntelligence = {
  problem_being_solved: string;
  gap_being_filled: string;
  why_now: string;
  authority_reason: string | null;
  expected_transformation: string;
  campaign_angle: string;
};

export type StrategicallyEnrichedRecommendation = {
  topic: string;
  [key: string]: unknown;
} & {
  intelligence: StrategicRecommendationIntelligence;
};

// ── PRODUCT-RESTORE-001 Phase 4 · feature flag ───────────────────────────────
const FLAG_ENV_VAR = 'STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED';

export const STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR = FLAG_ENV_VAR;

/**
 * Guards the RESTORED behaviour at the engine seam. Default **OFF** ⇒ the engine
 * keeps its current no-op pass-through and every one of the six fields keeps
 * resolving to `null` (byte-identical to pre-restoration behaviour). **ON** ⇒ the
 * full restored producer runs.
 *
 * The producer itself is pure and unflagged — the flag governs *integration only*,
 * so `enrichRecommendationIntelligence` stays directly testable and the flag has a
 * single, auditable decision point (`recommendationEngine/engine.ts`).
 *
 * REMOVAL CRITERIA (delete the flag and make the restored path unconditional once
 * ALL hold):
 *   1. Enabled in production for one full recommendation-generation cycle with no
 *      regression reported on recommendation cards, week topics, or the content bridge.
 *   2. The strategic-content-transformation validator's score distribution has been
 *      re-baselined against non-null intelligence (scores necessarily rise from the
 *      current silent 0 — see PRODUCT-ARCH-001 §8).
 *   3. Generated week-topic / decision-block copy reviewed once with the flag ON,
 *      confirming the narrative text is preferred over the hard-coded generic
 *      fallbacks in `recommendationBlueprintService`.
 */
export function strategicRecommendationIntelligenceEnabled(): boolean {
  return process.env[FLAG_ENV_VAR] === 'true';
}

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

/**
 * RULE B′ — Gap identification (PRODUCT-IMPLEMENTATION-003).
 *
 * The historical grounded CORE is unchanged: awareness_gap first, else
 * `polish_flags.diamond_candidate`, else the default. Because all three depend only
 * on COMPANY-level state, the core repeated verbatim on every card of a company.
 *
 * B′ composes that core with a per-recommendation qualifier derived from signals the
 * engine already computes (corroboration, demand position, polish flags) and anchors
 * it to the recommendation topic. Nothing is fabricated — the corroboration count is
 * a real measured value and every other branch is a flag the producer already reads.
 * Deterministic; no new data dependency.
 */
function buildGapBeingFilled(
  flags: PolishFlags | undefined,
  profile: CompanyProfile | null,
  rec: Record<string, unknown>,
  topic: string,
  volumeMax: number
): string {
  // ── historical core (selection logic verbatim) ──
  const awarenessGap = (profile as { awareness_gap?: string | null })?.awareness_gap;
  const core =
    awarenessGap && String(awarenessGap).trim().length > 0
      ? `Audience lacks awareness of: ${String(awarenessGap).trim()}`
      : flags?.diamond_candidate
        ? 'Underserved but high-alignment opportunity.'
        : 'Existing demand lacking clear authority-driven guidance.';

  // ── per-recommendation qualifier (measured signals only) ──
  const corroboration = Array.isArray(rec.sources)
    ? (rec.sources as unknown[]).length
    : Number(rec.frequency ?? 0) || 0;
  const vol = Number(rec.volume ?? 0) || 0;
  const demandHigh = volumeMax > 0 && vol >= volumeMax * 0.66;
  const qualifier =
    corroboration >= 2 ? `corroborated across ${corroboration} sources`
    : demandHigh ? 'demand is already concentrated'
    : flags?.diamond_candidate ? 'alignment is strong but coverage is thin'
    : flags?.is_generic_reframed ? 'the framing is crowded'
    : 'coverage is thin relative to intent';

  const anchor = topic && topic.trim() ? ` for ${topic.trim()}` : '';
  return `${core.replace(/\.$/, '')} — ${qualifier}${anchor}.`;
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

/** Lowercase word tokens (≥3 chars) used for deterministic domain↔topic matching. */
function tokenizeForMatch(value: string): string[] {
  return String(value ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}

/** Deterministic, non-random stable hash (FNV-like) — used only for tie-breaking. */
function stableHash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * PRODUCT-IMPLEMENTATION-002 (D′) — choose the authority domain most relevant to
 * THIS recommendation instead of always taking `domains[0]`.
 *
 * Deterministic by construction: score every domain by token overlap with the
 * topic, keep the highest-scoring set, and — when that set has more than one
 * member (including the all-zero case where nothing overlaps) — resolve with a
 * stable hash of the topic. No randomness, no clock, no ambient state. A
 * single-domain company is unaffected (the sole domain always wins), so this is a
 * strict generalization of the historical `domains[0]` behaviour.
 */
function selectAuthorityDomain(domains: string[], topic: string): string {
  if (domains.length === 1) return domains[0];
  const topicTokens = new Set(tokenizeForMatch(topic));
  const scored = domains.map((d) => ({
    domain: d,
    score: tokenizeForMatch(d).filter((t) => topicTokens.has(t)).length,
  }));
  const max = Math.max(...scored.map((s) => s.score));
  const tied = scored.filter((s) => s.score === max).map((s) => s.domain);
  return tied.length === 1 ? tied[0] : tied[stableHash(topic) % tied.length];
}

/**
 * RULE D — Authority reason when authority_elevated.
 *
 * PRODUCT-IMPLEMENTATION-002 (D′): now recommendation-aware. The `topic` parameter
 * was historically accepted and never read; it now (a) selects the most relevant
 * authority domain and (b) anchors the sentence. **Null-return conditions are
 * unchanged** — this is load-bearing, because a non-empty `authority_reason`
 * promotes a card to the `authority` execution stage in
 * `recommendationSequencingService`. When no topic is available the output is the
 * historical sentence verbatim.
 */
function buildAuthorityReason(
  flags: PolishFlags | undefined,
  topic: string,
  profile: CompanyProfile | null
): string | null {
  if (!flags?.authority_elevated || !profile?.authority_domains) return null;
  const domains = profile.authority_domains;
  const list = (Array.isArray(domains) ? domains : [domains])
    .map((d) => String(d ?? '').trim())
    .filter(Boolean);
  if (list.length === 0) return null;
  const match = selectAuthorityDomain(list, topic);
  if (!match) return null;
  const anchor = topic && topic.trim() ? ` — directly relevant to ${topic.trim()}` : '';
  return `Company has credibility in ${match}${anchor}.`;
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
): StrategicallyEnrichedRecommendation[] {
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
      const alignmentHigh = (rec.diamond_score as number ?? 0) >= 0.5 || flags?.diamond_candidate === true;

      const problemBeingSolved = buildProblemBeingSolved(profile, displayTopic);
      const expectedTransformation = buildExpectedTransformation(profile, displayTopic);

      const intelligence: StrategicRecommendationIntelligence = {
        problem_being_solved: problemBeingSolved,
        gap_being_filled: buildGapBeingFilled(flags, profile, rec, displayTopic, volumeMax),
        why_now: buildWhyNow(rec, volumeMax, alignmentHigh),
        authority_reason: buildAuthorityReason(flags, displayTopic, profile),
        expected_transformation: expectedTransformation,
        campaign_angle: buildCampaignAngle(flags),
      };

      return {
        ...rec,
        intelligence,
      } as StrategicallyEnrichedRecommendation;
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
      } as StrategicRecommendationIntelligence,
    })) as StrategicallyEnrichedRecommendation[];
  }
}
