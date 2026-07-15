import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/billing-forensics/timeline
 *
 * Returns the company financial timeline view rows for an org.
 *
 * Query: ?orgId=<uuid>&limit=200&since=<iso>
 * Auth:  FINANCE_AUDITOR.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
  const limit = Math.min(1000, Number(req.query.limit ?? 200));
  const since = typeof req.query.since === 'string' ? req.query.since : null;
  if (!orgId) return res.status(400).json({ error: 'orgId required' });

  let q = supabase
    .from('v_company_financial_timeline')
    .select('*')
    .eq('organization_id', orgId)
    .order('event_at', { ascending: false })
    .limit(limit);
  if (since) q = q.gte('event_at', since);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    organizationId: orgId,
    count:          data?.length ?? 0,
    events:         data ?? [],
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/billing-forensics/timeline' });
