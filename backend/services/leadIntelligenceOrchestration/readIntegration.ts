/**
 * INT-001 Phase 4 — read integration.
 *
 * Additive read surface: composes the EXISTING enriched-profile read
 * (leadIntelligenceReadService — file untouched, imported as-is) with the
 * persisted intelligence record. Existing response contracts are unchanged;
 * `intelligence` / `intelligenceMeta` are NEW fields on a NEW function's
 * return type. Reads use persisted intelligence only — they never run the
 * engines, so there is no duplicate computation on the read path.
 */

import {
  getEnrichedLeadProfile,
  defaultLeadSourceReaders,
  type LeadSourceReaders,
} from '../leadIntelligence/leadIntelligenceReadService';
import type { EnrichedLeadProfile } from '../../../lib/leadIntelligence';
import type { LeadIntelligenceSummary } from '../leadIntelligenceEngine';
import { durableIntelligencePersistence } from './persistence';
import { resolveIntelligenceFreshness } from './freshness';
import type { IntelligenceFreshness, IntelligencePersistencePort, LeadIntelligenceRecord } from './types';

export interface IntelligenceMeta {
  freshness: IntelligenceFreshness;
  generatedAt: string | null;
  engineVersion: string | null;
  generationVersion: number | null;
  leadId: string | null;
}

/** The existing profile, unchanged, plus additive intelligence fields. */
export type EnrichedLeadProfileWithIntelligence = EnrichedLeadProfile & {
  intelligence: LeadIntelligenceSummary | null;
  intelligenceMeta: IntelligenceMeta;
};

/**
 * Cheap persisted-intelligence read for one lead. No engine execution, no
 * capture-row loads — freshness here reflects record state only (pending /
 * engine-version staleness); input-level staleness needs the orchestrator's
 * `freshness()` which compares fingerprints.
 */
export async function getPersistedLeadIntelligence(
  companyId: string,
  leadId: string,
  persistence: IntelligencePersistencePort = durableIntelligencePersistence,
): Promise<{ record: LeadIntelligenceRecord | null; freshness: IntelligenceFreshness }> {
  const record = await persistence.get(companyId, leadId);
  return { record, freshness: resolveIntelligenceFreshness(record) };
}

/**
 * Enriched lead profile + persisted intelligence. The base profile is exactly
 * what getEnrichedLeadProfile returns today (contract untouched); intelligence
 * is attached additively and is null when never generated.
 */
export async function getEnrichedLeadProfileWithIntelligence(
  companyId: string,
  leadKey: string,
  opts: { readers?: LeadSourceReaders; persistence?: IntelligencePersistencePort } = {},
): Promise<EnrichedLeadProfileWithIntelligence | null> {
  const readers = opts.readers ?? defaultLeadSourceReaders;
  const persistence = opts.persistence ?? durableIntelligencePersistence;

  const base = await getEnrichedLeadProfile(companyId, leadKey, readers);
  if (!base) return null;

  const leadId = base.view.sourceRef?.id ?? null;
  const record = leadId ? await persistence.get(companyId, leadId) : null;
  return {
    ...base,
    intelligence: record?.intelligence ?? null,
    intelligenceMeta: {
      freshness: resolveIntelligenceFreshness(record),
      generatedAt: record?.generatedAt ?? null,
      engineVersion: record?.engineVersion ?? null,
      generationVersion: record?.generationVersion ?? null,
      leadId,
    },
  };
}
