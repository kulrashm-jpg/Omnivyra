import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/admin/credits/company-wallet
 *
 * Composite read for the Credit Console "Wallet" panel. Returns:
 *   - current wallet snapshot (free / paid / incentive + reserved)
 *   - active reservations summary (count + total reserved)
 *   - 30-day burn forecast
 *   - invoice projection (current calendar month)
 *   - billing flag state for the org
 *   - financial controls (emergency_freeze / billing_lock)
 *   - active enterprise contract (if any)
 *
 * Single round-trip for the entire wallet view. NEVER mutates state.
 *
 * Auth: FINANCE_AUDITOR or above.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';
import { getBillingWalletSnapshot } from '../../../../backend/services/billing/payments/billingWalletService';
import { forecastUsage, detectBurnRateAnomaly } from '../../../../backend/services/billing/contracts/usageForecastingService';
import { projectInvoice } from '../../../../backend/services/billing/contracts/invoiceProjectionEngine';
import { resolveActiveContract } from '../../../../backend/services/billing/contracts/enterpriseContractResolver';
import { evaluateAllBillingFlags } from '../../../../backend/services/billing/billingFeatureFlags';
import { checkFinancialControls } from '../../../../backend/services/billing/orgFinancialControlService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
  if (!orgId) return res.status(400).json({ error: 'orgId required' });

  try {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

    // Parallelize all reads — every call is independent
    const [
      wallet,
      forecast,
      anomalyCheck,
      invoiceProjection,
      contract,
      flags,
      controls,
      reservationsSummary,
    ] = await Promise.all([
      getBillingWalletSnapshot(orgId),
      forecastUsage({ organizationId: orgId, periodStart, periodEnd }),
      detectBurnRateAnomaly(orgId),
      projectInvoice({ organizationId: orgId, periodStart, periodEnd }),
      resolveActiveContract(orgId),
      evaluateAllBillingFlags(orgId),
      checkFinancialControls(orgId),
      getActiveReservationsSummary(orgId),
    ]);

    return res.status(200).json({
      organizationId: orgId,
      wallet,
      reservations:        reservationsSummary,
      forecast,
      burnRateAnomaly:     anomalyCheck.anomaly ? anomalyCheck : null,
      invoiceProjection,
      contract,
      flags,
      financialControls:   controls,
      generatedAt:         new Date().toISOString(),
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function getActiveReservationsSummary(orgId: string): Promise<{
  openHolds: number;
  totalReserved: number;
  oldestHoldAgeSec: number | null;
}> {
  // Pull open HOLDs (HOLD rows with no sibling CONFIRM or RELEASE).
  // The v_reservation_health view computes this — use it where available.
  const { data } = await supabase
    .from('v_reservation_health')
    .select('open_holds, holds_older_1h, holds_older_6h, holds_older_24h, total_reserved')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (!data) {
    return { openHolds: 0, totalReserved: 0, oldestHoldAgeSec: null };
  }
  const row = data as Record<string, unknown>;
  const oldestHoldAgeSec =
    Number(row.holds_older_24h ?? 0) > 0 ? 24 * 3600 :
    Number(row.holds_older_6h  ?? 0) > 0 ? 6 * 3600  :
    Number(row.holds_older_1h  ?? 0) > 0 ? 3600      :
    null;
  return {
    openHolds:        Number(row.open_holds ?? 0),
    totalReserved:    Number(row.total_reserved ?? 0),
    oldestHoldAgeSec,
  };
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/credits/company-wallet' });
