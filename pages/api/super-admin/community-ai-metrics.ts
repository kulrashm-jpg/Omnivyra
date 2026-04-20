import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAdminRateLimit, requireSuperAdminUser } from '../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:community-ai-metrics', 20, 60))) return;

  if (!(await requireSuperAdminUser(req, res))) return;

  try {
    const [actionsCount, executedCount, playbooksCount, autoRulesCount, tenantRows] =
      await Promise.all([
        supabase
          .from('community_ai_actions')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('community_ai_action_logs')
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'executed'),
        supabase
          .from('community_ai_playbooks')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('community_ai_auto_rules')
          .select('id', { count: 'exact', head: true }),
        supabase.from('community_ai_actions').select('tenant_id'),
      ]);

    if (
      actionsCount.error ||
      executedCount.error ||
      playbooksCount.error ||
      autoRulesCount.error ||
      tenantRows.error
    ) {
      return res.status(500).json({ error: 'FAILED_TO_LOAD_COMMUNITY_AI_METRICS' });
    }

    const actionsByTenant = (tenantRows.data || []).reduce<Record<string, number>>((acc, row) => {
      const key = row.tenant_id ? String(row.tenant_id) : 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const actionsByTenantList = Object.entries(actionsByTenant)
      .map(([tenant_id, total_actions]) => ({ tenant_id, total_actions }))
      .sort((a, b) => b.total_actions - a.total_actions);

    return res.status(200).json({
      total_actions: actionsCount.count || 0,
      total_actions_executed: executedCount.count || 0,
      playbooks_count: playbooksCount.count || 0,
      auto_rules_count: autoRulesCount.count || 0,
      actions_by_tenant: actionsByTenantList,
    });
  } catch (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_COMMUNITY_AI_METRICS' });
  }
}
