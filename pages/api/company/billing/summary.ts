/**
 * GET /api/company/billing/summary?companyId=<uuid>
 *
 * Phase C/E/F — Company Billing Portal composite read. Org-isolated:
 * `assertOrgAccess` verifies the request principal belongs to the org
 * (platform-super-admin bypasses; everyone else is hard-scoped to their
 * own organization — no cross-org leakage possible).
 *
 * Returns: wallet, reservations, forecast, invoice projection, contract,
 * subscription tier, active flags, recent billing events.
 *
 * Read-only. Reuses the same immutable billing services as the super-admin
 * wallet endpoint — the difference is the access guard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { assertOrgAccess } from '../../../../backend/services/requestAccessService';
import { getBillingWalletSnapshot } from '../../../../backend/services/billing/payments/billingWalletService';
import { forecastUsage } from '../../../../backend/services/billing/contracts/usageForecastingService';
import { projectInvoice } from '../../../../backend/services/billing/contracts/invoiceProjectionEngine';
import { resolveActiveContract } from '../../../../backend/services/billing/contracts/enterpriseContractResolver';
import { projectOrgSubscriptions } from '../../../../backend/services/billing/payments/subscriptionProjectionService';
import { evaluateAllBillingFlags } from '../../../../backend/services/billing/billingFeatureFlags';
import { checkFinancialControls } from '../../../../backend/services/billing/orgFinancialControlService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  // Hard org-isolation. Writes 401/403/404 + audit on rejection.
  const access = await assertOrgAccess(req, res, companyId);
  if (!access) return;

  try {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

    const [
      wallet, forecast, invoiceProjection, contract, subscriptions, flags, financialControls, reservationHealth, recentEvents,
    ] = await Promise.all([
      getBillingWalletSnapshot(companyId),
      forecastUsage({ organizationId: companyId, periodStart, periodEnd }),
      projectInvoice({ organizationId: companyId, periodStart, periodEnd }),
      resolveActiveContract(companyId),
      projectOrgSubscriptions(companyId),
      evaluateAllBillingFlags(companyId),
      checkFinancialControls(companyId),
      supabase.from('v_reservation_health').select('open_holds, total_reserved, holds_older_24h').eq('organization_id', companyId).maybeSingle(),
      supabase
        .from('credit_transactions')
        .select('id, execution_phase, credits_delta, reference_type, note, created_at')
        .eq('organization_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // Top consuming modules — group recent CONFIRM rows by reference_type
    const { data: confirmRows } = await supabase
      .from('credit_transactions')
      .select('reference_type, credits_delta')
      .eq('organization_id', companyId)
      .eq('execution_phase', 'confirm')
      .gte('created_at', periodStart)
      .limit(2000);
    const byModule: Record<string, number> = {};
    for (const r of ((confirmRows ?? []) as Array<{ reference_type: string | null; credits_delta: number }>)) {
      const k = r.reference_type ?? 'unknown';
      byModule[k] = (byModule[k] ?? 0) + Math.abs(Number(r.credits_delta ?? 0));
    }
    const topModules = Object.entries(byModule)
      .map(([module, credits]) => ({ module, credits }))
      .sort((a, b) => b.credits - a.credits)
      .slice(0, 10);

    const rh = reservationHealth.data as { open_holds?: number; total_reserved?: number; holds_older_24h?: number } | null;

    return res.status(200).json({
      organizationId: companyId,
      generatedAt:    new Date().toISOString(),
      wallet,
      reservations: {
        openHolds:     Number(rh?.open_holds ?? 0),
        totalReserved: Number(rh?.total_reserved ?? 0),
        oldHolds24h:   Number(rh?.holds_older_24h ?? 0),
      },
      forecast,
      invoiceProjection,
      contract: contract
        ? {
            contractNumber: contract.contractNumber,
            paymentTerms:   contract.paymentTerms,
            allotment:      contract.totalCreditAllotment,
            startDate:      contract.startDate,
            endDate:        contract.endDate,
            currency:       contract.currency,
          }
        : null,
      subscriptions,
      flags,
      financialControls: {
        emergencyFreeze: financialControls.emergencyFreeze,
        billingLock:     financialControls.billingLock,
        reason:          financialControls.reason ?? null,
      },
      topModules,
      recentEvents: recentEvents.data ?? [],
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
