/**
 * The shared execution contract between AI Orchestration and the Outreach Engines,
 * versioned. Prose, ownership and rationale: docs/orchestration/contract/.
 *
 * EXTENDS `EngineAdapter`; it replaces nothing. `disposition` stays the one thing that
 * settles a journey step. Everything here is a normalized READING of what an engine
 * reported, so an engine keeps its own vocabulary and a report can compare engines.
 *
 * Engine, provider and action are three separate identities: an engine is what the
 * orchestrator routes to, a provider is who that engine calls, and an action is what
 * was asked for. A channel added later declares itself here and needs no redesign.
 *
 * PURE: no I/O and no clock.
 */

import type { EngineDisposition, EngineName, EngineResult } from './engineAdapters';

export const EXECUTION_CONTRACT_VERSION = '0.1.0';

/** Bumped when a field's meaning changes, never when an optional field is added. */
export const JOURNEY_EVENT_VERSION = 1;

// ── Normalized execution state ──────────────────────────────────────────────

export const EXECUTION_STATES = [
  'REQUESTED', 'AUTHORIZED', 'QUEUED', 'EXECUTING', 'ACCEPTED', 'DELIVERED',
  'FAILED', 'RETRY_REQUIRED', 'CANCELLED', 'REJECTED',
] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];

/**
 * "It may have happened" is not a state: it says nothing about where the work got to,
 * and it must never read as FAILED (which invites a retry) or RETRY_REQUIRED (which
 * asks for one). An uncertain result keeps its last known state and is never retried.
 */
export type ExecutionCertainty = 'definite' | 'uncertain';

export const EXECUTION_ERROR_CLASSES = [
  'gate_refused', 'approval_missing', 'person_ineligible', 'invalid_request',
  'not_configured', 'unsupported', 'transient_not_acted', 'may_have_acted', 'provider_rejected',
] as const;
export type ExecutionErrorClass = typeof EXECUTION_ERROR_CLASSES[number];

/** Who may try again. Nothing here ever means "retry around a gate". */
export type Retryability = 'not_retryable' | 'next_sweep' | 'human_only';

export interface NormalizedExecutionResult {
  readonly contractVersion: string;
  readonly engine: EngineName;
  readonly state: ExecutionState;
  readonly certainty: ExecutionCertainty;
  readonly errorClass: ExecutionErrorClass | null;
  readonly retryability: Retryability;
  /** The engine's own word, kept as metadata. */
  readonly engineOutcome: string;
  readonly disposition: EngineDisposition;
  readonly externalRef: string | null;
}

const GATE_REFUSALS = new Set([
  'global_kill_switch', 'tenant_not_enabled', 'tenant_kill_switch', 'channel_not_enabled',
  'blocked_governance', 'blocked_send_control', 'cancel_requested', 'tenant_scope_violation',
]);
const APPROVAL_OUTCOMES = new Set(['approval_required', 'not_approved', 'approval_unproven']);
const NOT_CONFIGURED = new Set(['no_template', 'target_binding_unavailable', 'no_bound_action', 'person_identity_unbound', 'no_permission_source', 'person_unresolved']);
const UNSUPPORTED = new Set(['unsupported', 'unsupported_action', 'unsupported_channel']);
const MAY_HAVE_ACTED = new Set(['uncertain', 'send_uncertain', 'timeout', 'submission_interrupted', 'blocked_prior_attempt']);
const PROVIDER_REJECTED = new Set(['failed', 'rejected', 'submit_failed', 'provider_refused_prior_attempt']);
const AWAITING = new Set(['awaiting_approval', 'pending']);
const IN_FLIGHT = new Set(['dispatching', 'submitting', 'submitted', 'dispatched', 'sending', 'executing', 'acknowledged', 'skipped_already_dispatched']);
const SCHEDULED = new Set(['queued', 'scheduled']);

