/**
 * CPG-001 — the per-value measures the claim resolver applies (§9, §10, §14).
 *
 * Split out of claimResolution.ts (CPG-016) along its own section boundaries:
 * evidence freshness, revenue semantics (§14), materiality (§10) and confidence
 * (§9) judge ONE value or ONE pair of values; the resolver in claimResolution.ts
 * decides what a whole field's evidence means. Moved verbatim — no weight,
 * threshold or rule changed. claimResolution.ts re-exports the public measures,
 * so every existing import is unchanged.
 *
 * Pure and deterministic: `asOf` is injected; no clock, no RNG, no I/O.
 */

import { foldForComparison } from './textFold';
import type { EvidenceFreshness, FieldConfidence } from './types';
import { canonicalMoneyKey } from './extraction/valueTypes';

// ── freshness ────────────────────────────────────────────────────────────────

const FRESH_DAYS = 180;
const AGING_DAYS = 540;

export function evidenceFreshness(publishedAt: string | null, accessedAt: string, asOf: string): EvidenceFreshness {
  const basis = publishedAt ?? accessedAt;
  const t = Date.parse(basis);
  const now = Date.parse(asOf);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return 'unknown';
  const days = (now - t) / 86_400_000;
  if (days < 0) return 'unknown';
  if (days <= FRESH_DAYS) return 'fresh';
  if (days <= AGING_DAYS) return 'aging';
  return 'stale';
}

/**
 * `unknown` scores ZERO, not a consolation fraction. An undateable document is
 * not weak evidence of recency — it is no evidence of recency, and awarding it
 * points would let a claim with no sources at all accumulate confidence.
 */
export const FRESHNESS_WEIGHT: Readonly<Record<EvidenceFreshness, number>> = Object.freeze({
  fresh: 1.0, aging: 0.7, stale: 0.35, unknown: 0,
});

// ── revenue semantics (§14) ──────────────────────────────────────────────────

export type RevenueKind =
  | 'ACTUAL' | 'TARGET' | 'RUN_RATE' | 'ORDER_BOOK' | 'INVESTMENT' | 'UNVERIFIED' | 'NOT_REVENUE';

/**
 * Classify a revenue-shaped string by the measure it actually states.
 * Deliberately conservative: anything forward-looking is NOT actual revenue.
 */
export function revenueKind(value: string): RevenueKind {
  const v = value.toLowerCase();
  if (/\b(not verified|unverified)\b/.test(v)) return 'UNVERIFIED';
  if (/\b(target|projection|projected|ambition|expectation|expected|aims? to|goal)\b/.test(v)) return 'TARGET';
  if (/\brun[- ]?rate\b/.test(v)) return 'RUN_RATE';
  if (/\border[- ]?book\b/.test(v)) return 'ORDER_BOOK';
  if (/\b(investment|funding|raised|invested)\b/.test(v)) return 'INVESTMENT';
  // CPG-007: ISO codes count as currency too — an extracted value is rendered
  // "INR 78,000,000 (FY2024)", and without this it read as NOT_REVENUE, which
  // made every user-vs-extracted revenue disagreement "not comparable" and so
  // silently suppressed the conflict.
  if (/\b(revenue|turnover|arr|topline|top[- ]line)\b/.test(v) || /(₹|\$|€|£)\s*[\d.]/.test(v)
    || /\b(usd|inr|eur|gbp|jpy)\s*[\d.]/.test(v)) return 'ACTUAL';
  return 'NOT_REVENUE';
}

export const REVENUE_FIELDS = new Set(['revenue', 'annual_revenue', 'revenue_evidence', 'turnover']);

/** Two revenue claims are comparable only if they state the SAME measure. */
export function revenueComparable(a: string, b: string): boolean {
  return revenueKind(a) === revenueKind(b);
}

// ── materiality (§10) ────────────────────────────────────────────────────────

/**
 * Fields where a disagreement is worth interrupting the user for. Everything
 * else records the conflict but does not raise a confirmation request.
 */
export const MATERIAL_FIELDS: ReadonlySet<string> = new Set([
  'name', 'legal_name', 'industry', 'products_services', 'unique_value',
  'ideal_customer_profile', 'target_audience', 'brand_positioning',
  'ceo', 'founder', 'leadership', 'headquarters', 'geography',
  'revenue', 'annual_revenue', 'revenue_evidence', 'turnover',
  'employee_count', 'funding', 'ownership', 'expansion',
  // CPG-008: a founding year is an identity fact — 2009 vs 2010 is a real
  // disagreement. It was absent, so it could never conflict, even with a user.
  'founded_year',
]);

/**
 * Trivial wording differences must not generate a confirmation request.
 *
 * TWO TRAPS THIS DELIBERATELY AVOIDS:
 *  1. Never strip 'a'/'an' as stop words. Folding "Person A" to "person" makes
 *     it a prefix of "person b", which would silently classify two DIFFERENT
 *     named people as the same value — the worst possible false negative here.
 *  2. Containment requires the shorter side to be substantial AND to align on a
 *     token boundary, so "Chennai" never absorbs "Chennai Express" by accident.
 */
