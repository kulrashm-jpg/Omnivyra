/**
 * Phase 3 — Bounded listening execution orchestrator.
 *
 * Public surface:
 *   createOnDemandExecution(...)   — UI "Run Now"
 *   createScheduledExecution(...)  — called by Phase-3 internal scheduler (none yet)
 *   processListeningExecution(...) — worker entry; pulls connector, runs pipeline
 *   cancelExecution(...)           — abort a planned/queued execution
 *   getExecution(...)              — read one row
 *   listExecutionsForSource(...)   — most-recent history
 *
 * Hard contracts:
 *   • Anti-overlap via DB UNIQUE partial index on (listening_source_id)
 *     WHERE status IN ('planned','queued','running'). Phase 2 createOnDemand
 *     races collapse cleanly into a single 23505 → "already in flight".
 *   • Activation goes through evaluateMonitoringEligibility per platform.
 *   • Credit ceiling validated before enqueueing. The monthly budget check
 *     uses real (running + completed) actuals from listening_executions.
 *   • Worker MUST observe the timeout encoded in the payload. The connector
 *     itself also enforces a deadline.
 *
 * Phase 3 wires ONLY the on-demand path. Scheduled execution helpers exist
 * for future phases but no scheduler invokes them.
 */

import { ownedDbTable } from '../db/writeOwner';
import { enqueueOrThrow } from '../middleware/queueBackpressure';
import {
  listeningExecutionQueue,
  buildListeningExecutionJobId,
} from '../queue/listeningExecutionQueue';
import { buildCapabilityAggregate } from './capabilityAggregationService';
import { evaluateMonitoringEligibility } from './monitoringEligibilityService';
import { getListeningSource } from './listeningSourceService';
import { getListeningConnector } from './connectors/listeningConnectorRegistry';
import { processRawSignals } from './listeningSignalPipeline';
import { evaluateGovernance } from './governanceEnforcementService';
import { getListeningConfiguration } from './listeningConfigurationService';
import {
  publishExecutionPlannedEvent,
  publishExecutionStartedEvent,
  publishExecutionCompletedEvent,
  publishExecutionFailedEvent,
  publishExecutionBlockedEvent,
  publishSignalsDetectedEvent,
  publishSourceRateLimitedEvent,
} from '../events/listeningEvents';
import type {
  ExecutionMode,
  ExecutionStatus,
  ListeningExecution,
} from '../types/listeningExecution';
import type { FetchSignalsResult } from '../types/listeningConnector';

// Bounded execution caps. These are hard limits — connectors may go lower
// (e.g. due to rate limits) but never higher. Tunable via env without code
// changes.
const MAX_POSTS_PER_RUN = Math.max(10, parseInt(process.env.LISTENING_MAX_POSTS_PER_RUN || '200', 10));
const MAX_COMMENTS_PER_RUN = Math.max(0, parseInt(process.env.LISTENING_MAX_COMMENTS_PER_RUN || '500', 10));
const MAX_PAGES_PER_RUN = Math.max(1, parseInt(process.env.LISTENING_MAX_PAGES_PER_RUN || '5', 10));
const EXECUTION_TIMEOUT_MS = Math.max(30_000, parseInt(process.env.LISTENING_EXECUTION_TIMEOUT_MS || '180000', 10));

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateExecutionInput = {
  organizationId: string;
  listeningSourceId: string;
  executionMode: ExecutionMode;
  createdBy: string | null;
  /** When omitted, derived from the listening_configurations row. */
  keywords?: string[];
  /** Bypass scheduled-mode gating when a Phase-3 caller already validated. */
  prevalidated?: boolean;
};

export type CreateExecutionRefusal = {
  ok: false;
  reason:
    | 'source_not_found'
    | 'capability_disabled'
    | 'consent_blocked'
    | 'scope_blocked'
    | 'source_not_ready'
    | 'overlap_prevented'
    | 'budget_blocked'
    | 'connector_unavailable'
    | 'connector_eligibility_failed';
  detail: string;
};

export type CreateExecutionSuccess = {
  ok: true;
  execution: ListeningExecution;
};

export type CreateExecutionResult = CreateExecutionSuccess | CreateExecutionRefusal;

