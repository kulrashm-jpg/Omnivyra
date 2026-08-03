/**
 * INT-001 Phase 4 — Lead Intelligence Orchestrator.
 *
 * THE public entry point for generating, persisting and regenerating lead
 * intelligence. Flow: load stored rows → assemble snapshot → fingerprint →
 * skip if unchanged → run the Phase 2 engines (via the summary builder) →
 * derive Phase 3 qualification planning + Phase 5 automation planning
 * (INT-002 Wave 2, same snapshot, deterministic) → persist envelope v2 →
 * return. Individual engines remain internal and are never re-implemented here.
 *
 * Determinism: engines receive an injected `now`; the only impurity lives at
 * this boundary (the injectable `clock`, defaulting to Date.now).
 */

import {
  assembleLeadCaptureSnapshot,
  buildLeadIntelligenceSummary,
  type LeadCaptureSnapshot,
  type LeadIntelligenceEngineConfig,
  type LeadIntelligenceSummary,
} from '../leadIntelligenceEngine';
import { buildQualificationPlanningSummary } from '../qualificationPlanning';
import { buildAutomationSummary } from '../automationExecution';
import type { QualificationPlanningSummary } from '../qualificationPlanning/types';
import type { AutomationSummary } from '../automationExecution/types';
import { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION, ORCHESTRATED_ENGINES } from './engineVersion';
import { computeInputFingerprint } from './fingerprint';
import { resolveIntelligenceFreshness } from './freshness';
import { durableIntelligencePersistence } from './persistence';
import { durableSnapshotSource } from './snapshotSource';
import type {
  IntelligenceDiagnostics,
  IntelligenceFreshness,
  IntelligenceGenerationResult,
  IntelligencePersistencePort,
  IntelligenceRebuildQueuePort,
  IntelligenceSnapshotSourcePort,
  LeadIntelligenceRecord,
  LeadRef,
  RebuildRequestResult,
} from './types';

export interface LeadIntelligenceOrchestratorOptions {
  persistence?: IntelligencePersistencePort;
  snapshotSource?: IntelligenceSnapshotSourcePort;
  /** Optional future async-rebuild seam. No queue is implemented in Phase 4. */
  rebuildQueue?: IntelligenceRebuildQueuePort;
  engineConfig?: Partial<LeadIntelligenceEngineConfig>;
  /** Millisecond clock — injectable for deterministic tests. */
  clock?: () => number;
}

export interface LeadIntelligenceOrchestrator {
  /** Generate (or reuse) intelligence for a lead. `force` bypasses the skip. */
  generate(ref: LeadRef, opts?: { force?: boolean }): Promise<IntelligenceGenerationResult>;
  /** Force a full regeneration regardless of fingerprint. */
  rebuild(ref: LeadRef): Promise<IntelligenceGenerationResult>;
  /** Read the persisted record (no computation, no input loads). */
  getPersisted(ref: LeadRef): Promise<LeadIntelligenceRecord | null>;
  /** Deterministic freshness — loads current inputs to compare fingerprints. */
  freshness(ref: LeadRef): Promise<IntelligenceFreshness>;
  /** Mark (and optionally enqueue) a background rebuild. No queue implemented. */
  requestRebuild(ref: LeadRef, reason?: string): Promise<RebuildRequestResult>;
  /** Bulk variant — sequential and deterministic. */
  requestBulkRebuild(companyId: string, leadIds: string[], reason?: string): Promise<RebuildRequestResult[]>;
}

