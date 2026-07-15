import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * GET /api/admin/credits/idempotency/list
 *
 * Operator-facing list of recoverable idempotency state across BOTH the
 * operational surfaces AND the withIdempotency middleware bookkeeping table.
 * Richer than /inspect — includes heartbeat liveness + stale-middleware rows.
 *
 * Query:
 *   orgId?     - filter by organization
 *   scope?     - filter middleware rows by scope (e.g. admin-credits-grant)
 *   ageSec?    - only rows older than this (default: surface SLA windows)
 *   limit?     - default 100, max 500
 *
 * Auth: FINANCE_AUDITOR.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../../backend/services/billing/financeRbacService';
import { findStuckOperations } from '../../../../../backend/services/billing/idempotency/idempotencyRecoveryService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
  const scope = typeof req.query.scope === 'string' ? req.query.scope : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));

  try {
    // 1. Operational surfaces (billing_operations / job_execution_registry / approvals)
    const stuck = await findStuckOperations({ limit });
    const stuckFiltered = orgId ? stuck.filter(s => s.organizationId === orgId) : stuck;

    // 2. Middleware bookkeeping rows in 'processing' (the api_idempotency_keys
    //    table) — these are what cause the 409 IDEMPOTENCY_IN_PROGRESS.
    let midQ = supabase
      .from('api_idempotency_keys')
      .select('scope, idempotency_key, status, request_id, locked_at, updated_at, created_at')
      .eq('status', 'processing')
      .order('locked_at', { ascending: true, nullsFirst: true })
      .limit(limit);
    if (scope) midQ = midQ.eq('scope', scope);
    const { data: midRows } = await midQ;
    const middlewareProcessing = ((midRows ?? []) as Array<Record<string, unknown>>).map(r => {
      const lockedAt = (r.locked_at as string | null) ?? (r.updated_at as string | null) ?? (r.created_at as string);
      const ageSec = lockedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(lockedAt)) / 1000)) : 0;
      return {
        scope:          String(r.scope),
        idempotencyKey: String(r.idempotency_key),
        status:         String(r.status),
        requestId:      r.request_id ? String(r.request_id) : null,
        lockedAt,
        ageSec,
        autoRecoverEligible: ageSec >= 600, // matches DEFAULT_STUCK_WINDOW_SEC (10 min)
      };
    });

    // 3. Heartbeat liveness for job_execution_registry rows in the stuck set
    const jerIds = stuckFiltered
      .filter(s => s.surface === 'job_execution_registry')
      .map(s => s.id);
    let heartbeats: Record<string, { lastSeenAt: string | null; ageSec: number }> = {};
    if (jerIds.length > 0) {
      const { data: jer } = await supabase
        .from('job_execution_registry')
        .select('id, last_seen_at')
        .in('id', jerIds);
      for (const row of ((jer ?? []) as Array<{ id: string; last_seen_at: string | null }>)) {
        const ls = row.last_seen_at;
        heartbeats[row.id] = {
          lastSeenAt: ls,
          ageSec: ls ? Math.max(0, Math.floor((Date.now() - Date.parse(ls)) / 1000)) : -1,
        };
      }
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      orgFilter:   orgId,
      scopeFilter: scope,
      operational: {
        count: stuckFiltered.length,
        rows:  stuckFiltered.map(s => ({
          ...s,
          heartbeat: heartbeats[s.id] ?? null,
        })),
      },
      middlewareProcessing: {
        count: middlewareProcessing.length,
        rows:  middlewareProcessing,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/credits/idempotency/list' });
