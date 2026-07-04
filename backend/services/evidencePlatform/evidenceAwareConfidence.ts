/**
 * Evidence-Aware Confidence  (BETA-ENGINE-006)
 *
 * Upgrades decision engines from *provider-aware* (a boolean "is the provider connected?") to
 * *evidence-aware* (confidence derived from the provider's ACTUAL measured canonical Evidence rows).
 * It does NOT duplicate any calculation or fabricate anything — it reads measurements already present in a
 * canonical `Evidence[]` and maps them onto the existing `DecisionEvidence` factors, which flow through the
 * single `deriveDecisionConfidence` → Confidence Engine path.
 *
 * Deterministic. When no measured Evidence is supplied (the default / this environment without provider
 * data), engines fall back to their prior behaviour — so adoption is a perfect no-op until real Evidence
 * exists (backward compatible). Reuses canonical Evidence already produced by the provider adapters — no
 * new fetch, no duplicated transformation (Phase 7).
 */
import type { Evidence } from './evidenceModel';
import type { EvidenceMaturity } from './evidenceMaturity';

/** A measurement genuinely counts only when it is not an UNAVAILABLE failure row and carries a value. */
function isMeasured(e: Evidence): boolean {
  return e.maturity !== 'UNAVAILABLE' && e.value != null;
}

/** The canonical key of an evidence row (the part after the last ':' in its deterministic id). */
export function evidenceKey(e: Evidence): string {
  return e.id.split(':').pop() ?? '';
}

/** Extract a measured NUMERIC value by canonical key. Returns null when absent or not a measured number. */
export function evidenceValue(evidence: Evidence[] | null | undefined, key: string): number | null {
  if (!evidence) return null;
  const row = evidence.find((e) => evidenceKey(e) === key && isMeasured(e) && typeof e.value === 'number');
  return row ? (row.value as number) : null;
}

/** True when the set carries at least one genuine measurement (not just UNAVAILABLE failure rows). */
export function hasMeasuredEvidence(evidence: Evidence[] | null | undefined): boolean {
  return Boolean(evidence && evidence.some(isMeasured));
}

/** Number of measured rows in the set. */
export function measuredCount(evidence: Evidence[] | null | undefined): number {
  return evidence ? evidence.filter(isMeasured).length : 0;
}

export interface EvidenceSummary {
  /** measured (non-UNAVAILABLE, valued) rows */
  measured: number;
  /** total rows supplied */
  total: number;
  /** measured / total, 0 when empty */
  completeness: number;
  /** dominant maturity: MEASURED if any measured row is MEASURED, else the first measured row's maturity, else UNAVAILABLE */
  maturity: EvidenceMaturity;
  /** mean of per-row canonical confidence scores, when present */
  meanReliability: number | null;
  /** canonical keys of the measured rows (for explainability) */
  measuredKeys: string[];
}

/**
 * Deterministic summary of an Evidence[] for explainability + confidence factors. Pure — reads only what
 * the adapters already produced.
 */
export function summarizeEvidence(evidence: Evidence[] | null | undefined): EvidenceSummary {
  const rows = evidence ?? [];
  const measured = rows.filter(isMeasured);
  const reliabilities = measured
    .map((e) => {
      const c = e.confidence;
      const v = c?.reliability ?? c?.confidenceScore ?? null;
      return typeof v === 'number' ? v : null;
    })
    .filter((v): v is number => v != null);
  const maturity: EvidenceMaturity = measured.some((e) => e.maturity === 'MEASURED')
    ? 'MEASURED'
    : (measured[0]?.maturity ?? 'UNAVAILABLE');
  return {
    measured: measured.length,
    total: rows.length,
    completeness: rows.length > 0 ? measured.length / rows.length : 0,
    maturity,
    meanReliability: reliabilities.length ? reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length : null,
    measuredKeys: measured.map(evidenceKey),
  };
}
