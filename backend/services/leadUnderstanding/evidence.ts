/**
 * LI-B102 — Canonical evidence layer (pure, deterministic).
 * The ONE evidence format all engines emit. Supports the five kinds (structured/observed/inferred/
 * external/ai_generated) and the lifecycle (created → refreshed → superseded → expired). Never
 * deletes: superseded/expired evidence is retained with its state (audit-safe).
 */

import type { EvidenceRef, EvidenceKind, SourceRef, ISOTimestamp } from './types';

export function evidenceRef(input: {
  id: string; kind: EvidenceKind; label: string;
  value?: string | number | boolean | null; source: SourceRef;
  observedAt: ISOTimestamp; recordedAt: ISOTimestamp; weight?: number;
}): EvidenceRef {
  return { lifecycle: 'created', supersededBy: null, value: null, ...input };
}

/** Refresh an evidence item with a newer observation (same identity, newer timestamps). */
export function refresh(e: EvidenceRef, observedAt: ISOTimestamp, recordedAt: ISOTimestamp): EvidenceRef {
  return { ...e, observedAt, recordedAt, lifecycle: 'refreshed', supersededBy: null };
}

/** Mark an evidence item superseded BY another (retained, not deleted). */
export function supersede(e: EvidenceRef, bySupersedingId: string): EvidenceRef {
  return { ...e, lifecycle: 'superseded', supersededBy: bySupersedingId };
}

/** Expire evidence older than a cutoff (deterministic — cutoff passed in). */
export function expire(e: EvidenceRef, cutoffISO: ISOTimestamp): EvidenceRef {
  return e.observedAt < cutoffISO && e.lifecycle !== 'superseded' ? { ...e, lifecycle: 'expired' } : e;
}

/** Apply an expiry cutoff across a set (pure). */
export function applyExpiry(evidence: EvidenceRef[], cutoffISO: ISOTimestamp): EvidenceRef[] {
  return evidence.map((e) => expire(e, cutoffISO));
}

/** Only evidence that currently counts toward a conclusion. */
export function activeEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  return evidence.filter((e) => e.lifecycle !== 'superseded' && e.lifecycle !== 'expired');
}

/** Deterministic de-dup by id (first wins), then stable sort by observedAt desc, id asc. */
export function normalizeEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const e of evidence) { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } }
  return out.sort((a, b) => (a.observedAt === b.observedAt ? a.id.localeCompare(b.id) : b.observedAt.localeCompare(a.observedAt)));
}

export function countByKind(evidence: EvidenceRef[]): Record<EvidenceKind, number> {
  const base: Record<EvidenceKind, number> = { structured: 0, observed: 0, inferred: 0, external: 0, ai_generated: 0 };
  for (const e of evidence) base[e.kind] += 1;
  return base;
}
