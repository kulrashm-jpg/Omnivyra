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
import { recordPersistenceFailure, recordTenantMismatch } from '../leadIntelligenceTelemetry';
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
      // HARDEN-INT-002: distinguish "no row" (normal) from "read failed"
      // (actionable). Only the latter is reported.
      if (error) {
        recordPersistenceFailure('get', String((error as { message?: string }).message ?? error), companyId);
        return null;
      }
      if (!Array.isArray(data) || data.length === 0) return null;
      return rowToIntelligenceRecord(data[0] as Row);
    } catch (e) {
      recordPersistenceFailure('get', e instanceof Error ? e.message : String(e), companyId);
      return null;
    }
  },

  /**
   * HARDEN-INT-001 (4): one query for the whole id set instead of one per
   * lead. Served by the UNIQUE (company_id, lead_id) index. Same tenant
   * scoping and same fail-open contract as `get` — an error yields an empty
   * map, which callers render exactly like "never generated".
   */
  async getMany(companyId, leadIds) {
    const out = new Map<string, LeadIntelligenceRecord>();
    const ids = [...new Set((Array.isArray(leadIds) ? leadIds : []).filter((id) => typeof id === 'string' && id !== ''))];
    if (!companyId || ids.length === 0) return out;

    // Per-lead fallback. CRITICAL: a batched read that fails must NOT degrade
    // the whole page to "never generated" — that would silently blank every
    // row. Falling back to the pre-existing per-lead path guarantees the same
    // results the caller got before batching, at the old cost.
    const perLead = async (): Promise<Map<string, LeadIntelligenceRecord>> => {
      const fallback = new Map<string, LeadIntelligenceRecord>();
      const records = await Promise.all(ids.map((id) => durableIntelligencePersistence.get(companyId, id)));
      records.forEach((record, i) => {
        if (record) fallback.set(ids[i], record);
      });
      return fallback;
    };

    try {
      const query = ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('*').eq('company_id', companyId);
      // Not every chain implementation exposes `.in` (older wrappers, test
      // doubles). Detect rather than assume, and degrade to correctness.
      if (typeof (query as { in?: unknown }).in !== 'function') return perLead();
      // HARDEN-INT-002: type-only correction — the driver's builder does not
      // structurally overlap this shape, so the cast must route through
      // `unknown` (it also avoids an excessively-deep generic instantiation).
      // Runtime behaviour is unchanged.
      const { data, error } = await (
        query as unknown as { in: (col: string, vals: string[]) => Promise<{ data: unknown; error: unknown }> }
      ).in('lead_id', ids);
      if (error) {
        recordPersistenceFailure('getMany', String((error as { message?: string }).message ?? error), companyId);
        return perLead();
      }
      if (!Array.isArray(data)) return perLead();
      for (const row of data as Row[]) {
        const record = rowToIntelligenceRecord(row);
        if (!record) continue;
        // STABILIZE-INT-002 (D10) — TELEMETRY PARITY. The batched path used to
        // drop a cross-tenant row silently, so a tenant-isolation breach that
        // alarms on the detail route (via the read mapper's guard) was
        // invisible on the bulk route — the higher-volume surface. Both paths
        // now emit the same security signal. Behaviour is unchanged: the row
        // is still withheld.
        if (record.companyId !== companyId) {
          recordTenantMismatch(companyId, record.companyId, record.leadId);
          continue;
        }
        out.set(record.leadId, record);
      }
      return out;
    } catch (e) {
      recordPersistenceFailure('getMany', e instanceof Error ? e.message : String(e), companyId);
      return perLead();
    }
  },

  async upsert(record) {
    try {
      const { error } = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE)
        .upsert(toRow(record), { onConflict: 'company_id,lead_id' });
      if (error) {
        // THE migration-not-applied signal: intelligence was computed and is
        // being discarded. Loudest path in the stack.
        recordPersistenceFailure('upsert', String(error.message ?? error), record.companyId);
        return { ok: false, error: String(error.message ?? error) };
      }
      return { ok: true };
    } catch (e) {
      recordPersistenceFailure('upsert', e instanceof Error ? e.message : String(e), record.companyId);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async markRebuildRequested(companyId, leadId, requestedAt) {
    try {
      const { error } = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE)
        .update({ rebuild_requested_at: requestedAt })
        .eq('company_id', companyId)
        .eq('lead_id', leadId);
      if (error) {
        recordPersistenceFailure('mark_rebuild', String(error.message ?? error), companyId);
        return { ok: false, error: String(error.message ?? error) };
      }
      return { ok: true };
    } catch (e) {
      recordPersistenceFailure('mark_rebuild', e instanceof Error ? e.message : String(e), companyId);
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
    async getMany(companyId, leadIds) {
      const out = new Map<string, LeadIntelligenceRecord>();
      for (const leadId of Array.isArray(leadIds) ? leadIds : []) {
        const record = records.get(key(companyId, leadId));
        if (record) out.set(leadId, record);
      }
      return out;
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
