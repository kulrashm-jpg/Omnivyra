/**
 * agentEvents.ts — agent events + telemetry (AIA-001 §9/§10).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log via
 * logSecurityEvent, the versioned SignupEventEnvelope, correlation, and the
 * HARDEN-001 metric registry). Only the agent.<Event> vocabulary and agent.*
 * metric names are new — no duplicate event system, no new telemetry.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter, recordRawHistogram } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { SIGNUP_EVENT_SCHEMA_VERSION, type SignupEventEnvelope } from '../signupEventService';
import { resolveCrawlCorrelationId } from '../crawl/crawlEventService';
import type { AgentId, AgentResult } from './agentContracts';

export type AgentEventName =
  | 'AgentCreated'
  | 'AgentStarted'
  | 'AgentPaused'
  | 'AgentResumed'
  | 'AgentWaiting'
  | 'AgentCompleted'
  | 'AgentFailed'
  | 'AgentCancelled'
  | 'ApprovalRequested'
  | 'ApprovalReceived'
  | 'CheckpointCreated'
  | 'CheckpointRestored';

export const AGENT_EVENT_CAPABILITY_PREFIX = 'agent.';

export interface AgentEvent {
  event: AgentEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  agent?: AgentId | null;
  runId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §10 — the counter each event increments. */
export function metricForAgentEvent(event: AgentEventName): string | null {
  switch (event) {
    case 'AgentStarted':       return 'started';
    case 'AgentCompleted':     return 'completed';
    case 'AgentFailed':        return 'failed';
    case 'AgentWaiting':       return 'waiting';
    case 'AgentResumed':       return 'resumed';
    case 'AgentCancelled':     return 'cancelled';
    case 'ApprovalRequested':  return 'approvals_requested';
    case 'ApprovalReceived':   return 'approvals_received';
    case 'CheckpointCreated':  return 'checkpoints';
    case 'CheckpointRestored': return 'checkpoint_restores';
    default:                   return null;
  }
}

export { resolveCrawlCorrelationId as resolveAgentCorrelationId };

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

/** Emit one agent event. Fire-and-forget; never throws. */
export async function emitAgentEvent(e: AgentEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v: SIGNUP_EVENT_SCHEMA_VERSION,
      event: e.event as unknown as SignupEventEnvelope['event'],
      state: (e.agent ? String(e.agent) : null) as unknown as SignupEventEnvelope['state'],
      email: null,
      reason: e.reason ?? null,
      requestId: safeAmbientRequestId(),
      metadata: e.runId ? { runId: e.runId, ...(e.metadata ?? {}) } : (e.metadata ?? null),
    };
    await logSecurityEvent({
      capability: `${AGENT_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision: e.outcome,
      reason: JSON.stringify(envelope),
      resourceId: e.correlationId,
      organizationId: e.companyId ?? null,
    });
    const metric = metricForAgentEvent(e.event);
    if (metric) { try { recordRawCounter(`agent.${metric}`, 1, {}); } catch { /* fail-safe */ } }
  } catch (err) {
    logger.warn('agent_event_emit_failed', { event: e.event, message: err instanceof Error ? err.message : String(err) });
  }
}

/** §10 — record telemetry a finished/paused run produced. Fail-safe. */
export function recordAgentTelemetry(result: AgentResult): void {
  try {
    const agent = String(result.agent);
    recordRawHistogram('agent.execution_ms', result.execution.durationMs, { agent });
    recordRawCounter('agent.checkpoint_count', result.checkpoint.executionMetadata.checkpointCount, { agent });
    recordRawCounter('agent.resume_count', result.checkpoint.executionMetadata.resumeCount, { agent });
    recordRawCounter('agent.memory_bytes', JSON.stringify(result.checkpoint.memory).length, { agent });
    for (const stepId of result.checkpoint.completedCapabilities) {
      const cap = result.results[stepId]?.capability;
      if (cap) recordRawCounter('agent.capability_utilization', 1, { capability: String(cap) });
    }
  } catch { /* fail-safe */ }
}

/** §10 — record approval latency once a decision arrives. Fail-safe. */
export function recordApprovalLatency(agent: AgentId, ms: number): void {
  if (!(ms >= 0)) return;
  try { recordRawHistogram('agent.approval_latency_ms', ms, { agent: String(agent) }); } catch { /* fail-safe */ }
}
