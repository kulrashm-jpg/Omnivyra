import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/creator-operations
 *
 * Aggregated operational view for the BOLT Creator workflow:
 *   - metric snapshot (configurable window)
 *   - active alerts
 *   - DLQ entries
 *   - integrity audit summary (cached, 5 min)
 *
 * Admin-gated; uses the same auth pattern as other super-admin endpoints.
 *
 * Query params:
 *   - window=1h|24h|7d|30d  (default 1h)
 *   - company_id=...        (optional scope filter)
 *
 * Response shape is intentionally chunked so the dashboard can lazily
 * hydrate each panel.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireSuperAdminUser } from '../../../backend/services/requestAccessService';
import { aggregateCreatorMetrics, classifyWorkflowStatus } from '../../../backend/services/creatorObservabilityService';
import { listDeadLetterJobs } from '../../../backend/services/creatorQueueReliabilityService';
import { getQueuePressure } from '../../../backend/services/creatorScalabilityHarnessService';
import { withCache } from '../../../backend/services/creatorScalabilityHarnessService';
import type { ObservabilityWindow } from '../../../backend/services/creatorObservabilityService';

const VALID_WINDOWS: ObservabilityWindow[] = ['1h', '24h', '7d', '30d'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // ROUTE-AUTH-001 (STEP 3AH-85): the previous local isSuperAdmin() trusted
  // auth.users.user_metadata (is_super_admin / role), which the user can write
  // with their own session via auth.updateUser — any signed-in user could grant
  // themselves this cross-tenant view. Super admin is now decided by the
  // canonical platform role (user_company_roles SUPER_ADMIN): 401 when not
  // signed in, 403 SUPER_ADMIN_REQUIRED otherwise.
  const admin = await requireSuperAdminUser(req, res);
  if (!admin) return;

  const window = (Array.isArray(req.query.window) ? req.query.window[0] : req.query.window) as ObservabilityWindow | undefined;
  const resolvedWindow: ObservabilityWindow = VALID_WINDOWS.includes(window as any) ? (window as ObservabilityWindow) : '1h';
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;

  try {
    const cacheKey = `creator-ops:${resolvedWindow}:${companyId ?? 'all'}`;
    const data = await withCache(cacheKey, 30_000, async () => {
      const [snapshot, dlq, queuePressure, activeAlerts] = await Promise.all([
        aggregateCreatorMetrics({ window: resolvedWindow, companyId }),
        listDeadLetterJobs({ limit: 50 }),
        getQueuePressure(),
        loadActiveAlerts(companyId),
      ]);
      return {
        window: resolvedWindow,
        company_id: companyId,
        status: classifyWorkflowStatus(snapshot),
        snapshot,
        dlq,
        queue_pressure: queuePressure,
        active_alerts: activeAlerts,
      };
    });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message ?? 'unknown' });
  }
}

async function loadActiveAlerts(companyId: string | null): Promise<Array<Record<string, unknown>>> {
  try {
    let q = supabase
      .from('creator_alert_state')
      .select('alert_key, severity, message, status, fire_count, first_fired_at, last_fired_at, metadata')
      .eq('status', 'active')
      .order('last_fired_at', { ascending: false })
      .limit(50);
    const { data } = await q;
    const rows = Array.isArray(data) ? data : [];
    if (!companyId) return rows as Array<Record<string, unknown>>;
    return (rows as Array<{ alert_key: string }>).filter((r) => r.alert_key.endsWith(`:${companyId}`));
  } catch {
    return [];
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/creator-operations' });
