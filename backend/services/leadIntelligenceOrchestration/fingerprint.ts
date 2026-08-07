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

/**
 * STABILIZE-INT-002 (D4) — code-unit comparison, NOT localeCompare.
 *
 * ICU collation is not stable across Node builds, ICU versions or LANG (a
 * locale may order 'a' < 'B' where code units order 'B' < 'a'), and the sort
 * keys embed free-text event names. Two runtimes with different ICU would
 * canonicalize the same rows into different orders and therefore produce
 * different SHA-256 fingerprints — so each runtime would see the other's
 * records as stale and regenerate them forever, inflating generationVersion
 * and write volume. The Vercel API tier and the Railway worker are exactly
 * such a pair. This matches the code-unit rule already applied at
 * pages/api/leads/intelligence.ts for the same reason.
 *
 * One-time effect: for any lead whose rows sort differently under the two
 * comparators, the fingerprint changes once and that record regenerates on
 * its next trigger. Self-healing, no migration.
 */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Fingerprint the engine inputs. Excludes `now` so time alone never dirties it. */
export function computeInputFingerprint(snapshot: LeadCaptureSnapshot): string {
  const canonical = {
    lead: snapshot.lead,
    events: [...snapshot.events].sort((a, b) => byCodeUnit(eventSortKey(a), eventSortKey(b))),
    sessions: [...snapshot.sessions].sort((a, b) => byCodeUnit(a.id ?? '', b.id ?? '')),
    touchpoints: [...snapshot.touchpoints].sort((a, b) => byCodeUnit(a.id ?? '', b.id ?? '')),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}
