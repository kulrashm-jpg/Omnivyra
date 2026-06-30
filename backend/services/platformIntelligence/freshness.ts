/**
 * Platform Freshness Engine (Phase 21B, Phase H).
 * One freshness model for every intelligence domain. Pure, deterministic (caller injects
 * `nowMs`). Website Intelligence's engineCommon re-exports this (Consumer #1).
 */
export interface Freshness {
  lastEvaluatedAt: string | null;
  dataAgeHours: number | null;
  stale: boolean;
}

export function freshnessFrom(iso: string | null, nowMs: number, staleHours = 24 * 14): Freshness {
  if (!iso) return { lastEvaluatedAt: null, dataAgeHours: null, stale: true };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { lastEvaluatedAt: iso, dataAgeHours: null, stale: true };
  const ageHours = Math.max(0, Math.round((nowMs - t) / 3_600_000));
  return { lastEvaluatedAt: iso, dataAgeHours: ageHours, stale: ageHours > staleHours };
}
