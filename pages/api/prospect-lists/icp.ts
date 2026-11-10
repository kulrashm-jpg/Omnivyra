import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PUT  /api/prospect-lists/icp?companyId=<uuid>   Body: { listId, icpId | null }
 * POST /api/prospect-lists/icp?companyId=<uuid>   Body: { listId, dryRun? }  — evaluate
 *
 * An ICP list's membership is maintained by the evaluator from Prospect
 * Intelligence's evaluations under the ICP's ratified version; a manual or intake
 * list has no ICP (`icpId: null`). PUT sets or clears it; POST runs the evaluator
 * (dryRun previews adds/removals without writing). People's decisions win: the
 * evaluator never re-adds someone a person removed, nor removes someone a person
 * added.
 *
 * Membership, then PROSPECT_ICP_MANAGE; the VERIFIED tenant only. An ICP of
 * another tenant is refused by the composite foreign key.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import { productionListStore } from '../../../backend/services/prospectLists/store';
import { evaluateIcpList, IcpListEvaluationError } from '../../../backend/services/prospectLists/icpListEvaluator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['PUT', 'POST'];

const statusFor = (code: string): number => {
  if (code === 'targeting_schema_missing') return 503;
  if (code === 'list_not_found') return 404;
  if (code === 'list_archived' || code === 'list_has_no_icp' || code === 'icp_not_ratified') return 409;
  return 400;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = str(req.query.companyId);
  if (!companyId || !UUID.test(companyId)) return res.status(400).json({ error: 'companyId must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'set or evaluate a prospect list\'s ICP',
  });
  if (guard.ok !== true) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const listId = str(body.listId);
  if (!listId || !UUID.test(listId)) return res.status(400).json({ error: 'listId must be a uuid' });

  try {
    if (req.method === 'PUT') {
      const icpId = body.icpId == null ? null : str(body.icpId);
      if (icpId !== null && !UUID.test(icpId)) return res.status(400).json({ error: 'icpId must be a uuid or null' });
      try {
        const ok = await productionListStore.setListIcp(companyId, listId, icpId);
        return ok ? res.status(200).json({ listId, icpId }) : res.status(404).json({ error: 'no such list' });
      } catch (e) {
        const code = String((e as { code?: string } | null)?.code ?? '');
        if (code === 'targeting_schema_missing') return res.status(503).json({ error: (e as Error).message, code });
        if (/foreign key|23503/i.test(String((e as Error).message))) return res.status(404).json({ error: 'no such ICP in this tenant', code: 'icp_not_found' });
        throw e;
      }
    }
    const report = await evaluateIcpList({ organizationId: companyId, listId, dryRun: body.dryRun === true });
    return res.status(200).json({ report });
  } catch (e) {
    if (e instanceof IcpListEvaluationError) return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    return res.status(500).json({ error: 'list ICP request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-lists/icp' });
