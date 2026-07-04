/**
 * Canonical Evidence Validation Engine  (BETA-ENGINE-008, Phase 2)
 *
 * ONE reusable validator for canonical Evidence — no provider-specific validators, no duplicated logic.
 * Every Evidence record is validated before persistence; invalid (error-severity) rows are rejected so they
 * can never influence a decision. Deterministic: rules compare the Evidence against the canonical model + a
 * passed-in `nowIso` (no clock, no randomness).
 *
 * Severity → effect:
 *   error   → the row is REJECTED (must not enter a decision sample)
 *   warning → the row is FLAGGED (usable, but recorded — e.g. stale, duplicate key)
 *   info    → informational only
 */
import type { Evidence } from '../evidenceModel';

export const VALIDATOR_VERSION = '1.0.0';

export type ValidationSeverity = 'error' | 'warning' | 'info';
export type EvidenceValidationStatus = 'validated' | 'flagged' | 'rejected';

export interface ValidationReason {
  code: string;
  severity: ValidationSeverity;
  message: string;
  /** The evidence key the reason applies to (null for set-level reasons). */
  key: string | null;
}

export interface EvidenceValidationResult {
  id: string;
  key: string;
  status: EvidenceValidationStatus;
  reasons: ValidationReason[];
}

export interface EvidenceValidationReport {
  results: EvidenceValidationResult[];
  reasons: ValidationReason[]; // all reasons across the set (incl. set-level)
  validatedCount: number;
  flaggedCount: number;
  rejectedCount: number;
  duplicateKeys: string[];
  /** The subset that may enter a decision sample (status !== 'rejected'). */
  valid: Evidence[];
}

export interface ValidationContext {
  nowIso: string;
  /** Provider freshness window (hours) — Evidence older than this is flagged expired. */
  maxAgeHours?: number | null;
  /** Clock-skew tolerance for "future timestamp" checks (hours, default 1). */
  futureSkewHours?: number;
}

/** Allowed numeric ranges keyed by canonical unit. `max: null` = unbounded above. */
const UNIT_RANGES: Record<string, { min: number; max: number | null; integer?: boolean }> = {
  count: { min: 0, max: null, integer: true },
  ratio: { min: 0, max: 1 },
  score_0_100: { min: 0, max: 100 },
  rating_0_5: { min: 0, max: 5 },
  position: { min: 1, max: null },
  hours: { min: 0, max: null },
  seconds: { min: 0, max: null },
  per_day: { min: 0, max: null },
  boolean: { min: 0, max: 1, integer: true },
};

