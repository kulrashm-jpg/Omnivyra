/**
 * Enterprise Governance — Runtime Integration Facade
 * (Phases 1, 2, 3, 9).
 *
 * Single entry point the creator orchestrator + QA pipeline + publish
 * lifecycle call into. Wraps the underlying review state machine,
 * escalation pipeline, event bus, persistence mirror, and idempotency
 * primitives in a feature-flagged, never-throws surface.
 *
 * Activation:
 *   - ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED=true  → orchestrator hooks fire
 *   - ENTERPRISE_GOVERNANCE_REDIS_ENABLED=true    → cross-instance state
 *
 * Failure isolation contract:
 *   - Every public function is wrapped in try/catch internally.
 *   - Errors are logged + swallowed; orchestrator flow continues.
 *   - Bypassed code paths return a `{ skipped: true }` envelope so
 *     callers can correlate audit telemetry.
 *
 * Bounded behavior:
 *   - Escalations are idempotent on `(assetId, reason)` for 1h.
 *   - Review-record establishment is idempotent on `assetId` for 1h.
 *   - Distributed lock on state transitions prevents double-processing.
 *   - Escalation-loop cap (3/asset) lives in the state machine itself.
 */

import {
  establishReviewRecord,
  getReviewRecord,
  transitionReviewState,
  ReviewTransitionError,
  type ReviewState,
  type CreativeReviewRecord,
} from './creativeReviewStateMachine';
import {
  issueEscalation,
  decideEscalationReason,
  type Escalation,
  type EscalationReason,
} from './creativeEscalationPipeline';
import { canPerform, type CreativeReviewRole } from './creativeReviewRoles';
import { mirrorReviewRecord, mirrorEscalation } from './enterpriseGovernanceRedisPersistence';
import { withIdempotency, withDistributedLock, LockBusyError } from './enterpriseGovernanceLocking';
import { emitGovernanceEvent } from './enterpriseGovernanceEvents';
import { trackEvent } from '../telemetry/telemetryDispatcher';

function isRuntimeEnabled(): boolean {
  return String(process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED ?? 'false').toLowerCase() === 'true';
}

export type GovernanceIntegrationResult<T = unknown> = {
  skipped: boolean;
  reason?: 'flag_off' | 'idempotent_duplicate' | 'lock_busy' | 'asset_missing' | 'internal_error';
  result?: T;
  errorMessage?: string;
};

function skipped<T = unknown>(reason: GovernanceIntegrationResult['reason']): GovernanceIntegrationResult<T> {
  return { skipped: true, reason };
}

/* ── Phase 1 — Asset generation → establish review record ─────────────── */

