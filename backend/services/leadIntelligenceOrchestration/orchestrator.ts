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
import {
  recordEvolution,
  recordGenerationOutcome,
  recordVersionUpgrade,
  type GenerationStage,
} from '../leadIntelligenceTelemetry';

/** WS-2 M3: the subset of the evolution block this instrumentation reads. */
type EvolutionShape = {
  intent?: { trend?: string; checkpoints?: unknown[] };
  funnel?: { stage?: string; advancementCount?: number; regressionCount?: number };
  journey?: { state?: string };
};
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

/**
 * HARDEN-INT-001 (2) — per-lead generation serialization.
 *
 * Activation can fire two triggers for the SAME lead concurrently (a capture
 * trigger and a tracking/session trigger in the same process). Both would read
 * the same `existing` record, both would compute, and both would upsert —
 * duplicating engine work and losing the `generationVersion` increment
 * (both write N+1). Serializing per (company, lead) makes the second call read
 * what the first wrote, so it fingerprint-skips instead: no duplicate work, no
 * lost counter, no duplicate persistence. `force` semantics are preserved
 * because calls queue rather than coalesce. The map is keyed per lead and
 * removed when its last waiter drains, so memory stays bounded.
 *
 * Scope: in-process ONLY. STABILIZE-INT-002 (D3) corrects the rationale that
 * previously stood here, which was wrong in both premises:
 *   • "both writes carry identical intelligence" — FALSE. Two processes load
 *     their snapshots at different instants, so they compute over different
 *     inputs. The loser's write can persist OLDER intelligence together with
 *     its older inputFingerprint; because read paths resolve freshness without
 *     a fingerprint, that record then reports `fresh` until the next trigger.
 *   • `generationVersion` monotonicity — FALSE across processes. Both read N
 *     and write N+1, so increments are lost. Treat the counter as a lower
 *     bound on generations, not an exact count.
 * Neither is a correctness risk for CONTENT (the next trigger reconciles, and
 * the engines are deterministic for identical inputs), but both must be stated
 * accurately: the production API tier is multi-instance, so this lock protects
 * only same-instance collisions. Cross-process serialization would require a
 * shared lock (architecture change — deliberately not attempted here).
 */
/**
 * HARDEN-INT-002: measured envelope size, the metric that tells operators when
 * JSONB growth (driven by the 1:1 timeline) is becoming a storage concern.
 * Never throws and never runs when there is nothing to measure.
 */
function envelopeBytesOf(record: LeadIntelligenceRecord | null): number | undefined {
  if (!record) return undefined;
  try {
    return Buffer.byteLength(
      JSON.stringify({
        summary: record.intelligence,
        qualificationPlanning: record.qualificationPlanning,
        automationPlanning: record.automationPlanning,
      }),
    );
  } catch {
    return undefined;
  }
}

type LeadLock = { tail: Promise<unknown>; waiters: number };
const leadLocks = new Map<string, LeadLock>();

async function withLeadLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const lock: LeadLock = leadLocks.get(key) ?? { tail: Promise.resolve(), waiters: 0 };
  lock.waiters += 1;
  leadLocks.set(key, lock);
  const started = lock.tail.then(run, run); // run after the previous settles, either way
  lock.tail = started.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await started;
  } finally {
    lock.waiters -= 1;
    if (lock.waiters === 0) leadLocks.delete(key);
  }
}