async function evaluatePerPlatformEligibility(
  organizationId: string,
  platform: string,
): Promise<{ ok: true } | { ok: false; reason: CreateExecutionRefusal['reason']; detail: string }> {
  const aggregate = await buildCapabilityAggregate(organizationId);
  const decision = evaluateMonitoringEligibility(aggregate, platform);
  if (decision.eligible) return { ok: true };
  for (const b of decision.blockers) {
    if (b.code === 'consent_not_active' || b.code === 'consent_stale') {
      return { ok: false, reason: 'consent_blocked', detail: b.detail ?? b.code };
    }
    if (b.code === 'scope_insufficient') {
      return { ok: false, reason: 'scope_blocked', detail: b.detail ?? b.code };
    }
    if (b.code === 'listen_capability_not_enabled') {
      return { ok: false, reason: 'capability_disabled', detail: b.code };
    }
    if (b.code === 'no_ready_source') {
      return { ok: false, reason: 'source_not_ready', detail: b.code };
    }
  }
  return { ok: false, reason: 'capability_disabled', detail: decision.blockers.map((b) => b.code).join(',') };
}

async function assertBudgetAllows(
  organizationId: string,
  estimatedCost: number,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const config = await getListeningConfiguration(organizationId);
  if (!config || config.monthly_credit_ceiling <= 0) return { ok: true };

  const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ownedDbTable('listening_executions')
    .select('actual_credit_cost')
    .eq('organization_id', organizationId)
    .gt('created_at', monthStart)
    .in('execution_status', ['running', 'completed', 'partial']);
  if (error) return { ok: false, detail: `budget_read_failed:${error.message}` };
  const spent = (data ?? []).reduce(
    (sum, r) => sum + ((r as { actual_credit_cost?: number }).actual_credit_cost ?? 0),
    0,
  );
  if (spent + estimatedCost > config.monthly_credit_ceiling) {
    return {
      ok: false,
      detail: `monthly_ceiling_reached (${spent}/${config.monthly_credit_ceiling}, est+${estimatedCost})`,
    };
  }
  return { ok: true };
}

export async function createOnDemandExecution(
  input: CreateExecutionInput,
): Promise<CreateExecutionResult> {
  // Load source (tenant scoped).
  const source = await getListeningSource(input.organizationId, input.listeningSourceId);
  if (!source) return { ok: false, reason: 'source_not_found', detail: 'listening_source_id' };

  // Platform lookup. listening_sources doesn't directly carry a platform
  // column; we use metadata.platform per Phase 1's documented mapping.
  const platform =
    typeof (source.metadata as { platform?: string })?.platform === 'string'
      ? String((source.metadata as { platform: string }).platform).toLowerCase()
      : 'reddit'; // Phase 3 default — Reddit is the only live connector

  if (!input.prevalidated) {
    const eligibility = await evaluatePerPlatformEligibility(input.organizationId, platform);
    if (!eligibility.ok) {
      const failure = eligibility as Extract<typeof eligibility, { ok: false }>;
      await publishExecutionBlockedEvent({
        organization_id: input.organizationId,
        listening_source_id: input.listeningSourceId,
        reason: failure.reason as never,
        detail: failure.detail,
        occurred_at: new Date().toISOString(),
      });
      return { ok: false, reason: failure.reason, detail: failure.detail };
    }

    // Phase 7 — governance check (advisory). Decision is recorded in
    // governance_enforcement_events regardless of outcome. A 'denied'
    // result hard-blocks the execution.
    const governanceDecision = await evaluateGovernance({
      organizationId: input.organizationId,
      action: 'execution.create',
      actorUserId: input.createdBy,
      context: {
        platform,
        source_identifier: source.source_identifier,
        listening_source_id: input.listeningSourceId,
      },
    });
    if (governanceDecision.decision === 'denied') {
      await publishExecutionBlockedEvent({
        organization_id: input.organizationId,
        listening_source_id: input.listeningSourceId,
        reason: 'capability_disabled' as never,
        detail: `governance:${governanceDecision.policy_key}:${governanceDecision.reasons.join(',')}`,
        occurred_at: new Date().toISOString(),
      });
      return {
        ok: false,
        reason: 'capability_disabled',
        detail: `governance_denied:${governanceDecision.reasons.join(',')}`,
      };
    }
  }

  const connector = getListeningConnector(platform);
  if (!connector) {
    return {
      ok: false,
      reason: 'connector_unavailable',
      detail: `no connector registered for platform ${platform}`,
    };
  }

  const connectorEligibility = await connector.validateEligibility({
    organizationId: input.organizationId,
    sourceIdentifier: source.source_identifier,
  });
  if (!connectorEligibility.eligible) {
    await publishExecutionBlockedEvent({
      organization_id: input.organizationId,
      listening_source_id: input.listeningSourceId,
      reason: 'source_not_ready',
      detail: connectorEligibility.reasons.join(','),
      occurred_at: new Date().toISOString(),
    });
    return {
      ok: false,
      reason: 'connector_eligibility_failed',
      detail: connectorEligibility.reasons.join(','),
    };
  }

  const config = await getListeningConfiguration(input.organizationId);
  const keywords = (input.keywords && input.keywords.length > 0)
    ? input.keywords
    : (Array.isArray((source.metadata as { keywords?: unknown }).keywords)
        ? ((source.metadata as { keywords: string[] }).keywords)
        : []);

  const estimate = await connector.estimateCost({
    keywords,
    maxPosts: MAX_POSTS_PER_RUN,
    maxComments: MAX_COMMENTS_PER_RUN,
  });

  const budget = await assertBudgetAllows(input.organizationId, estimate.per_run);
  if (!budget.ok) {
    const budgetFailure = budget as Extract<typeof budget, { ok: false }>;
    await publishExecutionBlockedEvent({
      organization_id: input.organizationId,
      listening_source_id: input.listeningSourceId,
      reason: 'budget_blocked',
      detail: budgetFailure.detail,
      occurred_at: new Date().toISOString(),
    });
    return { ok: false, reason: 'budget_blocked', detail: budgetFailure.detail };
  }

  // Insert listening_executions row. The partial unique index catches
  // concurrent attempts via 23505.
  const now = new Date().toISOString();
  const { data: created, error } = await ownedDbTable('listening_executions')
    .insert({
      organization_id: input.organizationId,
      listening_source_id: input.listeningSourceId,
      configuration_id: config?.id ?? null,
      execution_mode: input.executionMode,
      execution_status: 'planned',
      planned_at: now,
      estimated_credit_cost: estimate.per_run,
      created_by: input.createdBy,
      metadata: { keywords, rationale: estimate.rationale, platform },
    })
    .select('*')
    .single();

  if (error || !created) {
    if (error?.code === '23505') {
      return { ok: false, reason: 'overlap_prevented', detail: 'another execution is in flight for this source' };
    }
    throw new Error(`Failed to create execution row: ${error?.message ?? 'unknown'}`);
  }
  const execution = created as ListeningExecution;

  // Enqueue.
  const jobId = buildListeningExecutionJobId(execution.id);
  // enqueueOrThrow: the row is immediately marked `queued` with this jobId
  // below, so a silent shed would leave a row claiming to be queued for a job
  // that was never created.
  await enqueueOrThrow(
    listeningExecutionQueue,
    'listening-executions',
    'listening-execution',
    {
      executionId: execution.id,
      organizationId: input.organizationId,
      listeningSourceId: input.listeningSourceId,
    },
    { jobId },
  );
  await ownedDbTable('listening_executions')
    .update({ execution_status: 'queued', queued_at: new Date().toISOString(), bullmq_job_id: jobId })
    .eq('id', execution.id);

  await publishExecutionPlannedEvent({
    organization_id: input.organizationId,
    listening_execution_id: execution.id,
    listening_source_id: input.listeningSourceId,
    execution_mode: input.executionMode,
    estimated_credit_cost: estimate.per_run,
    actor_user_id: input.createdBy,
    occurred_at: now,
  });

  return { ok: true, execution: { ...execution, execution_status: 'queued' as ExecutionStatus } };
}

