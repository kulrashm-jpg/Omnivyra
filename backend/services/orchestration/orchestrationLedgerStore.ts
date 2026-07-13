/**
 * orchestrationLedgerStore.ts — orchestration task ledger (CKRE-004 §8/§9).
 *
 * ADDITIVE. Reuses company_profiles.report_settings JSONB — NO new table. Stores
 * the deterministic execution-task ledger (report_settings.orchestration_tasks)
 * that backs queue orchestration, resume, and failure recovery. Bounded; merges
 * to preserve siblings. Best-effort/fail-safe.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import type { ExecutionTask } from './executionTaskModel';

const TASKS_KEY = 'orchestration_tasks';
const TASK_LIMIT = 100;

async function readReportSettings(companyId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from('company_profiles').select('report_settings').eq('company_id', companyId).maybeSingle();
  return ((data as { report_settings?: Record<string, unknown> } | null)?.report_settings) ?? {};
}

/** Read the task ledger. Never throws. */
export async function readTasks(companyId: string): Promise<ExecutionTask[]> {
  if (!companyId) return [];
  try {
    const rs = await readReportSettings(companyId);
    const arr = rs[TASKS_KEY];
    return Array.isArray(arr) ? (arr as ExecutionTask[]) : [];
  } catch {
    return [];
  }
}

/**
 * Upsert tasks into the ledger by idempotency id (dedup — no parallel queue).
 * Terminal completed/cancelled tasks are pruned to the limit. Never throws.
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
    const { error } = await supabase
      .from('company_profiles')
      .update({ report_settings: { ...rs, [TASKS_KEY]: merged }, updated_at: now })
      .eq('company_id', companyId);
    if (error) { logger.warn('orchestration_ledger_write_failed', { companyId, message: error.message }); return false; }
    return true;
  } catch (err) {
    logger.warn('orchestration_ledger_write_threw', { companyId, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
