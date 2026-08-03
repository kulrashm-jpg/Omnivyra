/**
 * INT-001 Phase 4 — deterministic intelligence freshness.
 *
 * Freshness is a pure function of the persisted record and (optionally) the
 * current input fingerprint:
 *   - no record                      → never_generated
 *   - rebuild requested, not yet run → pending_regeneration
 *   - unsupported envelope schema    → stale (INT-002 Wave 2 compatibility)
 *   - engine version changed         → stale
 *   - inputs changed (fingerprint)   → stale
 *   - otherwise                      → fresh
 *
 * When the current fingerprint is not supplied (cheap reads that skip loading
 * inputs), staleness-by-input cannot be detected; the other rules still apply.
 */

import { ENGINE_VERSION, isSupportedSchemaVersion } from './engineVersion';
import type { IntelligenceFreshness, LeadIntelligenceRecord } from './types';

export function resolveIntelligenceFreshness(
  record: LeadIntelligenceRecord | null,
  currentFingerprint?: string | null,
  currentEngineVersion: string = ENGINE_VERSION,
): IntelligenceFreshness {
  if (!record) return 'never_generated';
  if (record.rebuildRequestedAt) return 'pending_regeneration';
  if (!isSupportedSchemaVersion(record.schemaVersion)) return 'stale';
  if (record.engineVersion !== currentEngineVersion) return 'stale';
  if (currentFingerprint != null && record.inputFingerprint !== currentFingerprint) return 'stale';
  return 'fresh';
}
