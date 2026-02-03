import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireTenantScope } from './utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const { data: actions, error } = await supabase
    .from('community_ai_actions')
    .select('id, status, risk_level')
    .eq('tenant_id', scope.tenantId)
    .eq('organization_id', scope.organizationId);

  if (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_ACTION_METRICS' });
  }

  const actionRows = actions || [];
  const statusCounts = actionRows.reduce(
    (acc, action) => {
      const status = (action.status || 'pending').toString().toLowerCase();
      if (status === 'approved') acc.approved += 1;
      else if (status === 'scheduled') acc.scheduled += 1;
      else if (status === 'executed') acc.executed += 1;
      else if (status === 'failed') acc.failed += 1;
      else if (status === 'skipped') acc.skipped += 1;
      else acc.pending += 1;
      return acc;
    },
    {
      pending: 0,
      approved: 0,
      scheduled: 0,
      executed: 0,
      failed: 0,
      skipped: 0,
    }
  );

  const riskCounts = actionRows.reduce(
    (acc, action) => {
      const risk = (action.risk_level || '').toString().toLowerCase();
      if (risk === 'low') acc.low += 1;
      else if (risk === 'medium') acc.medium += 1;
      else if (risk === 'high') acc.high += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 }
  );

  const { data: logs, error: logsError } = await supabase
    .from('community_ai_action_logs')
    .select('event_type, created_at')
    .eq('tenant_id', scope.tenantId)
    .eq('organization_id', scope.organizationId);

  if (logsError) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_ACTION_LOGS' });
  }

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  let lastExecutionAt: string | null = null;
  let last24hExecutions = 0;
  let last24hFailures = 0;

  (logs || []).forEach((log) => {
    const createdAt = new Date(log.created_at).getTime();
    if (log.event_type === 'executed') {
      if (!lastExecutionAt || new Date(lastExecutionAt).getTime() < createdAt) {
        lastExecutionAt = log.created_at;
      }
      if (createdAt >= cutoff) last24hExecutions += 1;
    }
    if (log.event_type === 'failed') {
      if (createdAt >= cutoff) last24hFailures += 1;
    }
  });

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    total_actions: actionRows.length,
    actions_by_status: statusCounts,
    actions_by_risk: riskCounts,
    last_24h_executions: last24hExecutions,
    last_24h_failures: last24hFailures,
    scheduler_running: Boolean(lastExecutionAt),
    last_execution_at: lastExecutionAt,
  });
}
