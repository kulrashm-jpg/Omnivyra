import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/PUT /api/companies/approval-settings — Strategic Mix R2-P1.
 *
 * Company-level enablement for Assignment approvals (SPEC-001 §5.2):
 * `companies.require_assignment_approval` (default false — companies that
 * never touch this behave byte-identically). GET returns the flag; PUT
 * toggles it. Tenant-guarded; static path (no dynamic [id] — dev-env
 * reliability convention).
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' && req.query.company_id.trim()
      ? req.query.company_id.trim()
      : typeof req.body?.company_id === 'string'
        ? req.body.company_id.trim()
        : '';
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('companies')
      .select('require_assignment_approval')
      .eq('id', companyId)
      .maybeSingle();
    if (error) {
      console.error('[approval-settings] read failed:', error.message);
      return res.status(500).json({ error: 'Failed to read approval settings' });
    }
    return res.status(200).json({
      require_assignment_approval:
        (data as { require_assignment_approval?: unknown } | null)?.require_assignment_approval === true,
    });
  }

  if (req.method === 'PUT') {
    const value = req.body?.require_assignment_approval;
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'require_assignment_approval (boolean) is required' });
    }
    const { error } = await supabase
      .from('companies')
      .update({ require_assignment_approval: value })
      .eq('id', companyId);
    if (error) {
      console.error('[approval-settings] update failed:', error.message);
      return res.status(500).json({ error: 'Failed to update approval settings' });
    }
    return res.status(200).json({ require_assignment_approval: value });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/companies/approval-settings' });