function normalizeOutcome(r: EngineResult): Pick<NormalizedExecutionResult, 'state' | 'certainty' | 'errorClass' | 'retryability'> {
  const definite = 'definite' as const;
  // The word comes first: it is what tells an engine's "may have acted" from a refusal.
  if (MAY_HAVE_ACTED.has(r.outcome)) {
    return { state: 'EXECUTING', certainty: 'uncertain', errorClass: 'may_have_acted', retryability: 'human_only' };
  }
  switch (r.disposition) {
    case 'completed':
      return { state: r.outcome === 'delivered' ? 'DELIVERED' : 'ACCEPTED', certainty: definite, errorClass: null, retryability: 'not_retryable' };
    case 'skipped':
      return r.outcome === 'cancelled' || r.outcome === 'expired'
        ? { state: 'CANCELLED', certainty: definite, errorClass: null, retryability: 'not_retryable' }
        : { state: 'REJECTED', certainty: definite, errorClass: r.outcome === 'rejected' ? null : 'person_ineligible', retryability: 'not_retryable' };
    case 'wait':
      if (AWAITING.has(r.outcome)) return { state: 'REQUESTED', certainty: definite, errorClass: null, retryability: 'next_sweep' };
      if (IN_FLIGHT.has(r.outcome)) return { state: 'EXECUTING', certainty: definite, errorClass: null, retryability: 'next_sweep' };
      if (SCHEDULED.has(r.outcome)) return { state: 'QUEUED', certainty: definite, errorClass: null, retryability: 'next_sweep' };
      return { state: 'RETRY_REQUIRED', certainty: definite, errorClass: 'transient_not_acted', retryability: 'next_sweep' };
    default:
      if (GATE_REFUSALS.has(r.outcome)) return { state: 'REJECTED', certainty: definite, errorClass: 'gate_refused', retryability: 'human_only' };
      if (APPROVAL_OUTCOMES.has(r.outcome)) return { state: 'REQUESTED', certainty: definite, errorClass: 'approval_missing', retryability: 'human_only' };
      if (NOT_CONFIGURED.has(r.outcome)) return { state: 'REJECTED', certainty: definite, errorClass: 'not_configured', retryability: 'human_only' };
      if (UNSUPPORTED.has(r.outcome)) return { state: 'REJECTED', certainty: definite, errorClass: 'unsupported', retryability: 'human_only' };
      if (PROVIDER_REJECTED.has(r.outcome)) return { state: 'FAILED', certainty: definite, errorClass: 'provider_rejected', retryability: 'human_only' };
      return { state: 'FAILED', certainty: definite, errorClass: 'invalid_request', retryability: 'human_only' };
  }
}

/** Never claims more than the engine reported: "sent" is ACCEPTED, and only a delivery event is DELIVERED. */
export function normalizeEngineResult(r: EngineResult): NormalizedExecutionResult {
  return {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    engine: r.engine,
    ...normalizeOutcome(r),
    engineOutcome: r.outcome,
    disposition: r.disposition,
    externalRef: r.externalRef,
  };
}

// ── Correlation ─────────────────────────────────────────────────────────────

/** The one idempotency key of an execution: the task. See the adapter contract. */
export const executionIdempotencyKey = (executionTaskId: string): string => `task:${executionTaskId}`;

/** Ties every event of one journey step together, across engines and PI. */
export const executionCorrelationId = (executionInstanceId: string, planStepId: string | null): string =>
  `journey:${executionInstanceId}${planStepId === null ? '' : `/step:${planStepId}`}`;

// ── Capability declaration ──────────────────────────────────────────────────

/** How far a claim has been proven. Only the last two involve a real provider. */
export const VERIFICATION_LEVELS = ['mocked', 'postgres_verified', 'sandbox_provider_verified', 'production_verified'] as const;
export type VerificationLevel = typeof VERIFICATION_LEVELS[number];

export interface ProviderDeclaration {
  /** Who the engine calls. Separate from the engine: one engine may have several. */
  readonly provider: string;
  /** Tenant credentials, shared platform credentials, or none needed. */
  readonly credentials: 'tenant' | 'platform' | 'none';
  readonly verification: VerificationLevel;
}

