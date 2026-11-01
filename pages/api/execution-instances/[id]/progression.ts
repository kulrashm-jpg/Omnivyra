import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * PI-037 — Workflow progression for one run.
 *
 *   GET   /api/execution-instances/:id/progression?company_id=<uuid>
 *         -> { instance, plan, steps, readyStep }
 *   POST  /api/execution-instances/:id/progression
 *         { action: 'advance' | 'cancel' }        -> { advanced | cancelledSteps, ... }
 *   PATCH /api/execution-instances/:id/progression
 *         { stepId, state }                       -> { step }
 *
 * ─── WHY THIS IS A NEW ROUTE AND NOT AN EDIT TO 036's ─────────────────────
 * `[id]/plan.ts` is a frozen 036 artefact. Folding progression into it would have
 * meant changing a certified file for convenience, so progression got its own
 * sub-resource under the same bound parent instead. Nothing frozen was touched.
 *
 * ─── THE RUN IS A PATH PARENT, AND IT IS BOUND ────────────────────────────
 * `getExecutionInstance(companyId, instanceId)` is tenant-scoped, so another
 * tenant's run answers 404 — the same answer as one that does not exist. The
 * database functions re-check and stay authoritative.
 *
 * ─── ADVANCE IS A POLL, NOT A COMMAND ─────────────────────────────────────
 * POST `advance` asks "is anything due?". It is idempotent: it makes at most the
 * one eligible step `ready` and returns how many it moved, so calling it twice
 * converges rather than skipping ahead. A paused or finished run answers 0 instead
 * of erroring, because polling a paused run is a normal thing to do.
 *
 * ─── PATCH RECORDS AN OUTCOME; IT DOES NOT PRODUCE ONE ────────────────────
 * The caller asserts what happened to a step. This route never infers completion —
 * 036 prepared every task when the plan was materialized, so treating that as
 * completion would fabricate success for work that never ran. The transition graph
 * is enforced in the database either way.
 *
 * ─── READINESS IS NOT PERMISSION ──────────────────────────────────────────
 * Nothing here dispatches, schedules, enqueues or contacts a provider, and nothing
 * marks a task sent or delivered. `mayContact` and
 * `kill_switch → suppression → region → approval → rate_limit → transport`
 * remain authoritative and untouched. A step may be `ready` while Outreach later
 * refuses to send: that is the expected shape, not a conflict.
 *
 * ─── AUTHORIZATION: THE SAME INTERIM BOUNDARY, UNCHANGED ──────────────────
 * `PROSPECT_ICP_MANAGE`. 037 adds no capability and does not touch the registry.
 * The widening 032 recorded, 034 restated and 036 carried forward extends here:
 * holders of `PROSPECT_ICP_MANAGE` can also advance and cancel a run. That stands
 * until a dedicated execution capability is ratified.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { getExecutionInstance } from '../../../../backend/services/executionInstances/executionInstanceStore';
import { getPlanForInstance } from '../../../../backend/services/executionPlans/executionPlanStore';
import {
  advanceExecutionRun, transitionPlanStep,
  listProgressionSteps, getReadyStep, StepProgressionError,
  STEP_STATES, type StepState,
} from '../../../../backend/services/workflowExecution/stepProgressionStore';
import { listJourneyDecisions, recordJourneyDecisions, type JourneyDecisionInput } from '../../../../backend/services/orchestration/journeyDecisionLog';
import { exitJourney } from '../../../../backend/services/orchestration/journeyExit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST', 'PATCH'];
const ACTIONS = ['advance', 'cancel'];

const statusFor = (code: string): number => {
  if (code === 'instance_terminal' || code === 'already_settled') return 409;
  if (code === 'invalid_transition') return 409;
  if (code === 'instance_not_found') return 404;
  if (code === 'no_plan' || code === 'plan_not_ready') return 409;
  return 400;
};

