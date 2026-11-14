import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { tenantTable, tenantContextFor, TenantSeamError, type TenantContext } from '../../../../backend/db/tenantTable';
import { seamDenial } from '../../../../backend/db/seamDenial';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const companyId = String(campaignRow.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  // S2 tenant seam: the tenant is the campaign's company that getUserRole just authorized for this user (derived
  // above from the campaign's versions, never a request value). A company that cannot form a context answers the
  // route's existing campaign 404.
  let tenant: TenantContext;
  try {
    tenant = tenantContextFor({ userId: user.id }, companyId);
  } catch (err) {
    if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Campaign not found' });
    throw err;
  }

  const { data, error } = await supabase
    .from('ai_improvements')
    .select('id, improvement_type, suggestion, impact_score, implementation_status, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch AI improvements' });
  }

  const { data: learningRow } = await tenantTable('campaign_learnings', tenant)
    .select('performance, metrics, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: enhancementRow } = await supabase
    .from('ai_enhancement_logs')
    .select('improvement_notes, ai_provider, confidence_score, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return res.status(200).json({
    improvements: data || [],
    context: {
      learning: learningRow
        ? {
            performance: learningRow.performance ?? {},
            metrics: learningRow.metrics ?? {},
            created_at: learningRow.created_at ?? null,
          }
        : null,
      enhancement: enhancementRow
        ? {
            improvement_notes: enhancementRow.improvement_notes ?? null,
            ai_provider: enhancementRow.ai_provider ?? null,
            confidence_score: enhancementRow.confidence_score ?? null,
            created_at: enhancementRow.created_at ?? null,
          }
        : null,
    },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/ai-improvements' });
