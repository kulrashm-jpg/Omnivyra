import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceActionRole, requireTenantScope } from './utils';
import { Role } from '../../../backend/services/rbacService';

const ADMIN_ROLES = [Role.COMPANY_ADMIN, Role.SUPER_ADMIN];

const parseCondition = (value: any) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: ADMIN_ROLES,
  });
  if (!roleGate) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('community_ai_auto_rules')
      .select('id, rule_name, condition, action_type, max_risk_level, is_active, created_at')
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_LOAD_AUTO_RULES' });
    }

    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      rules: data || [],
    });
  }

  if (req.method === 'POST') {
    const { rule_name, condition, action_type, max_risk_level, is_active } = req.body || {};
    if (!rule_name || !condition || !action_type || !max_risk_level) {
      return res.status(400).json({ error: 'rule_name, condition, action_type, max_risk_level are required' });
    }
    const parsedCondition = parseCondition(condition);
    if (!parsedCondition) {
      return res.status(400).json({ error: 'condition must be valid JSON' });
    }
    const { data, error } = await supabase
      .from('community_ai_auto_rules')
      .insert({
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        rule_name,
        condition: parsedCondition,
        action_type,
        max_risk_level,
        is_active: is_active ?? true,
        created_at: new Date().toISOString(),
      })
      .select('id, rule_name, condition, action_type, max_risk_level, is_active, created_at')
      .limit(1);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_CREATE_AUTO_RULE' });
    }

    return res.status(201).json({ rule: data?.[0] || null });
  }

  if (req.method === 'PATCH') {
    const { id, is_active } = req.body || {};
    if (!id || typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'id and is_active are required' });
    }
    const { error } = await supabase
      .from('community_ai_auto_rules')
      .update({ is_active })
      .eq('id', id)
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId);
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_AUTO_RULE' });
    }
    return res.status(200).json({ status: 'updated' });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { error } = await supabase
      .from('community_ai_auto_rules')
      .delete()
      .eq('id', id)
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId);
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_DELETE_AUTO_RULE' });
    }
    return res.status(200).json({ status: 'deleted' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
