import { supabase } from '../db/supabaseClient';
import { executeAction } from './communityAiActionExecutor';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { randomUUID } from 'crypto';
import { notifyCommunityAi } from './communityAiNotificationService';
import { sendCommunityAiWebhooks } from './communityAiWebhookService';
import { persistExecutionResult, claimCommunityActionForExecution } from './communityAiActionExecutor';
import { getPlaybookById } from './playbooks/playbookService';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';
import { getToken } from './platformTokenService';
import { getCommunityExecutionPolicy } from './communityAiPlatformPolicyService';
import { evaluateCommunityApprovalEvidence } from './communityApprovalBinding';
import { recordCommunityExecutionRefusal } from './communityExecutionRefusal';
import { canExecuteAction } from './executionGuardrailService';
import { ownedDbTable } from '../db/writeOwner';

/** Narrowing helpers (the project is not strictNullChecks, so `!x.ok` does not narrow). */
const refusedCode = (d: { ok: boolean }): string => (d as { code?: string }).code ?? 'POLICY_UNREADABLE';
const evidenceRefusal = (e: { ok: boolean }): { code: string; detail: string } =>
  ({ code: (e as { code?: string }).code ?? 'APPROVAL_EVIDENCE_REQUIRED', detail: (e as { detail?: string }).detail ?? '' });

type SchedulerResult = {
  processed: number;
  executed: number;
  failed: number;
};

const loadHistoryMetrics = async (
  tenantId: string,
  organizationId: string,
  playbookId: string
) => {
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartIso = dayStart.toISOString();

    const { data: replyRows } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .eq('action_type', 'reply')
      .gte('updated_at', hourAgo);

    const { data: followRows } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .eq('action_type', 'follow')
      .gte('updated_at', dayStartIso);

    const { data: actionRows } = await ownedDbTable('community_ai_actions')
      .select('id, intent_classification')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .gte('updated_at', dayStartIso);

    const networkActionsToday =
      (actionRows || []).filter(
        (row: any) => row?.intent_classification?.primary_intent === 'network_expansion'
      ).length ?? 0;

    return {
      replies_last_hour: replyRows?.length ?? 0,
      follows_today: followRows?.length ?? 0,
      actions_today: actionRows?.length ?? 0,
      networkActionsToday,
    };
  } catch (error: any) {
    console.warn('PLAYBOOK_HISTORY_METRICS_FAILED', error?.message || error);
    return {
      replies_last_hour: 0,
      follows_today: 0,
      actions_today: 0,
    };
  }
};

