import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * PI-036 — the Execution Plan for one run.
 *
 *   GET  /api/execution-instances/:id/plan?company_id=<uuid>
 *        -> { plan, steps, tasks }
 *   POST /api/execution-instances/:id/plan
 *        -> { plan, steps, tasks }     materializes the plan for that run
 *
 * ─── THE INSTANCE IS A PATH PARENT, AND IT IS BOUND ───────────────────────
 * Same shape 033 and 034 settled on: the run is identified by the path, and
 * `getExecutionInstance(companyId, instanceId)` is tenant-scoped, so another
 * tenant's run answers 404 — the same answer as one that does not exist, which is
 * the point. The creation function re-checks and stays authoritative.
 *
 * ─── THE BODY CARRIES NOTHING ─────────────────────────────────────────────
 * POST takes no parameters at all, deliberately. The pinned Workflow Version, the
 * step content, the channel intent and the delays all come from the version the
 * instance already pinned. A caller cannot supply a version, a workflow, steps,
 * a channel, a delay or a subject: every one of those would be a way to make a
 * historical run claim something it did not do.
 *
 * ─── REPEATING THE POST IS REFUSED BY THE DATABASE ────────────────────────
 * `execution_plans_instance_unique` makes a second plan for one run
 * unrepresentable, so a repeat is a constraint violation surfaced as 409
 * `plan_exists` — not a read-then-write check, which two concurrent callers could
 * both pass. Concurrency is settled by the constraint and by the row lock the
 * creation function takes on the run.
 *
 * ─── MATERIALIZING A PLAN EXECUTES NOTHING ────────────────────────────────
 * It records what the run will do. Nothing is scheduled, nothing is dispatched, no
 * provider is called, no attempt or outcome is created, and no permission to
 * contact anyone is conferred — `mayContact` and
 * `kill_switch → suppression → region → approval → rate_limit → transport`
 * remain authoritative and untouched. A task's `requires_approval` is a
 * REQUIREMENT carried forward, never a grant.
 *
 * ─── AUTHORIZATION: THE SAME INTERIM BOUNDARY, UNCHANGED ──────────────────
 * `PROSPECT_ICP_MANAGE`. 036 adds no capability and does not touch the registry.
 * The widening 032 recorded and 034 restated extends to this route: holders of
 * `PROSPECT_ICP_MANAGE` — COMPANY_ADMIN and above — can also materialize an
 * execution plan. That stands until a dedicated execution capability is ratified.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { getExecutionInstance } from '../../../../backend/services/executionInstances/executionInstanceStore';
import {
  createExecutionPlan, getPlanForInstance, listPlanSteps, listInstanceTasks,
  ExecutionPlanError,
} from '../../../../backend/services/executionPlans/executionPlanStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

const statusFor = (code: string): number => {
  if (code === 'plan_exists') return 409;
  if (code === 'instance_terminal') return 409;
  if (code === 'instance_not_found' || code === 'pinned_version_missing') return 404;
  if (code === 'definition_has_no_steps') return 422;
  return 400;
};

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
    reason: 'read or materialize the execution plan for a workflow run',
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
        plan,
        steps: await listPlanSteps(companyId, plan.id),
        tasks: await listInstanceTasks(companyId, instanceId),
      });
    }

    const plan = await createExecutionPlan({
      organizationId: companyId,        // the VERIFIED tenant, never the body's
      executionInstanceId: instanceId,  // the BOUND run, from the path
    });
    return res.status(201).json({
      plan,
      steps: await listPlanSteps(companyId, plan.id),
      tasks: await listInstanceTasks(companyId, instanceId),
    });
  } catch (e) {
    if (e instanceof ExecutionPlanError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'execution plan request failed' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/execution-instances/[id]/plan',
});
