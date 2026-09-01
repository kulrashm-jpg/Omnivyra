/**
 * WS-3 — Lead Outreach Execution Runtime (public surface).
 *
 * MILESTONE-1 SCOPE: the canonical durable execution model and its storage.
 *
 * What exists here: the `OutreachTask` domain model, the lifecycle state
 * machine as validatable data, the two-axis outcome model, the immutable
 * provenance contract, and append-only persistence for approvals, attempts,
 * delivery evidence, outcomes and governance decisions.
 *
 * MILESTONE-2 ADDS: the single AutomationTask → OutreachTask translation
 * boundary and dry-run materialisation. Translation is pure and deterministic;
 * materialisation writes durable tasks and nothing else.
 *
 * MILESTONE-3 ADDS: the approval workflow — submit, approve, reject, cancel,
 * and immutable decision history. Transitions are compare-and-set, so exactly
 * one approver can win a contested decision.
 *
 * MILESTONE-4 ADDS: the deterministic governance evaluation engine — kill
 * switch, suppression, region, eligibility and a durable rate limiter — plus
 * immutable governance decisions. The engine EVALUATES; it never acts.
 *
 * MILESTONE-5A ADDS: the Internal Dispatch Runtime — governance-gated, with
 * durable quota consumption (Redis fast path over a database truth), immutable
 * attempts, and an internal transport that contacts nobody. Internal channel
 * ONLY: no email, WhatsApp, LinkedIn, SMS, HTTP or third-party SDK exists.
 *
 * MILESTONE-5B ADDS: the external channel boundary — a transport interface and
 * registry, an email transport disabled by default, and deterministic
 * per-attempt idempotency keys. Acceptance by a provider is not delivery.
 *
 * MILESTONE-6 ADDS: the closed failure taxonomy, stage/lifecycle/health
 * telemetry, and the runtime health report — all through the existing
 * HARDEN-001 registry, with no new monitoring infrastructure.
 *
 * MILESTONE-7 ADDS: feedback ingestion and the intelligence feedback envelope.
 * Feedback is idempotent, routed onto the delivery or business axis it belongs
 * to, and appended immutably. The envelope is PURE DERIVED DATA — counts,
 * ordering and explanations, never a score.
 *
 * THE PIPELINE IS ONE-WAY. Feedback is the terminus. It never returns to WS-2:
 * no behaviour, intent, qualification or recommendation score, no replay
 * checkpoint, no fingerprint, no regeneration and no plan may depend on it. The
 * absence of that arrow is enforced by guard tests, not by convention.
 *
 * `AutomationTask` remains WS-2-owned and immutable; this runtime never writes
 * it.
 *
 * See docs/WS3-ARCHITECTURE.md for the frozen architecture.
 */

