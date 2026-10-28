/**
 * GET|POST /api/cron/workflow-execution-progression
 *
 * PI-041-A-I — the operational trigger for Workflow execution.
 *
 * WHY A CRON AND NOT A ROUTE. 037's `advance_execution_plan` is documented as "a
 * poll, not an assertion", and until now nothing polled it: a run could become
 * time-eligible and stay that way forever. Eligibility here is time-based and the
 * delays are hour-scale, so a periodic sweep is the shape of the problem. The
 * manual diagnostic surface, `POST /api/execution-instances/:id/progression`, is
 * unchanged and remains the way to advance one named run by hand.
 *
 * WHAT IT DOES. For every tenant whose outreach governance is enabled: advance its
 * occupied runs, resolve whatever step became ready, and hand the corresponding
 * Execution Task to the engine for its channel. Nothing more.
 *
 * WHAT IT CANNOT DO. Name its own tenant — the set is derived from
 * `outreach_governance_config.enabled = true` and the request body is never
 * consulted for one. Approve, suppress, or reserve quota; those are Common
 * Outreach's and are reached through the certified dispatch path. Send email while
 * `LEAD_OUTREACH_EMAIL_ENABLED` is off: the transport still returns `disabled`,
 * which this endpoint reports as `tasks_disabled` rather than as an error.
 *
 * OFF BY DEFAULT (orchestration port, 2026-10-28). Inert unless
 * WORKFLOW_ORCHESTRATION_ENABLED is exactly `true`: automatic journeys act on
 * tenants' individuals without a human at run time, so turning the automation on
 * is a separate decision from enabling a tenant. NOT scheduled: no vercel.json
 * entry exists for it.
 *
 * AUTH. `CRON_SECRET` as a bearer token, compared in constant time — the same
 * mechanism the fifteen deployed crons use. There is no user session and no
 * capability check, because there is no user: that is also why the tenant may not
 * come from the caller.
 *
 * IDEMPOTENCE. Repeated invocation converges rather than duplicating work.
 * `advance_execution_plan` locks the run and promotes at most one step per pass,
 * step promotion is a conditional UPDATE, and the dispatch claim is a
 * compare-and-set whose loser is told `skipped_already_dispatched`. A fifteen-minute
 * cadence therefore needs no lock of its own.
 */
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import {
  sweepWorkflowExecutionProgression,
} from '../../../backend/services/workflowExecution/workflowProgressionSweeper';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/workflow-execution-progression] CRON_SECRET not configured; rejecting');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!bearerTokenMatches(req.headers['authorization'], cronSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (String(process.env.WORKFLOW_ORCHESTRATION_ENABLED ?? '').toLowerCase() !== 'true') {
    return res.status(200).json({ success: true, enabled: false, message: 'Workflow orchestration is disabled' });
  }

  try {
    // No argument is taken from the request. Bounds are the service's constants, so
    // a caller cannot widen the sweep, and the tenant set comes from data.
    const report = await sweepWorkflowExecutionProgression();

    return res.status(200).json({
      success: true,
      enabled: true,
      ranAt: report.ranAt,
      tenantsConsidered: report.tenantsConsidered,
      ...report.counters,
      // Stated, never hidden: a bound was reached and the next run has more to do.
      workRemains: report.workRemains,
      issues: report.issues,
      message: report.counters.tasks_seen === 0
        ? 'No workflow execution was due'
        : `${report.counters.steps_settled} executed, ${report.counters.steps_skipped} skipped, ${report.counters.tasks_waiting} waiting, ${report.counters.tasks_needing_human} need a human, of ${report.counters.tasks_seen} due`,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Workflow progression sweep failed';
    console.error('[cron/workflow-execution-progression]', message);
    return res.status(500).json({ error: message });
  }
}

export default __createApiRoute(handler, { route: '/api/cron/workflow-execution-progression' });
