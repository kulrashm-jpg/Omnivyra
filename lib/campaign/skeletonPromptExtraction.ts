/**
 * Strategic Mix — Skeleton AI-Chat natural-language bootstrap.
 *
 * Deterministic, registry-driven extraction of platforms / cadence /
 * duration / objective / content hints from the user's prompt, so the
 * panel can bootstrap the structured planning request BEFORE calling
 * ai/plan (whose validation is correct and stays untouched).
 *
 * HARD RULES (the complete rulebook — nothing outside it):
 *  - platforms come ONLY from the canonical registry: its keys plus its
 *    own alias vocabulary (PLATFORM_ALIAS_KEYS → normalizePlatformKey →
 *    getPlatformCapability). Unknown names fail closed — never invented.
 *  - SEGMENTS: each included platform mention opens a segment that runs to
 *    the next platform mention (or end of prompt). A cadence or content
 *    hint found inside a segment binds to THAT platform only.
 *  - SINGLE-VALUE FALLBACK: when exactly one distinct cadence (or hint)
 *    appears in the whole prompt, it applies to every platform lacking its
 *    own. With multiple distinct values, nothing is averaged — unbound
 *    platforms take the documented default (3/week; capability-driven
 *    content type).
 *  - EXCLUSIONS: platform mentions after an exclusion marker (except /
 *    excluding / but not / without) and before the next clause boundary
 *    (.;) are excluded. "everything / all platforms|channels" sets
 *    allPlatformsRequested — the CALLER resolves the universe (the
 *    planner's connected platforms) via resolvePlatformSelection.
 *  - OBJECTIVE: explicit "goal:"/"objective:" phrasing, else the first
 *    match from the closed OBJECTIVE_PHRASES list. Nothing else.
 *  - AMBIGUITY: "post often", "be active" etc. match no rule → not
 *    confident → the caller shows guidance instead of calling ai/plan.
 *  - LANGUAGE: patterns are ENGLISH-ONLY (there is no shared multilingual
 *    parser in the codebase to reuse). Platform brand names are
 *    language-independent and still match; cadence/duration/objective in
 *    other languages deliberately match nothing (graceful degradation:
 *    recognized platforms get documented defaults; a prompt with no
 *    recognizable platform gets guidance — never partial guessing).
 *  - Pure, no randomness, single linear scan per rule: O(prompt length ×
 *    fixed vocabulary).
 */

import {
  getPlatformCapability,
  normalizePlatformKey,
  platformSupportsCapability,
  PLATFORM_CAPABILITY_REGISTRY,
  PLATFORM_ALIAS_KEYS,
} from '../shared/social/platformCapabilities';
import { normalizeContentCapability } from '../shared/social/contentCapability';
import { normalizeBoltContentType, isBoltPlannerFormat } from '../../components/planner/boltPlannerTaxonomy';

/** The friendly guidance shown INSTEAD of calling ai/plan when no platform
 *  could be recognized (the raw server validation error never surfaces). */
export const SKELETON_CHAT_NO_PLATFORMS_MESSAGE =
  "I couldn't determine which platforms to plan for. Please choose them in Schedule or mention them in your request (for example: LinkedIn, Instagram, X, Facebook).";

/** Default weekly cadence when platforms were recognized but no cadence was
 *  stated (documented default; freely editable in Schedule before generating). */
export const DEFAULT_BOOTSTRAP_FREQUENCY = 3;

/** The closed campaign-objective vocabulary (first match wins; extending it
 *  is a documented change, never a runtime heuristic). */
export const OBJECTIVE_PHRASES: readonly string[] = [
  'thought leadership',
  'lead generation',
  'brand awareness',
  'product launch',
  'community building',
  'customer retention',
  'recruitment',
  'engagement',
  'conversions',
  'awareness',
];

export interface PlatformRequest {
  platform: string;
  frequencyPerWeek: number | null;
  contentHint: string | null;
}