function buildDiagnostics(args: {
  summary: LeadIntelligenceSummary;
  snapshot: LeadCaptureSnapshot;
  durationMs: number;
  planningExecuted: boolean;
  planningWarnings: string[];
}): IntelligenceDiagnostics {
  const { summary, snapshot, durationMs } = args;
  const warnings: string[] = [...args.planningWarnings];
  if (snapshot.events.length === 0) warnings.push('no tracking events captured for this lead');
  if (snapshot.sessions.length === 0) warnings.push('no visitor sessions linked to this lead');
  if (summary.persona.persona === 'Unknown') warnings.push('persona could not be classified');
  if (summary.intent.score === 0) warnings.push('no intent signals detected');

  const missingEnrichment: string[] = [];
  if (!snapshot.lead.jobTitle) missingEnrichment.push('jobTitle');
  if (!snapshot.lead.companyName) missingEnrichment.push('companyName');
  if (!snapshot.lead.companySize) missingEnrichment.push('companySize');
  if (!snapshot.lead.industry) missingEnrichment.push('industry');

  // Planning engines appear only when they actually ran to completion.
  const enginesExecuted = args.planningExecuted
    ? [...ORCHESTRATED_ENGINES]
    : ORCHESTRATED_ENGINES.filter((e) => e !== 'qualificationPlanning' && e !== 'automationExecution');

  return {
    durationMs,
    engineVersion: ENGINE_VERSION,
    enginesExecuted,
    warnings,
    missingEnrichment,
    confidenceBreakdown: {
      overall: summary.confidence,
      persona: summary.persona.confidence,
      intentBand: summary.intent.band,
      qualificationBand: summary.qualification.band,
    },
    inputCounts: {
      events: snapshot.events.length,
      sessions: snapshot.sessions.length,
      touchpoints: snapshot.touchpoints.length,
    },
  };
}

