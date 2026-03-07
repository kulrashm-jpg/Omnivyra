import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

/**
 * GET /api/intelligence/execution/metrics
 * View execution history and metrics.
 * Query: ?companyId, ?limit, ?executionType
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.query.companyId as string);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));
    const executionType = req.query.executionType as string | undefined;

    let metricsQuery = supabase
      .from('intelligence_execution_metrics')
      .select('id, execution_type, executed_at')
      .eq('company_id', companyId)
      .order('executed_at', { ascending: false })
      .limit(limit);

    if (executionType) {
      metricsQuery = metricsQuery.eq('execution_type', executionType);
    }

    const { data: metrics, error: metricsError } = await metricsQuery;

    if (metricsError) throw new Error(metricsError.message);

    let logsQuery = supabase
      .from('intelligence_execution_logs')
      .select('id, execution_type, status, latency_ms, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (executionType) {
      logsQuery = logsQuery.eq('execution_type', executionType);
    }

    const { data: logs, error: logsError } = await logsQuery;

    if (logsError) throw new Error(logsError.message);

    const successCount = (logs ?? []).filter((l) => l.status === 'success').length;
    const failureCount = (logs ?? []).filter((l) => l.status === 'failure').length;
    const skippedCount = (logs ?? []).filter((l) => l.status === 'skipped_due_to_limits').length;
    const avgLatency =
      (logs ?? []).filter((l) => l.latency_ms != null).length > 0
        ? (logs ?? [])
            .filter((l) => l.latency_ms != null)
            .reduce((s, l) => s + Number(l.latency_ms), 0) /
          (logs ?? []).filter((l) => l.latency_ms != null).length
        : null;

    return res.status(200).json({
      execution_metrics: metrics ?? [],
      execution_logs: logs ?? [],
      summary: {
        execution_success: successCount,
        execution_failure: failureCount,
        execution_skipped_due_to_limits: skippedCount,
        average_latency_ms: avgLatency != null ? Math.round(avgLatency) : null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get execution metrics';
    console.error('[intelligence/execution/metrics]', message);
    return res.status(500).json({ error: message });
  }
}
