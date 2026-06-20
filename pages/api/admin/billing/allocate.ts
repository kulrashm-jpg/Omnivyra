/**
 * POST /api/admin/billing/allocate   { org_ids?: string[], dry_run?: boolean }
 *
 * Controlled trigger for the monthly subscription credit allocation sweep.
 * DRY-RUN BY DEFAULT — only grants when `dry_run` is explicitly false. Idempotent
 * (deterministic per-cycle key), so re-runs never double-grant. Capability-gated.
 *
 * This is the manual/controlled entry point. A scheduled cron is intentionally
 * NOT wired here — enabling automatic granting is a separate go-live decision.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_PURCHASE } from '@/shared/contracts/security';
import { runMonthlyAllocationSweep } from '@/backend/services/subscriptionAllocationService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const orgIds = Array.isArray(body.org_ids) ? body.org_ids.map(String) : undefined;
  const dryRun = body.dry_run !== false; // default true — must explicitly opt in to grant

  const guard = await requireCapability(req, res, {
    capability: BILLING_PURCHASE,
    reason: dryRun ? 'preview monthly credit allocation' : 'run monthly credit allocation',
  });
  if (guard.ok !== true) return;

  try {
    const summary = await runMonthlyAllocationSweep({ orgIds, dryRun });
    return res.status(200).json({ ok: true, mode: dryRun ? 'dry_run' : 'live', ...summary });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
