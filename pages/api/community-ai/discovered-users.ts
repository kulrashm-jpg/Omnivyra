import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from './utils';

const parseBoolean = (value?: string | string[]) => {
  if (typeof value !== 'string') return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return null;
};

const parseNumber = (value?: string | string[], fallback = 0) => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  if (req.method === 'GET') {
    const roleGate = await enforceActionRole({
      req,
      res,
      companyId: scope.organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_DISCOVERED_USERS],
    });
    if (!roleGate) return;

    const { platform, classification, discovered_via } = req.query;
    const eligible = parseBoolean(req.query.eligible_for_engagement);
    const limit = Math.min(Math.max(parseNumber(req.query.limit, 25), 1), 200);
    const offset = Math.max(parseNumber(req.query.offset, 0), 0);

    let query = supabase
      .from('community_ai_discovered_users')
      .select('*', { count: 'exact' })
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId)
      .order('last_seen_at', { ascending: false });

    if (typeof platform === 'string') {
      query = query.eq('platform', platform);
    }
    if (typeof classification === 'string') {
      query = query.eq('classification', classification);
    }
    if (typeof discovered_via === 'string') {
      query = query.eq('discovered_via', discovered_via);
    }
    if (eligible !== null) {
      query = query.eq('eligible_for_engagement', eligible);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      total: count ?? 0,
      limit,
      offset,
      users: data || [],
    });
  }

  if (req.method === 'PATCH') {
    const roleGate = await enforceActionRole({
      req,
      res,
      companyId: scope.organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.CLASSIFY_DISCOVERED_USERS],
    });
    if (!roleGate) return;

    const id =
      (typeof req.query.id === 'string' ? req.query.id : null) ||
      (typeof req.body?.id === 'string' ? req.body.id : null);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const { eligible_for_engagement, blocked_reason, classification } = req.body || {};
    if (typeof eligible_for_engagement !== 'boolean') {
      return res.status(400).json({ error: 'eligible_for_engagement must be boolean' });
    }

    const updatePayload: Record<string, any> = {
      eligible_for_engagement,
      last_seen_at: new Date().toISOString(),
    };
    if (typeof blocked_reason === 'string' || blocked_reason === null) {
      updatePayload.blocked_reason = blocked_reason;
    }
    if (typeof classification === 'string') {
      updatePayload.classification = classification;
    }

    const { data, error } = await supabase
      .from('community_ai_discovered_users')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId)
      .select('*')
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ user: data?.[0] || null });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
