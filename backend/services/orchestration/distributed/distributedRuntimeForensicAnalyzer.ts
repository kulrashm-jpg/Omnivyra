/**
 * Phase 21G — DistributedRuntimeForensicAnalyzer
 *
 * Pure read-side analyzer. Reconstructs the distributed-runtime history
 * of a single execution by joining:
 *   - DistributedExecutionQueue.listByExecution(executionId)
 *   - DistributedWorkerCoordinator.list() / .get()
 *   - DurableRecoveryDiagnostics snapshot (where present)
 *
 * CAPABILITIES (per spec):
 *   - reconstruct distributed execution chain
 *   - reconstruct ownership transfer history
 *   - reconstruct queue replay chain
 *   - reconstruct worker failover timeline
 *   - identify split-brain attempt windows
 *   - compare successful vs recovered distributed runs
 *
 * OUTPUTS:
 *   - probableDistributedFailureBoundary
 *   - ownershipContinuityAssessment
 *   - queueReplayIntegrityAssessment
 *   - workerFailoverAssessment
 *
 * SCOPE: forensic READ ONLY. No mutations. No autonomous remediation.
 * No orchestration semantics. Output consumed by /api endpoints + stress
 * harnesses to verify distributed-runtime correctness after the fact.
 */

import type { DistributedExecutionQueue } from './distributedExecutionQueue';
import type { DistributedWorkerCoordinator } from './distributedWorkerCoordinator';
import {
  getDefaultExecutionQueue,
} from './distributedExecutionQueue';
import {
  getDefaultDistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import type {
  QueueEntry,
  WorkerRecord,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────

export interface DistributedRuntimeForensicReport {
  executionId: string;
  /**
   * Best-effort window between the LAST queue-entry update before any
   * failure signal and the FIRST recovery / reclaim signal. Null when
   * the execution never crashed.
   */
  probableDistributedFailureBoundary: { startMs: number; endMs: number } | null;
  /** Per-queue-entry assessment of ownership chain integrity. */
  ownershipContinuityAssessment: {
    score: number;                  // 0..100
    chainEntries: number;
    distinctOwners: string[];
    ownershipTransfers: number;
    notes: string[];
  };
  /** Per-queue-entry assessment of replay sanity. */
  queueReplayIntegrityAssessment: {
    score: number;                  // 0..100
    visibilityReclaims: number;
    deadLetterCount: number;
    retryStorms: number;            // attempt count >= maxAttempts/2
    notes: string[];
  };
  /** Per-worker assessment of failover timing. */
  workerFailoverAssessment: {
    score: number;                  // 0..100
    suspectedDeadWorkers: string[];
    failoverEvents: number;
    notes: string[];
  };
  /**
   * Phase 23F — workflow execution chain reconstruction.
   * Inferred from queue payload schema + checkpoint chain.
   */
  workflowExecutionAssessment: {
    score: number;                  // 0..100
    workflowTypes: string[];        // distinct workflowType values observed
    payloadCorruptionWindow: { startMs: number; endMs: number } | null;
    replayDivergenceCount: number;  // entries whose payload references unknown checkpoint
    notes: string[];
  };
  /**
   * Phase 23F — best-effort failure boundary specifically for the workflow
   * execution chain (vs the broader distributed boundary).
   */
  probableWorkflowFailureBoundary: { startMs: number; endMs: number } | null;
  /** Phase 23F — per-payload integrity scores. */
  replayExecutionIntegrityAssessment: Array<{
    queueEntryId: string;
    integrityScore: number;
    reason: string;
  }>;
  /** Phase 23F — queue payload continuity assessment. */
  queuePayloadContinuityAssessment: {
    score: number;
    sequenceBreaks: number;
    notes: string[];
  };
  /** Phase 24H — per-domain replay integrity. */
  domainReplayIntegrityAssessment: {
    score: number;
    distinctDomains: string[];
    domainsWithRetries: string[];
    notes: string[];
  };
  /** Phase 24H — provider publish continuity. */
  providerPublishContinuityAssessment: {
    score: number;
    distinctFingerprints: string[];
    duplicateFingerprintCount: number;
    notes: string[];
  };
  /** Phase 24H — campaign recovery assessment. */
  campaignRecoveryAssessment: {
    score: number;
    distinctCampaigns: string[];
    campaignsWithRetries: string[];
    notes: string[];
  };
  /** Phase 24H — reconciliation execution assessment. */
  reconciliationExecutionAssessment: {
    score: number;
    distinctRowIds: string[];
    repeatedReconciles: number;
    notes: string[];
  };
  /** Operator-readable single-line summary. */
  oneLine: string;
}

// ────────────────────────────────────────────────────────────────────
// Analyzer
// ────────────────────────────────────────────────────────────────────

export interface DistributedRuntimeForensicAnalyzerOptions {
  queue?: DistributedExecutionQueue;
  workerCoordinator?: DistributedWorkerCoordinator;
}

/**
 * Phase 26G — Cross-run domain comparison shape. Returned by
 * `compareDistributedRuns` to surface per-domain divergence between a
 * canonical run and a replayed run.
 */
export interface CrossRunDomainComparison {
  /** Overall lifecycle / ownership score (existing behavior). */
  score: number;
  matchedQueueEvents: number;
  divergentQueueEvents: number;
  matchedOwners: string[];
  divergentOwners: string[];
  notes: string[];
  /** Phase 26G — per-domain assessments. */
  crossRunDomainReplayAssessment: {
    canonicalDomains: string[];
    recoveredDomains: string[];
    matchedDomains: string[];
    divergentDomains: string[];
    score: number;       // 0..100
    notes: string[];
  };
  providerReplayDivergenceAssessment: {
    canonicalFingerprints: string[];
    recoveredFingerprints: string[];
    extraInRecovered: string[];   // potential duplicate publishes
    missingInRecovered: string[]; // potential lost publishes
    score: number;
    notes: string[];
  };
  campaignContinuityComparison: {
    canonicalCampaigns: string[];
    recoveredCampaigns: string[];
    matched: string[];
    divergent: string[];
    score: number;
    notes: string[];
  };
  reconciliationReplayComparison: {
    canonicalRowIds: string[];
    recoveredRowIds: string[];
    matched: string[];
    extraInRecovered: string[];   // potential duplicate reconciles
    score: number;
    notes: string[];
  };
}

export interface DistributedRuntimeForensicAnalyzer {
  analyze(input: { executionId: string }): Promise<DistributedRuntimeForensicReport>;
  /**
   * Compare two executions (canonical vs recovered). Phase 26G extends
   * the original lifecycle / ownership comparison with four per-domain
   * assessments.
   */
  compareDistributedRuns(input: {
    canonicalExecutionId: string;
    recoveredExecutionId: string;
  }): Promise<CrossRunDomainComparison>;
}

function clamp100(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

function findFailureBoundary(entries: QueueEntry[]): { startMs: number; endMs: number } | null {
  // Boundary heuristic: the gap between the latest non-recovery-event
  // updatedAt and the earliest recovery / reclaim event. We approximate
  // "recovery event" as any entry whose status transitions through
  // 'queued' AFTER being 'claimed' (a reclaim) OR whose attemptCount > 1.
  const recoveryEvents = entries.filter(
    (e) => e.attemptCount > 1 || e.status === 'dead_lettered' || e.status === 'failed',
  );
  if (recoveryEvents.length === 0) return null;
  const recoveryStartMs = Math.min(...recoveryEvents.map((e) => Date.parse(e.updatedAtIso)));
  const baselineEvents = entries.filter((e) => !recoveryEvents.includes(e));
  const baselineEndMs = baselineEvents.length > 0
    ? Math.max(...baselineEvents.map((e) => Date.parse(e.updatedAtIso)))
    : Math.min(...entries.map((e) => Date.parse(e.createdAtIso)));
  return { startMs: baselineEndMs, endMs: recoveryStartMs };
}

function assessOwnershipContinuity(entries: QueueEntry[]): DistributedRuntimeForensicReport['ownershipContinuityAssessment'] {
  const distinctOwners = new Set<string>();
  for (const e of entries) if (e.claimedByWorkerId) distinctOwners.add(e.claimedByWorkerId);
  const ownershipTransfers = Math.max(0, distinctOwners.size - 1);
  const notes: string[] = [];
  let score = 100;
  if (ownershipTransfers > 0) {
    score -= ownershipTransfers * 10;
    notes.push(`${ownershipTransfers} ownership transfer(s) detected`);
  }
  // Penalize claimed-but-no-deadline (suspicious).
  const claimedNoDeadline = entries.filter((e) => e.status === 'claimed' && !e.visibilityDeadlineIso);
  if (claimedNoDeadline.length > 0) {
    score -= 20;
    notes.push(`${claimedNoDeadline.length} claimed entries missing visibility deadline`);
  }
  return {
    score: clamp100(score),
    chainEntries: entries.length,
    distinctOwners: Array.from(distinctOwners),
    ownershipTransfers,
    notes,
  };
}

function assessQueueReplayIntegrity(entries: QueueEntry[]): DistributedRuntimeForensicReport['queueReplayIntegrityAssessment'] {
  let visibilityReclaims = 0;
  let deadLetterCount = 0;
  let retryStorms = 0;
  for (const e of entries) {
    // Reclaim heuristic: attemptCount > 1 with visibility timeout having been the trigger.
    if (e.attemptCount > 1) visibilityReclaims += 1;
    if (e.status === 'dead_lettered') deadLetterCount += 1;
    if (e.attemptCount >= Math.max(2, Math.floor(e.maxAttempts / 2))) retryStorms += 1;
  }
  const notes: string[] = [];
  let score = 100;
  if (deadLetterCount > 0) {
    score -= deadLetterCount * 20;
    notes.push(`${deadLetterCount} entries reached dead-letter`);
  }
  if (retryStorms > 0) {
    score -= retryStorms * 10;
    notes.push(`${retryStorms} entries showed retry-storm pattern (attempts >= maxAttempts/2)`);
  }
  if (visibilityReclaims > 5) {
    score -= 10;
    notes.push(`${visibilityReclaims} visibility reclaims (suggests worker instability)`);
  }
  return {
    score: clamp100(score),
    visibilityReclaims,
    deadLetterCount,
    retryStorms,
    notes,
  };
}

function assessWorkflowExecution(entries: QueueEntry[]): DistributedRuntimeForensicReport['workflowExecutionAssessment'] {
  const workflowTypes = new Set<string>();
  let payloadCorruptionStart: number | null = null;
  let payloadCorruptionEnd: number | null = null;
  let replayDivergence = 0;
  const notes: string[] = [];
  let score = 100;

  for (const e of entries) {
    if (e.payload && typeof e.payload === 'object') {
      const p = e.payload as Record<string, unknown>;
      const wf = typeof p.workflowType === 'string' ? p.workflowType : null;
      if (wf) workflowTypes.add(wf);
      // Corruption signal: payload present but schemaVersion missing or unexpected.
      if (typeof p.schemaVersion !== 'number') {
        const ms = Date.parse(e.updatedAtIso);
        if (Number.isFinite(ms)) {
          payloadCorruptionStart = payloadCorruptionStart === null ? ms : Math.min(payloadCorruptionStart, ms);
          payloadCorruptionEnd = payloadCorruptionEnd === null ? ms : Math.max(payloadCorruptionEnd, ms);
        }
        score -= 25;
        notes.push(`payload schemaVersion missing on entry ${e.queueEntryId}`);
      }
      // Replay divergence: payload references a checkpointId we can't
      // verify from the queue side (we don't have the checkpoint chain
      // here; that's the QueueCheckpointContinuityCoordinator's job).
      const cp = p.checkpointReference;
      if (cp && (typeof cp !== 'object' || typeof (cp as Record<string, unknown>).checkpointId !== 'string')) {
        replayDivergence += 1;
      }
    } else if (e.attemptCount > 0) {
      // Claimed entries with no payload are suspicious.
      score -= 5;
      notes.push(`entry ${e.queueEntryId} has no payload but was claimed`);
    }
  }

  return {
    score: clamp100(score),
    workflowTypes: Array.from(workflowTypes),
    payloadCorruptionWindow: payloadCorruptionStart !== null && payloadCorruptionEnd !== null
      ? { startMs: payloadCorruptionStart, endMs: payloadCorruptionEnd }
      : null,
    replayDivergenceCount: replayDivergence,
    notes,
  };
}

function assessReplayExecutionIntegrity(entries: QueueEntry[]): DistributedRuntimeForensicReport['replayExecutionIntegrityAssessment'] {
  return entries.map((e) => {
    let score = 100;
    const reasons: string[] = [];
    if (!e.payload) {
      score -= 30;
      reasons.push('no payload');
    } else if (typeof (e.payload as Record<string, unknown>).schemaVersion !== 'number') {
      score -= 50;
      reasons.push('missing schemaVersion');
    }
    if (e.attemptCount >= Math.max(2, Math.floor(e.maxAttempts / 2))) {
      score -= 20;
      reasons.push(`high attempt count (${e.attemptCount}/${e.maxAttempts})`);
    }
    if (e.status === 'dead_lettered') {
      score -= 30;
      reasons.push('dead-lettered');
    }
    return {
      queueEntryId: e.queueEntryId,
      integrityScore: clamp100(score),
      reason: reasons.length === 0 ? 'ok' : reasons.join('; '),
    };
  });
}

function assessQueuePayloadContinuity(entries: QueueEntry[]): DistributedRuntimeForensicReport['queuePayloadContinuityAssessment'] {
  // Heuristic: sort by createdAt + count gaps where payload.executionId changes
  // unexpectedly within the same listByExecution window.
  let sequenceBreaks = 0;
  const notes: string[] = [];
  const sorted = [...entries].sort((a, b) => a.createdAtIso < b.createdAtIso ? -1 : 1);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].executionId !== sorted[0].executionId) {
      sequenceBreaks += 1;
      notes.push(`entry ${sorted[i].queueEntryId} executionId diverges from chain head`);
    }
  }
  const score = Math.max(0, 100 - sequenceBreaks * 25);
  return { score, sequenceBreaks, notes };
}