export interface SkeletonPromptExtraction {
  /** Included platforms (exclusions already filtered), in prompt order. */
  platforms: string[];
  /** Per-platform cadence/hint, segment-scoped (see rulebook). */
  requests: PlatformRequest[];
  /** Prompt-global cadence — the single-value fallback (null when zero or
   *  multiple distinct cadences were found). */
  frequencyPerWeek: number | null;
  durationWeeks: number | null;
  objective: string | null;
  /** Prompt-global content hint — same single-value fallback rule. */
  contentHint: string | null;
  /** Registry platforms excluded via except/excluding/but not/without. */
  exclusions: string[];
  /** "everything" / "all platforms|channels" was requested. */
  allPlatformsRequested: boolean;
  /** True ⇔ ≥1 platform recognized OR an all-platforms request was made. */
  confident: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

interface Mention { index: number; key: string }

/** All registry platform mentions (keys + registry aliases) as whole words.
 *  'x' and short aliases only count standalone (never inside "3x"/words). */
function findPlatformMentions(lower: string): Mention[] {
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  const candidates = [...Object.keys(PLATFORM_CAPABILITY_REGISTRY), ...PLATFORM_ALIAS_KEYS];
  for (const word of candidates) {
    if (word.length === 0 || /[^a-z/]/.test(word)) continue;
    const escaped = word.replace('/', '\\/');
    const pattern = new RegExp(`(?<![0-9a-z])${escaped}(?![0-9a-z])`);
    const match = pattern.exec(lower);
    if (match === null) continue;
    const key = normalizePlatformKey(word);
    if (!getPlatformCapability(key)) continue; // the registry is the authority
    if (seen.has(key)) {
      // keep the EARLIEST mention per platform (alias + name may both appear)
      const existing = mentions.find((m) => m.key === key)!;
      if (match.index < existing.index) existing.index = match.index;
      continue;
    }
    seen.add(key);
    mentions.push({ index: match.index, key });
  }
  return mentions.sort((a, b) => a.index - b.index);
}

const EXCLUSION_MARKER = /\b(?:except|excluding|but\s+not|without)\b/g;
const ALL_PLATFORMS = /\b(?:everything|all\s+(?:the\s+)?(?:platforms|channels))\b/;

/** Mentions after an exclusion marker and before the next clause boundary. */
function findExclusions(lower: string, mentions: Mention[]): Set<string> {
  const excluded = new Set<string>();
  for (const marker of lower.matchAll(EXCLUSION_MARKER)) {
    const start = (marker.index ?? 0) + marker[0].length;
    const boundaryOffset = lower.slice(start).search(/[.;]/);
    const end = boundaryOffset === -1 ? lower.length : start + boundaryOffset;
    for (const mention of mentions) {
      if (mention.index >= start && mention.index < end) excluded.add(mention.key);
    }
  }
  return excluded;
}

function findFrequency(segment: string): number | null {
  const numeric = /(\d+)\s*(?:posts?|times|x)?\s*(?:\/|per|a|each)\s*week/.exec(segment);
  if (numeric) return clamp(Number(numeric[1]), 1, 14);
  const worded = /\b(once|twice|thrice|one|two|three|four|five|six|seven)\b(?:\s*(?:posts?|times))?\s*(?:\/|per|a|each)\s*week/.exec(segment);
  if (worded && NUMBER_WORDS[worded[1]]) return clamp(NUMBER_WORDS[worded[1]], 1, 14);
  if (/\b(daily|every\s*day)\b/.test(segment)) return 7;
  if (/\bweekly\b/.test(segment)) return 1;
  return null;
}

function findContentHint(segment: string): string | null {
  const tokens = segment.split(/[^a-z_]+/).filter(Boolean);
  for (const token of tokens) {
    const singular = token.endsWith('s') ? token.slice(0, -1) : token;
    for (const candidate of [token, singular]) {
      const normalized = normalizeBoltContentType(candidate);
      if (isBoltPlannerFormat(normalized)) return normalized;
    }
  }
  return null;
}

function findDurationWeeks(lower: string): number | null {
  const weeks = /(\d+)\s*-?\s*(?:weeks?|wks?)\b/.exec(lower);
  if (weeks) return clamp(Number(weeks[1]), 1, 52);
  const months = /(\d+)\s*-?\s*months?\b/.exec(lower);
  if (months) return clamp(Number(months[1]) * 4, 1, 52);
  if (/\b(?:a|one)\s+month\b/.test(lower)) return 4;
  return null;
}

function findObjective(prompt: string): string | null {
  const explicit = /(?:goal|objective)\s*[:\-]\s*([^.;\n]+)/i.exec(prompt);
  if (explicit) return explicit[1].trim();
  const lower = prompt.toLowerCase();
  let best: { index: number; phrase: string } | null = null;
  for (const phrase of OBJECTIVE_PHRASES) {
    const index = lower.indexOf(phrase);
    if (index !== -1 && (best === null || index < best.index)) best = { index, phrase };
  }
  return best ? best.phrase : null;
}

export function extractSkeletonRequest(prompt: string): SkeletonPromptExtraction {
  const text = typeof prompt === 'string' ? prompt : '';
  const lower = text.toLowerCase();

  const allMentions = findPlatformMentions(lower);
  const excluded = findExclusions(lower, allMentions);
  const included = allMentions.filter((m) => !excluded.has(m.key));
  const allPlatformsRequested = ALL_PLATFORMS.test(lower);

  // Segment-scoped cadence + hints (rulebook: segment = mention → next mention).
  const requests: PlatformRequest[] = included.map((mention, i) => {
    const segment = lower.slice(mention.index, included[i + 1]?.index ?? lower.length);
    return {
      platform: mention.key,
      frequencyPerWeek: findFrequency(segment),
      contentHint: findContentHint(segment),
    };
  });

  // Single-value fallback: exactly one distinct value in the WHOLE prompt
  // applies to unbound platforms; multiple distinct values never average.
  const promptFrequency = findFrequency(lower);
  const distinctFrequencies = new Set(requests.map((r) => r.frequencyPerWeek).filter((f) => f !== null));
  if (promptFrequency !== null) distinctFrequencies.add(promptFrequency);
  const globalFrequency = distinctFrequencies.size === 1 ? [...distinctFrequencies][0] as number : null;

  const promptHint = findContentHint(lower);
  const distinctHints = new Set(requests.map((r) => r.contentHint).filter((h) => h !== null));
  if (promptHint !== null) distinctHints.add(promptHint);
  const globalHint = distinctHints.size === 1 ? [...distinctHints][0] as string : null;

  return {
    platforms: included.map((m) => m.key),
    requests,
    frequencyPerWeek: globalFrequency,
    durationWeeks: findDurationWeeks(lower),
    objective: findObjective(text),
    contentHint: globalHint,
    exclusions: [...excluded],
    allPlatformsRequested,
    confident: included.length > 0 || allPlatformsRequested,
  };
}

/**
 * Resolve the final platform list. Explicit mentions win; an all-platforms
 * request expands to the caller-supplied universe (the planner's CONNECTED
 * platforms — the same set the Schedule matrix shows) minus exclusions.
 * Empty result ⇒ the caller shows guidance.
 */
export function resolvePlatformSelection(
  extraction: SkeletonPromptExtraction,
  connectedUniverse: string[],
): string[] {
  if (extraction.platforms.length > 0) return extraction.platforms;
  if (!extraction.allPlatformsRequested) return [];
  const excluded = new Set(extraction.exclusions);
  return connectedUniverse
    .map((p) => normalizePlatformKey(p))
    .filter((p) => Boolean(getPlatformCapability(p)) && !excluded.has(p));
}

/**
 * Default content type per platform, capability-driven (never invented):
 * the hint when the platform supports its capability, else text-capable →
 * 'post', else image-capable → 'image', else 'video'. Unsupported
 * combinations are thereby rejected into the nearest valid type.
 */
export function defaultContentTypeForPlatform(platform: string, contentHint: string | null): string {
  if (contentHint) {
    const capability = normalizeContentCapability({ contentType: contentHint });
    if (capability && platformSupportsCapability(platform, capability)) return contentHint;
  }
  if (platformSupportsCapability(platform, 'text')) return 'post';
  if (platformSupportsCapability(platform, 'image')) return 'image';
  return 'video';
}

/**
 * Build the platform_content_requests matrix (the planner's canonical
 * ingress — the Schedule view renders it; strategy_context derives from
 * it). `platforms` defaults to the extraction's own list; callers pass the
 * resolved list for all-platforms requests or a merge subset.
 */
export function buildBootstrapMatrix(
  extraction: SkeletonPromptExtraction,
  platforms?: string[],
): Record<string, Record<string, number>> {
  const targets = platforms ?? extraction.platforms;
  const byPlatform = new Map(extraction.requests.map((r) => [r.platform, r]));
  const matrix: Record<string, Record<string, number>> = {};
  for (const platform of targets) {
    const request = byPlatform.get(platform);
    const frequency = request?.frequencyPerWeek ?? extraction.frequencyPerWeek ?? DEFAULT_BOOTSTRAP_FREQUENCY;
    const hint = request?.contentHint ?? extraction.contentHint;
    matrix[platform] = { [defaultContentTypeForPlatform(platform, hint)]: frequency };
  }
  return matrix;
}
