import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { buildUsageReport, usageWindow, USAGE_MAX_DAYS } from '../../../backend/services/prospectUsage/usageReport';

/**
 * "Data sources & usage" (owner, 2026-11-10).
 *
 *   GET /api/prospect-sources/usage?companyId=<uuid>[&from=<iso>&to=<iso>]
 *     default window: the last 30 days; at most 92 days.
 *
 * Every data source the tenant used (vendor enrichment, vendor discovery,
 * Sales Navigator capture), per source, per user, per day and per run: the
 * vendor's own units (to reconcile with the vendor's usage page), the Omnivyra
 * credits charged, and the leads received / added / held / skipped.
 *
 * Read-only, tenant-scoped (TenantGuard binds the caller to companyId), counts
 * and ids only. A ledger that cannot be read is reported `unavailable`, never
 * as zero usage.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if ((req.method ?? 'GET') !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = (req.query?.companyId ?? req.query?.company_id) as string | undefined;
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const window = usageWindow(req.query?.from, req.query?.to, new Date());
  if (!window) return res.status(400).json({ error: 'INVALID_WINDOW', maxDays: USAGE_MAX_DAYS });

  try {
    const report = await buildUsageReport(String(companyId), window);
    return res.status(200).json(report);
  } catch (err: unknown) {
    console.error('[prospect-sources/usage] report failed', { name: err instanceof Error ? err.name : 'error' });
    return res.status(500).json({ error: 'USAGE_REPORT_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-sources/usage' });
