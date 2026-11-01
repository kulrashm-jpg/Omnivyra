import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * PI-040 — the Outreach Bridge for one run.
 *
 *   GET  /api/execution-instances/:id/outreach-bridge?company_id=<uuid>
 *        -> { handoffs }
 *   POST /api/execution-instances/:id/outreach-bridge
 *        { executionTaskId }   -> { handoff, replayed }
 *
 * ONE canonical bridge endpoint. It sits under the run that owns the task, which
 * is where 036's plan route and 037's progression route already live, so the
 * tenant and the run are bound once, in the same way, for all three.
 *
 * ─── THE RUN IS A PATH PARENT, AND THE TASK IS CHECKED AGAINST IT ──────────
 * `getExecutionInstance(companyId, instanceId)` is tenant-scoped, so another
 * tenant's run answers 404. The store then resolves the task within the same
 * tenant, and the database function re-checks and stays authoritative.
 *
 * ─── IDEMPOTENT BY CONSTRUCTION ───────────────────────────────────────────
 * POST returns the EXISTING handoff with `replayed: true` rather than erroring,
 * because a retry of a handoff is not a conflict — it is the same handoff. The
 * guarantee is the database's `outreach_bridge_handoffs_task_unique`, not a
 * pre-check, so two concurrent callers produce one legacy task and the loser
 * reads the winner's row.
 *
 * There is deliberately no `Idempotency-Key` here. 034 needed one because
 * invocation had no durable identity of its own; a bridge does — the
 * `execution_task_id` IS the identity, and adding a second key would create two
 * answers to "is this the same handoff?".
 *
 * ─── THE BRIDGE DISPATCHES NOTHING ────────────────────────────────────────
 * It creates one legacy Outreach task and one mapping. Governance, approval,
 * quota and transport all run afterwards in the existing engine; no provider is
 * called from here, and `mayContact` plus
 * `kill_switch → suppression → region → eligibility/approval → rate_limit →
 * transport` remain authoritative and untouched. An `autonomous` step means no
 * per-action human approval was required by the Workflow — never that this
 * person may be contacted.
 *
 * ─── AUTHORIZATION: THE SAME INTERIM BOUNDARY, UNCHANGED ──────────────────
 * `PROSPECT_ICP_MANAGE`. 040 adds no capability and does not touch the registry.
 * The widening 032 recorded and 034/036/037 carried forward extends here:
 * holders of `PROSPECT_ICP_MANAGE` can also hand a prepared task to Outreach.
 * That stands until a dedicated execution capability is ratified.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { getExecutionInstance } from '../../../../backend/services/executionInstances/executionInstanceStore';
import {
  bridgeExecutionTask, listInstanceHandoffs, OutreachBridgeError,
} from '../../../../backend/services/outreachBridge/outreachBridgeStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

const statusFor = (code: string): number => {
  if (code === 'task_not_found' || code === 'plan_not_found') return 404;
  if (code === 'channel_unsupported') return 422;
  if (code === 'person_unresolved') return 422;
  if (code === 'task_not_prepared' || code === 'run_not_executable') return 409;
  if (code === 'already_bridged' || code === 'legacy_claimed') return 409;
  if (code === 'malformed_snapshot' || code === 'invalid_linkage'
      || code === 'invalid_policy' || code === 'attribution_mismatch') return 422;
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
    reason: 'hand a prepared execution task to the outreach engine',
  });
  // `ok !== true`, not `!ok`: `{ ok:false, sent:true }` is truthy and the root
  // tsconfig sets `strict: false`, disabling narrowing on a negated boolean.
  if (guard.ok !== true) return;

  // THE BIND. Tenant-scoped, so another tenant's run is a 404.
  const instance = await getExecutionInstance(companyId, instanceId);
  if (!instance) return res.status(404).json({ error: 'no such execution instance' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({
        handoffs: await listInstanceHandoffs(companyId, instanceId),
      });
    }

    const executionTaskId = str(body.executionTaskId);
    if (!executionTaskId || !UUID.test(executionTaskId)) {
      return res.status(400).json({ error: 'executionTaskId must be a uuid' });
    }

    const { handoff, replayed } = await bridgeExecutionTask({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      executionTaskId,
    });
    // The task must belong to the BOUND run. Checked after the handoff resolves
    // so a cross-run id cannot be used to probe another run's tasks: the store
    // already refused anything outside this tenant.
    if (handoff.executionInstanceId !== instanceId) {
      return res.status(404).json({ error: 'no such execution task for this run' });
    }
    return res.status(replayed ? 200 : 201).json({ handoff, replayed });
  } catch (e) {
    if (e instanceof OutreachBridgeError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'outreach bridge request failed' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/execution-instances/[id]/outreach-bridge',
});
