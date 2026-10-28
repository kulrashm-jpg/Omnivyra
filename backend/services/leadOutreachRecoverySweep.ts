/**
 * WS-3 — scheduled recovery of outreach tasks an earlier dispatch returned to
 * `queued` (quota deferral, attempt-write failure, transport failure).
 *
 * Without it such a task waits for the next operator `/activate` call. This
 * module finds them and hands each one back to the EXISTING per-lead dispatch
 * path (`dispatchApprovedOutreachForLead`, scoped to exactly the tasks found).
 * It contains no dispatch logic: governance (approval on record, kill switches,
 * tenant enablement, suppression, contact governance, region, rate), quota,
 * the compare-and-set claim, the prior-attempt safety check and the
 * append-only attempt / evidence history all stay where they are.
 *
 * ─── WHY A FLAG HERE, WHEN ACTIVATION HAS NONE ─────────────────────────────
 * Activation is invoked by an operator for one lead; tenant enablement is its
 * single switch. This sweep acts on its own schedule, across tenants, with no
 * human in the loop at run time — so turning the AUTOMATION on is a separate
 * decision from enabling a tenant. `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED` must
 * be exactly `true`; anything else and the sweep reads nothing.
 *
 * ─── SAFETY POSTURE ────────────────────────────────────────────────────────
 *  • Internal channel only (the activation default). Email stays behind its own
 *    flag and is not widened here; a queued email task is reported
 *    `channel_not_permitted`.
 *  • A task whose earlier attempt may have reached the recipient is never
 *    re-sent: it is skipped here (so it does not re-run governance and append a
 *    decision row on every sweep) and dispatch would refuse it anyway
 *    (`blocked_prior_attempt`).
 *  • Bounded: at most `scanLimit` tasks read, `maxLeads` leads dispatched, and
 *    no new lead started after `timeBudgetMs`. Leads run sequentially, like
 *    dispatch itself, so concurrent dispatches never race one run's quota.
 *  • Failure isolated per lead: one lead's error is recorded and the run moves
 *    on. Concurrent or repeated sweeps are safe because every claim is a
 *    compare-and-set and every attempt number is unique per task.
 *  • Never approves, never enables a tenant, never reads outcomes.
 *
 * ─── DRY RUN (non-production validation) ───────────────────────────────────
 * `dryRun: true` performs the same read and the same prior-attempt check and
 * reports exactly which tasks a real run would hand to dispatch, without
 * calling dispatch: no governance decision, claim, attempt, quota or transport.
 * Because it writes nothing it runs even while the flag is off (the flag gates
 * dispatch, not observation); the global kill switch still stops it.
 */

import {
  isLeadOutreachGloballyDisabled,
  listQueuedOutreachTasks,
  registerDefaultTransports,
  requeuedDispatchProblem,
  type OutreachTask,
} from './leadOutreachExecution';
import { dispatchApprovedOutreachForLead } from './leadOutreachActivation';
import { logger } from './logger';

export const RECOVERY_SWEEP_ENABLED_ENV = 'LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED';

/** Anything other than an explicit `true` keeps the sweep inert. */
export const isRecoverySweepEnabled = (): boolean =>
  String(process.env[RECOVERY_SWEEP_ENABLED_ENV] ?? '').toLowerCase() === 'true';

export const RECOVERY_SWEEP_DEFAULTS = { scanLimit: 200, maxLeads: 25, timeBudgetMs: 45_000 } as const;

/** Most unrecoverable tasks listed in one report; the count is always complete. */
const MAX_LISTED = 20;

export interface RecoverySweepOptions {
  scanLimit?: number;
  maxLeads?: number;
  timeBudgetMs?: number;
  /** Injected clock (ms), for deterministic tests. */
  clock?: () => number;
  /** Report what a real run would dispatch; dispatch is never called. */
  dryRun?: boolean;
}

export interface RecoverySweepReport {
  enabled: boolean;
  dryRun: boolean;
  /** Why nothing was read: the flag is off, or the global kill switch is engaged. */
  skipped: 'disabled' | 'kill_switch' | null;
  scanned: number;
  /** Queued tasks no earlier attempt prevents from being dispatched again. */
  recoverable: number;
  /** Queued tasks that need a human (an attempt may have reached the recipient, no evidence, ...). */
  unrecoverable: number;
  unrecoverableTasks: Array<{ companyId: string; taskId: string; reason: string }>;
  leadsProcessed: number;
  /** Leads with recoverable tasks left for a later run (lead cap or time budget). */
  leadsDeferred: number;
  /** Dispatch outcomes for the tasks this run handed to dispatch, by outcome. */
  outcomes: Record<string, number>;
  sent: number;
  failures: Array<{ companyId: string; leadId: string; error: string }>;
  /** Dry run only: the tasks a real run would hand to dispatch, per lead (bounded like a real run). */
  wouldDispatch: Array<{ companyId: string; leadId: string; taskIds: string[] }>;
}

