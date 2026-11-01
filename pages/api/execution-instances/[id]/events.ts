import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * One run's journey events, read from the records that already hold them.
 *
 *   GET /api/execution-instances/:id/events?company_id=<uuid>&after=<cursor>&limit=<n>
 *       -> { contractEventVersion, events, cursor, hasMore }
 *
 * Read-only and codes only (journeyEvents.ts). The same interim boundary as the rest of
 * the run's sub-resources, `PROSPECT_ICP_MANAGE`, until a dedicated capability is ratified.
 * Another tenant's run answers 404, the same as one that does not exist.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { readJourneyEvents } from '../../../../backend/services/orchestration/journeyEvents';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const instanceId = str(req.query.id);
  if (!instanceId || !UUID.test(instanceId)) {
    return res.status(400).json({ error: 'instance id must be a uuid' });
  }
  const companyId = str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'read the journey events of an execution run',
  });
  if (guard.ok !== true) return;

  const limit = Number(str(req.query.limit) ?? '');
  const after = str(req.query.after);
  try {
    const page = await readJourneyEvents(companyId, instanceId, {
      ...(after === null ? {} : { after }),
      ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
    });
    if (page === null) return res.status(404).json({ error: 'no such execution instance' });
    return res.status(200).json(page);
  } catch {
    return res.status(500).json({ error: 'journey events could not be read' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/execution-instances/[id]/events',
});
