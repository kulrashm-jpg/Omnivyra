/**
 * Billing service barrel — single import surface for the enterprise billing
 * layer introduced by Phase 1 CRITICAL gap closure (C-1..C-4).
 *
 * Public entry points (use these — not the underlying services directly):
 *
 *   runBilledOperation        — generic orchestrated billing call
 *   runBilledAiCompletion     — convenience for LLM-priced HTTP routes
 *   withQueueBilling          — wrap a queue handler with exactly-once billing
 *   withQueueBillingLlm       — same, for LLM-priced jobs
 *   proposeApproval           — open an approval request for an admin action
 *   signApproval              — N-of-M signature submission
 *   markApprovalExecuted      — close the approval row after the action is performed
 *   emitFinancialAudit        — direct financial audit row insert
 *   emitAnomaly               — structured anomaly event
 *   snapshotBillingMetrics    — pull current in-memory counters
 *   buildBillingIdempotencyKey— derive idempotency from caller class
 *   getBillingCorrelation     — pull correlation in a request/job context
 *   seedBillingCorrelation    — initialize correlation in a non-request context
 *   checkAiBillingGuard       — pre-flight check before an aiGateway call
 *   isAiBillingEnforced       — feature-flag read
 */

export {
  runBilledOperation,
  openBillingOperation,
  closeBillingOperation,
  recordAdminFinancialOperation,
  type OrchestratedOperation,
  type OrchestratedFixed,
  type OrchestratedLlm,
  type OrchestratorResult,
} from './enterpriseBillingOrchestrator';

export { runBilledAiCompletion } from './runBilledAiCompletion';

export {
  withQueueBilling,
  withQueueBillingLlm,
  type QueueBillingContext,
  type QueueBillingResult,
} from './queueBillingMiddleware';

export {
  proposeApproval,
  signApproval,
  markApprovalExecuted,
  getApprovalDetails,
  expirePendingApprovals,
  type ApprovalActionType,
  type ApprovalPayload,
  type ProposeApprovalArgs,
  type ProposeApprovalResult,
  type SignApprovalArgs,
  type SignApprovalResult,
} from './creditApprovalService';

export {
  emitFinancialAudit,
  emitAnomaly,
  type FinancialAuditEvent,
  type AnomalyEvent,
} from './billingAuditEmitter';

export {
  buildBillingIdempotencyKey,
  fingerprintPayload,
  type BillingIdempotencyArgs,
  type BillingIdempotencyKey,
  type HttpKeyArgs,
  type QueueKeyArgs,
  type WebhookKeyArgs,
  type CronKeyArgs,
} from './billingIdempotencyService';

export {
  getBillingCorrelation,
  seedBillingCorrelation,
  deriveCorrelationId,
  buildExecutionHash,
  type BillingCorrelation,
} from './billingCorrelationService';

export {
  checkAiBillingGuard,
  isAiBillingEnforced,
  invalidateAllowlistCache,
  type CreditHandle,
  type AiBillingGuardResult,
} from './aiGatewayBillingGuard';

export {
  snapshotBillingMetrics,
  incrCounter as incrBillingCounter,
  getCounter as getBillingCounter,
  type BillingCounter,
} from './billingMetrics';

export {
  resolveCreditCost,
  type PricingQuery,
  type PricingDecision,
  type FixedCostQuery,
  type TokenCostQuery,
} from './pricing/pricingResolver';

export {
  findModelPricing,
  listKnownModels,
  invalidateModelPricingCache,
  type ModelPricingRow,
} from './pricing/modelPricingRegistry';

export {
  estimateHoldFromMaxTokens,
  resolveActualCost,
  type TokenUsage,
  type TokenPricingContext,
} from './pricing/tokenCreditConverter';

export {
  normalizeToUsd,
  captureFxSnapshot,
  type MoneyAmount,
  type FxSnapshot,
} from './pricing/currencyNormalizationService';

// ── Phase 2 — Feature flags + governance + payments + integrity jobs ──────────

export {
  BILLING_FLAGS,
  isBillingFlagEnabled,
  evaluateAllBillingFlags,
  isRefineVariantBillingEnabled,
  type BillingFlagKey,
  type FlagEvaluation,
  type MigrationReadiness,
} from './billingFeatureFlags';

export {
  FINANCE_ROLES,
  isFinanceAdmin,
  isFinanceApprover,
  isFinanceAuditor,
  evaluateRequiredApprovals,
  type FinanceRole,
} from './financeRbacService';

