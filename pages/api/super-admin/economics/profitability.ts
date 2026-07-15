import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/economics/profitability
 *
 * Phase 9A — read-only super-admin profitability report: provider, activity,
 * and organization profitability + credit-to-cost ratios. Thin wrapper over
 * economicAccountingService.getProfitabilityReport() — no accounting logic,
 * no mutation.
 *
 * Query:
 *   from             ISO start (required)
 *   to?              ISO end
 *   organizationId?  scope to one org
 *
 * Auth: platform super-admin ONLY (no company / finance-role access).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../../backend/services/rbacService';
import { getProfitabilityReport } from '../../../../backend/services/billing/economicAccountingService';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!((await isPlatformSuperAdmin(user.id)) || (await isSuperAdmin(user.id)))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const from = str(req.query.from);
  if (!from) return res.status(400).json({ error: 'from is required (ISO timestamp)' });
  const to = str(req.query.to);
  const organizationId = str(req.query.organizationId);

  try {
    const report = await getProfitabilityReport({ since: from, until: to, organizationId });
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      from,
      to: to ?? null,
      organizationId: organizationId ?? null,
      byProvider: report.byProvider,
      byActivity: report.byActivity,
      byOrganization: report.byOrganization,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/economics/profitability' });
