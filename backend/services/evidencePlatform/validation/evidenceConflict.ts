/**
 * Evidence Conflict Resolution  (BETA-ENGINE-008, Phase 4)
 *
 * Deterministic cross-provider conflict handling. When two or more providers report a DIFFERENT numeric
 * value for the SAME canonical measurement (same key, same subject), it is recorded as a conflict — NEVER
 * silently overwritten. Resolution is deterministic + explainable: the highest-reliability provider's value
 * is chosen as the "effective" value, ties broken by lexicographic providerId; ALL contributing values are
 * retained for traceability.
 *
 * Pure — no clock, no randomness.
 */
import type { Evidence } from '../evidenceModel';

/** A per-provider Evidence contribution for the same subject. */
export interface ProviderEvidenceSet {
  providerId: string;
  providerReliability: number | null;
  evidence: Evidence[];
}

export interface ConflictValue {
  providerId: string;
  providerReliability: number | null;
  value: number;
}

export interface EvidenceConflict {
  key: string;
  values: ConflictValue[];
  /** max - min across contributing values. */
  spread: number;
  resolution: {
    policy: 'highest_reliability';
    chosenProviderId: string;
    chosenValue: number;
  };
}

export interface ConflictReport {
  conflicts: EvidenceConflict[];
  conflictCount: number;
}

const keyOf = (e: Evidence): string => e.id?.split(':').pop() ?? '';
const round = (n: number): number => Math.round(n * 10000) / 10000;

/** Relative tolerance below which two numeric values are considered "the same" (not a conflict). */
const REL_TOLERANCE = 0.02;

function differ(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale > REL_TOLERANCE;
}

/**
 * Detect + deterministically resolve cross-provider conflicts over the same canonical keys. Only
 * measured numeric values participate (UNAVAILABLE / non-numeric are ignored, never in conflict).
 */
export function detectConflicts(sets: ProviderEvidenceSet[]): ConflictReport {
  // Gather measured numeric values per key, per provider.
  const byKey = new Map<string, ConflictValue[]>();
  for (const set of sets) {
    for (const e of set.evidence) {
      if (e.maturity === 'UNAVAILABLE' || typeof e.value !== 'number') continue;
      const key = keyOf(e);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push({ providerId: set.providerId, providerReliability: set.providerReliability, value: e.value });
      byKey.set(key, list);
    }
  }

  const conflicts: EvidenceConflict[] = [];
  // Deterministic key order.
  for (const key of [...byKey.keys()].sort()) {
    const values = byKey.get(key)!;
    if (values.length < 2) continue;
    const nums = values.map((v) => v.value);
    const spread = Math.max(...nums) - Math.min(...nums);
    // A conflict exists only if at least one pair differs beyond tolerance.
    let conflicting = false;
    for (let i = 0; i < values.length && !conflicting; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (differ(values[i].value, values[j].value)) { conflicting = true; break; }
      }
    }
    if (!conflicting) continue;

    // Deterministic resolution: highest reliability, tie → lexicographic providerId.
    const chosen = [...values].sort((a, b) => {
      const ra = a.providerReliability ?? -1;
      const rb = b.providerReliability ?? -1;
      if (rb !== ra) return rb - ra;
      return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
    })[0];

    conflicts.push({
      key,
      values: values.map((v) => ({ ...v, value: round(v.value) })),
      spread: round(spread),
      resolution: { policy: 'highest_reliability', chosenProviderId: chosen.providerId, chosenValue: round(chosen.value) },
    });
  }

  return { conflicts, conflictCount: conflicts.length };
}
