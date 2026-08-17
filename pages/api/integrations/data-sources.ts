import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import {
  DATA_SOURCE_GROUPS,
  buildDataSourceView,
  type TenantIntegrationRow,
} from '../../../backend/services/integrations/dataSourceCatalogue';

/**
 * PHASE-1A — the Data Sources view for the Company Admin integration hub.
 *
 * GET /api/integrations/data-sources?company_id=<uuid>
 *   → { groups: [...], sources: [{ key, label, group, available, status, ... }] }
 *
 * READ-ONLY BY DESIGN. There is no POST, PUT or DELETE here: this phase builds
 * the structure that later phases will connect providers into, and a write path
 * that no provider can yet satisfy would only invite a fake connection row.
 *
 * ─── THE TENANT IS NEVER TAKEN FROM THE BODY ──────────────────────────────
 * `company_id` comes from the QUERY STRING, is checked for shape before any
 * database access, and is membership-verified by `enforceCompanyAccess`. The
 * integration rows are then read with that verified value, so one tenant's
 * connection state can never appear in another's view.
 *
 * ─── IT RETURNS NO SECRETS ────────────────────────────────────────────────
 * Only `id`, `type` and `status` are selected from `company_integrations`.
 * `config`, `non_secret_config` and every credential column are deliberately
 * outside the projection — a status view has no reason to read them, and the
 * safest way to guarantee a secret is not returned is never to load it.
 */

/**
 * A tenant id is a uuid, checked HERE rather than left to the membership
 * lookup: a malformed value reaches Postgres as `22P02`, which TenantGuard
 * classifies as NOT_A_MEMBER, so the caller would be told "access denied" for
 * what is actually a malformed request — and a database round-trip would have
 * been spent on unvalidated input.
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

  // Membership-verified. Writes its own 400/401/403 and returns null on failure.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const { data, error } = await ownedDbTable('company_integrations')
    .select('id, type, status')
    .eq('company_id', companyId);

  if (error) {
    // The catalogue is still returned, with every source reported as unknown-
    // to-us rather than silently as "not connected" — a read failure is not
    // evidence that nothing is connected.
    return res.status(503).json({ error: 'integration status is temporarily unavailable', retryable: true });
  }

  const rows = (data ?? []) as TenantIntegrationRow[];

  return res.status(200).json({
    groups: DATA_SOURCE_GROUPS,
    sources: buildDataSourceView(rows),
  });
}

export default __createApiRoute(handler, { route: '/api/integrations/data-sources' });
