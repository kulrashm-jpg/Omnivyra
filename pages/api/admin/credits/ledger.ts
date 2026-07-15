import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/admin/credits/ledger
 *
 * Filtered read of credit_transactions for the Ledger Explorer panel.
 * Read-only — never mutates state.
 *
 * Query params:
 *   orgId           - required
 *   actorUserId     - optional
 *   referenceType   - optional
 *   correlationId   - optional (joins through billing_operations)
 *   reservationId   - optional (parent_transaction_id match)
 *   executionPhase  - hold|confirm|release|grant|expire|expire_incentive
 *   since           - ISO date
 *   until           - ISO date
 *   anomalyOnly     - 'true' filters to rows flagged with metadata.anomaly
 *   failedOnly      - 'true' filters to release / expire rows
 *   limit           - default 200, max 1000
 *   offset          - default 0
 *
 * Auth: FINANCE_AUDITOR or above.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
  if (!orgId) return res.status(400).json({ error: 'orgId required' });

  const limit  = Math.min(1000, Number(req.query.limit ?? 200) || 200);
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const since  = typeof req.query.since === 'string' ? req.query.since : null;
  const until  = typeof req.query.until === 'string' ? req.query.until : null;

  let q = supabase
    .from('credit_transactions')
    .select('id, organization_id, execution_phase, credits_delta, balance_after, usd_equivalent, reference_type, reference_id, note, performed_by, idempotency_key, parent_transaction_id, category, free_delta, paid_delta, incentive_delta, metadata, created_at', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const referenceType = typeof req.query.referenceType === 'string' ? req.query.referenceType : null;
  if (referenceType) q = q.eq('reference_type', referenceType);

  const executionPhase = typeof req.query.executionPhase === 'string' ? req.query.executionPhase : null;
  if (executionPhase) q = q.eq('execution_phase', executionPhase);

  const reservationId = typeof req.query.reservationId === 'string' ? req.query.reservationId : null;
  if (reservationId) q = q.eq('parent_transaction_id', reservationId);

  const actorUserId = typeof req.query.actorUserId === 'string' ? req.query.actorUserId : null;
  if (actorUserId) q = q.eq('performed_by', actorUserId);

  if (since) q = q.gte('created_at', since);
  if (until) q = q.lte('created_at', until);

  if (req.query.failedOnly === 'true') {
    q = q.in('execution_phase', ['release', 'expire', 'expire_incentive']);
  }

  // correlationId routes through billing_operations to find matching ledger rows
  const correlationId = typeof req.query.correlationId === 'string' ? req.query.correlationId : null;
  if (correlationId) {
    const { data: ops } = await supabase
      .from('billing_operations')
      .select('idempotency_key')
      .eq('correlation_id', correlationId)
      .limit(50);
    const idemKeys = ((ops ?? []) as Array<{ idempotency_key: string }>)
      .flatMap(r => [r.idempotency_key, `${r.idempotency_key}:hold`, `${r.idempotency_key}:confirm`, `${r.idempotency_key}:release`]);
    if (idemKeys.length === 0) {
      return res.status(200).json({ orgId, rows: [], totalCount: 0, filteredBy: 'correlationId', message: 'no matching billing_operations' });
    }
    q = q.in('idempotency_key', idemKeys);
  }

  try {
    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });

    let rows = (data ?? []) as Array<Record<string, unknown>>;
    if (req.query.anomalyOnly === 'true') {
      rows = rows.filter(r => {
        const meta = (r.metadata as Record<string, unknown> | null) ?? {};
        return Boolean(meta.anomaly) || Boolean(meta.is_anomaly);
      });
    }

    return res.status(200).json({
      orgId,
      rows,
      totalCount: count ?? rows.length,
      pagination: { limit, offset, returned: rows.length },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/credits/ledger' });
