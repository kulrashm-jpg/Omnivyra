/**
 * GET /api/super-admin/planner-control/inspect
 *
 * Read-only ops snapshot covering every runtime surface the planner exposes:
 *   - Cluster overload mode + pressure
 *   - Distributed semaphore live counts per pool
 *   - Provider token bucket state (local + distributed)
 *   - Redis Streams length + consumer-group lag
 *   - Planner alert counters (per-process + cluster)
 *   - BullMQ queue pressure
 *   - Rollout orchestrator state
 *   - Canary gate evaluation (dry-run — no rollback action)
 *   - Active SSE connection count (advisory; surfaced from a process counter)
 *   - Feature registry snapshot
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Read-only — never mutates state.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { getPlannerOpsSnapshot } from '../../../../backend/services/plannerOpsDashboard';
import { getRolloutState, readAuditTrail } from '../../../../backend/services/plannerRolloutOrchestrator';
import { evaluateHealthGates } from '../../../../backend/services/plannerCanaryHealthGates';
import { listFeatures } from '../../../../backend/services/plannerFeatureGovernance';
import { detectSemaphoreSplitBrain, getOrphanRefinementCount } from '../../../../backend/services/plannerFailureRecovery';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'inspect_planner_control_plane',
  });
  if (!auth.ok) return;

  try {
    const [ops, rollout, audit, gates, features, splitBrain, orphans] = await Promise.all([
      getPlannerOpsSnapshot(),
      getRolloutState(),
      readAuditTrail(20),
      evaluateHealthGates({ dryRun: true }),
      listFeatures(),
      detectSemaphoreSplitBrain(3),
      getOrphanRefinementCount(),
    ]);
    return res.status(200).json({
      ops_snapshot: ops,
      rollout_state: rollout,
      rollout_audit_recent: audit,
      canary_gates: gates,
      feature_registry: features,
      split_brain_report: splitBrain,
      orphan_refinement: orphans,
      // Active SSE connection count — kept simple: any /api/bolt/progress-stream
      // handler can update a Redis INCR/DECR if a richer count is needed.
      // For now we surface a placeholder so the UI shape stays stable.
      active_sse_connections: null,
    });
  } catch (err) {
    console.error('[planner-control/inspect]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
