/**
 * Phase 24 — Shared domain workflow types.
 *
 * The four domain builders (long-form, campaign, publish, reconciliation)
 * share a common shape:
 *   - A typed `workflowParams` interface describing the queue payload's
 *     domain-specific fields.
 *   - A typed `Context` shape passed to every step.
 *   - A `serviceHooks` interface that the boot wiring injects with real
 *     service calls (production) or stubs (tests).
 *
 * Keeping the service-hook layer caller-injected preserves replay safety:
 * the builder constructs DETERMINISTIC steps with stable IDs; the actual
 * domain mutation happens inside the injected hook, which can be wrapped
 * with idempotency / retry / observability without touching the builder.
 *
 * Pure types. No I/O.
 */

import type {
  DomainWorkflowType,
  ReplayableWorkflowStep,
} from '../workflowExecutionTypes';

// ────────────────────────────────────────────────────────────────────
// Long-form generation
// ────────────────────────────────────────────────────────────────────

export interface LongFormWorkflowParams {
  /** Domain-specific subType discriminator. */
  subType: 'long_form_generation';
  /** Logical generation request id (used for idempotency + dedup). */
  generationId: string;
  /** Optional company-context bag (read-only inside steps). */
  companyContext?: Record<string, unknown>;
  /** Section ids to generate. Used as stable step IDs. */
  sectionIds: string[];
  /** Per-section tone / style hint (informational, optional). */
  styleHint?: string;
  /** Whether enrichment phase runs after generation. Default true. */
  runEnrichment?: boolean;
  /** Whether the finalize phase emits a recommendation card. Default true. */
  emitRecommendationCard?: boolean;
}

export interface LongFormContext {
  executionId: string;
  generationId: string;
  companyContext: Record<string, unknown>;
}

export interface LongFormServiceHooks {
  runPrecheck?: (ctx: LongFormContext) => Promise<void>;
  runGenerationSection: (ctx: LongFormContext, sectionId: string) => Promise<void>;
  runEnrichment?: (ctx: LongFormContext) => Promise<void>;
  runRecommendationCard?: (ctx: LongFormContext) => Promise<void>;
  runFinalize?: (ctx: LongFormContext) => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Campaign execution
// ────────────────────────────────────────────────────────────────────

export interface CampaignWorkflowParams {
  subType: 'campaign_execution';
  campaignId: string;
  /** Posts in the campaign — each becomes a workflow step. */
  posts: Array<{
    postId: string;
    /** Optional scheduled time (informational). */
    scheduledAtIso?: string;
    /** Optional payload bag for the post (read-only inside steps). */
    meta?: Record<string, unknown>;
  }>;
  /** Stagger interval in ms applied between posts (advisory). */
  staggerMs?: number;
  /** Whether to abort the whole campaign on any single-post failure. Default false. */
  failFast?: boolean;
}

export interface CampaignContext {
  executionId: string;
  campaignId: string;
  totalPosts: number;
}

export interface CampaignServiceHooks {
  /** Called once before any post runs. */
  runCampaignPrecheck?: (ctx: CampaignContext) => Promise<void>;
  /** Called per post. Must be idempotent on (campaignId, postId). */
  runPost: (ctx: CampaignContext, postId: string, meta: Record<string, unknown>) => Promise<void>;
  /** Called once after all posts complete (or first failure, when failFast). */
  runCampaignFinalize?: (ctx: CampaignContext) => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Social publish
// ────────────────────────────────────────────────────────────────────

export type SocialPlatform =
  | 'x' | 'linkedin' | 'instagram' | 'facebook'
  | 'tiktok' | 'youtube' | 'pinterest' | 'reddit' | 'spotify';

export interface SocialPublishWorkflowParams {
  subType: 'social_publish';
  /** Authoritative provider + account combo. */
  provider: SocialPlatform;
  socialAccountId: string;
  /** Content references (existing scheduled_posts row id). */
  scheduledPostId: string;
  /** Content fingerprint — used for duplicate-publish suppression. */
  contentFingerprint: string;
  /** Optional thread root id (for thread-style publishing). */
  threadRootId?: string;
  /** Optional retry advisory; the queue's own retry policy is authoritative. */
  retryBudgetHint?: number;
}

export interface SocialPublishContext {
  executionId: string;
  provider: SocialPlatform;
  socialAccountId: string;
  scheduledPostId: string;
  contentFingerprint: string;
  threadRootId: string | null;
}

export interface SocialPublishServiceHooks {
  /** Optional pre-publish validation (e.g. token freshness). */
  runPublishValidate?: (ctx: SocialPublishContext) => Promise<void>;
  /** Performs the actual provider publish. MUST be idempotent on
   *  (provider, socialAccountId, contentFingerprint). */
  runProviderPublish: (ctx: SocialPublishContext) => Promise<void>;
  /** Optional post-publish confirmation (e.g. provider verification). */
  runPublishConfirm?: (ctx: SocialPublishContext) => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Provider reconciliation
// ────────────────────────────────────────────────────────────────────

export interface ReconciliationWorkflowParams {
  subType: 'provider_reconciliation';
  /** Single row id targeted by reconciliation. */
  rowId: string;
  /** Provider scope (informational). */
  provider: SocialPlatform;
  /** Optional drift-analysis hint (rows to compare). */
  driftAnalysisHint?: string[];
  /** Whether to take a reconciliation snapshot. Default true. */
  takeSnapshot?: boolean;
}

export interface ReconciliationContext {
  executionId: string;
  rowId: string;
  provider: SocialPlatform;
}

export interface ReconciliationServiceHooks {
  /** Fetch + compare provider state. */
  runFetchProviderState?: (ctx: ReconciliationContext) => Promise<void>;
  /** Compute drift between local + provider state. */
  runDriftAnalysis?: (ctx: ReconciliationContext) => Promise<void>;
  /** Apply the reconciliation (e.g. update local row). */
  runReconcileRow: (ctx: ReconciliationContext) => Promise<void>;
  /** Optional snapshot for forensic archive. */
  runReconciliationSnapshot?: (ctx: ReconciliationContext) => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Step-builder utility return shape (re-exported for consistency)
// ────────────────────────────────────────────────────────────────────

export interface DomainBuilderResult<TCtx> {
  steps: ReplayableWorkflowStep<TCtx>[];
  context: TCtx;
}

// ────────────────────────────────────────────────────────────────────
// Re-export the domain workflow type union for ergonomic imports
// ────────────────────────────────────────────────────────────────────

export type { DomainWorkflowType };
