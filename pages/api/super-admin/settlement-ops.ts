/**
 * /api/super-admin/settlement-ops — HIDDEN settlement-operations governance.
 *
 *   GET — aggregated settlement operational metrics + runtime lock visibility.
 *
 * STRICTLY internal: super-admin only (BILLING_PLATFORM_MANAGE — SUPER_ADMIN-
 * only, platform-level). NOT a public API, NOT a telemetry surface. This
 * endpoint is READ-ONLY — it exposes no manual lock mutation / override.
 *
 * PRICING-BLIND: the response carries ONLY the five normalized settlement
 * lifecycle counters and lock-lease metadata — never an amount / plan price /
 * revenue / invoice figure. It does NOT touch the ledger, HOLD semantics,
 * settlement execution, or provider governance.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { BILLING_PLATFORM_MANAGE } from '../../../shared/contracts/security/SecurityCapabilities';
import { aggregateSettlementMetrics } from '../../../backend/services/billing/payments/settlementMetrics';
import { listSettlementLocks } from '../../../backend/services/billing/payments/settlementRuntimeLock';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: BILLING_PLATFORM_MANAGE,
    reason: 'super-admin reads settlement operational metrics',
    resourceId: null,
  });
  if (guard.ok !== true) return;

  // Deterministic aggregation + read-only lock visibility. Both are
  // pricing-blind and never throw.
  const [metrics, locks] = await Promise.all([
    aggregateSettlementMetrics(),
    listSettlementLocks(),
  ]);

  return res.status(200).json({ metrics, locks });
}