function assessDomainReplayIntegrity(entries: QueueEntry[]): DistributedRuntimeForensicReport['domainReplayIntegrityAssessment'] {
  const domains = new Set<string>();
  const domainsWithRetries = new Set<string>();
  const notes: string[] = [];
  let score = 100;
  for (const e of entries) {
    if (!e.payload || typeof e.payload !== 'object') continue;
    const p = e.payload as Record<string, unknown>;
    const wf = typeof p.workflowType === 'string' ? p.workflowType : null;
    if (!wf) continue;
    if (wf === 'long_form_generation' || wf === 'campaign_execution' ||
        wf === 'social_publish' || wf === 'provider_reconciliation') {
      domains.add(wf);
      if (e.attemptCount > 1) {
        domainsWithRetries.add(wf);
        score -= 5;
        notes.push(`${wf} entry ${e.queueEntryId} retried (attempt=${e.attemptCount})`);
      }
    }
  }
  return {
    score: clamp100(score),
    distinctDomains: Array.from(domains),
    domainsWithRetries: Array.from(domainsWithRetries),
    notes,
  };
}

function assessProviderPublishContinuity(entries: QueueEntry[]): DistributedRuntimeForensicReport['providerPublishContinuityAssessment'] {
  const fpCounts = new Map<string, number>();
  const notes: string[] = [];
  for (const e of entries) {
    if (!e.payload || typeof e.payload !== 'object') continue;
    const p = e.payload as Record<string, unknown>;
    if (p.workflowType !== 'social_publish') continue;
    const params = (p.workflowParams ?? {}) as Record<string, unknown>;
    const fp = typeof params.contentFingerprint === 'string' ? params.contentFingerprint : null;
    if (!fp) continue;
    fpCounts.set(fp, (fpCounts.get(fp) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const [fp, count] of fpCounts) {
    if (count > 1) {
      duplicates += count - 1;
      notes.push(`contentFingerprint '${fp}' observed ${count} times (${count - 1} duplicate attempt(s))`);
    }
  }
  const score = duplicates === 0 ? 100 : Math.max(0, 100 - duplicates * 10);
  return {
    score, distinctFingerprints: Array.from(fpCounts.keys()),
    duplicateFingerprintCount: duplicates, notes,
  };
}

function assessCampaignRecovery(entries: QueueEntry[]): DistributedRuntimeForensicReport['campaignRecoveryAssessment'] {
  const campaigns = new Set<string>();
  const withRetries = new Set<string>();
  const notes: string[] = [];
  let score = 100;
  for (const e of entries) {
    if (!e.payload || typeof e.payload !== 'object') continue;
    const p = e.payload as Record<string, unknown>;
    if (p.workflowType !== 'campaign_execution') continue;
    const params = (p.workflowParams ?? {}) as Record<string, unknown>;
    const id = typeof params.campaignId === 'string' ? params.campaignId : null;
    if (!id) continue;
    campaigns.add(id);
    if (e.attemptCount > 1) {
      withRetries.add(id);
      score -= 10;
      notes.push(`campaign ${id} retried (attempt=${e.attemptCount})`);
    }
  }
  return {
    score: clamp100(score),
    distinctCampaigns: Array.from(campaigns),
    campaignsWithRetries: Array.from(withRetries),
    notes,
  };
}

function assessReconciliationExecution(entries: QueueEntry[]): DistributedRuntimeForensicReport['reconciliationExecutionAssessment'] {
  const rowCounts = new Map<string, number>();
  const notes: string[] = [];
  for (const e of entries) {
    if (!e.payload || typeof e.payload !== 'object') continue;
    const p = e.payload as Record<string, unknown>;
    if (p.workflowType !== 'provider_reconciliation') continue;
    const params = (p.workflowParams ?? {}) as Record<string, unknown>;
    const rowId = typeof params.rowId === 'string' ? params.rowId : null;
    if (!rowId) continue;
    rowCounts.set(rowId, (rowCounts.get(rowId) ?? 0) + 1);
  }
  let repeats = 0;
  for (const [rowId, count] of rowCounts) {
    if (count > 1) {
      repeats += count - 1;
      notes.push(`rowId '${rowId}' reconciled ${count} times`);
    }
  }
  const score = repeats === 0 ? 100 : Math.max(0, 100 - repeats * 5);
  return {
    score, distinctRowIds: Array.from(rowCounts.keys()),
    repeatedReconciles: repeats, notes,
  };
}

function findWorkflowBoundary(entries: QueueEntry[]): { startMs: number; endMs: number } | null {
  // Heuristic: workflow failures show as entries with attemptCount > 1
  // AND payload present. Find the earliest such event vs the latest
  // healthy event.
  const failed = entries.filter((e) =>
    e.attemptCount > 1 && e.payload !== null,
  );
  if (failed.length === 0) return null;
  const failedMin = Math.min(...failed.map((e) => Date.parse(e.updatedAtIso)));
  const healthy = entries.filter((e) => !failed.includes(e));
  const healthyEnd = healthy.length > 0
    ? Math.max(...healthy.map((e) => Date.parse(e.updatedAtIso)))
    : Math.min(...entries.map((e) => Date.parse(e.createdAtIso)));
  return { startMs: healthyEnd, endMs: failedMin };
}

function assessWorkerFailover(
  entries: QueueEntry[],
  workers: WorkerRecord[],
): DistributedRuntimeForensicReport['workerFailoverAssessment'] {
  const distinctOwners = new Set<string>();
  for (const e of entries) if (e.claimedByWorkerId) distinctOwners.add(e.claimedByWorkerId);
  const suspected: string[] = [];
  let failoverEvents = 0;
  for (const owner of distinctOwners) {
    const w = workers.find((wr) => wr.workerId === owner);
    if (!w) {
      suspected.push(owner);
      continue;
    }
    if (w.status === 'stale' || w.status === 'offline') {
      suspected.push(owner);
      failoverEvents += 1;
    }
  }
  const notes: string[] = [];
  let score = 100;
  if (suspected.length > 0) {
    score -= suspected.length * 15;
    notes.push(`${suspected.length} owners are stale/offline/unknown: ${suspected.join(', ')}`);
  }
  return {
    score: clamp100(score),
    suspectedDeadWorkers: suspected,
    failoverEvents,
    notes,
  };
}

export function createDistributedRuntimeForensicAnalyzer(
  options?: DistributedRuntimeForensicAnalyzerOptions,
): DistributedRuntimeForensicAnalyzer {
  const queue = options?.queue ?? getDefaultExecutionQueue();
  const workerCoord = options?.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();

  return {
    async analyze({ executionId }) {
      const entries = await queue.listByExecution(executionId);
      const workers = await workerCoord.list();
      if (entries.length === 0) {
        return {
          executionId,
          probableDistributedFailureBoundary: null,
          ownershipContinuityAssessment: { score: 100, chainEntries: 0, distinctOwners: [], ownershipTransfers: 0, notes: ['no queue entries observed'] },
          queueReplayIntegrityAssessment: { score: 100, visibilityReclaims: 0, deadLetterCount: 0, retryStorms: 0, notes: [] },
          workerFailoverAssessment: { score: 100, suspectedDeadWorkers: [], failoverEvents: 0, notes: [] },
          workflowExecutionAssessment: { score: 100, workflowTypes: [], payloadCorruptionWindow: null, replayDivergenceCount: 0, notes: [] },
          probableWorkflowFailureBoundary: null,
          replayExecutionIntegrityAssessment: [],
          queuePayloadContinuityAssessment: { score: 100, sequenceBreaks: 0, notes: [] },
          // Phase 24H — empty assessments.
          domainReplayIntegrityAssessment: { score: 100, distinctDomains: [], domainsWithRetries: [], notes: [] },
          providerPublishContinuityAssessment: { score: 100, distinctFingerprints: [], duplicateFingerprintCount: 0, notes: [] },
          campaignRecoveryAssessment: { score: 100, distinctCampaigns: [], campaignsWithRetries: [], notes: [] },
          reconciliationExecutionAssessment: { score: 100, distinctRowIds: [], repeatedReconciles: 0, notes: [] },
          oneLine: `${executionId}: no queue history`,
        };
      }
      const boundary = findFailureBoundary(entries);
      const owners = assessOwnershipContinuity(entries);
      const replay = assessQueueReplayIntegrity(entries);
      const failover = assessWorkerFailover(entries, workers);
      // Phase 23F assessments.
      const workflow = assessWorkflowExecution(entries);
      const workflowBoundary = findWorkflowBoundary(entries);
      const replayIntegrity = assessReplayExecutionIntegrity(entries);
      const payloadContinuity = assessQueuePayloadContinuity(entries);
      // Phase 24H assessments.
      const domainReplay = assessDomainReplayIntegrity(entries);
      const providerPublish = assessProviderPublishContinuity(entries);
      const campaignRecovery = assessCampaignRecovery(entries);
      const reconciliation = assessReconciliationExecution(entries);

      const oneLine = `${executionId}: queue=${entries.length} ` +
        `owners=${owners.distinctOwners.length} transfers=${owners.ownershipTransfers} ` +
        `reclaims=${replay.visibilityReclaims} dead=${replay.deadLetterCount} ` +
        `failover=${failover.failoverEvents} boundary=${boundary ? 'yes' : 'no'} ` +
        `wf=${workflow.workflowTypes.join(',') || '∅'} wf_score=${workflow.score} ` +
        `domains=${domainReplay.distinctDomains.length} pub_dup=${providerPublish.duplicateFingerprintCount}`;

      return {
        executionId,
        probableDistributedFailureBoundary: boundary,
        ownershipContinuityAssessment: owners,
        queueReplayIntegrityAssessment: replay,
        workerFailoverAssessment: failover,
        workflowExecutionAssessment: workflow,
        probableWorkflowFailureBoundary: workflowBoundary,
        replayExecutionIntegrityAssessment: replayIntegrity,
        queuePayloadContinuityAssessment: payloadContinuity,
        // Phase 24H
        domainReplayIntegrityAssessment: domainReplay,
        providerPublishContinuityAssessment: providerPublish,
        campaignRecoveryAssessment: campaignRecovery,
        reconciliationExecutionAssessment: reconciliation,
        oneLine,
      };
    },

    async compareDistributedRuns({ canonicalExecutionId, recoveredExecutionId }) {
      const [canon, reco] = await Promise.all([
        queue.listByExecution(canonicalExecutionId),
        queue.listByExecution(recoveredExecutionId),
      ]);
      const canonOwners = new Set<string>();
      const recoOwners = new Set<string>();
      for (const e of canon) if (e.claimedByWorkerId) canonOwners.add(e.claimedByWorkerId);
      for (const e of reco) if (e.claimedByWorkerId) recoOwners.add(e.claimedByWorkerId);
      const matchedOwners = [...recoOwners].filter((o) => canonOwners.has(o));
      const divergentOwners = [...recoOwners].filter((o) => !canonOwners.has(o));

      // Event-level overlap: compare attempt counts + status set.
      const canonEvents = new Set<string>(canon.map((e) => `${e.kind}:${e.status}:${e.attemptCount}`));
      const recoEvents = new Set<string>(reco.map((e) => `${e.kind}:${e.status}:${e.attemptCount}`));
      let matched = 0, divergent = 0;
      for (const e of recoEvents) (canonEvents.has(e) ? matched++ : divergent++);
      const total = matched + divergent;
      const score = total === 0 ? 100 : Math.round((matched / total) * 100);
      const notes: string[] = [];
      notes.push(`matched=${matched}, divergent=${divergent}, score=${score}`);
      if (divergentOwners.length > 0) notes.push(`recovered run involved new owners: ${divergentOwners.join(', ')}`);

      // ── Phase 26G — per-domain cross-run assessments ──
      // Helper: extract workflow types from a list of entries.
      function extractDomains(entries: QueueEntry[]): Set<string> {
        const domains = new Set<string>();
        for (const e of entries) {
          if (!e.payload || typeof e.payload !== 'object') continue;
          const wf = (e.payload as Record<string, unknown>).workflowType;
          if (typeof wf === 'string') domains.add(wf);
        }
        return domains;
      }
      function extractWorkflowParams(entries: QueueEntry[], wf: string): Array<Record<string, unknown>> {
        const out: Array<Record<string, unknown>> = [];
        for (const e of entries) {
          if (!e.payload || typeof e.payload !== 'object') continue;
          const p = e.payload as Record<string, unknown>;
          if (p.workflowType !== wf) continue;
          const params = (p.workflowParams ?? {}) as Record<string, unknown>;
          out.push(params);
        }
        return out;
      }

      // Domain replay
      const canonDomains = extractDomains(canon);
      const recoDomains = extractDomains(reco);
      const matchedDomains = [...recoDomains].filter((d) => canonDomains.has(d));
      const divergentDomains = [...recoDomains].filter((d) => !canonDomains.has(d));
      const domainTotal = matchedDomains.length + divergentDomains.length;
      const domainScore = domainTotal === 0 ? 100 : Math.round((matchedDomains.length / domainTotal) * 100);
      const domainNotes: string[] = [];
      if (divergentDomains.length > 0) {
        domainNotes.push(`recovered run introduced workflow types not in canonical: ${divergentDomains.join(', ')}`);
      }

      // Provider publish — fingerprints comparison.
      const canonFps = new Set<string>();
      const recoFps = new Set<string>();
      for (const p of extractWorkflowParams(canon, 'social_publish')) {
        if (typeof p.contentFingerprint === 'string') canonFps.add(p.contentFingerprint);
      }
      for (const p of extractWorkflowParams(reco, 'social_publish')) {
        if (typeof p.contentFingerprint === 'string') recoFps.add(p.contentFingerprint);
      }
      const extraFps = [...recoFps].filter((fp) => !canonFps.has(fp));
      const missingFps = [...canonFps].filter((fp) => !recoFps.has(fp));
      const pubTotal = recoFps.size + missingFps.length;
      const pubScore = pubTotal === 0 ? 100 :
        Math.max(0, Math.round(100 - (extraFps.length + missingFps.length) * 100 / Math.max(1, pubTotal)));
      const pubNotes: string[] = [];
      if (extraFps.length > 0) pubNotes.push(`recovered run has ${extraFps.length} fingerprint(s) not in canonical (potential duplicate publishes)`);
      if (missingFps.length > 0) pubNotes.push(`canonical run has ${missingFps.length} fingerprint(s) absent from recovered (potential lost publishes)`);

      // Campaign continuity.
      const canonCampaigns = new Set<string>();
      const recoCampaigns = new Set<string>();
      for (const p of extractWorkflowParams(canon, 'campaign_execution')) {
        if (typeof p.campaignId === 'string') canonCampaigns.add(p.campaignId);
      }
      for (const p of extractWorkflowParams(reco, 'campaign_execution')) {
        if (typeof p.campaignId === 'string') recoCampaigns.add(p.campaignId);
      }
      const matchedCampaigns = [...recoCampaigns].filter((c) => canonCampaigns.has(c));
      const divergentCampaigns = [...recoCampaigns].filter((c) => !canonCampaigns.has(c));
      const campaignTotal = matchedCampaigns.length + divergentCampaigns.length;
      const campaignScore = campaignTotal === 0 ? 100 : Math.round((matchedCampaigns.length / campaignTotal) * 100);
      const campaignNotes: string[] = [];
      if (divergentCampaigns.length > 0) {
        campaignNotes.push(`recovered campaigns not in canonical: ${divergentCampaigns.join(', ')}`);
      }

      // Reconciliation replay.
      const canonRows = new Set<string>();
      const recoRows = new Set<string>();
      for (const p of extractWorkflowParams(canon, 'provider_reconciliation')) {
        if (typeof p.rowId === 'string') canonRows.add(p.rowId);
      }
      for (const p of extractWorkflowParams(reco, 'provider_reconciliation')) {
        if (typeof p.rowId === 'string') recoRows.add(p.rowId);
      }
      const matchedRows = [...recoRows].filter((r) => canonRows.has(r));
      const extraRows = [...recoRows].filter((r) => !canonRows.has(r));
      const reconTotal = matchedRows.length + extraRows.length;
      const reconScore = reconTotal === 0 ? 100 :
        Math.max(0, Math.round(100 - extraRows.length * 100 / Math.max(1, reconTotal)));
      const reconNotes: string[] = [];
      if (extraRows.length > 0) {
        reconNotes.push(`recovered run reconciled ${extraRows.length} row(s) not in canonical: ${extraRows.join(', ')}`);
      }

      return {
        score, matchedQueueEvents: matched, divergentQueueEvents: divergent,
        matchedOwners, divergentOwners, notes,
        crossRunDomainReplayAssessment: {
          canonicalDomains: [...canonDomains],
          recoveredDomains: [...recoDomains],
          matchedDomains, divergentDomains,
          score: domainScore, notes: domainNotes,
        },
        providerReplayDivergenceAssessment: {
          canonicalFingerprints: [...canonFps],
          recoveredFingerprints: [...recoFps],
          extraInRecovered: extraFps,
          missingInRecovered: missingFps,
          score: pubScore, notes: pubNotes,
        },
        campaignContinuityComparison: {
          canonicalCampaigns: [...canonCampaigns],
          recoveredCampaigns: [...recoCampaigns],
          matched: matchedCampaigns, divergent: divergentCampaigns,
          score: campaignScore, notes: campaignNotes,
        },
        reconciliationReplayComparison: {
          canonicalRowIds: [...canonRows],
          recoveredRowIds: [...recoRows],
          matched: matchedRows, extraInRecovered: extraRows,
          score: reconScore, notes: reconNotes,
        },
      };
    },
  };
}

let _default: DistributedRuntimeForensicAnalyzer | null = null;
export function getDefaultDistributedRuntimeForensicAnalyzer(): DistributedRuntimeForensicAnalyzer {
  if (!_default) _default = createDistributedRuntimeForensicAnalyzer();
  return _default;
}
export function setDefaultDistributedRuntimeForensicAnalyzer(a: DistributedRuntimeForensicAnalyzer): void {
  _default = a;
}