export const runCommunityAiScheduler = async (now = new Date()): Promise<SchedulerResult> => {
  // The execution policy is per tenant (OD-1) and is decided for each action
  // below, before anything is written or claimed. There is no global switch to
  // read here: the platform kill switch is part of every tenant decision.
  //
  // Only rows with a human approval of record are loaded. An 'approved' row with
  // no approved_at (a legacy auto-rule approval) is never claimable, and loading
  // it re-read it on every run without ever settling it.
  const cutoff = now.toISOString();
  const { data: actions, error } = await ownedDbTable('community_ai_actions')
    .select('*')
    .eq('status', 'approved')
    .not('approved_at', 'is', null)
    .gte('scheduled_at', '1970-01-01T00:00:00.000Z')
    .lte('scheduled_at', cutoff);

  if (error || !actions) {
    console.warn('COMMUNITY_AI_SCHEDULER_LOAD_FAILED', error?.message);
    return { processed: 0, executed: 0, failed: 0 };
  }

  let executed = 0;
  let failed = 0;

  for (const action of actions) {
    if (!action.tenant_id || !action.organization_id) {
      failed += 1;
      await persistExecutionResult({
        // Pre-claim write: only while the row is still 'approved' (never
        // overwrites a row another claimant is executing).
        expectedFromStatuses: ['approved'],
        actionId: action.id,
        organizationId: action.organization_id || 'unknown',
        correlationId: randomUUID(),
        result: { ok: false, status: 'failed', error: 'TENANT_SCOPE_MISSING', response: { source: 'scheduler' } },
        rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
      });
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id || 'unknown',
        organization_id: action.organization_id || 'unknown',
        event_type: 'failed',
        event_payload: { error: 'TENANT_SCOPE_MISSING' },
      });
      continue;
    }

    // ── Policy and approval gates FIRST (LD-7): a refusal here writes one
    // governance refusal record and leaves the row 'approved' (never burned).
    const decision = await getCommunityExecutionPolicy({
      organizationId: action.organization_id,
      tenantId: action.tenant_id,
    });
    const evidence = decision.ok ? evaluateCommunityApprovalEvidence(action) : null;
    const gateCode = !decision.ok ? refusedCode(decision) : evidence && !evidence.ok ? evidenceRefusal(evidence).code : null;
    if (gateCode) {
      await recordCommunityExecutionRefusal({
        actionId: action.id,
        organizationId: action.organization_id,
        tenantId: action.tenant_id,
        claimPoint: 'scheduler',
        code: gateCode,
        payload: { source: 'scheduler' },
      });
      continue;
    }

    if (action.intent_classification?.primary_intent === 'network_expansion') {
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'skipped',
        event_payload: {
          reason: 'PHASE_5B_OBSERVATION_LOCK',
        },
      });
      continue;
    }

    if (!action.playbook_id) {
      failed += 1;
      const failure = { ok: false, status: 'failed' as const, error: 'PLAYBOOK_REQUIRED', response: { source: 'scheduler' } };
      await persistExecutionResult({
        // Pre-claim write: only while the row is still 'approved' (never
        // overwrites a row another claimant is executing).
        expectedFromStatuses: ['approved'],
        actionId: action.id,
        organizationId: action.organization_id,
        correlationId: randomUUID(),
        result: failure,
        rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
      });
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        event_payload: failure,
      });
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Scheduled action failed on ${action.platform}`,
      });
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Scheduled action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
      continue;
    }

    let playbook = null;
    try {
      playbook = await getPlaybookById(
        action.playbook_id,
        action.tenant_id,
        action.organization_id
      );
    } catch (error: any) {
      failed += 1;
      const failure = { ok: false, status: 'failed' as const, error: 'PLAYBOOK_NOT_FOUND', response: { source: 'scheduler' } };
      await persistExecutionResult({
        // Pre-claim write: only while the row is still 'approved' (never
        // overwrites a row another claimant is executing).
        expectedFromStatuses: ['approved'],
        actionId: action.id,
        organizationId: action.organization_id,
        correlationId: randomUUID(),
        result: failure,
        rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
      });
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        event_payload: failure,
      });
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Scheduled action failed on ${action.platform}`,
      });
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Scheduled action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
      continue;
    }

    const historyMetrics = await loadHistoryMetrics(
      action.tenant_id,
      action.organization_id,
      action.playbook_id
    );
    const playbookValidation = validateActionAgainstPlaybook(
      {
        action_type: action.action_type,
        text: action.suggested_text,
        execution_mode: action.execution_mode || 'manual',
        risk_level: action.risk_level,
        intent_classification: action.intent_classification || null,
      },
      playbook,
      historyMetrics
    );
    if (!playbookValidation.allowed) {
      const reason = playbookValidation.reason || 'PLAYBOOK_VIOLATION';
      const skipReasons = new Set([
        'NETWORK_DAILY_LIMIT_EXCEEDED',
        'OUTSIDE_ALLOWED_HOURS',
        'AUTOMATION_LEVEL_OBSERVE',
        'AUTOMATION_LEVEL_ASSIST_LIMIT',
        'AUTOMATION_LEVEL_AUTOMATE_LIMIT',
      ]);
      if (skipReasons.has(reason)) {
        await persistExecutionResult({
          // Pre-claim write: only while the row is still 'approved' (never
          // overwrites a row another claimant is executing).
          expectedFromStatuses: ['approved'],
          actionId: action.id,
          organizationId: action.organization_id,
          correlationId: randomUUID(),
          result: { ok: false, status: 'skipped', reason, response: { source: 'scheduler' } },
          rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
        });
        await logCommunityAiActionEvent({
          action_id: action.id,
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'skipped',
          event_payload: { reason },
        });
        continue;
      }

      failed += 1;
      const failure = {
        ok: false,
        status: 'failed' as const,
        error: reason,
        response: { source: 'scheduler' },
      };
      await persistExecutionResult({
        // Pre-claim write: only while the row is still 'approved' (never
        // overwrites a row another claimant is executing).
        expectedFromStatuses: ['approved'],
        actionId: action.id,
        organizationId: action.organization_id,
        correlationId: randomUUID(),
        result: failure,
        rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
      });
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        event_payload: failure,
      });
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Scheduled action failed on ${action.platform}`,
      });
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Scheduled action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
      continue;
    }

    const executionMode = (action.execution_mode || 'manual').toString().trim().toLowerCase();
    if (executionMode === 'api') {
      let tokenRow: { access_token?: string | null } | null = null;
      try {
        tokenRow = await getToken(
          action.tenant_id,
          action.organization_id,
          (action.platform || '').toString().trim().toLowerCase()
        );
      } catch (error: any) {
        tokenRow = null;
      }
      if (!tokenRow?.access_token) {
        failed += 1;
        const failure = {
          ok: false,
          status: 'failed' as const,
          error: 'Platform not connected',
          response: { source: 'scheduler' },
        };
        await persistExecutionResult({
          // Pre-claim write: only while the row is still 'approved' (never
          // overwrites a row another claimant is executing).
          expectedFromStatuses: ['approved'],
          actionId: action.id,
          organizationId: action.organization_id,
          correlationId: randomUUID(),
          result: failure,
          rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
        });
        await logCommunityAiActionEvent({
          action_id: action.id,
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'failed',
          event_payload: failure,
        });
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Scheduled action failed on ${action.platform}`,
        });
        void sendCommunityAiWebhooks({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'failed',
          action_id: action.id,
          message: `Scheduled action failed on ${action.platform}`,
          metadata: { platform: action.platform, action_type: action.action_type },
        });
        continue;
      }
    }

    const guardrail = await canExecuteAction(
      {
        id: action.id,
        company_id: action.organization_id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        platform: action.platform,
        action_type: action.action_type,
        target_id: action.target_id,
      },
      { source: 'scheduler' }
    );
    if (!guardrail.allowed) {
      // 'skipped_guardrail' is a scheduler-specific status retained for
      // backwards compatibility. Route through persistExecutionResult so the
      // central pipeline owns every row write; the status CHECK still
      // permits the legacy value.
      await persistExecutionResult({
        // Pre-claim write: only while the row is still 'approved' (never
        // overwrites a row another claimant is executing).
        expectedFromStatuses: ['approved'],
        actionId: action.id,
        organizationId: action.organization_id,
        correlationId: randomUUID(),
        result: {
          ok: false,
          status: 'skipped',
          reason: guardrail.reason ?? 'GUARDRAIL',
          response: { source: 'scheduler', guardrail_reason: guardrail.reason ?? null },
        },
        rowHint: { platform: action.platform, action_type: action.action_type, target_id: action.target_id },
      });
      continue;
    }

    // Atomic, tenant-scoped claim BEFORE acting: approved -> executing.
    // A concurrent scheduler, the manual execute route, the orchestration
    // adapter or the RPA retry flush may race for the same row; exactly one
    // wins and every loser does nothing.
    // The claim RPC re-applies policy, evidence and the 7-day lifetime; its
    // refusal leaves the row 'approved' and is recorded there.
    const correlationId = randomUUID();
    const claim = await claimCommunityActionForExecution({
      actionId: action.id,
      tenantId: action.tenant_id,
      organizationId: action.organization_id,
      claimPoint: 'scheduler',
      executionMode: action.execution_mode ?? null,
      correlationId,
    });
    if (!claim.claimed) {
      continue;
    }

    // Executor owns the terminal row write (persist:true). The scheduler
    // simply observes the outcome; notify + webhook fan-out lives inside
    // the executor so every entry point emits identically. The terminal
    // write is compare-and-set from the claimed 'executing' state.
    const result = await executeAction(action, true, {
      notify: true,
      webhook: true,
      source: 'scheduler',
      persist: true,
      correlation_id: correlationId,
      expected_from_statuses: ['executing'],
    });

    if (result.status === 'skipped' && result.reason === 'HUMAN_APPROVAL_REQUIRED') {
      continue;
    }

    const nextStatus =
      result.status === 'skipped' ? 'skipped' : result.ok ? 'executed' : 'failed';
    if (result.ok) executed += 1;
    else if (result.status !== 'skipped') failed += 1;

    // 'deferred' (not acted, queued for retry) and 'uncertain' (review
    // required) are logged under the CHECK-permitted 'failed' event type
    // with the precise status in the payload.
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: nextStatus === 'executed' ? 'executed' : nextStatus === 'skipped' ? 'skipped' : 'failed',
      event_payload: result,
    });
  }

  return { processed: actions.length, executed, failed };
};