export {
  applyFinancialControl,
  checkFinancialControls,
  type FinancialControlAction,
  type FinancialControlOpts,
  type FinancialControlResult,
} from './orgFinancialControlService';

export {
  cancelApproval,
  type CancelApprovalArgs,
  type CancelApprovalResult,
} from './approvalCancellationService';

export {
  dispatchCheckout,
  dispatchWebhook,
  getProviderAdapter,
  registerProviderAdapter,
  type SupportedProvider,
  type CheckoutSessionRequest,
  type CheckoutSessionResult,
  type WebhookEventInput,
  type WebhookProcessingResult,
  type PaymentProviderAdapter,
} from './payments/paymentProviderAdapter';

export {
  getBillingWalletSnapshot,
  getPortfolioWalletAggregate,
  type BillingWalletSnapshot,
  type BillingWalletAggregate,
} from './payments/billingWalletService';

export {
  prepareDraftInvoice,
  type PrepareInvoiceArgs,
  type InvoiceDraft,
} from './payments/invoicePreparationService';

export {
  projectOrgSubscriptions,
  listRenewalsDue,
  type SubscriptionProjection,
} from './payments/subscriptionProjectionService';

export {
  takeUsageSnapshot,
  type UsageSnapshotArgs,
  type UsageSnapshotResult,
} from './payments/usageAggregationService';

export {
  runReservationReconciliation,
  type ReservationReconciliationResult,
} from './jobs/reservationReconciliationJob';

export {
  runOrphanUsageReconciliation,
  type OrphanUsageResult,
} from './jobs/orphanUsageReconciliationJob';

export {
  runFinancialIntegrityAudit,
  type FinancialIntegrityReport,
} from './jobs/financialIntegrityAuditJob';

// ── Phase 3 — Non-billable registry, exports, FX, contracts ───────────────────

export {
  registerNonBillable,
  getRegisteredEntry,
  isRegisteredNonBillable,
  auditRegistry,
  reportExpiredEntryAccess,
  NON_BILLABLE_CATEGORIES,
  type NonBillableCategory,
  type NonBillableEntry,
  type RegisteredEntry,
  type RegistryAuditResult,
} from './nonBillableRegistry';

export {
  recordExportManifest,
  verifyExportContent,
  listManifests,
  type ExportType,
  type ExportFormat,
  type ManifestInput,
  type ManifestResult,
} from './exports/auditManifestService';

export {
  exportLedger,
  exportAdminAdjustments,
  exportCompanyUsage,
  exportReservationLifecycle,
  exportApprovalChain,
  exportBillingAnomalies,
  type LedgerExportArgs,
  type LedgerExportFilters,
  type LedgerExportResult,
} from './exports/ledgerExportService';

export {
  traceBillingOperation,
  investigateJobReplay,
  type ForensicsResult,
} from './exports/billingForensicsService';

export {
  Money,
  CURRENCY_PRECISION,
  UnsupportedCurrencyError,
  MoneyMismatchError,
  type RoundingMode,
  type MoneyShape,
} from './money/Money';

export {
  getFxRate,
  recordFxRate,
  invalidateFxCache,
  type FxRate,
} from './money/fxRateService';

export {
  resolveActiveContract,
  getContractContext,
  listUpcomingContractExpirations,
  type ActiveContract,
  type ContractContext,
} from './contracts/enterpriseContractResolver';

export {
  forecastUsage,
  detectBurnRateAnomaly,
  type ForecastResult,
} from './contracts/usageForecastingService';

export {
  projectInvoice,
  type InvoiceProjection,
  type InvoiceProjectionLine,
} from './contracts/invoiceProjectionEngine';

export {
  runBillingMicroBench,
  type BenchResult,
} from './jobs/billingBenchHarness';

export {
  planPercentageRollout,
  validateBillingRolloutDependencies,
  enableBillingCanaryForOrg,
  applyPercentageRollout,
  BILLING_CANARY_FLAGS,
  type BillingRolloutPlanEntry,
  type BillingRolloutValidation,
  type BillingCanaryResult,
} from './rollout/billingRolloutCoordinator';

export {
  rollbackBillingForOrg,
  emergencyDisableBillingCanary,
  type BillingRollbackResult,
} from './rollout/billingRollbackService';

export {
  verifyBillingConsistency,
  type BillingConsistencyReport,
  type BillingConsistencySignal,
} from './rollout/billingConsistencyVerifier';