const emptyReport = (enabled: boolean, skipped: RecoverySweepReport['skipped'], dryRun = false): RecoverySweepReport => ({
  enabled,
  dryRun,
  skipped,
  scanned: 0,
  recoverable: 0,
  unrecoverable: 0,
  unrecoverableTasks: [],
  leadsProcessed: 0,
  leadsDeferred: 0,
  outcomes: {},
  sent: 0,
  failures: [],
  wouldDispatch: [],
});

const positive = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;

/**
 * One recovery pass. Throws only when the queued-task read itself fails, so the
 * caller reports an error rather than "nothing to recover".
 */
export async function runOutreachDispatchRecoverySweep(options: RecoverySweepOptions = {}): Promise<RecoverySweepReport> {
  const enabled = isRecoverySweepEnabled();
  const dryRun = options.dryRun === true;
  if (!enabled && !dryRun) return emptyReport(false, 'disabled');
  if (isLeadOutreachGloballyDisabled()) return emptyReport(enabled, 'kill_switch', dryRun);

  const clock = options.clock ?? Date.now;
  const started = clock();
  const scanLimit = positive(options.scanLimit, RECOVERY_SWEEP_DEFAULTS.scanLimit);
  const maxLeads = positive(options.maxLeads, RECOVERY_SWEEP_DEFAULTS.maxLeads);
  const timeBudgetMs = positive(options.timeBudgetMs, RECOVERY_SWEEP_DEFAULTS.timeBudgetMs);

  const queued = await listQueuedOutreachTasks(scanLimit);
  if (queued.ok === false) throw new Error(`queued outreach tasks could not be read: ${queued.error}`);

  // The prior-attempt check needs the transports registered, as dispatch does.
  registerDefaultTransports();
  const report = emptyReport(enabled, null, dryRun);
  report.scanned = queued.tasks.length;

  // Group the recoverable tasks per (tenant, lead), oldest first.
  const groups = new Map<string, { companyId: string; leadId: string; taskIds: string[] }>();
  for (const task of queued.tasks) {
    const problem = await requeuedDispatchProblem(task.companyId, task);
    if (problem !== null) {
      report.unrecoverable += 1;
      if (report.unrecoverableTasks.length < MAX_LISTED) report.unrecoverableTasks.push({ companyId: task.companyId, taskId: String(task.id), reason: problem });
      continue;
    }
    report.recoverable += 1;
    const key = groupKey(task);
    const group = groups.get(key) ?? { companyId: task.companyId, leadId: task.leadId, taskIds: [] };
    group.taskIds.push(String(task.id));
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (report.leadsProcessed >= maxLeads || clock() - started >= timeBudgetMs) {
      report.leadsDeferred += 1;
      continue;
    }
    report.leadsProcessed += 1;
    if (dryRun) {
      report.wouldDispatch.push({ companyId: group.companyId, leadId: group.leadId, taskIds: [...group.taskIds] });
      continue;
    }
    try {
      const reports = await dispatchApprovedOutreachForLead(group.companyId, group.leadId, { taskIds: group.taskIds });
      for (const r of reports) {
        const key = r.action === 'dispatched' ? String(r.outcome ?? 'unknown') : r.action;
        report.outcomes[key] = (report.outcomes[key] ?? 0) + 1;
        if (r.action === 'dispatched' && r.outcome === 'sent') report.sent += 1;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      report.failures.push({ companyId: group.companyId, leadId: group.leadId, error });
      logger.error('outreach.recovery_sweep.lead_failed', { companyId: group.companyId, error });
    }
  }

  logger.info('outreach.recovery_sweep.completed', {
    dryRun,
    scanned: report.scanned,
    recoverable: report.recoverable,
    unrecoverable: report.unrecoverable,
    leadsProcessed: report.leadsProcessed,
    leadsDeferred: report.leadsDeferred,
    sent: report.sent,
    failures: report.failures.length,
  });
  return report;
}

const groupKey = (t: OutreachTask): string => `${t.companyId}\u0000${t.leadId}`;
