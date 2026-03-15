import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  COMMUNITY_AI_CAPABILITIES,
  hasCommunityAiCapability,
} from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from './utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  if (req.method === 'GET') {
    const roleGate = await enforceActionRole({
      req,
      res,
      companyId: scope.organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
    });
    if (!roleGate) return;

    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('X-Debug-Webhook-Query', 'true');
    }

    const { data, error } = await supabase
      .from('community_ai_webhooks')
      .select('id, event_type, webhook_url, is_active, created_at')
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[community-ai:webhooks]', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supabaseError: error,
      });
      return res.status(500).json({
        error: 'FAILED_TO_LOAD_WEBHOOKS',
      });
    }

    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      can_manage: hasCommunityAiCapability(roleGate.role, 'MANAGE_CONNECTORS'),
      webhooks: data || [],
    });
  }

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.MANAGE_CONNECTORS],
  });
  if (!roleGate) return;

  if (req.method === 'POST') {
    const { event_type, webhook_url, is_active } = req.body || {};
    if (!event_type || !webhook_url) {
      return res.status(400).json({ error: 'event_type and webhook_url are required' });
    }
    const { data, error } = await supabase
      .from('community_ai_webhooks')
      .insert({
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        event_type,
        webhook_url,
        is_active: is_active ?? true,
        created_at: new Date().toISOString(),
      })
      .select('id, event_type, webhook_url, is_active, created_at')
      .limit(1);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_CREATE_WEBHOOK' });
    }

    return res.status(201).json({ webhook: data?.[0] || null });
  }

  if (req.method === 'PATCH') {
    const { id, is_active } = req.body || {};
    if (!id || typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'id and is_active are required' });
    }
    const { error } = await supabase
      .from('community_ai_webhooks')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId);
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_WEBHOOK' });
    }
    return res.status(200).json({ status: 'updated' });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { error } = await supabase
      .from('community_ai_webhooks')
      .delete()
      .eq('id', id)
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId);
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_DELETE_WEBHOOK' });
    }
    return res.status(200).json({ status: 'deleted' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
