/**
 * orchestrationLedgerStore.ts — orchestration task ledger (CKRE-004 §8/§9).
 *
 * ADDITIVE. Reuses company_profiles.report_settings JSONB — NO new table. Stores
 * the deterministic execution-task ledger (report_settings.orchestration_tasks)
 * that backs queue orchestration, resume, and failure recovery. Bounded; merges
 * to preserve siblings. Best-effort/fail-safe.
 */

import { readReportSettingsChecked, mergeReportSettingsKeys, ReportSettingsUnreadableError } from '../../db/reportSettingsKeys';
import { logger } from '../logger';
import type { ExecutionTask } from './executionTaskModel';

const TASKS_KEY = 'orchestration_tasks';
const TASK_LIMIT = 100;

/** The company_profiles read failed: the ledger and its sibling settings are UNKNOWN, not empty. */
export class OrchestrationLedgerUnavailableError extends Error {
  constructor(readonly companyId: string, readonly cause_: string) {
    super(`orchestration ledger unreadable for ${companyId}: ${cause_}`);
    this.name = 'OrchestrationLedgerUnavailableError';
  }
}

/**
 * CHECKED (2026-11-12, e9: BLOCKING data loss). The client returns {data: null, error} and does not
 * throw, and this read used to destructure only `data`, so a failed read became `{}`. upsertTasks then
 * wrote `report_settings = { ...{}, orchestration_tasks }`, which WIPED every other key in the company's
 * report_settings and dropped the existing task ledger (the resume / dedup record). A read error now
 * throws; a genuinely absent row or column is still `{}`. Reads go through the shared checked reader.
 */
async function readReportSettings(companyId: string): Promise<Record<string, unknown>> {
  try {
    return (await readReportSettingsChecked(companyId)).settings;
  } catch (err) {
    if (err instanceof ReportSettingsUnreadableError) throw new OrchestrationLedgerUnavailableError(companyId, err.detail);
    throw err;
  }
}

/**
 * Read the task ledger. THROWS OrchestrationLedgerUnavailableError when it cannot be read: an
 * unreadable ledger is not an empty one (callers that resume or dedup from it must not act on "none").
 */
export async function readTasks(companyId: string): Promise<ExecutionTask[]> {
  if (!companyId) return [];
  const rs = await readReportSettings(companyId);
  const arr = rs[TASKS_KEY];
  return Array.isArray(arr) ? (arr as ExecutionTask[]) : [];
}

/**
 * Upsert tasks into the ledger by idempotency id (dedup — no parallel queue).
 * Terminal completed/cancelled tasks are pruned to the limit. Never throws.
 * NEVER WRITES on a failed read (it returns false): writing would replace the company's whole
 * report_settings with only the ledger. A write that matches no company_profiles row is false too.
 * The write replaces ONLY report_settings.orchestration_tasks, server-side (merge_report_settings_keys):
 * a concurrent writer of another key is never lost. Two concurrent upserts of THIS ledger still race
 * (each merges from its own read; the later wins for this key only).
 */
export async function upsertTasks(companyId: string, tasks: ExecutionTask[], now: string = new Date().toISOString()): Promise<boolean> {
  if (!companyId || tasks.length === 0) return false;
  try {
    const rs = await readReportSettings(companyId);
    const existing = Array.isArray(rs[TASKS_KEY]) ? (rs[TASKS_KEY] as ExecutionTask[]) : [];
    const byId = new Map<string, ExecutionTask>(existing.map((t) => [t.id, t]));
    for (const t of tasks) byId.set(t.id, t);
    // Keep active tasks first; bound total.
    const merged = Array.from(byId.values())
      .sort((a, b) => {
        const activeA = a.state === 'PENDING' || a.state === 'RUNNING' || a.state === 'RETRYING' ? 0 : 1;
        const activeB = b.state === 'PENDING' || b.state === 'RUNNING' || b.state === 'RETRYING' ? 0 : 1;
        return activeA - activeB || a.priority - b.priority;
      })
      .slice(0, TASK_LIMIT);
    const written = await mergeReportSettingsKeys(companyId, 'orchestration_ledger', { [TASKS_KEY]: merged }, { updatedAt: now });
    if (!written) {
      logger.warn('orchestration_ledger_write_no_row', { companyId });
      return false;
    }
    return true;
  } catch (err) {
    if (err instanceof OrchestrationLedgerUnavailableError) {
      logger.error('orchestration_ledger_unreadable_write_refused', { companyId, message: err.message });
      return false;
    }
    logger.warn('orchestration_ledger_write_threw', { companyId, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
