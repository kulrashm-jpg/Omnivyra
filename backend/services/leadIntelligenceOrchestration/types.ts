/**
 * INT-001 Phase 4 — Intelligence Integration & Persistence: contracts.
 *
 * This module wires the Phase 2 Lead Intelligence Engine into the backend:
 * orchestration, persistence, incremental regeneration, versioning, freshness
 * and diagnostics. It builds AROUND the engines (which stay pure and
 * unmodified) and exposes ONE public entry point — the orchestrator.
 */

import type { LeadIntelligenceSummary } from '../leadIntelligenceEngine';
import type { RawCapturedLeadData } from '../leadIntelligenceEngine';
import type { QualificationPlanningSummary } from '../qualificationPlanning/types';
import type { AutomationSummary } from '../automationExecution/types';

export type { QualificationPlanningSummary, AutomationSummary };

/** Raw stored rows for one lead, before the evaluation time is injected. */
export type RawLeadRows = Omit<RawCapturedLeadData, 'now'>;

/** Deterministic freshness states for a persisted intelligence record. */
export type IntelligenceFreshness = 'never_generated' | 'pending_regeneration' | 'stale' | 'fresh';

/** Internal diagnostics — NOT for public API exposure. */
export interface IntelligenceDiagnostics {
  durationMs: number;
  engineVersion: string;
  enginesExecuted: string[];
  warnings: string[];
  /** Profile fields that would improve intelligence but were not captured. */
  missingEnrichment: string[];
  confidenceBreakdown: {
    overall: number;
    persona: number;
    intentBand: string;
    qualificationBand: string;
  };
  inputCounts: { events: number; sessions: number; touchpoints: number };
}

/** The persisted intelligence envelope (one row per company/lead). */
export interface LeadIntelligenceRecord {
  companyId: string;
  leadId: string;
  intelligence: LeadIntelligenceSummary;
  /**
   * INT-002 Wave 2 (schema 2): Phase 3 qualification planning. Null on
   * schema-1 (legacy) records and when planning generation degraded.
   */
  qualificationPlanning: QualificationPlanningSummary | null;
  /** INT-002 Wave 2 (schema 2): Phase 5 automation planning. Null on legacy rows. */
  automationPlanning: AutomationSummary | null;
  diagnostics: IntelligenceDiagnostics;
  /** SHA-256 over the normalized engine inputs (excludes evaluation time). */
  inputFingerprint: string;
  /** Version of the engine + orchestration logic that produced this record. */
  engineVersion: string;
  /** Monotonic per-lead counter, incremented on every persisted generation. */
  generationVersion: number;
  /** Envelope schema version — future shape changes without breaking history. */
  schemaVersion: number;
  generatedAt: string;
  /** Set when a rebuild has been requested but not yet executed. */
  rebuildRequestedAt: string | null;
}

export interface LeadRef {
  companyId: string;
  leadId: string;
}

export interface PersistenceWriteResult {
  ok: boolean;
  /** Present when ok === false. */
  error?: string;
}

/** Persistence seam — durable implementation targets lead_intelligence_profiles. */
export interface IntelligencePersistencePort {
  get(companyId: string, leadId: string): Promise<LeadIntelligenceRecord | null>;
  /**
   * HARDEN-INT-001 (4) — OPTIONAL batched read. Bulk consumers (Lead List,
   * dashboard) previously issued one `get` per lead: a 100-lead cohort meant
   * 100 round trips per page load. Ports that implement this serve the whole
   * set in one query; ports that do not (injected test doubles) keep working
   * through the per-lead fallback, so results are identical either way.
   */
  getMany?(companyId: string, leadIds: string[]): Promise<Map<string, LeadIntelligenceRecord>>;
  upsert(record: LeadIntelligenceRecord): Promise<PersistenceWriteResult>;
  markRebuildRequested(companyId: string, leadId: string, requestedAt: string): Promise<PersistenceWriteResult>;
}

/** Snapshot seam — loads the stored capture rows for one lead (read-only). */
export interface IntelligenceSnapshotSourcePort {
  /** Returns null when the lead does not exist in this tenant. */
  load(companyId: string, leadId: string): Promise<RawLeadRows | null>;
}

/**
 * Future async-rebuild seam. Phase 4 provides the boundary ONLY — no queue
 * implementation. A future phase may back this with BullMQ or similar.
 */
export interface IntelligenceRebuildQueuePort {
  enqueue(request: { companyId: string; leadId: string; requestedAt: string; reason: string }): Promise<void>;
}

export type GenerationStatus = 'generated' | 'skipped_unchanged' | 'failed';

/** Result of one orchestrated generation attempt. */
export interface IntelligenceGenerationResult {
  status: GenerationStatus;
  /** Present unless status === 'failed' before any record existed. */
  record: LeadIntelligenceRecord | null;
  freshness: IntelligenceFreshness;
  /** True when the new record (or skip decision) was durably persisted. */
  persisted: boolean;
  /** Non-fatal problems (persistence failure, missing inputs, …). */
  warnings: string[];
  /** Fatal error message when status === 'failed'. */
  error: string | null;
}

export interface RebuildRequestResult {
  accepted: boolean;
  leadId: string;
  /** 'marked' = pending flag persisted; 'queued' = also handed to a queue port. */
  mode: 'marked' | 'queued' | 'failed';
  error: string | null;
}