export async function onAssetGenerated(input: {
  assetId: string;
  companyId: string;
  campaignId?: string | null;
  actorUserId?: string | null;
  actorRole?: CreativeReviewRole | null;
}): Promise<GovernanceIntegrationResult<CreativeReviewRecord>> {
  if (!isRuntimeEnabled()) return skipped('flag_off');
  if (!input.assetId || !input.companyId) return skipped('asset_missing');

  try {
    const idemKey = `establish:${input.assetId}`;
    const idem = await withIdempotency(idemKey, async () => {
      // Skip if record already exists (warm restart / queue retry).
      const existing = getReviewRecord(input.assetId);
      if (existing) return existing;
      const record = establishReviewRecord({
        assetId: input.assetId,
        companyId: input.companyId,
        campaignId: input.campaignId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
      });
      // Best-effort distributed mirror.
      void mirrorReviewRecord({
        assetId: record.assetId,
        companyId: record.companyId,
        campaignId: record.campaignId,
        currentState: record.currentState,
        updatedAt: record.lastTransitionedAt,
      });
      emitGovernanceEvent({
        type: 'review_record_established',
        assetId: record.assetId,
        companyId: record.companyId,
        campaignId: record.campaignId,
        context: { initialState: record.currentState },
      });
      emitGovernanceEvent({
        type: 'asset_generated',
        assetId: record.assetId,
        companyId: record.companyId,
        campaignId: record.campaignId,
      });
      return record;
    });
    if (!idem.ran) return { skipped: true, reason: 'idempotent_duplicate' };
    return { skipped: false, result: idem.result };
  } catch (error) {
    return {
      skipped: true,
      reason: 'internal_error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ── Phase 2 — QA failure → automatic escalation ───────────────────────── */

export async function onQaResult(input: {
  assetId: string;
  companyId: string;
  campaignId?: string | null;
  qaScore?: number | null;
  qaSeverity?: 'pass' | 'warning' | 'fail' | 'reject';
  retryCount?: number | null;
  governanceScore?: number | null;
  governanceRejected?: boolean;
  governanceViolationCount?: number | null;
  campaignConsistencyScore?: number | null;
  legalRiskSignal?: boolean;
  notes?: string | null;
}): Promise<GovernanceIntegrationResult<Escalation | null>> {
  if (!isRuntimeEnabled()) return skipped('flag_off');

  try {
    const reason: EscalationReason | null = decideEscalationReason({
      governanceScore: input.governanceScore,
      governanceRejected: input.governanceRejected,
      qaScore: input.qaScore,
      qaSeverity: input.qaSeverity,
      retryCount: input.retryCount,
      governanceViolationCount: input.governanceViolationCount,
      campaignConsistencyScore: input.campaignConsistencyScore,
      legalRiskSignal: input.legalRiskSignal,
    });

    // Always emit QA outcome event for observability, even when no escalation.
    if (input.qaSeverity === 'pass') {
      emitGovernanceEvent({
        type: 'qa_passed',
        assetId: input.assetId,
        companyId: input.companyId,
        campaignId: input.campaignId ?? null,
        context: { qaScore: input.qaScore ?? null },
      });
      // Auto-advance the FSM forward on QA pass:
      //   generated → qa_review (submit) then qa_review → governance_review
      // Distributed-lock-guarded; never throws (transition errors are
      // captured as skipped envelopes).
      try {
        const record = getReviewRecord(input.assetId);
        if (record && record.currentState === 'generated') {
          const lockKey = `transition:${input.assetId}:to-qa-review`;
          await withDistributedLock(lockKey, async () => {
            const fresh = getReviewRecord(input.assetId);
            if (!fresh || fresh.currentState !== 'generated') return;
            const updated = transitionReviewState({
              assetId: input.assetId,
              to: 'qa_review',
              actorUserId: 'system',
              actorRole: 'creative_operator',
              reason: 'auto_submit_for_qa',
            });
            void mirrorReviewRecord({
              assetId: updated.assetId,
              companyId: updated.companyId,
              campaignId: updated.campaignId,
              currentState: updated.currentState,
              updatedAt: updated.lastTransitionedAt,
            });
            emitGovernanceEvent({
              type: 'review_state_transition',
              assetId: updated.assetId,
              companyId: updated.companyId,
              campaignId: updated.campaignId,
              context: { from: 'generated', to: updated.currentState, auto: true },
            });
          });
        }
        const after = getReviewRecord(input.assetId);
        if (after && after.currentState === 'qa_review') {
          const lockKey = `transition:${input.assetId}:to-governance-review`;
          await withDistributedLock(lockKey, async () => {
            const fresh = getReviewRecord(input.assetId);
            if (!fresh || fresh.currentState !== 'qa_review') return;
            const updated = transitionReviewState({
              assetId: input.assetId,
              to: 'governance_review',
              actorUserId: 'system',
              actorRole: 'compliance_reviewer',
              reason: 'auto_advance_after_qa_pass',
            });
            void mirrorReviewRecord({
              assetId: updated.assetId,
              companyId: updated.companyId,
              campaignId: updated.campaignId,
              currentState: updated.currentState,
              updatedAt: updated.lastTransitionedAt,
            });
            emitGovernanceEvent({
              type: 'review_state_transition',
              assetId: updated.assetId,
              companyId: updated.companyId,
              campaignId: updated.campaignId,
              context: { from: 'qa_review', to: updated.currentState, auto: true },
            });
          });
        }
      } catch (transitionErr) {
        // FSM rejections shouldn't propagate — log + continue.
        if (!(transitionErr instanceof LockBusyError) && !(transitionErr instanceof ReviewTransitionError)) {
          throw transitionErr;
        }
      }
      return { skipped: false, result: null };
    }
    if (input.qaSeverity === 'fail' || input.qaSeverity === 'reject') {
      emitGovernanceEvent({
        type: 'qa_failure',
        assetId: input.assetId,
        companyId: input.companyId,
        campaignId: input.campaignId ?? null,
        context: {
          qaScore: input.qaScore ?? null,
          severity: input.qaSeverity,
          retryCount: input.retryCount ?? 0,
        },
      });
    }

    if (!reason) return { skipped: false, result: null };

    // Idempotency on (assetId, reason) — prevents an in-flight retry storm
    // from fanning out N escalations for the same root cause.
    const idemKey = `escalate:${input.assetId}:${reason}`;
    const idem = await withIdempotency(idemKey, async () => {
      const escalation = issueEscalation({
        assetId: input.assetId,
        companyId: input.companyId,
        campaignId: input.campaignId ?? null,
        reason,
        governanceScore: input.governanceScore ?? null,
        qaScore: input.qaScore ?? null,
        retryCount: input.retryCount ?? null,
        governanceViolationCount: input.governanceViolationCount ?? null,
        notes: input.notes ?? null,
      });
      void mirrorEscalation(escalation);
      emitGovernanceEvent({
        type: 'escalation_created',
        assetId: escalation.assetId,
        companyId: escalation.companyId,
        campaignId: escalation.campaignId,
        context: {
          escalationId: escalation.escalationId,
          reason: escalation.reason,
          level: escalation.escalationLevel,
          priority: escalation.escalationPriority,
          assignedRole: escalation.assignedReviewRole,
          capReached: escalation.capReached === true,
        },
      });
      if (reason === 'severe_governance_violation') {
        emitGovernanceEvent({
          type: 'severe_governance_violation',
          assetId: escalation.assetId,
          companyId: escalation.companyId,
          campaignId: escalation.campaignId,
          context: { escalationId: escalation.escalationId },
        });
      }
      if ((input.retryCount ?? 0) >= 3) {
        emitGovernanceEvent({
          type: 'retry_exhausted',
          assetId: escalation.assetId,
          companyId: escalation.companyId,
          campaignId: escalation.campaignId,
          context: { retryCount: input.retryCount ?? 0 },
        });
      }
      return escalation;
    });

    if (!idem.ran) return { skipped: true, reason: 'idempotent_duplicate' };
    return { skipped: false, result: idem.result };
  } catch (error) {
    return {
      skipped: true,
      reason: 'internal_error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ── Phase 3 — Governance result → drive review state ──────────────────── */

export async function onGovernanceResult(input: {
  assetId: string;
  companyId: string;
  campaignId?: string | null;
  passed: boolean;
  actorUserId?: string;
  actorRole?: CreativeReviewRole;
  governanceScore?: number | null;
  rejectionReason?: string | null;
}): Promise<GovernanceIntegrationResult<CreativeReviewRecord | null>> {
  if (!isRuntimeEnabled()) return skipped('flag_off');

  try {
    const record = getReviewRecord(input.assetId);
    if (!record) return skipped('asset_missing');

    // Auto-advance the asset from governance_review → brand_review on
    // governance pass. Distributed-lock-guarded; FSM rejections become
    // log-and-continue (not propagated).
    if (record.currentState === 'governance_review' && input.passed) {
      const actor = input.actorRole ?? 'brand_manager';
      const lockKey = `transition:${input.assetId}:to-brand-review`;
      try {
        const updated = await withDistributedLock(lockKey, async () => {
          const fresh = getReviewRecord(input.assetId);
          if (!fresh || fresh.currentState !== 'governance_review') return fresh;
          return transitionReviewState({
            assetId: input.assetId,
            to: 'brand_review',
            actorUserId: input.actorUserId ?? 'system',
            actorRole: actor,
            reason: 'auto_advance_after_governance_pass',
          });
        });
        if (updated) {
          void mirrorReviewRecord({
            assetId: updated.assetId,
            companyId: updated.companyId,
            campaignId: updated.campaignId,
            currentState: updated.currentState,
            updatedAt: updated.lastTransitionedAt,
          });
          emitGovernanceEvent({
            type: 'review_state_transition',
            assetId: updated.assetId,
            companyId: updated.companyId,
            campaignId: updated.campaignId,
            context: { from: 'governance_review', to: updated.currentState, auto: true },
          });
        }
      } catch (error) {
        if (error instanceof LockBusyError) return skipped('lock_busy');
        if (!(error instanceof ReviewTransitionError)) throw error;
        // ReviewTransitionError: log + continue, don't propagate
      }
    }

    if (input.passed) {
      emitGovernanceEvent({
        type: 'governance_passed',
        assetId: input.assetId,
        companyId: input.companyId,
        campaignId: input.campaignId ?? null,
        context: { score: input.governanceScore ?? null },
      });
    } else {
      emitGovernanceEvent({
        type: 'governance_intervention',
        assetId: input.assetId,
        companyId: input.companyId,
        campaignId: input.campaignId ?? null,
        context: {
          score: input.governanceScore ?? null,
          rejectionReason: input.rejectionReason ?? null,
        },
      });
    }

    return { skipped: false, result: getReviewRecord(input.assetId) };
  } catch (error) {
    return {
      skipped: true,
      reason: 'internal_error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ── Phase 3 — Approval transition surface ─────────────────────────────── */

export async function onApprovalDecision(input: {
  assetId: string;
  to: ReviewState;
  actorUserId: string;
  actorRole: CreativeReviewRole;
  reason?: string | null;
  bypass?: boolean;
}): Promise<GovernanceIntegrationResult<CreativeReviewRecord>> {
  if (!isRuntimeEnabled()) return skipped('flag_off');

  try {
    const lockKey = `transition:${input.assetId}:${input.to}`;
    const updated = await withDistributedLock(lockKey, async () => {
      return transitionReviewState({
        assetId: input.assetId,
        to: input.to,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reason: input.reason ?? null,
        bypass: input.bypass === true,
      });
    });
    void mirrorReviewRecord({
      assetId: updated.assetId,
      companyId: updated.companyId,
      campaignId: updated.campaignId,
      currentState: updated.currentState,
      updatedAt: updated.lastTransitionedAt,
    });

    // Emit one transition event + one semantic event (approved/rejected/...).
    emitGovernanceEvent({
      type: 'review_state_transition',
      assetId: updated.assetId,
      companyId: updated.companyId,
      campaignId: updated.campaignId,
      context: {
        from: updated.history[updated.history.length - 1]?.from ?? null,
        to: updated.currentState,
        actorRole: input.actorRole,
        bypassed: input.bypass === true,
      },
    });
    if (input.to === 'approved') {
      emitGovernanceEvent({
        type: 'approval_granted',
        assetId: updated.assetId,
        companyId: updated.companyId,
        campaignId: updated.campaignId,
        context: { actorRole: input.actorRole },
      });
      emitGovernanceEvent({
        type: 'publish_allowed',
        assetId: updated.assetId,
        companyId: updated.companyId,
        campaignId: updated.campaignId,
      });
    } else if (input.to === 'rejected') {
      emitGovernanceEvent({
        type: 'approval_rejected',
        assetId: updated.assetId,
        companyId: updated.companyId,
        campaignId: updated.campaignId,
        context: { reason: input.reason ?? null, actorRole: input.actorRole },
      });
    }
    // Canonical telemetry (append-only, fail-soft): an approval/review reached a
    // terminal decision (approved or rejected). Not deduped — a re-review of the
    // same asset is a distinct completed decision.
    if (input.to === 'approved' || input.to === 'rejected') {
      trackEvent({
        type: 'collaboration.approval_completed',
        organizationId: updated.companyId,
        actorId: input.actorUserId,
        entityId: updated.assetId,
        metadata: { entityType: 'creative_asset', decision: input.to },
        dedupKey: null,
      });
    }
    return { skipped: false, result: updated };
  } catch (error) {
    if (error instanceof LockBusyError) return skipped('lock_busy');
    if (error instanceof ReviewTransitionError) {
      // Surface the FSM rejection — the caller (an admin UI / API) needs the code.
      return {
        skipped: true,
        reason: 'internal_error',
        errorMessage: `${error.code}: ${error.message}`,
      };
    }
    return {
      skipped: true,
      reason: 'internal_error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ── Phase 3 — Publish lifecycle ───────────────────────────────────────── */

export async function onPublished(input: {
  assetId: string;
  actorUserId: string;
  actorRole: CreativeReviewRole;
}): Promise<GovernanceIntegrationResult<CreativeReviewRecord>> {
  if (!isRuntimeEnabled()) return skipped('flag_off');

  try {
    const record = getReviewRecord(input.assetId);
    if (!record) return skipped('asset_missing');

    // Illegal-publish prevention — only advance from approved → published.
    if (record.currentState !== 'approved') {
      emitGovernanceEvent({
        type: 'publish_blocked',
        assetId: record.assetId,
        companyId: record.companyId,
        campaignId: record.campaignId,
        context: {
          currentState: record.currentState,
          reason: 'not_approved',
        },
      });
      return {
        skipped: true,
        reason: 'internal_error',
        errorMessage: `publish blocked — asset in state ${record.currentState}, expected approved`,
      };
    }
    if (!canPerform(input.actorRole, 'publish')) {
      return {
        skipped: true,
        reason: 'internal_error',
        errorMessage: `role ${input.actorRole} cannot publish`,
      };
    }

    const lockKey = `transition:${input.assetId}:published`;
    const updated = await withDistributedLock(lockKey, async () => {
      return transitionReviewState({
        assetId: input.assetId,
        to: 'published',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reason: 'publish_lifecycle',
      });
    });
    void mirrorReviewRecord({
      assetId: updated.assetId,
      companyId: updated.companyId,
      campaignId: updated.campaignId,
      currentState: updated.currentState,
      updatedAt: updated.lastTransitionedAt,
    });
    emitGovernanceEvent({
      type: 'published',
      assetId: updated.assetId,
      companyId: updated.companyId,
      campaignId: updated.campaignId,
      context: { actorRole: input.actorRole },
    });
    return { skipped: false, result: updated };
  } catch (error) {
    if (error instanceof LockBusyError) return skipped('lock_busy');
    return {
      skipped: true,
      reason: 'internal_error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ── Phase 9 — Health probe ───────────────────────────────────────────── */

export function integrationHealth(): {
  runtimeEnabled: boolean;
} {
  return { runtimeEnabled: isRuntimeEnabled() };
}
