/**
 * changeDetectionService.ts — deterministic website change decision (CKRE-001 §5).
 *
 * PURE. Retry-safe. Reusable. No network, no AI, no semantic analysis. Given a
 * previous fingerprint and the current one (from websiteFingerprintService), it
 * classifies the change and produces a deterministic 0–100 score.
 *
 * Verdicts:
 *   UNKNOWN         — no prior fingerprint (nothing to compare)
 *   UNCHANGED       — no structural and no business change
 *   COSMETIC_CHANGE — structural/HTTP changed, but no business field changed
 *   BUSINESS_CHANGE — 1–2 business fields changed
 *   MAJOR_CHANGE    — company name changed, or ≥3 business fields changed
 *
 * Level 0 (HTTP validators) provides a fast confirm: matching etag (or
 * last-modified + content-length) alongside an unchanged html hash yields
 * UNCHANGED without weighing the rest.
 *
 * This mission does NOT act on the verdict (no enrichment gating — that is
 * CKRE-002). The verdict is computed, emitted, and stored as a foundation.
 */

import type { WebsiteFingerprint } from './websiteFingerprintService';

export type ChangeVerdict =
  | 'UNKNOWN'
  | 'UNCHANGED'
  | 'COSMETIC_CHANGE'
  | 'BUSINESS_CHANGE'
  | 'MAJOR_CHANGE';

export interface ChangeDecision {
  verdict: ChangeVerdict;
  /** Deterministic 0–100 change magnitude. */
  score: number;
  changedLevels: Array<'level0' | 'level1' | 'level2'>;
  changedFields: string[];
  reason: string;
}

const LEVEL1_WEIGHT = 5;
const LEVEL2_WEIGHT = 20;
const COMPANY_NAME_BONUS = 30;

/** Fields differ when both are present and unequal, OR one is present and the other null. */
function differs(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return false;
  return a !== b;
}

function changedKeys(prev: Record<string, string | null>, next: Record<string, string | null>): string[] {
  return Object.keys(next).filter((k) => differs(prev[k] ?? null, next[k] ?? null));
}

function level0Match(prev: WebsiteFingerprint, next: WebsiteFingerprint): boolean {
  const p = prev.level0, n = next.level0;
  if (p.etag && n.etag && p.etag === n.etag) return true;
  if (p.lastModified && n.lastModified && p.lastModified === n.lastModified &&
      p.contentLength && n.contentLength && p.contentLength === n.contentLength) return true;
  return false;
}

/**
 * Decide the change class between two fingerprints. Deterministic and pure —
 * same inputs always yield the same decision.
 */
export function decideWebsiteChange(
  prev: WebsiteFingerprint | null,
  next: WebsiteFingerprint,
): ChangeDecision {
  if (!prev) {
    return { verdict: 'UNKNOWN', score: 0, changedLevels: [], changedFields: [], reason: 'no_prior_fingerprint' };
  }

  const l1Changed = changedKeys(prev.level1 as unknown as Record<string, string | null>, next.level1 as unknown as Record<string, string | null>);
  const l2Changed = changedKeys(prev.level2 as unknown as Record<string, string | null>, next.level2 as unknown as Record<string, string | null>);

  const changedLevels: ChangeDecision['changedLevels'] = [];
  if (!level0Match(prev, next) && (prev.level0.etag || next.level0.etag || prev.level0.lastModified || next.level0.lastModified)) {
    changedLevels.push('level0');
  }
  if (l1Changed.length) changedLevels.push('level1');
  if (l2Changed.length) changedLevels.push('level2');

  const changedFields = [
    ...l1Changed.map((f) => `level1.${f}`),
    ...l2Changed.map((f) => `level2.${f}`),
  ];

  // Fast confirm: HTTP validators match AND structural html unchanged → UNCHANGED.
  const htmlUnchanged = !differs(prev.level1.htmlHash, next.level1.htmlHash);
  if (level0Match(prev, next) && htmlUnchanged && l2Changed.length === 0) {
    return { verdict: 'UNCHANGED', score: 0, changedLevels: [], changedFields: [], reason: 'level0_match_and_html_unchanged' };
  }

  if (l1Changed.length === 0 && l2Changed.length === 0) {
    return { verdict: 'UNCHANGED', score: 0, changedLevels: [], changedFields: [], reason: 'no_fingerprint_change' };
  }

  // Deterministic score.
  let score = l1Changed.length * LEVEL1_WEIGHT + l2Changed.length * LEVEL2_WEIGHT;
  const companyNameChanged = l2Changed.includes('companyName');
  if (companyNameChanged) score += COMPANY_NAME_BONUS;
  score = Math.min(100, score);

  if (l2Changed.length === 0) {
    return { verdict: 'COSMETIC_CHANGE', score, changedLevels, changedFields, reason: 'structural_only' };
  }
  if (companyNameChanged || l2Changed.length >= 3) {
    return { verdict: 'MAJOR_CHANGE', score, changedLevels, changedFields, reason: companyNameChanged ? 'company_name_changed' : 'many_business_fields_changed' };
  }
  return { verdict: 'BUSINESS_CHANGE', score, changedLevels, changedFields, reason: 'business_fields_changed' };
}

/** Map a verdict to the observability metric that should increment (CKRE-001 §6). */
export function changeMetricFor(verdict: ChangeVerdict): string | null {
  switch (verdict) {
    case 'COSMETIC_CHANGE': return 'change_detected';
    case 'BUSINESS_CHANGE': return 'business_change';
    case 'MAJOR_CHANGE':    return 'major_change';
    default:                return null; // UNCHANGED / UNKNOWN emit no change metric
  }
}
