/**
 * Campaign enrollment — selected campaign targets → individual journeys.
 *
 * For every DISTINCT prospect among a campaign's targets (optionally one selection
 * occurrence), against one workflow:
 *
 *   1. an occupied journey for (campaign, workflow, prospect) already exists →
 *      `already_enrolled` (never a second journey);
 *   2. the workflow's current published version's ENROLLMENT CONDITIONS are
 *      evaluated against the person's facts → ineligible people are excluded with
 *      their reasons (enrollment.ts — the same rules the single-enrollment route
 *      applies);
 *   3. otherwise the journey is created through the EXISTING store, which pins
 *      the published version in the database and links the target
 *      (`create_execution_instance`), and its plan is materialized — both
 *      idempotent, so a repeated or concurrent run converges.
 *
 * A prospect selected from two lists is one person: the earliest target is used.
 * No journey is ever created other than through the instance store, whose partial
 * unique index stays the final authority on duplicates.
 *
 * PREVIEW (`dryRun`): the population, who would be enrolled, who is already
 * enrolled and every exclusion reason — nothing written.
 *
 * It enables nothing: a created journey still meets every engine gate at every
 * step, and WS-3 actions still need human approval.
 */

import { getProspectCampaign } from '../prospectCampaigns/prospectCampaignStore';
import { listCampaignTargets, type CampaignTarget } from '../prospectCampaigns/campaignTargetStore';
import {
  createExecutionInstance, getOccupiedExecutionInstance, ExecutionInstanceError,
} from '../executionInstances/executionInstanceStore';
import { createExecutionPlan, getPlanForInstance } from '../executionPlans/executionPlanStore';
import { checkEnrollmentEligibility } from './enrollment';
import type { IndividualIntelligencePort } from './individualIntelligence';

export class CampaignEnrollmentError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CampaignEnrollmentError';
  }
}

function fail(message: string, code: string): never {
  throw new CampaignEnrollmentError(message, code);
}

export interface CampaignEnrollmentReport {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly workflowId: string;
  /** The workflow version people were assessed against (and journeys pin). */
  readonly workflowVersionId: string | null;
  readonly dryRun: boolean;
  readonly targets: number;
  /** Distinct prospects among those targets. */
  readonly population: number;
  readonly enrolled: number;
  readonly wouldEnroll: number;
  readonly alreadyEnrolled: number;
  readonly excluded: number;
  /** Exclusion reason → count (descriptions only; never a value about a person). */
  readonly exclusionReasons: Record<string, number>;
  /** Journeys created this run that pinned a different version than assessed (published mid-run). */
  readonly versionChangedDuringRun: number;
  readonly outcomes: ReadonlyArray<{ prospectId: string; targetId: string; outcome: 'enrolled' | 'would_enroll' | 'already_enrolled' | 'excluded'; instanceId: string | null; reasons: readonly string[] }>;
}

const MAX_OUTCOMES = 500;

export async function enrollCampaignTargets(input: {
  organizationId: string;
  campaignId: string;
  workflowId: string;
  /** Limit to one selection occurrence (`origin:key`); all targets otherwise. */
  selectionEventKey?: string;
  dryRun?: boolean;
  now?: string;
  intelligence?: IndividualIntelligencePort;
}): Promise<CampaignEnrollmentReport> {
  const dryRun = input.dryRun === true;
  const campaign = await getProspectCampaign(input.organizationId, input.campaignId);
  if (!campaign) fail('no such campaign in this tenant', 'campaign_not_found');
  if (campaign.status === 'archived') fail('an archived campaign enrolls no one', 'campaign_archived');

  const targets = await listCampaignTargets(input.organizationId, input.campaignId,
    input.selectionEventKey ? { selectionEventKey: input.selectionEventKey } : {});

  // One person, one journey: the earliest target per prospect.
  const byProspect = new Map<string, CampaignTarget>();
  for (const t of targets) if (!byProspect.has(t.prospectId)) byProspect.set(t.prospectId, t);

  let workflowVersionId: string | null = null;
  let enrolled = 0;
  let wouldEnroll = 0;
  let alreadyEnrolled = 0;
  let excluded = 0;
  let versionChangedDuringRun = 0;
  const exclusionReasons: Record<string, number> = {};
  const outcomes: Array<CampaignEnrollmentReport['outcomes'][number]> = [];
  const record = (o: CampaignEnrollmentReport['outcomes'][number]) => { if (outcomes.length < MAX_OUTCOMES) outcomes.push(o); };

  for (const [prospectId, target] of byProspect) {
    const occupied = await getOccupiedExecutionInstance(input.organizationId, input.campaignId, input.workflowId, 'prospect', prospectId);
    if (occupied) {
      alreadyEnrolled += 1;
      record({ prospectId, targetId: target.id, outcome: 'already_enrolled', instanceId: occupied.id, reasons: [] });
      continue;
    }

    const verdict = await checkEnrollmentEligibility({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      subject: { kind: 'prospect', id: prospectId },
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.intelligence === undefined ? {} : { intelligence: input.intelligence }),
    });
    workflowVersionId = workflowVersionId ?? verdict.assessedVersionId;
    if (!verdict.eligible) {
      excluded += 1;
      for (const reason of verdict.reasons.length ? verdict.reasons : ['not eligible']) {
        exclusionReasons[reason] = (exclusionReasons[reason] ?? 0) + 1;
      }
      record({ prospectId, targetId: target.id, outcome: 'excluded', instanceId: null, reasons: verdict.reasons });
      continue;
    }

    if (dryRun) {
      wouldEnroll += 1;
      record({ prospectId, targetId: target.id, outcome: 'would_enroll', instanceId: null, reasons: [] });
      continue;
    }

    let instanceId: string;
    try {
      const instance = await createExecutionInstance({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        workflowId: input.workflowId,
        subjectKind: 'prospect',
        subjectId: prospectId,
        targetId: target.id,
      });
      instanceId = instance.id;
      if (verdict.assessedVersionId !== null && instance.workflowVersionId !== verdict.assessedVersionId) versionChangedDuringRun += 1;
    } catch (e) {
      if (e instanceof ExecutionInstanceError && e.code === 'already_active') {
        // A concurrent run enrolled them first; the unique index held.
        const winner = await getOccupiedExecutionInstance(input.organizationId, input.campaignId, input.workflowId, 'prospect', prospectId);
        alreadyEnrolled += 1;
        record({ prospectId, targetId: target.id, outcome: 'already_enrolled', instanceId: winner?.id ?? null, reasons: [] });
        continue;
      }
      throw e;
    }

    // Materialize the plan so the journey can progress; a plan that already
    // exists (a retry, or a concurrent run) is the same plan.
    try {
      await createExecutionPlan({ organizationId: input.organizationId, executionInstanceId: instanceId });
    } catch (e) {
      const code = String((e as { code?: string } | null)?.code ?? '');
      if (code !== 'plan_exists' || (await getPlanForInstance(input.organizationId, instanceId)) === null) throw e;
    }
    enrolled += 1;
    record({ prospectId, targetId: target.id, outcome: 'enrolled', instanceId, reasons: [] });
  }

  return {
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    workflowId: input.workflowId,
    workflowVersionId,
    dryRun,
    targets: targets.length,
    population: byProspect.size,
    enrolled,
    wouldEnroll,
    alreadyEnrolled,
    excluded,
    exclusionReasons,
    versionChangedDuringRun,
    outcomes,
  };
}
