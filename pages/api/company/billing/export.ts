import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/company/billing/export
 *
 * Phase G — company-admin self-service export. Org-isolated: the export is
 * hard-scoped to the caller's validated org. Reuses the Phase 3 immutable
 * manifest service (SHA-256 checksum + audit-logged + correlation-traceable).
 *
 * Body: { companyId: string, exportType: 'company_usage' | 'reservation_lifecycle', format: 'csv'|'json'|'ndjson', periodStart?, periodEnd? }
 *
 * Company admins may export ONLY usage + reservation-lifecycle for their own
 * org. Ledger/anomaly/approval exports remain super-admin-only (handled by
 * the existing /api/super-admin/billing-exports/generate endpoint).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { assertOrgAccess, requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { exportCompanyUsage, exportReservationLifecycle, type ExportFormat } from '../../../../backend/services/billing/exports/ledgerExportService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';

const COMPANY_ALLOWED = ['company_usage', 'reservation_lifecycle'] as const;
type CompanyExportType = typeof COMPANY_ALLOWED[number];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:company:billing_export', 10, 60))) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const access = await assertOrgAccess(req, res, companyId);
  if (!access) return;

  const exportType = body.exportType as CompanyExportType;
  const format = body.format as ExportFormat;
  if (!COMPANY_ALLOWED.includes(exportType)) {
    return res.status(400).json({ error: `exportType must be one of: ${COMPANY_ALLOWED.join(', ')}` });
  }
  if (!['csv', 'json', 'ndjson'].includes(format)) {
    return res.status(400).json({ error: 'format must be csv|json|ndjson' });
  }

  try {
    const common = {
      format,
      requestedBy:    access.userId,
      organizationId: companyId,           // hard-pinned to validated org
      periodStart:    typeof body.periodStart === 'string' ? body.periodStart : undefined,
      periodEnd:      typeof body.periodEnd === 'string' ? body.periodEnd : undefined,
    };
    const result = exportType === 'company_usage'
      ? await exportCompanyUsage({ ...common, organizationId: companyId })
      : await exportReservationLifecycle(common);

    return res.status(200).json({
      ok:       true,
      manifest: result.manifest,
      rowCount: result.rowCount,
      body:     result.body,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

export default __createApiRoute(withIdempotency(handler, { scope: 'company-billing-export', methods: ['POST'] }), { route: '/api/company/billing/export' });
