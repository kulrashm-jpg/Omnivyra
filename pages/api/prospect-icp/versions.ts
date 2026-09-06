import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import { readIcpWorkspace } from '../../../backend/apiHandlers/prospects/icpWorkspaceRead';

/**
 * A2 — READ the tenant's ICP workspace.
 *
 * GET /api/prospect-icp/versions?company_id=<uuid>&icpKey=<slug>
 *   → Section<IcpWorkspace>
 *
 * The review UI cannot show a reviewer what they are about to ratify without
 * enumeration, and `getIcpVersion` can only answer about a version number the
 * caller already knows. This is that read surface and nothing more: it creates
 * no version, ratifies nothing and writes nothing.
 *
 * ─── AUTHORIZATION MIRRORS THE WRITE ROUTES ───────────────────────────────
 * `company_id` comes from the QUERY STRING and is membership-verified, exactly
 * as in `propose.ts` and `ratify.ts`. The capability is `PROSPECT_ICP_MANAGE`
 * deliberately: no read-only ICP capability exists, and inventing one would be
 * a change to the frozen capability registry. Requiring the manage capability
 * to read is the conservative choice — it can be widened later by a contract
 * change, whereas a capability invented here could not be narrowed safely.
 *
 * ─── THE ENVELOPE IS THE ANSWER ───────────────────────────────────────────
 * A tenant with no ICP is `empty`, not 404 and not an error. `failed` means the
 * seam could not be reached. The five states are the frozen `Section<T>`
 * contract and the UI branches on them rather than on HTTP status alone.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const icpKey = typeof req.query.icpKey === 'string' ? req.query.icpKey.trim() : '';
  if (!icpKey) return res.status(400).json({ error: 'icpKey is required' });

  // Membership-verified. Writes its own 400/401/403 and returns null on failure.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'read the tenant Ideal Customer Profile workspace',
  });
  if (guard.ok !== true) return;

  // The VERIFIED tenant, never the query's unverified twin.
  const workspace = await readIcpWorkspace(companyId, icpKey);
  return res.status(200).json(workspace);
}

export default __createApiRoute(handler, { route: '/api/prospect-icp/versions' });
