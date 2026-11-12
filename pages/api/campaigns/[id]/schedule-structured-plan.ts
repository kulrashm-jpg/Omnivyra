import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../../backend/services/GovernanceLockdownService';
import { scheduleStructuredPlan, ScheduleEligibilityError } from '../../../../backend/services/structuredPlanScheduler';
import { saveCampaignBlueprintFromLegacy } from '../../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';
import { assertBlueprintActive, assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError, BlueprintMutabilityReadError } from '../../../../backend/services/campaignBlueprintService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../../backend/governance/ExecutionStateMachine';
import { assertSchedulerExecutable, SchedulerIntegrityError } from '../../../../backend/services/SchedulerIntegrityGuard';
import { acquireSchedulerLock, releaseSchedulerLock, SchedulerLockError } from '../../../../backend/services/SchedulerLockService';
import { checkAndCompleteCampaignIfEligible } from '../../../../backend/services/CampaignCompletionService';
import { recordGovernanceEvent } from '../../../../backend/services/GovernanceEventService';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import {
  CreatorScheduleGovernanceError,
  assertCreatorFormatsSchedulable,
  assertNoUnschedulableCreatorDailyPlans,
  getCreatorFormatsFromStructuredPlanWeeks,
} from '../../../../lib/shared/creatorGovernanceRegistry';

const isScheduleEligibilityError = (error: unknown): error is ScheduleEligibilityError => {
  return typeof ScheduleEligibilityError === 'function' && error instanceof ScheduleEligibilityError;
};

/** The campaign's company, CHECKED: a failed read is reported, never "no company". */
async function readCompanyId(campaignId: string): Promise<{ companyId: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (error) return { companyId: null, error };
  return { companyId: (data as any)?.company_id ?? null, error: null };
}

/**
 * best-effort(audit): the company for a governance event on an ERROR path (finalized / lock /
 * integrity / freeze). The response is already decided there; a failed read only loses the event,
 * so it is logged at ERROR, never thrown (e9: audit after the outcome is B with an ERROR log).
 */
async function getCompanyId(campaignId: string): Promise<string | null> {
  const r = await readCompanyId(campaignId);
  if (r.error) {
    console.error('[schedule-structured-plan] company lookup failed; governance event not recorded', { campaignId, message: r.error.message });
  }
  return r.companyId;
}

async function getCampaignVersionContext(campaignId: string): Promise<{
  companyId: string | null;
  executionProfile: string;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id, campaign_snapshot')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed read must not default the profile to 'text': that SKIPS the creator governance gate.
  if (error) return { companyId: null, executionProfile: '', error };
  const snapshot = (data as any)?.campaign_snapshot ?? {};
  const executionConfig = snapshot.execution_config ?? snapshot.executionConfig ?? {};
  return {
    companyId: (data as any)?.company_id ?? null,
    executionProfile: String(executionConfig.campaign_mode || executionConfig.campaignMode || 'text').trim().toLowerCase(),
    error: null,
  };
}

