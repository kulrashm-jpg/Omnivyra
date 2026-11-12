import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { tenantContextFor, tenantTable } from '../../../backend/db/tenantTable';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.query.company_id as string | undefined);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    // S2: pinned to the company resolveCompanyAccess authorized.
    const { data, error } = await tenantTable('company_profile_refinements', tenantContextFor(access, companyId))
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) {
      return res.status(500).json({ error: 'Failed to load refinements' });
    }

    return res.status(200).json({ refinements: data || [] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load refinements' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/refinements' });