/** Records who settled what. True means the action stands with no record of it, and the caller is told. */
async function recordPersonDecision(companyId: string, actorUserId: unknown, d: JourneyDecisionInput): Promise<boolean> {
  const recorded = await recordJourneyDecisions(companyId, [{ ...d, reasons: [`actor:${String(actorUserId)}`] }]);
  return recorded.failed > 0;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const instanceId = str(req.query.id);
  if (!instanceId || !UUID.test(instanceId)) {
    return res.status(400).json({ error: 'instance id must be a uuid' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'read or advance the workflow progression of an execution run',
  });
  // `ok !== true`, not `!ok`: `{ ok:false, sent:true }` is truthy and the root
  // tsconfig sets `strict: false`, disabling narrowing on a negated boolean.
  if (guard.ok !== true) return;

  // THE BIND. Tenant-scoped, so another tenant's run is a 404.
  const instance = await getExecutionInstance(companyId, instanceId);
  if (!instance) return res.status(404).json({ error: 'no such execution instance' });

  try {
    if (req.method === 'GET') {
      const plan = await getPlanForInstance(companyId, instanceId);
      if (!plan) return res.status(404).json({ error: 'that run has no plan yet' });
      return res.status(200).json({
        instance,
        plan,
        steps: await listProgressionSteps(companyId, plan.id),
        readyStep: await getReadyStep(companyId, plan.id),
        decisions: await listJourneyDecisions(companyId, instanceId),
      });
    }

    if (req.method === 'PATCH') {
      const stepId = str(body.stepId);
      const state = str(body.state);
      if (!stepId || !UUID.test(stepId)) {
        return res.status(400).json({ error: 'stepId must be a uuid' });
      }
      if (!state || !STEP_STATES.includes(state as StepState)) {
        return res.status(400).json({
          error: `state must be one of ${STEP_STATES.join(' | ')}`,
        });
      }
      // THE SECOND BIND. The store scopes by tenant only, so a step of another run in
      // this tenant would otherwise be movable through this run's path.
      const plan = await getPlanForInstance(companyId, instanceId);
      const belongs = plan === null ? undefined : (await listProgressionSteps(companyId, plan.id)).find((s) => s.id === stepId);
      if (!belongs) return res.status(404).json({ error: 'no such step in this run' });
      const step = await transitionPlanStep({
        organizationId: companyId,            // the VERIFIED tenant, never the body's
        stepId,
        state: state as StepState,
      });
      if (!step) return res.status(409).json({ error: 'that step moved concurrently' });
      const settled = await recordPersonDecision(companyId, guard.principal.userId, {
        executionInstanceId: instanceId, planStepId: step.id, stepKey: step.stepKey, channel: step.channel, engine: null,
        decision: step.state === 'completed' ? 'executed' : 'skipped', outcome: `human_${step.state}`, reasons: [],
      });
      return res.status(200).json({ step, auditFailed: settled });
    }

    const action = str(body.action);
    if (!action || !ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of ${ACTIONS.join(' | ')}` });
    }

    if (action === 'cancel') {
      // The BOUND run, from the path. Also withdraws what has not started sending: a run
      // a person cancelled must not leave a task someone can still approve and send.
      const cancelledSteps = await exitJourney(companyId, instanceId);
      const auditFailed = await recordPersonDecision(companyId, guard.principal.userId, {
        executionInstanceId: instanceId, planStepId: null, stepKey: null, channel: null, engine: null,
        decision: 'exited', outcome: 'cancelled_by_person', reasons: [],
      });
      return res.status(200).json({
        cancelledSteps,
        auditFailed,
        instance: await getExecutionInstance(companyId, instanceId),
      });
    }

    const advanced = await advanceExecutionRun({
      organizationId: companyId,
      executionInstanceId: instanceId,
    });
    const plan = await getPlanForInstance(companyId, instanceId);
    return res.status(200).json({
      advanced,
      instance: await getExecutionInstance(companyId, instanceId),
      readyStep: plan ? await getReadyStep(companyId, plan.id) : null,
    });
  } catch (e) {
    if (e instanceof StepProgressionError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'progression request failed' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/execution-instances/[id]/progression',
});