export function createLeadIntelligenceOrchestrator(
  options: LeadIntelligenceOrchestratorOptions = {},
): LeadIntelligenceOrchestrator {
  const persistence = options.persistence ?? durableIntelligencePersistence;
  const snapshotSource = options.snapshotSource ?? durableSnapshotSource;
  const clock = options.clock ?? Date.now;

  async function generate(ref: LeadRef, opts: { force?: boolean } = {}): Promise<IntelligenceGenerationResult> {
    const startedMs = clock();
    const existing = await persistence.get(ref.companyId, ref.leadId);

    let rows;
    try {
      rows = await snapshotSource.load(ref.companyId, ref.leadId);
    } catch (e) {
      return {
        status: 'failed',
        record: existing,
        freshness: resolveIntelligenceFreshness(existing),
        persisted: false,
        warnings: [],
        error: `snapshot load failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (!rows) {
      return {
        status: 'failed',
        record: existing,
        freshness: resolveIntelligenceFreshness(existing),
        persisted: false,
        warnings: [],
        error: 'lead not found',
      };
    }

    const now = new Date(clock()).toISOString();
    const snapshot = assembleLeadCaptureSnapshot({ ...rows, now });
    const inputFingerprint = computeInputFingerprint(snapshot);

    // INT-002 final activation (hardening): the skip decision is now the SAME
    // predicate the freshness resolver uses, so the two can never disagree.
    // It regenerates on exactly the four intended triggers — fingerprint
    // change, engine-version change, unsupported/changed envelope schema, and
    // rebuild requested — plus force. Previously the schema version was
    // stored but not consulted here, so a record on an unsupported envelope
    // schema could be skipped forever while resolveIntelligenceFreshness()
    // classified it 'stale'. Behaviour is unchanged for every record this
    // build can write (schema 1 and 2 are both supported today).
    const unchanged = !opts.force && resolveIntelligenceFreshness(existing, inputFingerprint) === 'fresh';
    if (unchanged) {
      return {
        status: 'skipped_unchanged',
        record: existing,
        freshness: 'fresh',
        persisted: false,
        warnings: [],
        error: null,
      };
    }

    let summary: LeadIntelligenceSummary;
    try {
      summary = buildLeadIntelligenceSummary(snapshot, options.engineConfig);
    } catch (e) {
      return {
        status: 'failed',
        record: existing,
        freshness: resolveIntelligenceFreshness(existing, inputFingerprint),
        persisted: false,
        warnings: [],
        error: `engine failure: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // INT-002 Wave 2: derive the Phase 3 + Phase 5 layers from the SAME
    // snapshot and the Phase 2 outputs — deterministic (time = snapshot.now,
    // context derived from captured fields only). Planning failure degrades to
    // null layers with a diagnostic warning; the Phase 2 layer still persists.
    let qualificationPlanning: QualificationPlanningSummary | null = null;
    let automationPlanning: AutomationSummary | null = null;
    const planningWarnings: string[] = [];
    try {
      qualificationPlanning = buildQualificationPlanningSummary({
        snapshot,
        intent: summary.intent,
        persona: summary.persona,
      });
      automationPlanning = buildAutomationSummary({
        summary: qualificationPlanning,
        context: { hasEmail: snapshot.lead.email !== null },
      });
    } catch (e) {
      qualificationPlanning = null;
      automationPlanning = null;
      planningWarnings.push(`planning generation degraded: ${e instanceof Error ? e.message : String(e)}`);
    }

    const diagnostics = buildDiagnostics({
      summary,
      snapshot,
      durationMs: Math.max(0, clock() - startedMs),
      planningExecuted: qualificationPlanning !== null && automationPlanning !== null,
      planningWarnings,
    });
    const record: LeadIntelligenceRecord = {
      companyId: ref.companyId,
      leadId: ref.leadId,
      intelligence: summary,
      qualificationPlanning,
      automationPlanning,
      diagnostics,
      inputFingerprint,
      engineVersion: ENGINE_VERSION,
      generationVersion: (existing?.generationVersion ?? 0) + 1,
      schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
      generatedAt: summary.generatedAt,
      rebuildRequestedAt: null,
    };

    const writeResult = await persistence.upsert(record);
    const warnings = [
      ...planningWarnings,
      ...(writeResult.ok ? [] : [`persistence failed: ${writeResult.error ?? 'unknown error'}`]),
    ];

    return {
      status: 'generated',
      record,
      freshness: 'fresh',
      persisted: writeResult.ok,
      warnings,
      error: null,
    };
  }

  async function requestRebuild(ref: LeadRef, reason = 'manual'): Promise<RebuildRequestResult> {
    const requestedAt = new Date(clock()).toISOString();
    const marked = await persistence.markRebuildRequested(ref.companyId, ref.leadId, requestedAt);
    const markError = marked.ok ? null : marked.error ?? 'unknown error';
    if (options.rebuildQueue) {
      try {
        await options.rebuildQueue.enqueue({ companyId: ref.companyId, leadId: ref.leadId, requestedAt, reason });
        return { accepted: true, leadId: ref.leadId, mode: 'queued', error: markError };
      } catch (e) {
        const queueError = e instanceof Error ? e.message : String(e);
        return marked.ok
          ? { accepted: true, leadId: ref.leadId, mode: 'marked', error: `queue enqueue failed: ${queueError}` }
          : { accepted: false, leadId: ref.leadId, mode: 'failed', error: `mark failed: ${markError}; queue failed: ${queueError}` };
      }
    }
    return marked.ok
      ? { accepted: true, leadId: ref.leadId, mode: 'marked', error: null }
      : { accepted: false, leadId: ref.leadId, mode: 'failed', error: markError };
  }

  return {
    generate,
    rebuild: (ref) => generate(ref, { force: true }),
    getPersisted: (ref) => persistence.get(ref.companyId, ref.leadId),

    async freshness(ref) {
      const existing = await persistence.get(ref.companyId, ref.leadId);
      if (!existing) return 'never_generated';
      let rows = null;
      try {
        rows = await snapshotSource.load(ref.companyId, ref.leadId);
      } catch {
        rows = null;
      }
      if (!rows) return resolveIntelligenceFreshness(existing);
      const snapshot = assembleLeadCaptureSnapshot({ ...rows, now: existing.generatedAt || new Date(clock()).toISOString() });
      return resolveIntelligenceFreshness(existing, computeInputFingerprint(snapshot));
    },

    requestRebuild,

    async requestBulkRebuild(companyId, leadIds, reason = 'bulk') {
      const results: RebuildRequestResult[] = [];
      for (const leadId of leadIds) {
        // Sequential on purpose: deterministic ordering, bounded DB pressure.
        results.push(await requestRebuild({ companyId, leadId }, reason));
      }
      return results;
    },
  };
}
