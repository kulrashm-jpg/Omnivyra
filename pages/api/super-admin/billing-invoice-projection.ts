import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/billing-invoice-projection
 *
 * Phase 3 F — forward-looking invoice projection for an org's current
 * (or specified) period. Combines observed usage + forecast + contract
 * context.
 *
 * Query: ?orgId=<uuid>&periodStart=<iso>&periodEnd=<iso>
 * Auth:  FINANCE_AUDITOR (read-only forecast).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuthenticatedInternalUser } from '../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../backend/services/billing/financeRbacService';
import { projectInvoice } from '../../../backend/services/billing/contracts/invoiceProjectionEngine';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
  if (!orgId) return res.status(400).json({ error: 'orgId required' });

  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const defaultEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const periodStart  = typeof req.query.periodStart === 'string' ? req.query.periodStart : defaultStart;
  const periodEnd    = typeof req.query.periodEnd   === 'string' ? req.query.periodEnd   : defaultEnd;

  try {
    const projection = await projectInvoice({ organizationId: orgId, periodStart, periodEnd });
    return res.status(200).json(projection);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/billing-invoice-projection' });
