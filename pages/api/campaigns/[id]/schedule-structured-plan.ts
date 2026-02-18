import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../../backend/services/GovernanceLockdownService';
import { scheduleStructuredPlan } from '../../../../backend/services/structuredPlanScheduler';
import { saveCampaignBlueprintFromLegacy } from '../../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';
import { assertBlueprintActive, assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../../backend/services/campaignBlueprintService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../../backend/governance/ExecutionStateMachine';
import { assertSchedulerExecutable, SchedulerIntegrityError } from '../../../../backend/services/SchedulerIntegrityGuard';
import { acquireSchedulerLock, releaseSchedulerLock, SchedulerLockError } from '../../../../backend/services/SchedulerLockService';
import { checkAndCompleteCampaignIfEligible } from '../../../../backend/services/CampaignCompletionService';
import { recordGovernanceEvent } from '../../../../backend/services/GovernanceEventService';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  return (data as any)?.company_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const { plan } = req.body || {};
  if (!plan || !Array.isArray(plan.weeks)) {
    return res.status(400).json({ error: 'Structured plan is required' });
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

    const companyId = await getCompanyId(id);

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

    // Persist the committed plan to twelve_week_plan so it appears in "Load committed plan" and retrieve-plan
    const blueprint = fromStructuredPlan({ weeks: plan.weeks, campaign_id: id });
    await saveCampaignBlueprintFromLegacy({ campaignId: id, blueprint, source: 'schedule-structured-plan' });

    const result = await scheduleStructuredPlan(plan, id);

    // Update campaign status to reflect committed/scheduled state
    await supabase
      .from('campaigns')
      .update({
        status: 'active',
        current_stage: 'schedule',
        blueprint_status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

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

    return res.status(200).json(result);
  } catch (error: any) {
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
