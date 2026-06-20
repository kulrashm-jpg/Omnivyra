/**
 * POST /api/admin/billing/reconcile
 *   { scope: 'single'|'org'|'global', purchase_id?, org_id?, dry_run?: boolean }
 *
 * Repairs paid-but-unfulfilled top-up purchases (idempotent). DRY-RUN BY DEFAULT
 * — only writes when dry_run is explicitly false. Capability-gated.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_PURCHASE } from '@/shared/contracts/security';
import { reconcile, type ReconScopeKind } from '@/backend/services/billing/commercialReconciliationService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const scope = String(body.scope ?? 'global') as ReconScopeKind;
  const dryRun = body.dry_run !== false; // default true

  const guard = await requireCapability(req, res, {
    capability: BILLING_PURCHASE,
    reason: dryRun ? 'preview commercial reconciliation' : 'run commercial reconciliation',
  });
  if (guard.ok !== true) return;

  try {
    const result = await reconcile(
      { kind: scope, purchaseId: body.purchase_id, orgId: body.org_id },
      dryRun,
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message ?? 'reconcile_failed' });
  }
}
