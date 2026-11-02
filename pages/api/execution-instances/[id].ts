import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PI-033 — one Execution Instance.
 *
 *   GET   /api/execution-instances/:id?company_id=<uuid>      -> { instance }
 *   PATCH /api/execution-instances/:id  { lifecycleState }    -> { instance }
 *
 * ─── PATCH MOVES LIFECYCLE STATE AND NOTHING ELSE ─────────────────────────
 * Identity and pinned attribution — campaign, workflow, workflow version, target,
 * subject — are immutable after creation, enforced by a database trigger. There is
 * nothing else here to edit.
 *
 * A TERMINAL instance cannot be reopened: `completed`, `cancelled` and `failed` are
 * final, and a whole-run retry is a NEW instance. That is the ratified retry
 * semantic, and it is what keeps run history honest — reopening a finished run
 * would overwrite the record that it finished.
 *
 * ─── IT ADVANCES NOTHING ON ITS OWN ───────────────────────────────────────
 * There is no scheduler, no automatic transition and no retry. This records the
 * state a caller asserts; later execution work owns actual orchestration.
 *
 * There is no DELETE: an instance is the historical record of a run.
 *
 * ─── AUTHORIZATION ────────────────────────────────────────────────────────
 * `PROSPECT_ICP_MANAGE`, the 032 interim boundary, unchanged. No capability was
 * added and the registry was not touched — the collection route records why
 * `AUTOMATION_EXECUTE` was checked and rejected.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withdrawUnsentTasks } from '../../../backend/services/orchestration/journeyExit';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  getExecutionInstance, setExecutionInstanceState, ExecutionInstanceError, TERMINAL_LIFECYCLE_STATES,
  LIFECYCLE_STATES, type LifecycleState,
} from '../../../backend/services/executionInstances/executionInstanceStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'PATCH'];

const statusFor = (code: string): number => (code === 'terminal_instance' ? 409 : 400);

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
    reason: 'read or advance the lifecycle state of a workflow execution instance',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      const instance = await getExecutionInstance(companyId, instanceId);
      if (!instance) return res.status(404).json({ error: 'no such execution instance' });
      return res.status(200).json({ instance });
    }

    const lifecycleState = str(body.lifecycleState);
    if (!lifecycleState || !LIFECYCLE_STATES.includes(lifecycleState as LifecycleState)) {
      return res.status(400).json({
        error: `lifecycleState must be one of ${LIFECYCLE_STATES.join(' | ')}`,
      });
    }

    // A run that ended must not leave a task someone can still approve and send. Withdrawn
    // first, so a failure leaves the run open; again after, for anything created meanwhile.
    const ending = (TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(lifecycleState);
    if (ending) await withdrawUnsentTasks(companyId, instanceId);
    const updated = await setExecutionInstanceState({
      organizationId: companyId,                   // the VERIFIED tenant
      instanceId,
      lifecycleState: lifecycleState as LifecycleState,
    });
    if (updated && ending) await withdrawUnsentTasks(companyId, updated.id);
    if (!updated) return res.status(404).json({ error: 'no such execution instance' });
    return res.status(200).json({ instance: updated });
  } catch (e) {
    if (e instanceof ExecutionInstanceError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'execution instance request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/execution-instances/[id]' });
