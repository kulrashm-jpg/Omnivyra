import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { ownerCompanyOfRow } from '../../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  // S2 derive-then-authorize (e9 ruling): ownerCompanyOfRow answers ONLY which company owns the snapshot (null for a
  // missing, unreadable or company-less row: the same 404). The route needs nothing else from the snapshot row, and
  // enforceCompanyAccess authorizes the caller for exactly that company before anything is written.
  const ownerCompanyId = await ownerCompanyOfRow('recommendation_snapshots', id, 'recommendation long-term');
  if (!ownerCompanyId) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: ownerCompanyId,
    requireCampaignId: false,
  });
  if (!access) return;

  const organizationId = ownerCompanyId;

  const { error: upsertError } = await supabase.from('recommendation_user_state').upsert(
    {
      organization_id: organizationId,
      user_id: access.userId ?? null,
      recommendation_id: id,
      state: 'LONG_TERM',
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'organization_id,recommendation_id',
      ignoreDuplicates: false,
    }
  );

  if (upsertError) {
    return res.status(500).json({ error: 'Failed to mark recommendation as long-term' });
  }

  return res.status(200).json({
    ok: true,
    recommendation_id: id,
    state: 'LONG_TERM',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/recommendations/:id/long-term' });
