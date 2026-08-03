/**
 * INT-001 Phase 4 — deterministic input fingerprint.
 *
 * The fingerprint is a SHA-256 over the NORMALIZED engine inputs (the
 * assembled snapshot minus the evaluation time). Same captured data → same
 * fingerprint, regardless of row ordering or when generation runs — this is
 * what lets regeneration skip work when nothing changed.
 */

import { createHash } from 'crypto';
import type { LeadCaptureSnapshot } from '../leadIntelligenceEngine';

/** JSON stringify with lexicographically sorted object keys (stable). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(',');
  return `{${body}}`;
}

const eventSortKey = (e: { occurredAt: string; id: string | null; eventName: string }): string =>
  `${e.occurredAt}|${e.eventName}|${e.id ?? ''}`;

/** Fingerprint the engine inputs. Excludes `now` so time alone never dirties it. */
export function computeInputFingerprint(snapshot: LeadCaptureSnapshot): string {
  const canonical = {
    lead: snapshot.lead,
    events: [...snapshot.events].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b))),
    sessions: [...snapshot.sessions].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
    touchpoints: [...snapshot.touchpoints].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}
