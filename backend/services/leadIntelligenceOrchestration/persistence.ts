/**
 * INT-001 Phase 4 — intelligence persistence.
 *
 * One record per (company, lead) in the NEW additive table
 * `lead_intelligence_profiles` (migration 20260907000000). Deliberately a
 * separate table: writing into `lead_intelligence` would make intelligence
 * envelopes appear as leads in the existing read-union (leadIntelligenceReadService)
 * and mutating `leads.metadata` would touch capture-owned rows — both would
 * change existing runtime behaviour. Reads are fail-open (null on error);
 * writes surface their error so the orchestrator can report persistence
 * failures without losing the computed intelligence.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type {
  IntelligencePersistencePort,
  LeadIntelligenceRecord,
  PersistenceWriteResult,
} from './types';

export const LEAD_INTELLIGENCE_PROFILES_TABLE = 'lead_intelligence_profiles';

type Row = Record<string, unknown>;

/**
 * INT-002 Wave 2 (schema 2): the `intelligence` JSONB column stores the full
 * envelope payload — { summary, qualificationPlanning, automationPlanning } —
 * so all three intelligence layers persist without any table/migration change.
 * Schema-1 rows stored the Phase 2 summary directly; the reader detects both.
 */
const toRow = (r: LeadIntelligenceRecord): Row => ({
  company_id: r.companyId,
  lead_id: r.leadId,
  intelligence: {
    summary: r.intelligence,
    qualificationPlanning: r.qualificationPlanning,
    automationPlanning: r.automationPlanning,
  },
  diagnostics: r.diagnostics,
  input_fingerprint: r.inputFingerprint,
  engine_version: r.engineVersion,
  generation_version: r.generationVersion,
  schema_version: r.schemaVersion,
  generated_at: r.generatedAt,
  rebuild_requested_at: r.rebuildRequestedAt,
  updated_at: r.generatedAt,
});

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const objOrNull = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Tolerant row → record mapping (partial/legacy rows degrade, never throw).
 * Detects both envelope shapes: schema 2 wraps the layers under
 * { summary, qualificationPlanning, automationPlanning }; schema 1 stored the
 * Phase 2 summary directly (planning layers surface as null).
 */
export function rowToIntelligenceRecord(row: Row | null | undefined): LeadIntelligenceRecord | null {
  if (!row || typeof row !== 'object') return null;
  const companyId = str(row.company_id);
  const leadId = str(row.lead_id);
  const payload = objOrNull(row.intelligence);
  if (!companyId || !leadId || !payload) return null;

  const v2Summary = objOrNull(payload.summary);
  const intelligence = v2Summary ?? payload; // v2 wrapped ∨ v1 direct
  const qualificationPlanning = v2Summary ? objOrNull(payload.qualificationPlanning) : null;
  const automationPlanning = v2Summary ? objOrNull(payload.automationPlanning) : null;

  const diagnostics = row.diagnostics && typeof row.diagnostics === 'object' ? row.diagnostics : null;
  return {
    companyId,
    leadId,
    intelligence: intelligence as unknown as LeadIntelligenceRecord['intelligence'],
    qualificationPlanning: qualificationPlanning as unknown as LeadIntelligenceRecord['qualificationPlanning'],
    automationPlanning: automationPlanning as unknown as LeadIntelligenceRecord['automationPlanning'],
    diagnostics: (diagnostics ?? {
      durationMs: 0,
      engineVersion: str(row.engine_version) ?? 'unknown',
      enginesExecuted: [],
      warnings: ['diagnostics missing on persisted row'],
      missingEnrichment: [],
      confidenceBreakdown: { overall: 0, persona: 0, intentBand: 'none', qualificationBand: 'cold' },
      inputCounts: { events: 0, sessions: 0, touchpoints: 0 },
    }) as LeadIntelligenceRecord['diagnostics'],
    inputFingerprint: str(row.input_fingerprint) ?? '',
    engineVersion: str(row.engine_version) ?? 'unknown',
    generationVersion: num(row.generation_version, 1),
    schemaVersion: num(row.schema_version, 1),
    generatedAt: str(row.generated_at) ?? '',
    rebuildRequestedAt: str(row.rebuild_requested_at),
  };
}

/** Durable port backed by lead_intelligence_profiles. Tenant-scoped, fail-open reads. */
export const durableIntelligencePersistence: IntelligencePersistencePort = {
  async get(companyId, leadId) {
    if (!companyId || !leadId) return null;
    try {
      const { data, error } = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE)
        .select('*')
        .eq('company_id', companyId)
        .eq('lead_id', leadId)
        .limit(1);
      if (error || !Array.isArray(data) || data.length === 0) return null;
      return rowToIntelligenceRecord(data[0] as Row);
    } catch {
      return null;
    }
  },

  async upsert(record) {
    try {
      const { error } = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE)
        .upsert(toRow(record), { onConflict: 'company_id,lead_id' });
      return error ? { ok: false, error: String(error.message ?? error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async markRebuildRequested(companyId, leadId, requestedAt) {
    try {
      const { error } = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE)
        .update({ rebuild_requested_at: requestedAt })
        .eq('company_id', companyId)
        .eq('lead_id', leadId);
      return error ? { ok: false, error: String(error.message ?? error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** In-memory port for tests and dark/flag-off usage. */
export function createInMemoryIntelligenceStore(): IntelligencePersistencePort & {
  records: Map<string, LeadIntelligenceRecord>;
  failWrites: (fail: boolean) => void;
} {
  const records = new Map<string, LeadIntelligenceRecord>();
  let writesFail = false;
  const key = (c: string, l: string): string => `${c}::${l}`;
  const write = (fn: () => void): PersistenceWriteResult => {
    if (writesFail) return { ok: false, error: 'in-memory store: writes disabled' };
    fn();
    return { ok: true };
  };
  return {
    records,
    failWrites: (fail: boolean) => {
      writesFail = fail;
    },
    async get(companyId, leadId) {
      return records.get(key(companyId, leadId)) ?? null;
    },
    async upsert(record) {
      return write(() => records.set(key(record.companyId, record.leadId), record));
    },
    async markRebuildRequested(companyId, leadId, requestedAt) {
      const existing = records.get(key(companyId, leadId));
      if (!existing) return { ok: false, error: 'record not found' };
      return write(() => records.set(key(companyId, leadId), { ...existing, rebuildRequestedAt: requestedAt }));
    },
  };
}