export function createLeadIntelligenceOrchestrator(
  options: LeadIntelligenceOrchestratorOptions = {},
): LeadIntelligenceOrchestrator {
  const persistence = options.persistence ?? durableIntelligencePersistence;
  const snapshotSource = options.snapshotSource ?? durableSnapshotSource;
  const clock = options.clock ?? Date.now;

  function generate(ref: LeadRef, opts: { force?: boolean } = {}): Promise<IntelligenceGenerationResult> {
    // HARDEN-INT-001 (2): serialize concurrent generations of the same lead.
    // HARDEN-INT-002: ONE instrumentation point for every outcome — the six
    // return paths inside generateSerialized stay untouched, and the failure
    // stage is derived from the error each of them already reports.
    const startedMs = clock();
    return withLeadLock(`${ref.companyId}::${ref.leadId}`, () => generateSerialized(ref, opts)).then((result) => {
      const err = result.error ?? '';
      const stage: GenerationStage = err.startsWith('snapshot load failed')
        ? 'snapshot'
        : err === 'lead not found'
          ? 'not_found'
          : err.startsWith('engine failure')
            ? 'engine'
            : 'engine';
      recordGenerationOutcome({
        outcome: result.status,
        reason: opts.force ? 'force' : 'trigger',
        durationMs: Math.max(0, clock() - startedMs),
        companyId: ref.companyId,
        leadId: ref.leadId,
        stage,
        error: result.error,
        persisted: result.persisted,
        inputCounts: result.status === 'generated' ? result.record?.diagnostics?.inputCounts : undefined,
        envelopeBytes: result.status === 'generated' ? envelopeBytesOf(result.record) : undefined,
      });
      // WS-2 M3: evolution shape, recorded HERE because the engines are pure
      // and must not perform I/O. Only on a real generation — a fingerprint
      // skip produced no new evolution to describe.
      if (result.status === 'generated') {
        const evo = (result.record?.intelligence as { evolution?: EvolutionShape } | undefined)?.evolution;
        if (evo) {
          recordEvolution({
            intentTrend: String(evo.intent?.trend ?? 'unknown'),
            funnelStage: String(evo.funnel?.stage ?? 'unaware'),
            journeyState: String(evo.journey?.state ?? 'new'),
            advancements: Number(evo.funnel?.advancementCount ?? 0),
            regressions: Number(evo.funnel?.regressionCount ?? 0),
            checkpoints: Array.isArray(evo.intent?.checkpoints) ? evo.intent.checkpoints.length : 0,
            timelineEntries: Array.isArray((result.record?.intelligence as { timeline?: unknown[] } | undefined)?.timeline)
              ? (result.record!.intelligence as { timeline: unknown[] }).timeline.length
              : 0,
          });
        }
      }
      return result;
    }).catch((e) => {
      // STABILIZE-INT-002 (D1): the instrumentation chain previously had NO
      // rejection handler. Statements outside the inner try/catch blocks
      // (snapshot assembly, fingerprint, an injected port that throws) rejected
      // the chain, skipped recordGenerationOutcome entirely and were swallowed
      // upstream — zero metric, zero log, while health still read "healthy".
      // That was the exact blind spot this telemetry exists to remove.
      const error = e instanceof Error ? e.message : String(e);
      recordGenerationOutcome({
        outcome: 'failed',
        reason: opts.force ? 'force' : 'trigger',
        durationMs: Math.max(0, clock() - startedMs),
        companyId: ref.companyId,
        leadId: ref.leadId,
        stage: 'engine',
        error,
        persisted: false,
      });
      // Preserve the fail-open contract: callers receive a result, never a throw.
      return {
        status: 'failed',
        record: null,
        freshness: 'never_generated',
        persisted: false,
        warnings: [],
        error,
      } as IntelligenceGenerationResult;
    });
  }

  async function generateSerialized(ref: LeadRef, opts: { force?: boolean } = {}): Promise<IntelligenceGenerationResult> {
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
    // STABILIZE-INT-002 (D5): never DOWNGRADE a record written by a newer
    // build. During a rolling deploy the old pods read a future schema as
    // "unsupported" → stale → regenerate → write their OLDER schema back, so
    // the two builds rewrite each other for the whole deploy window. Yielding
    // to the newer writer costs nothing (that record is by definition at least
    // as current) and makes mixed-version deploys inert instead of thrashing.
    if (existing && existing.schemaVersion > INTELLIGENCE_SCHEMA_VERSION) {
      return {
        status: 'skipped_unchanged',
        record: existing,
        freshness: resolveIntelligenceFreshness(existing, inputFingerprint),
        persisted: false,
        warnings: [
          `record written by a newer build (schema ${existing.schemaVersion} > ${INTELLIGENCE_SCHEMA_VERSION}); left untouched`,
        ],
        error: null,
      };
    }

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

    // HARDEN-INT-002: a version/schema move is the trigger for fleet-wide
    // regeneration, so operators need to see the wave happen and end.
    if (existing) {
      recordVersionUpgrade({
        fromEngine: existing.engineVersion,
        toEngine: ENGINE_VERSION,
        fromSchema: existing.schemaVersion,
        toSchema: INTELLIGENCE_SCHEMA_VERSION,
        companyId: ref.companyId,
        leadId: ref.leadId,
      });
    }

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
    // STABILIZE-INT-002 (D2): mark under the SAME per-lead lock as generation.
    // Previously this ran unserialized, so a request landing between a
    // generation's read and its upsert was erased by that upsert (which always
    // writes rebuild_requested_at: null) — the caller saw accepted:true for a
    // rebuild that would never run. Serializing makes the mark either precede
    // the generation (which then consumes it) or follow it (and survive).
    const marked = await withLeadLock(`${ref.companyId}::${ref.leadId}`, () =>
      persistence.markRebuildRequested(ref.companyId, ref.leadId, requestedAt),
    );
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
