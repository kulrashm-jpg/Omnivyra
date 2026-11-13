/**
 * Server-side merge rules for AI-produced company-profile values (e1 2026-11-13, D3 + the generate-MI fallback).
 *
 * The routes return AI results that clients SPREAD into the profile and then save. Three ways that loses data:
 *   1. define-target-customer returned campaign_purpose_intent with only its 5 AI keys, REPLACING the stored object
 *      and erasing reader_emotion_target / narrative_flow_seed / recommended_cta_style for every caller (D3).
 *   2. A blank AI value was returned as '' - which overwrites a stored value, and which the scalar clear-lock reads
 *      as a DELIBERATE user clear.
 *   3. structuredFields passed through any key the model invented, straight into the profile.
 * Rule everywhere: a non-empty AI value wins; an empty one keeps the stored value; if neither has a value the key is
 * OMITTED (never '', never null) so a client spread leaves the profile untouched; only whitelisted keys are returned.
 */
import type { CompanyProfile } from './types';

type Cpi = NonNullable<CompanyProfile['campaign_purpose_intent']>;

const nonEmpty = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/**
 * Whitelisted scalar fields: AI non-empty wins, else the stored value, else the key is omitted.
 */
export function mergeAiScalarFields(
  allowed: readonly string[],
  ai: Record<string, unknown> | null | undefined,
  stored: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const v = nonEmpty(ai?.[key]) || nonEmpty(stored?.[key]);
    if (v) out[key] = v;
  }
  return out;
}

const CPI_STRING_KEYS = ['primary_objective', 'campaign_intent', 'monetization_intent', 'brand_positioning_angle'] as const;

/**
 * The FULL campaign_purpose_intent: the stored object (all 8 keys, untouched where the AI says nothing) with the AI's
 * non-empty values on top. dominant_problem_domains: a non-empty AI list (strings only) wins, else the stored list.
 * Returns null only when there is nothing at all (no stored object and no AI value).
 */
export function mergeCampaignPurposeIntent(stored: unknown, ai: unknown): Cpi | null {
  const base: Cpi = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Cpi) } : {};
  const a = ai && typeof ai === 'object' && !Array.isArray(ai) ? (ai as Record<string, unknown>) : {};
  for (const key of CPI_STRING_KEYS) {
    const v = nonEmpty(a[key]);
    if (v) base[key] = v;
  }
  const domains = Array.isArray(a.dominant_problem_domains)
    ? a.dominant_problem_domains.filter((d): d is string => typeof d === 'string' && d.trim() !== '').map((d) => d.trim())
    : [];
  if (domains.length > 0) base.dominant_problem_domains = domains;
  return Object.keys(base).length > 0 ? base : null;
}
