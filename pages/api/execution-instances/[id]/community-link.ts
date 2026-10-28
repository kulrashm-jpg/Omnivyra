import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * Orchestration — link a community journey step to an existing community action.
 *
 *   GET  /api/execution-instances/:id/community-link?company_id=<uuid>
 *        -> { links }
 *   POST /api/execution-instances/:id/community-link
 *        { company_id, executionTaskId, communityActionId } -> { link, replayed }
 *
 * The operator path for `community_action_journey_links` (20261231000003): it
 * records which EXISTING drafted community action a prepared `community` task
 * executes. It approves nothing (the approve route, APPROVE_ACTIONS, remains the
 * only approval) and executes nothing (the community adapter does, under the
 * engine's own gates). Idempotent: the same (task, action) returns the existing
 * link with `replayed: true`.
 *
 * AUTHORIZATION, in order: company membership (`enforceCompanyAccess`), the
 * interim execution-run capability every execution-instance route uses
 * (`PROSPECT_ICP_MANAGE`), and — for POST, which hands an action to an executor —
 * the community role allowed to execute actions (`EXECUTE_ACTIONS`). The run is
 * bound tenant-scoped, and the store refuses a task outside that run.
 *
 * PERMISSION IS NOT VALIDITY. A member holding both grants may still only link an
 * action that is PROVEN to concern the run's person: `linkCommunityAction` runs
 * `proveActionPerson` (communityIdentityProof.ts) — the action's platform account
 * must belong to the run's canonical person through ONE active, verified
 * `external_id` identity claim in this tenant — and the database guard
 * (20261231000006) re-proves it. There is no override, flag or body field that
 * skips it: missing / ambiguous / unverified / mismatched identity is refused
 * with its code (422; 503 when the identity record is unreadable).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { getExecutionInstance } from '../../../../backend/services/executionInstances/executionInstanceStore';
import {
  CommunityJourneyLinkError, linkCommunityAction, listInstanceLinks,
} from '../../../../backend/services/orchestration/communityJourneyLinkStore';
import {
  IDENTITY_REFUSAL_CODES, TRANSIENT_IDENTITY_CODES, type IdentityRefusalCode,
} from '../../../../backend/services/orchestration/communityIdentityProof';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

export const statusForLinkError = (code: string): number => {
  if ((IDENTITY_REFUSAL_CODES as readonly string[]).includes(code)) {
    if (TRANSIENT_IDENTITY_CODES.has(code as IdentityRefusalCode)) return 503;
    // Another tenant's account is answered like any other tenant's row.
    if (code === 'identity_cross_tenant') return 404;
    return 422;
  }
  if (code === 'link_unproven') return 409;
  if (code === 'task_not_found' || code === 'action_not_found' || code === 'not_found') return 404;
  if (code === 'cross_tenant') return 404;
  if (code === 'task_already_linked' || code === 'action_already_linked' || code === 'already_exists'
      || code === 'task_not_prepared' || code === 'run_not_executable' || code === 'action_not_linkable') return 409;
  if (code === 'task_not_community' || code === 'unsupported_action' || code === 'unsupported_action_type'
      || code === 'instance_mismatch') return 422;
  if (code === 'action_unreadable') return 503;
  return 400;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const instanceId = str(req.query.id);
  if (!instanceId || !UUID.test(instanceId)) return res.status(400).json({ error: 'instance id must be a uuid' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'link a community journey step to an existing community action',
  });
  // `ok !== true`, not `!ok` (strict:false disables narrowing on a negated boolean).
  if (guard.ok !== true) return;

  let linkedBy: string | null = null;
  if (req.method === 'POST') {
    const role = await enforceRole({
      req, res, companyId, allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!role) return;
    linkedBy = role.userId;
  }

  const instance = await getExecutionInstance(companyId, instanceId);
  if (!instance) return res.status(404).json({ error: 'no such execution instance' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ links: await listInstanceLinks(companyId, instanceId) });
    }
    const executionTaskId = str(body.executionTaskId);
    const communityActionId = str(body.communityActionId);
    if (!executionTaskId || !UUID.test(executionTaskId)) return res.status(400).json({ error: 'executionTaskId must be a uuid' });
    if (!communityActionId || !UUID.test(communityActionId)) return res.status(400).json({ error: 'communityActionId must be a uuid' });

    const { link, replayed } = await linkCommunityAction({
      organizationId: companyId,            // the VERIFIED tenant, never the body's
      executionInstanceId: instanceId,
      executionTaskId,
      communityActionId,
      linkedBy,
    });
    return res.status(replayed ? 200 : 201).json({ link, replayed });
  } catch (e) {
    if (e instanceof CommunityJourneyLinkError) {
      return res.status(statusForLinkError(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'community link request failed' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/execution-instances/[id]/community-link',
});
