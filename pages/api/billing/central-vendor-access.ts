import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { requireExternalApiAccess } from '../../../backend/apiHandlers/externalApis/indexShared';
import {
  CentralAccessSelectionRefused,
  quoteCentralVendorAccess,
  readCentralVendorOptIns,
  writeCentralVendorOptIns,
} from '../../../backend/services/enrichment/centralVendorAccess';

/**
 * Mode B: the tenant's choice of PAID central data-vendor access.
 *
 *   GET /api/billing/central-vendor-access?companyId=<uuid>
 *     each vendor: credits per vendor unit at THIS org's credit rate,
 *     availability (cost set in Super Admin), and whether the tenant opted in.
 *   PUT /api/billing/central-vendor-access?companyId=<uuid>   { vendors: string[] }
 *     opt in to exactly these vendors ([] opts out of all). Unknown -> 400.
 *
 * Opting in authorises spending this tenant's credits, so it requires tenant
 * binding AND the external-API MANAGE permission (the same as storing the
 * tenant's own vendor key). The tenant's OWN key, when present, still wins.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = (req.query?.companyId ?? req.query?.company_id) as string | undefined;
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;
  if (method === 'PUT') {
    const access = await requireExternalApiAccess(req, res, companyId, true);
    if (!access) return;
  }
  const org = String(companyId);
  try {
    if (method === 'PUT') {
      const body = (req.body ?? {}) as { vendors?: unknown };
      const optedIn = await writeCentralVendorOptIns(org, body.vendors, tenant.userId);
      return res.status(200).json({ optedIn });
    }
    const [quotes, optedIn] = await Promise.all([quoteCentralVendorAccess(org), readCentralVendorOptIns(org)]);
    return res.status(200).json({
      vendors: quotes.map((q) => ({ ...q, optedIn: optedIn.includes(q.vendor) })),
    });
  } catch (e) {
    if (e instanceof CentralAccessSelectionRefused) {
      return res.status(400).json({ error: 'CENTRAL_ACCESS_SELECTION_REFUSED', code: e.code, vendor: e.vendor ?? null });
    }
    console.error('[billing/central-vendor-access]', { method, message: e instanceof Error ? e.message : 'error' });
    return res.status(500).json({ error: 'CENTRAL_ACCESS_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/billing/central-vendor-access' });