function sendCreatorGovernanceError(res: NextApiResponse, error: CreatorScheduleGovernanceError) {
  return res.status(error.statusCode).json(error.payload);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (await isGovernanceLocked()) {
    return res.status(423).json({
      code: 'GOVERNANCE_LOCKED',
      message: 'Governance lockdown active. Mutations disabled.',
    });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  // SECURITY: enforce caller has access to this campaign's company before
  // any mutation, lock acquisition, or governance event is recorded.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  const { plan } = req.body || {};
  if (!plan || !Array.isArray(plan.weeks)) {
    return res.status(400).json({ error: 'Structured plan is required' });
  }

  const versionContext = await getCampaignVersionContext(id);
  if (versionContext.error) {
    console.error('[schedule-structured-plan] version context unreadable; refusing to schedule without the governance gate', { campaignId: id, message: versionContext.error.message });
    return res.status(503).json({
      code: 'CAMPAIGN_VERSION_READ_FAILED',
      message: 'Could not read the campaign version to check scheduling rules. Nothing was scheduled. Please try again.',
    });
  }
  if (versionContext.executionProfile === 'creator') {
    try {
      assertCreatorFormatsSchedulable(getCreatorFormatsFromStructuredPlanWeeks(plan.weeks));
      const { data: dailyPlansForGovernance, error: dailyPlansGovernanceError } = await supabase
        .from('daily_content_plans')
        .select('content_type')
        .eq('campaign_id', id);
      if (dailyPlansGovernanceError) {
        return res.status(500).json({
          success: false,
          error: 'Failed to validate creator schedule governance.',
        });
      }
      assertNoUnschedulableCreatorDailyPlans(Array.isArray(dailyPlansForGovernance) ? dailyPlansForGovernance : []);
    } catch (error) {
      if (error instanceof CreatorScheduleGovernanceError) {
        return sendCreatorGovernanceError(res, error);
      }
      throw error;
    }
  }

  let lockId: string | null = null;
  try {
    await assertBlueprintMutable(id);
    await assertBlueprintActive(id);

    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('execution_status, blueprint_status, duration_locked')
      .eq('id', id)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const executionStatus = normalizeExecutionState((campaign as any).execution_status);
    try {
      assertCampaignNotFinalized(executionStatus);
    } catch (err: any) {
      if (err instanceof CampaignFinalizedError) {
        const companyIdForErr = await getCompanyId(id);
        if (companyIdForErr) {
          await recordGovernanceEvent({
            companyId: companyIdForErr,
            campaignId: id,
            eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
            eventStatus: 'BLOCKED',
            metadata: { campaignId: id, execution_status: executionStatus },
          });
        }
        return res.status(409).json({
          code: 'CAMPAIGN_FINALIZED',
          message: 'Campaign is finalized and cannot be modified',
        });
      }
      throw err;
    }

    assertSchedulerExecutable(campaign);

    // CHECKED before the lock: a failed read used to make companyId null and SILENTLY skip every
    // governance event of the run (lock acquired, started, completed) and the version-stage sync.
    const companyRead = await readCompanyId(id);
    if (companyRead.error) {
      console.error('[schedule-structured-plan] company lookup failed before scheduling', { campaignId: id, message: companyRead.error.message });
      return res.status(503).json({
        code: 'CAMPAIGN_COMPANY_READ_FAILED',
        message: 'Could not read the campaign\'s company. Nothing was scheduled. Please try again.',
      });
    }
    const companyId = companyRead.companyId;

    lockId = await acquireSchedulerLock(id);
    if (companyId) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULER_LOCK_ACQUIRED',
        eventStatus: 'ACQUIRED',
        metadata: { campaignId: id, lockId },
      });
    }

    if (companyId) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULE_STARTED',
        eventStatus: 'STARTED',
        metadata: {
          campaignId: id,
          execution_status: (campaign as any).execution_status,
          blueprint_status: (campaign as any).blueprint_status,
          duration_locked: (campaign as any).duration_locked,
        },
        evaluationContext: {
          execution_status: (campaign as any).execution_status,
          blueprint_status: (campaign as any).blueprint_status,
          duration_locked: (campaign as any).duration_locked,
        },
      });
    }

    // Persist the committed plan to campaign_week_plan so it appears in "Load committed plan" and retrieve-plan
    const blueprint = fromStructuredPlan({ weeks: plan.weeks, campaign_id: id });
    try {
      await saveCampaignBlueprintFromLegacy({ campaignId: id, blueprint, source: 'schedule-structured-plan' });
    } catch (persistErr) {
      // Scheduling should still proceed even if the "committed plan" persistence fails.
      console.warn('[schedule-structured-plan] Failed to persist committed blueprint, continuing:', persistErr);
    }

    const result = await scheduleStructuredPlan(plan, id);

    // Update campaign status to reflect committed/scheduled state. The old try/catch could not see
    // a PostgREST error (it is returned, never thrown), so a failure was invisible. The posts ARE
    // scheduled by now and will publish (the publish path does not read campaigns.status), and
    // scheduleStructuredPlan is not idempotent: a 500 here would invite the user to schedule AGAIN
    // and duplicate every post. So the idempotent write is retried once, and a persistent failure is
    // reported in the 200 body (`activation.ok: false`) and logged at ERROR: visible, without
    // inviting a duplicate schedule. (Disposition put to e9, 2026-11-12.)
    const activate = () => supabase
      .from('campaigns')
      .update({
        status: 'active',
        current_stage: 'schedule',
        blueprint_status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    let { error: activateError } = await activate();
    if (activateError) ({ error: activateError } = await activate());
    if (activateError) {
      console.error('[schedule-structured-plan] campaign activation failed AFTER scheduling (posts are scheduled)', { campaignId: id, message: activateError.message, scheduled_count: result.scheduled_count });
    }
    const activation = activateError
      ? { ok: false as const, code: 'CAMPAIGN_ACTIVATION_FAILED' }
      : { ok: true as const };

    void checkAndCompleteCampaignIfEligible(id).catch(() => {});
    void syncCampaignVersionStage(id, 'schedule', companyId).catch(() => {});

    if (companyId) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULE_COMPLETED',
        eventStatus: 'COMPLETED',
        metadata: {
          campaignId: id,
          execution_status: (campaign as any).execution_status,
          blueprint_status: (campaign as any).blueprint_status,
          duration_locked: (campaign as any).duration_locked,
          scheduled_count: result.scheduled_count,
        },
        evaluationContext: {
          execution_status: (campaign as any).execution_status,
          blueprint_status: (campaign as any).blueprint_status,
          duration_locked: (campaign as any).duration_locked,
        },
      });
    }

    return res.status(200).json({ ...result, activation });
  } catch (error: any) {
    // The guard could not READ the blueprint state. That is not a policy
    // verdict (409) and not a server bug (500): it is retryable, and nothing
    // was mutated.
    if (error instanceof BlueprintMutabilityReadError) {
      return res.status(503).json({
        code: 'BLUEPRINT_STATE_READ_FAILED',
        message: 'Blueprint state could not be read. Try again shortly.',
      });
    }
    const companyId = await getCompanyId(id);
    const { data: camp } = await supabase
      .from('campaigns')
      .select('execution_status, blueprint_status, duration_locked')
      .eq('id', id)
      .maybeSingle();

    if (error instanceof SchedulerLockError) {
      if (companyId) {
        await recordGovernanceEvent({
          companyId,
          campaignId: id,
          eventType: 'SCHEDULER_LOCK_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId: id, code: error.code },
        });
      }
      return res.status(409).json({
        code: 'SCHEDULER_ALREADY_RUNNING',
        message: 'Scheduler execution already in progress',
      });
    }
    if (error instanceof SchedulerIntegrityError) {
      if (companyId) {
        await recordGovernanceEvent({
          companyId,
          campaignId: id,
          eventType: 'SCHEDULE_ABORTED',
          eventStatus: 'ABORTED',
          metadata: {
            campaignId: id,
            execution_status: (camp as any)?.execution_status,
            blueprint_status: (camp as any)?.blueprint_status,
            duration_locked: (camp as any)?.duration_locked,
            reason: error.code,
          },
        });
      }
      return res.status(409).json({
        code: error.code,
        message: 'Scheduler integrity check failed',
      });
    }
    if (isScheduleEligibilityError(error)) {
      return res.status(409).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    if (error instanceof BlueprintExecutionFreezeError) {
      const { data: cv } = await supabase
        .from('campaign_versions')
        .select('company_id')
        .eq('campaign_id', id)
        .limit(1)
        .maybeSingle();
      const companyId = (cv as any)?.company_id ?? id;
      await recordGovernanceEvent({
        companyId: String(companyId),
        campaignId: id,
        eventType: 'BLUEPRINT_FREEZE_BLOCKED',
        eventStatus: 'BLOCKED',
        metadata: {
          campaignId: id,
          hoursUntilExecution: error.hoursUntilExecution,
          freezeWindowHours: error.freezeWindowHours,
        },
      });
      return res.status(409).json({
        code: 'EXECUTION_WINDOW_FROZEN',
        message: 'Blueprint modifications are locked within 24 hours of execution.',
      });
    }
    if (error instanceof BlueprintImmutableError) {
      const { data: cv } = await supabase
        .from('campaign_versions')
        .select('company_id')
        .eq('campaign_id', id)
        .limit(1)
        .maybeSingle();
      const companyId = (cv as any)?.company_id ?? id;
      const { data: camp } = await supabase
        .from('campaigns')
        .select('execution_status, blueprint_status')
        .eq('id', id)
        .maybeSingle();
      await recordGovernanceEvent({
        companyId: String(companyId),
        campaignId: id,
        eventType: 'BLUEPRINT_MUTATION_BLOCKED',
        eventStatus: 'BLOCKED',
        metadata: {
          campaignId: id,
          execution_status: (camp as any)?.execution_status ?? 'ACTIVE',
          blueprint_status: (camp as any)?.blueprint_status ?? 'ACTIVE',
        },
      });
      return res.status(409).json({
        code: 'BLUEPRINT_IMMUTABLE',
        message: 'Blueprint cannot be modified while campaign is in execution.',
      });
    }
    if (companyId && camp) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULE_ABORTED',
        eventStatus: 'ABORTED',
        metadata: {
          campaignId: id,
          execution_status: (camp as any)?.execution_status,
          blueprint_status: (camp as any)?.blueprint_status,
          duration_locked: (camp as any)?.duration_locked,
          reason: error?.message ?? 'unknown',
        },
      });
    }
    console.error('Error scheduling structured plan:', error);
    return res.status(500).json({ error: 'Failed to schedule structured plan' });
  } finally {
    if (lockId) {
      await releaseSchedulerLock(id, lockId);
      const companyId = await getCompanyId(id);
      if (companyId) {
        await recordGovernanceEvent({
          companyId,
          campaignId: id,
          eventType: 'SCHEDULER_LOCK_RELEASED',
          eventStatus: 'RELEASED',
          metadata: { campaignId: id, lockId },
        });
      }
    }
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(withIdempotency(handler, { scope: 'campaigns-schedule-structured-plan' }), { route: '/api/campaigns/:id/schedule-structured-plan' });
