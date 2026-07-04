/**
 * GET /api/company/team-summary?companyId=xxx
 *
 * Lightweight membership summary readable by EVERY active member of the
 * company (via enforceCompanyAccess — no elevated permission required). Returns
 * only the minimum the Workspace Setup module needs to evaluate the Team
 * category, so Team is never hidden purely because a member lacks the
 * admin-only roster permission that /api/company/users requires for writes.
 *
 * Response: { ownerExists: boolean, memberCount: number }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

const OWNER_ROLES = ['COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'OWNER'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId ?? req.query.company_id) as string | undefined;
  if (!companyId?.trim()) {
    return res.status(400).json({ error: 'companyId required' });
  }

  // Any active member of an active org is authorized — never permission-gated.
  const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim() });
  if (!access) return; // enforceCompanyAccess already wrote the response

  try {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('role, status')
      .eq('company_id', companyId.trim())
      .eq('status', 'active');

    if (error) {
      // Fail soft — the Setup Team category degrades to "unavailable" (with a
      // canonical reason), never a hard error in the dashboard.
      console.warn('[company/team-summary]', error.message);
      return res.status(200).json({ ownerExists: false, memberCount: 0, degraded: true });
    }

    const rows = data ?? [];
    const memberCount = rows.length;
    const ownerExists = rows.some((r: { role?: string }) => OWNER_ROLES.includes((r.role ?? '').toUpperCase()));

    return res.status(200).json({ ownerExists, memberCount });
  } catch (err) {
    console.error('[company/team-summary]', err);
    return res.status(200).json({ ownerExists: false, memberCount: 0, degraded: true });
  }
}