const keyOf = (e: Evidence): string => e.id?.split(':').pop() ?? '';
const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** Validate a single Evidence row against the canonical model. Pure. */
export function validateEvidence(e: Evidence, ctx: ValidationContext): EvidenceValidationResult {
  const key = keyOf(e);
  const reasons: ValidationReason[] = [];
  const add = (code: string, severity: ValidationSeverity, message: string) => reasons.push({ code, severity, message, key });

  // ── Schema / required fields ────────────────────────────────────────────────────────────────
  if (!e.id || !e.id.includes(':')) add('MISSING_ID', 'error', 'Evidence id is missing or not `engineId:key`.');
  if (!e.engineId) add('MISSING_ENGINE_ID', 'error', 'Evidence engineId is missing.');
  if (!e.maturity) add('MISSING_MATURITY', 'error', 'Evidence maturity is required.');
  if (!e.sourceType) add('MISSING_SOURCE_TYPE', 'warning', 'Evidence sourceType is missing (provenance incomplete).');

  const isUnavailable = e.maturity === 'UNAVAILABLE';

  // ── Missing / impossible value ──────────────────────────────────────────────────────────────
  if (isUnavailable) {
    if (e.value != null) add('VALUE_ON_UNAVAILABLE', 'error', 'UNAVAILABLE evidence must carry a null value (no fabricated measurement).');
  } else if (e.value == null) {
    add('MISSING_VALUE', 'error', 'Measured evidence is missing its value.');
  }

  // ── Unit / range validation (numeric measured values) ───────────────────────────────────────
  if (!isUnavailable && typeof e.value === 'number') {
    const range = e.unit ? UNIT_RANGES[e.unit] : undefined;
    if (range) {
      if (e.value < range.min || (range.max != null && e.value > range.max)) {
        add('OUT_OF_RANGE', 'error', `Value ${e.value} is outside the allowed range for unit '${e.unit}' [${range.min}..${range.max ?? '∞'}].`);
      }
      if (range.integer && !Number.isInteger(e.value)) {
        add('NON_INTEGER_COUNT', 'warning', `Value ${e.value} is non-integer for a '${e.unit}' unit.`);
      }
    }
    if (!Number.isFinite(e.value)) add('NON_FINITE_VALUE', 'error', 'Value is not finite (NaN/Infinity).');
  }

  // ── Timestamp validation ────────────────────────────────────────────────────────────────────
  const nowMs = parseMs(ctx.nowIso);
  const observedMs = parseMs(e.observedAt);
  const collectedMs = parseMs(e.collectedAt);
  if (e.observedAt && observedMs == null) add('UNPARSEABLE_TIMESTAMP', 'error', 'observedAt is not a parseable ISO timestamp.');
  if (observedMs != null && nowMs != null) {
    const skewMs = (ctx.futureSkewHours ?? 1) * 3_600_000;
    if (observedMs > nowMs + skewMs) add('FUTURE_TIMESTAMP', 'error', 'observedAt is in the future.');
  }
  if (observedMs != null && collectedMs != null && collectedMs + 1000 < observedMs) {
    add('COLLECTED_BEFORE_OBSERVED', 'warning', 'collectedAt precedes observedAt.');
  }

  // ── Freshness validation (flag, do not reject) ──────────────────────────────────────────────
  if (observedMs != null && nowMs != null && ctx.maxAgeHours != null) {
    const ageHours = Math.max(0, (nowMs - observedMs) / 3_600_000);
    if (ageHours >= ctx.maxAgeHours) add('EXPIRED_EVIDENCE', 'warning', `Evidence age ${ageHours.toFixed(1)}h ≥ maxAge ${ctx.maxAgeHours}h.`);
    else if (ageHours >= ctx.maxAgeHours * 0.5) add('STALE_EVIDENCE', 'info', `Evidence age ${ageHours.toFixed(1)}h is past half its freshness window.`);
  }

  const hasError = reasons.some((r) => r.severity === 'error');
  const hasWarning = reasons.some((r) => r.severity === 'warning');
  const status: EvidenceValidationStatus = hasError ? 'rejected' : hasWarning ? 'flagged' : 'validated';
  return { id: e.id, key, status, reasons };
}

/** Validate a full Evidence set: per-row rules + set-level duplicate detection. Pure. */
export function validateEvidenceSet(evidence: Evidence[], ctx: ValidationContext): EvidenceValidationReport {
  const results = evidence.map((e) => validateEvidence(e, ctx));

  // ── Duplicate detection (set-level) ─────────────────────────────────────────────────────────
  const seen = new Map<string, number>();
  for (const r of results) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
  const duplicateKeys = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const setReasons: ValidationReason[] = [];
  for (const dup of duplicateKeys) {
    setReasons.push({ code: 'DUPLICATE_KEY', severity: 'warning', message: `Evidence key '${dup}' appears more than once in the set.`, key: dup });
    for (const r of results) if (r.key === dup && r.status === 'validated') r.status = 'flagged';
  }

  const valid = evidence.filter((_, i) => results[i].status !== 'rejected');
  const allReasons = [...results.flatMap((r) => r.reasons), ...setReasons];
  return {
    results,
    reasons: allReasons,
    validatedCount: results.filter((r) => r.status === 'validated').length,
    flaggedCount: results.filter((r) => r.status === 'flagged').length,
    rejectedCount: results.filter((r) => r.status === 'rejected').length,
    duplicateKeys,
    valid,
  };
}
