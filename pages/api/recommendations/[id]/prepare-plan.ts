import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../../backend/services/rbacService';

const allowedRoles = new Set([Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { data: recommendation, error: recError } = await supabase
    .from('recommendation_snapshots')
    .select('*')
    .eq('id', id)
    .single();

  if (recError || !recommendation) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const companyId = String(recommendation.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || !allowedRoles.has(role)) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const recommendationContext = {
    trend_topic: recommendation.trend_topic ?? null,
    audience: recommendation.audience ?? null,
    platforms: recommendation.platforms ?? null,
    scores: recommendation.scores ?? null,
    confidence: recommendation.confidence ?? null,
    final_score: recommendation.final_score ?? null,
    explanation: recommendation.explanation ?? null,
    snapshot_hash: recommendation.snapshot_hash ?? null,
  };

  const suggestionSummary = recommendation.explanation
    ? String(recommendation.explanation).slice(0, 240)
    : `Plan draft for ${recommendation.trend_topic || 'recommendation'}`;

  const draftRequested =
    typeof req.body?.draft === 'boolean' ? req.body.draft : false;
  const priorityBucket =
    typeof req.body?.priority_bucket === 'string' ? req.body.priority_bucket : null;

  try {
    await supabase.from('audit_logs').insert({
      action: draftRequested
        ? 'RECOMMENDATION_DRAFT_PLAN_REQUESTED'
        : 'RECOMMENDATION_USED_FOR_PLANNING',
      actor_user_id: user.id,
      company_id: companyId,
      metadata: {
        recommendation_id: recommendation.id,
        snapshot_hash: recommendation.snapshot_hash ?? null,
        priority_bucket: priorityBucket,
      },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('AUDIT_LOG_FAILED', error);
  }

  return res.status(200).json({
    recommendation_context: recommendationContext,
    snapshot_hash: recommendation.snapshot_hash ?? null,
    suggestion_summary: suggestionSummary,
  });
}