export * from './types';
export {
  OUTREACH_TASK_STATUSES,
  TERMINAL_STATUSES,
  TRANSIENT_STATUSES,
  ALLOWED_TRANSITIONS,
  DELIVERY_STATUSES,
  ALLOWED_DELIVERY_TRANSITIONS,
  BUSINESS_OUTCOME_TYPES,
  isOutreachTaskStatus,
  isDeliveryStatus,
  isBusinessOutcomeType,
  isTerminalStatus,
  isTransientStatus,
  isTransitionAllowed,
  isDeliveryTransitionAllowed,
  explainTransition,
} from './lifecycle';
export { EXECUTION_RUNTIME_VERSION, TRANSLATION_VERSION, GOVERNANCE_VERSION } from './runtimeVersion';
export {
  translateAutomationTask,
  translateAutomationPlan,
  type TranslationContext,
  type TranslationOutcome,
  type TranslationResult,
} from './translation';
export {
  materializeAutomationPlan,
  type MaterializationOptions,
  type MaterializationResult,
  type MaterializedTaskResult,
} from './materialization';
export {
  evaluateGovernance,
  evaluateKillSwitch,
  evaluateSuppression,
  evaluateRegion,
  evaluateEligibility,
  evaluateRateLimit,
  type GateDecision,
  type GateEvaluation,
  type GovernanceEvaluation,
  type GovernanceEvaluationInput,
  type RateUsage,
  type SuppressionMatches,
  type TenantGovernanceConfig,
} from './governance';
export {
  resolveLeadPersonId,
  resolvePersonAnchor,
  type PersonAnchorResolution,
} from './personAnchor';
export {
  evaluateTaskGovernance,
  evaluateBatchGovernance,
  resolveCanonicalGovernance,
  resolveCanonicalGovernanceWithAnchor,
  getLatestGovernanceDecision,
  getGovernanceHistory,
  loadTenantGovernanceConfig,
  loadSuppressionMatches,
  loadRateUsage,
  isLeadOutreachGloballyDisabled,
  LEAD_OUTREACH_DISABLED_ENV,
  OUTREACH_GOVERNANCE_CONFIG_TABLE,
  OUTREACH_SUPPRESSIONS_TABLE,
  type EvaluateOptions,
  type GovernanceServiceResult,
} from './governanceService';
export {
  OUTREACH_METRICS,
  recordGovernanceEvaluation,
  recordGovernanceGate,
  recordGovernanceFailure,
  recordDispatchOutcome,
  recordDispatchDuration,
  recordQuotaReserved,
  recordQuotaReconciled,
  recordStageOutcome,
  recordFailure,
  recordLifecycleTransition,
  recordHealthComponent,
  recordFeedbackIngestion,
  recordFeedbackRouting,
  type DispatchMetricOutcome,
  type StageOutcome,
} from './telemetry';
export {
  FEEDBACK_VERSION,
  FEEDBACK_SIGNALS,
  FEEDBACK_SOURCES,
  isFeedbackSignal,
  isFeedbackSource,
  feedbackAxis,
  ingestFeedback,
  ingestFeedbackBatch,
  readTaskFeedback,
  type FeedbackSignal,
  type FeedbackEvent,
  type FeedbackResult,
  type FeedbackRejection,
  type FeedbackBatchResult,
  type TaskFeedbackRecord,
} from './feedbackIngestion';
export {
  FEEDBACK_SCHEMA_VERSION,
  buildFeedbackEnvelope,
  type FeedbackEnvelope,
  type FeedbackSummaryInput,
  type FeedbackExplanation,
  type DeliverySummary,
  type EngagementSummary,
  type ResponseSummary,
  type ConversionSummary,
  type FeedbackTimelineEntry,
  type FeedbackCoverage,
  type ObservedRate,
} from './feedbackSummary';
export {
  QUOTA_WINDOW_HOURS,
  readDurableUsage,
  reserveQuota,
  releaseQuota,
  reconcileQuota,
  __resetQuotaRedisForTests,
  type QuotaReservation,
  type QuotaReconciliation,
} from './quota';
export {
  INTERNAL_CHANNEL,
  OUTREACH_INTERNAL_WORK_ITEMS_TABLE,
  dispatchInternalTask,
  internalTransport,
  listInternalWorkItems,
  type InternalDispatchResult,
} from './internalTransport';
export {
  registerTransport,
  resolveTransport,
  supportedChannels,
  buildIdempotencyKey,
  __clearTransportsForTests,
  type OutreachTransport,
  type TransportRequest,
  type TransportResult,
  type TransportOutcome,
} from './transport';
export {
  createEmailTransport,
  supabaseEdgeEmailProvider,
  isEmailTransportEnabled,
  EMAIL_ENABLED_ENV,
  EMAIL_TIMEOUT_MS,
  type EmailProviderPort,
  type EmailProviderRequest,
  type EmailProviderResponse,
} from './emailTransport';
export { registerDefaultTransports } from './transportRegistry';
export {
  FAILURE_CLASSES,
  RUNTIME_STAGES,
  FAILURE_OWNER,
  classifyFailure,
  isFailureClass,
  type FailureClass,
  type RuntimeStage,
} from './failureTaxonomy';
export {
  getOutreachRuntimeHealth,
  type OutreachHealthReport,
  type OutreachHealthIndicator,
  type OutreachHealthStatus,
} from './health';
export {
  dispatchInternalOutreachTask,
  dispatchInternalBatch,
  type DispatchOutcome,
  type DispatchOptions,
  type DispatchResult,
} from './dispatch';
export {
  submitForApproval,
  resubmitForApproval,
  cancelApprovalRequest,
  approveOutreachTask,
  rejectOutreachTask,
  getApprovalState,
  getApprovalHistory,
  type ApprovalDecision,
  type ApprovalRefusal,
  type ApprovalActionResult,
  type ApprovalStateView,
  type DecisionInput,
} from './approval';
export {
  OUTREACH_TASKS_TABLE,
  OUTREACH_APPROVALS_TABLE,
  OUTREACH_ATTEMPTS_TABLE,
  OUTREACH_DELIVERY_TABLE,
  OUTREACH_OUTCOMES_TABLE,
  OUTREACH_DECISIONS_TABLE,
  insertOutreachTask,
  getOutreachTask,
  getOutreachTaskById,
  listOutreachTasksForLead,
  setOutreachTaskState,
  setOutreachTaskPersonId,
  transitionOutreachTaskState,
  appendApproval,
  appendAttempt,
  appendDeliveryEvidence,
  appendOutcome,
  appendDecision,
  listApprovals,
  listAttempts,
  listDeliveryEvidence,
  listOutcomes,
  listDecisions,
  outcomeTypesFor,
  rowToOutreachTask,
  type WriteResult,
} from './storage';
