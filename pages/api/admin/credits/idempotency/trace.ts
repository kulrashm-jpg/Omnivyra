/**
 * POST /api/admin/credits/idempotency/trace
 *
 * Correlation/lineage trace for a stuck idempotency operation. Reuses the
 * Phase 3 billing forensics surface to reconstruct the full lifecycle:
 * billing_operations → ledger HOLD/CONFIRM/RELEASE → approvals → audits.
 * Also surfaces the middleware (api_idempotency_keys) history for the key.
 *
 * Body:
 *   { correlationId?: string; operationId?: string; idempotencyKey?: string }
 *
 * Auth: FINANCE_AUDITOR.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../../backend/services/billing/financeRbacService';
import { traceBillingOperation } from '../../../../../backend/services/billing/exports/billingForensicsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { correlationId, operationId, idempotencyKey } = body as {
    correlationId?: string; operationId?: string; idempotencyKey?: string;
  };
  if (!correlationId && !operationId && !idempotencyKey) {
    return res.status(400).json({ error: 'one of correlationId | operationId | idempotencyKey required' });
  }

  try {
    const forensics = await traceBillingOperation({ correlationId, operationId, idempotencyKey });

    // Augment with middleware history when an idempotency key is known.
    let middlewareHistory: Array<Record<string, unknown>> = [];
    const keyForMiddleware = idempotencyKey
      ?? (forensics.billingOperations[0]?.idempotency_key as string | undefined);
    if (keyForMiddleware) {
      const { data } = await supabase
        .from('api_idempotency_keys')
        .select('scope, idempotency_key, status, request_id, response_status, locked_at, created_at, updated_at, last_error')
        .eq('idempotency_key', keyForMiddleware)
        .order('created_at', { ascending: true });
      middlewareHistory = (data ?? []) as Array<Record<string, unknown>>;
    }

    return res.status(200).json({ ...forensics, middlewareHistory });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
