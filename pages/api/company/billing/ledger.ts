/**
 * GET /api/company/billing/ledger?companyId=<uuid>
 *
 * Phase D — company-facing ledger. Org-isolated via assertOrgAccess: a
 * company user can ONLY ever read their own organization's rows. The
 * query is hard-pinned to the validated companyId; the client cannot
 * widen scope.
 *
 * Query: companyId (required), executionPhase?, referenceType?, since?,
 *        until?, limit? (default 100, max 500), offset?
 *
 * Read-only. Rows are immutable (DB triggers) — tagged for the UI badge.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { assertOrgAccess } from '../../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const access = await assertOrgAccess(req, res, companyId);
  if (!access) return;

  const limit  = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);

  // organization_id is pinned to the access-validated companyId. There is
  // no code path that lets a company user read another org's rows.
  let q = supabase
    .from('credit_transactions')
    .select('id, execution_phase, credits_delta, balance_after, usd_equivalent, reference_type, reference_id, note, idempotency_key, parent_transaction_id, category, created_at', { count: 'exact' })
    .eq('organization_id', companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const phase = typeof req.query.executionPhase === 'string' ? req.query.executionPhase : null;
  if (phase) q = q.eq('execution_phase', phase);
  const refType = typeof req.query.referenceType === 'string' ? req.query.referenceType : null;
  if (refType) q = q.eq('reference_type', refType);
  const since = typeof req.query.since === 'string' ? req.query.since : null;
  const until = typeof req.query.until === 'string' ? req.query.until : null;
  if (since) q = q.gte('created_at', since);
  if (until) q = q.lte('created_at', until);

  try {
    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({ ...r, immutable: true }));
    return res.status(200).json({
      organizationId: companyId,
      rows,
      totalCount: count ?? rows.length,
      pagination: { limit, offset, returned: rows.length },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