const CONTAINMENT_MIN_CHARS = 6;

export function isTriviallyDifferent(a: string, b: string): boolean {
  // CPG-012: script-neutral (was [^a-z0-9]: "愛知県 豊田市, JP" and "東京都 港区, JP" both folded to "jp").
  const fold = (s: string) => foldForComparison(s)
    // Legal-form and connective noise only. 'a'/'an' are NOT stripped.
    .replace(/\b(and|the|of|for|inc|ltd|pvt|private|limited|llp|llc|corp|corporation)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const fa = fold(a), fb = fold(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;

  // "Cybersecurity" vs "cyber security" — same word, different spacing.
  if (fa.replace(/ /g, '') === fb.replace(/ /g, '')) return true;

  // One is a token-aligned superset of the other, and the shorter is not a
  // trivially short fragment.
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (short.length < CONTAINMENT_MIN_CHARS) return false;
  const boundary = new RegExp(`(^|\\s)${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`);
  return boundary.test(long);
}

export function isMaterialConflict(field: string, userValue: string, publicValue: string): boolean {
  if (!MATERIAL_FIELDS.has(field)) return false;
  if (REVENUE_FIELDS.has(field) && !revenueComparable(userValue, publicValue)) {
    // Different measures are not a contradiction — they are different facts.
    return false;
  }
  // CPG-007: two stated amounts compare EXACTLY, never by text folding — the
  // containment rule in `isTriviallyDifferent` reads "USD 5,000,000" as the
  // same value as "USD 5,000,000,000".
  const a = canonicalMoneyKey(field, userValue);
  const b = canonicalMoneyKey(field, publicValue);
  if (a !== null && b !== null) return a !== b;
  if (isTriviallyDifferent(userValue, publicValue)) return false;
  return true;
}

// ── confidence (§9) ──────────────────────────────────────────────────────────

/**
 * DOCUMENTED FORMULA — ENGINEERING DEFAULT, NOT EMPIRICALLY CALIBRATED.
 *
 *   score = authority(40) + corroboration(25) + freshness(20) + entityMatch(15)
 *           − conflictPenalty(25 when CONFLICTING)
 *
 * WHAT THE NUMBER MEANS: how well-EVIDENCED a claim is — source authority,
 * independent corroboration, recency, and identity certainty.
 *
 * WHAT IT DOES NOT MEAN: it is NOT a probability. A score of 80 does not mean
 * "80% likely to be true". No calibration study has been performed, and none of
 * these weights or bands is derived from data.
 */
export const CONFIDENCE_FORMULA = Object.freeze({
  weights: { authority: 40, corroboration: 25, freshness: 20, entityMatch: 15, conflictPenalty: 25 },
  corroborationSteps: { one: 0.4, two: 0.7, threeOrMore: 1.0 },
  bands: { VERIFIED_CANDIDATE: 90, HIGH: 80, NEEDS_REVIEW: 60 },
  calibration: 'ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED',
  meaning: 'Measures strength of evidence, not probability of truth. A score of 80 does NOT mean 80% likely correct.',
});

function corroborationFactor(independentSources: number): number {
  if (independentSources >= 3) return CONFIDENCE_FORMULA.corroborationSteps.threeOrMore;
  if (independentSources === 2) return CONFIDENCE_FORMULA.corroborationSteps.two;
  if (independentSources === 1) return CONFIDENCE_FORMULA.corroborationSteps.one;
  return 0;
}

export function computeConfidence(input: {
  bestTierWeight: number;
  independentSources: number;
  freshness: EvidenceFreshness;
  entityMatchWeight: number;
  conflicting: boolean;
}): FieldConfidence {
  const w = CONFIDENCE_FORMULA.weights;
  const authority = input.bestTierWeight * w.authority;
  const corroboration = corroborationFactor(input.independentSources) * w.corroboration;
  const freshness = FRESHNESS_WEIGHT[input.freshness] * w.freshness;
  const entityMatch = input.entityMatchWeight * w.entityMatch;
  const conflictPenalty = input.conflicting ? w.conflictPenalty : 0;

  const raw = authority + corroboration + freshness + entityMatch - conflictPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const band = score >= CONFIDENCE_FORMULA.bands.VERIFIED_CANDIDATE ? 'VERIFIED_CANDIDATE'
    : score >= CONFIDENCE_FORMULA.bands.HIGH ? 'HIGH'
    : score >= CONFIDENCE_FORMULA.bands.NEEDS_REVIEW ? 'NEEDS_REVIEW'
    : 'UNVERIFIED';

  return {
    score, band,
    components: {
      authority: Number(authority.toFixed(2)),
      corroboration: Number(corroboration.toFixed(2)),
      freshness: Number(freshness.toFixed(2)),
      entityMatch: Number(entityMatch.toFixed(2)),
      conflictPenalty,
    },
    meaning: CONFIDENCE_FORMULA.meaning,
  };
}
