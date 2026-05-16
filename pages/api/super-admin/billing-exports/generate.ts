/**
 * POST /api/super-admin/billing-exports/generate
 *
 * Phase 3 C — generate a billing export. Body specifies the export type,
 * filters, format. Response is the body (CSV/JSON/NDJSON) plus the
 * manifest record.
 *
 * Body:
 *   {
 *     exportType: 'ledger' | 'company_usage' | 'admin_adjustments' |
 *                 'reservation_lifecycle' | 'billing_anomalies' | 'approval_chain',
 *     format:     'csv' | 'json' | 'ndjson',
 *     organizationId?: string,
 *     periodStart?: string,
 *     periodEnd?: string,
 *     referenceType?: string,        // ledger only
 *     executionPhase?: string,       // ledger only
 *   }
 * Auth: FINANCE_AUDITOR.
 *
 * Rate-limited heavily — exports are I/O intensive.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';
import {
  exportLedger,
  exportAdminAdjustments,
  exportCompanyUsage,
  exportReservationLifecycle,
  exportApprovalChain,
  exportBillingAnomalies,
  type ExportFormat,
  type ExportType,
} from '../../../../backend/services/billing/exports/ledgerExportService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';

const VALID_TYPES: ExportType[] = [
  'ledger', 'company_usage', 'admin_adjustments',
  'reservation_lifecycle', 'billing_anomalies', 'approval_chain',
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:billing_exports', 10, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const exportType: ExportType = body.exportType;
  const format: ExportFormat   = body.format;
  if (!VALID_TYPES.includes(exportType)) return res.status(400).json({ error: 'invalid exportType' });
  if (!['csv', 'json', 'ndjson'].includes(format)) return res.status(400).json({ error: 'invalid format' });

  const common = {
    format,
    requestedBy:    user.id,
    organizationId: body.organizationId as string | undefined,
    periodStart:    body.periodStart as string | undefined,
    periodEnd:      body.periodEnd as string | undefined,
  };

  try {
    let result;
    switch (exportType) {
      case 'ledger':
        result = await exportLedger({
          ...common,
          filters: {
            organizationId: common.organizationId,
            periodStart:    common.periodStart,
            periodEnd:      common.periodEnd,
            executionPhase: body.executionPhase,
            referenceType:  body.referenceType,
          },
        });
        break;
      case 'company_usage':
        if (!common.organizationId) return res.status(400).json({ error: 'organizationId required for company_usage' });
        result = await exportCompanyUsage({ ...common, organizationId: common.organizationId });
        break;
      case 'admin_adjustments':
        result = await exportAdminAdjustments(common);
        break;
      case 'reservation_lifecycle':
        result = await exportReservationLifecycle(common);
        break;
      case 'approval_chain':
        result = await exportApprovalChain(common);
        break;
      case 'billing_anomalies':
        result = await exportBillingAnomalies(common);
        break;
    }
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

export default withIdempotency(handler, { scope: 'admin-billing-exports-generate', methods: ['POST'] });