export const createScheduledExecution = createOnDemandExecution; // future-proofing alias

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

export async function processListeningExecution(executionId: string): Promise<void> {
  const { data, error } = await ownedDbTable('listening_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();
  if (error || !data) throw new Error(`execution_not_found:${executionId}`);
  const execution = data as ListeningExecution;

  if (execution.execution_status !== 'queued') {
    // Already running / terminal — nothing to do. Idempotent.
    return;
  }

  await ownedDbTable('listening_executions')
    .update({ execution_status: 'running', started_at: new Date().toISOString() })
    .eq('id', executionId);

  await publishExecutionStartedEvent({
    organization_id: execution.organization_id,
    listening_execution_id: executionId,
    listening_source_id: execution.listening_source_id,
    occurred_at: new Date().toISOString(),
  });

  const source = await getListeningSource(execution.organization_id, execution.listening_source_id);
  if (!source) {
    await markFailed(executionId, 'source_disappeared');
    return;
  }
  const platform = String((source.metadata as { platform?: string })?.platform ?? 'reddit').toLowerCase();
  const connector = getListeningConnector(platform);
  if (!connector) {
    await markFailed(executionId, `connector_unavailable:${platform}`);
    return;
  }

  const keywords =
    (execution.metadata && Array.isArray((execution.metadata as { keywords?: unknown }).keywords))
      ? ((execution.metadata as { keywords: string[] }).keywords)
      : [];

  let fetchResult: FetchSignalsResult;
  try {
    fetchResult = await connector.fetchSignals({
      organizationId: execution.organization_id,
      sourceIdentifier: source.source_identifier,
      keywords,
      maxPosts: MAX_POSTS_PER_RUN,
      maxComments: MAX_COMMENTS_PER_RUN,
      maxPages: MAX_PAGES_PER_RUN,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    });
  } catch (err: any) {
    await markFailed(executionId, err?.message ?? 'connector_failed');
    return;
  }

  if (fetchResult.stats.rate_limit_pauses > 0) {
    const rl = await connector.validateRateLimits({ organizationId: execution.organization_id });
    await publishSourceRateLimitedEvent({
      organization_id: execution.organization_id,
      listening_source_id: execution.listening_source_id,
      platform,
      reset_at: rl.reset_at,
      occurred_at: new Date().toISOString(),
    });
  }

  // Pipeline (moderation + dedup + canonical write).
  let pipelineStats;
  try {
    pipelineStats = await processRawSignals({
      organizationId: execution.organization_id,
      listeningExecutionId: executionId,
      rawSignals: fetchResult.signals,
      keywords,
    });
  } catch (err: any) {
    await markFailed(executionId, `pipeline_failed:${err?.message ?? 'unknown'}`);
    return;
  }

  // Actual cost = estimate (Phase 3 keeps it simple; Phase 4 will tally real
  // upstream API request units once we ledger them).
  const actualCost = execution.estimated_credit_cost;

  const isPartial = fetchResult.partial || fetchResult.stats.rate_limit_pauses > 0;
  const moderationOnlyBlocks =
    pipelineStats.signals_detected > 0
    && pipelineStats.signals_persisted === 0
    && pipelineStats.signals_moderation_blocked === pipelineStats.signals_detected;

  let finalStatus: ExecutionStatus;
  if (moderationOnlyBlocks) finalStatus = 'blocked_by_moderation';
  else if (isPartial) finalStatus = 'partial';
  else finalStatus = 'completed';

  await ownedDbTable('listening_executions')
    .update({
      execution_status: finalStatus,
      completed_at: new Date().toISOString(),
      actual_credit_cost: actualCost,
      moderation_status: pipelineStats.signals_moderation_blocked > 0 ? 'flagged' : 'approved',
      ingestion_stats: fetchResult.stats,
      signal_stats: pipelineStats,
    })
    .eq('id', executionId);

  if (pipelineStats.signals_detected > 0) {
    await publishSignalsDetectedEvent({
      organization_id: execution.organization_id,
      listening_execution_id: executionId,
      platform,
      count: pipelineStats.signals_detected,
      occurred_at: new Date().toISOString(),
    });
  }

  await publishExecutionCompletedEvent({
    organization_id: execution.organization_id,
    listening_execution_id: executionId,
    listening_source_id: execution.listening_source_id,
    signals_persisted: pipelineStats.signals_persisted,
    signals_detected: pipelineStats.signals_detected,
    actual_credit_cost: actualCost,
    partial: isPartial,
    occurred_at: new Date().toISOString(),
  });
}

async function markFailed(executionId: string, reason: string): Promise<void> {
  await ownedDbTable('listening_executions')
    .update({
      execution_status: 'failed',
      failed_at: new Date().toISOString(),
      error_metadata: { reason },
    })
    .eq('id', executionId);
  const { data } = await ownedDbTable('listening_executions')
    .select('organization_id, listening_source_id')
    .eq('id', executionId)
    .maybeSingle();
  if (data) {
    await publishExecutionFailedEvent({
      organization_id: (data as { organization_id: string }).organization_id,
      listening_execution_id: executionId,
      listening_source_id: (data as { listening_source_id: string }).listening_source_id,
      reason,
      occurred_at: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Read / Cancel
// ---------------------------------------------------------------------------

export async function getExecution(
  organizationId: string,
  id: string,
): Promise<ListeningExecution | null> {
  const { data, error } = await ownedDbTable('listening_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load execution: ${error.message}`);
  return (data as ListeningExecution | null) ?? null;
}

export async function listExecutionsForSource(
  organizationId: string,
  listeningSourceId: string,
  limit = 20,
): Promise<ListeningExecution[]> {
  const { data, error } = await ownedDbTable('listening_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('listening_source_id', listeningSourceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  if (error) throw new Error(`Failed to list executions: ${error.message}`);
  return (data as ListeningExecution[]) ?? [];
}

export async function cancelExecution(
  organizationId: string,
  id: string,
): Promise<ListeningExecution | null> {
  const { data, error } = await ownedDbTable('listening_executions')
    .update({
      execution_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .in('execution_status', ['planned', 'queued'])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to cancel execution: ${error.message}`);
  return (data as ListeningExecution | null) ?? null;
}

export async function listExecutionsForOrg(
  organizationId: string,
  limit = 50,
): Promise<ListeningExecution[]> {
  const { data, error } = await ownedDbTable('listening_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (error) throw new Error(`Failed to list executions: ${error.message}`);
  return (data as ListeningExecution[]) ?? [];
}
