/**
 * Shared canonical ENGINE helpers — deterministic evidence/decay utilities reused by every entity's
 * intelligence engines (Lead/Company/Offering). Pure; no Date.now/Math.random.
 */

import { evidenceRef } from './primitives';
import type { EvidenceRef, EvidenceKind } from './contracts';

export const clamp01 = (n: number): number => Number(Math.max(0, Math.min(1, n)).toFixed(4));

export interface RawObservation { label: string; value?: string | number | boolean | null; source: string; observedAt: string; kind?: EvidenceKind; weight?: number; }

/** Deterministic evidence id: engine:label:source:observedAt (stable, collision-safe). */
export function mkEvidence(engine: string, o: RawObservation): EvidenceRef {
  return evidenceRef({
    id: `${engine}:${o.label}:${o.source}:${o.observedAt}`,
    kind: o.kind ?? 'observed', label: o.label, value: o.value ?? null,
    source: { system: o.source }, observedAt: o.observedAt, recordedAt: o.observedAt, weight: o.weight,
  });
}

/** Deterministic decay: 0.5 ^ (ageDays / halfLifeDays), clamped [0,1]. Timestamps passed in. */
export function decayFactor(observedAt: string, asOf: string, halfLifeDays: number): number {
  const ageMs = Math.max(0, Date.parse(asOf) - Date.parse(observedAt));
  return clamp01(Math.pow(0.5, ageMs / 86_400_000 / Math.max(1e-6, halfLifeDays)));
}
