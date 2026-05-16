/**
 * GET /api/super-admin/global-ledger
 *
 * Phase B — enterprise-wide ledger visibility. Cross-company, filterable,
 * paginated. Read-only. Every row is immutable (DB triggers); the response
 * tags rows so the UI can render the immutable badge.
 *
 * Query:
 *   orgId?           filter to one org
 *   executionPhase?  hold|confirm|release|grant|expire|expire_incentive
 *   referenceType?
 *   actorUserId?
 *   correlationId?   resolves through billing_operations
 *   since? until?    ISO
 *   limit?           default 200, max 1000
 *   offset?          default 0
 *
 * Auth: FINANCE_AUDITOR or above. (Global scope — intentionally cross-org;
 * this endpoint is super-admin-tier only.)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../backend/services/billing/financeRbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const limit  = Math.min(1000, Math.max(1, Number(req.query.limit ?? 200) || 200));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);

  let q = supabase
    .from('credit_transactions')
    .select('id, organization_id, execution_phase, credits_delta, balance_after, usd_equivalent, reference_type, reference_id, note, performed_by, idempotency_key, parent_transaction_id, category, metadata, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
  if (orgId) q = q.eq('organization_id', orgId);

  const phase = typeof req.query.executionPhase === 'string' ? req.query.executionPhase : null;
  if (phase) q = q.eq('execution_phase', phase);

  const refType = typeof req.query.referenceType === 'string' ? req.query.referenceType : null;
  if (refType) q = q.eq('reference_type', refType);

  const actor = typeof req.query.actorUserId === 'string' ? req.query.actorUserId : null;
  if (actor) q = q.eq('performed_by', actor);

  const since = typeof req.query.since === 'string' ? req.query.since : null;
  const until = typeof req.query.until === 'string' ? req.query.until : null;
  if (since) q = q.gte('created_at', since);
  if (until) q = q.lte('created_at', until);

  const correlationId = typeof req.query.correlationId === 'string' ? req.query.correlationId : null;
  if (correlationId) {
    const { data: ops } = await supabase
      .from('billing_operations')
      .select('idempotency_key')
      .eq('correlation_id', correlationId)
      .limit(100);
    const keys = ((ops ?? []) as Array<{ idempotency_key: string }>)
      .flatMap(r => [r.idempotency_key, `${r.idempotency_key}:hold`, `${r.idempotency_key}:confirm`, `${r.idempotency_key}:release`]);
    if (keys.length === 0) {
      return res.status(200).json({ rows: [], totalCount: 0, filteredBy: 'correlationId', message: 'no matching billing_operations' });
    }
    q = q.in('idempotency_key', keys);
  }

  try {
    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({ ...r, immutable: true }));
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      rows,
      totalCount: count ?? rows.length,
      pagination: { limit, offset, returned: rows.length },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