export interface ActionCapability {
  /** What is asked for, e.g. `send_email`. Separate from channel and engine. */
  readonly action: string;
  readonly channel: string;
  /** Contact governance and the central gate apply when true. */
  readonly contactsPerson: boolean;
  /** How `execute` is made safe to repeat. */
  readonly idempotency: 'engine_record' | 'request_ledger' | 'observation_only' | 'none_acts';
  readonly approval: 'ws3_task' | 'engine_record' | 'none_available' | 'not_applicable';
  /** Does this engine report usage against credits today? */
  readonly creditMetered: boolean;
  readonly reportsDelivery: boolean;
  readonly reportsResponses: boolean;
  readonly providers: readonly ProviderDeclaration[];
}

export interface EngineCapabilityDeclaration {
  readonly contractVersion: string;
  readonly engine: EngineName;
  readonly actions: readonly ActionCapability[];
}

/** A declaration must describe exactly what its adapter routes. Returns defects; empty means sound. */
export function checkCapabilityDeclaration(
  declaration: EngineCapabilityDeclaration,
  adapter: { readonly engine: EngineName; readonly channels: readonly string[] },
): string[] {
  const defects: string[] = [];
  if (declaration.engine !== adapter.engine) defects.push(`declares ${declaration.engine}, adapter is ${adapter.engine}`);
  if (declaration.contractVersion.split('.')[0] !== EXECUTION_CONTRACT_VERSION.split('.')[0]) {
    defects.push(`contract major ${declaration.contractVersion} is incompatible with ${EXECUTION_CONTRACT_VERSION}`);
  }
  const declared = new Set(declaration.actions.map((a) => a.channel));
  for (const c of adapter.channels) if (!declared.has(c)) defects.push(`routes "${c}" with no declared action`);
  for (const c of declared) if (!adapter.channels.includes(c)) defects.push(`declares "${c}", which the adapter does not route`);
  for (const a of declaration.actions) {
    if (a.providers.length === 0 && a.idempotency !== 'none_acts' && a.idempotency !== 'observation_only') {
      defects.push(`${a.action} acts but names no provider`);
    }
    if (a.contactsPerson && a.approval === 'not_applicable') defects.push(`${a.action} contacts a person with no approval model`);
  }
  return defects;
}

// ── Usage ───────────────────────────────────────────────────────────────────

/**
 * What one execution consumed. Reported, not charged: no engine charges credits today,
 * and what an action costs is an owner decision (C-1 in the decision register).
 */
export interface ExecutionUsage {
  readonly unit: string;
  readonly quantity: number;
  readonly creditsCharged: number | null;
}

// ── Events ──────────────────────────────────────────────────────────────────

export const JOURNEY_EVENT_TYPES = [
  'prospect.lifecycle_changed',
  'journey.enrolled', 'journey.terminated', 'journey.completed',
  'decision.recorded',
  'approval.requested', 'approval.granted', 'approval.rejected',
  'execution.requested', 'execution.started', 'execution.accepted', 'execution.failed', 'execution.cancelled',
  'delivery.confirmed', 'delivery.failed', 'delivery.bounced', 'delivery.complained',
  'response.replied', 'response.unsubscribed', 'response.rejected', 'response.other',
  'outcome.recorded',
] as const;
export type JourneyEventType = typeof JOURNEY_EVENT_TYPES[number];

/** A STOP, an unsubscribe, a bounce and a complaint are never positive engagement. */
export const POSITIVE_ENGAGEMENT_EVENTS: readonly JourneyEventType[] = ['response.replied'];

export interface JourneyEvent {
  /** Deterministic from the source row, so a replay of the same facts gives the same id. */
  readonly eventId: string;
  readonly eventVersion: number;
  readonly type: JourneyEventType;
  readonly organizationId: string;
  readonly executionInstanceId: string;
  readonly subject: { readonly kind: string; readonly id: string };
  readonly engine: string | null;
  readonly channel: string | null;
  readonly idempotencyKey: string | null;
  readonly correlationId: string;
  readonly occurredAt: string;
  /** The durable record this event was read from. Events are a view; those rows are the truth. */
  readonly source: { readonly table: string; readonly id: string };
  /** A code, never personal data or content. */
  readonly code: string | null;
  readonly positiveEngagement: boolean;
}
