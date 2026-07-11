/**
 * Strategic Mix — Skeleton AI-Chat natural-language bootstrap (UX fix).
 *
 * The Skeleton AI Chat's placeholder invites prompts like
 * "4-week LinkedIn & Instagram campaign, 3 posts per week" — this module
 * makes the client honor that: it extracts platforms / cadence / duration /
 * objective from the prompt so the panel can bootstrap the structured
 * planning request BEFORE calling ai/plan (whose validation is correct and
 * stays untouched).
 *
 * Rules:
 *  - platforms come ONLY from the canonical registry (normalizePlatformKey
 *    + getPlatformCapability) — unknown names are never invented, they
 *    simply don't match (fail closed)
 *  - confidence = at least one registry platform recognized; without it the
 *    caller must show guidance instead of calling ai/plan
 *  - pure + deterministic: same prompt → same extraction
 */

import {
  getPlatformCapability,
  normalizePlatformKey,
  platformSupportsCapability,
  PLATFORM_CAPABILITY_REGISTRY,
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

export interface SkeletonPromptExtraction {
  /** Canonical registry platform keys, in prompt order, deduped. */
  platforms: string[];
  /** Posts per week, when confidently stated. */
  frequencyPerWeek: number | null;
  /** Campaign duration in weeks, when confidently stated. */
  durationWeeks: number | null;
  /** Explicit goal/objective phrasing, when present. */
  objective: string | null;
  /** A BOLT content-type hint named in the prompt (e.g. "reels"). */
  contentHint: string | null;
  /** True ⇔ at least one platform recognized — the bootstrap gate. */
  confident: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Platforms: scan for registry keys (+ 'twitter' alias) as whole words.
 *  'x' only counts when standalone and not part of a multiplier ("3x"). */
function extractPlatforms(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const found: Array<{ index: number; key: string }> = [];
  const candidates = [...Object.keys(PLATFORM_CAPABILITY_REGISTRY), 'twitter'];
  for (const word of candidates) {
    const pattern = word === 'x'
      ? /(?<![0-9a-z])x(?![0-9a-z])/ // standalone X, never the "3x" multiplier
      : new RegExp(`(?<![a-z])${word}(?![a-z])`);
    const match = pattern.exec(lower);
    if (match === null) continue;
    const key = normalizePlatformKey(word);
    if (!getPlatformCapability(key)) continue; // registry is the authority
    found.push({ index: match.index, key });
  }
  const ordered = found.sort((a, b) => a.index - b.index).map((f) => f.key);
  return Array.from(new Set(ordered));
}

function extractFrequencyPerWeek(prompt: string): number | null {
  const lower = prompt.toLowerCase();
  // "3 posts per week" / "3x/week" / "3 times a week"
  const numeric = /(\d+)\s*(?:posts?|times|x)?\s*(?:\/|per|a|each)\s*week/.exec(lower);
  if (numeric) return clamp(Number(numeric[1]), 1, 14);
  // "twice a week" / "three times per week"
  const worded = /\b(once|twice|thrice|one|two|three|four|five|six|seven)\b(?:\s*(?:posts?|times))?\s*(?:\/|per|a|each)\s*week/.exec(lower);
  if (worded && NUMBER_WORDS[worded[1]]) return clamp(NUMBER_WORDS[worded[1]], 1, 14);
  if (/\b(daily|every\s*day)\b/.test(lower)) return 7;
  if (/\bweekly\b/.test(lower)) return 1;
  return null;
}

function extractDurationWeeks(prompt: string): number | null {
  const lower = prompt.toLowerCase();
  const weeks = /(\d+)\s*-?\s*(?:weeks?|wks?)\b/.exec(lower);
  if (weeks) return clamp(Number(weeks[1]), 1, 52);
  const months = /(\d+)\s*-?\s*months?\b/.exec(lower);
  if (months) return clamp(Number(months[1]) * 4, 1, 52);
  if (/\b(?:a|one)\s+month\b/.test(lower)) return 4;
  return null;
}

function extractObjective(prompt: string): string | null {
  const match = /(?:goal|objective)\s*[:\-]\s*([^.;\n]+)/i.exec(prompt);
  return match ? match[1].trim() : null;
}

/** A BOLT planner format named in the prompt (plural-tolerant), if any. */
function extractContentHint(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  const tokens = lower.split(/[^a-z_]+/).filter(Boolean);
  for (const token of tokens) {
    const singular = token.endsWith('s') ? token.slice(0, -1) : token;
    for (const candidate of [token, singular]) {
      const normalized = normalizeBoltContentType(candidate);
      if (isBoltPlannerFormat(normalized)) return normalized;
    }
  }
  return null;
}

export function extractSkeletonRequest(prompt: string): SkeletonPromptExtraction {
  const text = typeof prompt === 'string' ? prompt : '';
  const platforms = extractPlatforms(text);
  return {
    platforms,
    frequencyPerWeek: extractFrequencyPerWeek(text),
    durationWeeks: extractDurationWeeks(text),
    objective: extractObjective(text),
    contentHint: extractContentHint(text),
    confident: platforms.length > 0,
  };
}

/**
 * Default content type per platform, capability-driven (never invented):
 * the content hint when the platform supports its capability, else
 * text-capable → 'post', else image-capable → 'image', else 'video'.
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
 * Build the platform_content_requests matrix the planner already treats as
 * the canonical ingress (the Schedule view renders it; strategy_context is
 * derived from it). One entry per recognized platform.
 */
export function buildBootstrapMatrix(
  extraction: SkeletonPromptExtraction,
): Record<string, Record<string, number>> {
  const frequency = extraction.frequencyPerWeek ?? DEFAULT_BOOTSTRAP_FREQUENCY;
  const matrix: Record<string, Record<string, number>> = {};
  for (const platform of extraction.platforms) {
    matrix[platform] = { [defaultContentTypeForPlatform(platform, extraction.contentHint)]: frequency };
  }
  return matrix;
}
