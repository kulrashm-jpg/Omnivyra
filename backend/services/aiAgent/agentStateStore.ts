/**
 * agentStateStore.ts — canonical agent state persistence (AIA-001 §5/§6).
 *
 * ONE store for agent checkpoints (which embed the versioned memory snapshot).
 * ADDITIVE — reuses company_profiles.report_settings JSONB (report_settings
 * .agent_checkpoints), no new table, mirroring the CKRE/CKC persistence pattern.
 * There is no separate memory store and no separate checkpoint system: a
 * checkpoint IS the resumable unit and carries the memory. Best-effort/fail-safe.
 *
 * The runtime depends on the AgentStore interface, so tests inject an in-memory
 * store and production uses the report_settings-backed default.
 */

import { readReportSettingsChecked, mergeReportSettingsKeys } from '../../db/reportSettingsKeys';
import { logger } from '../logger';
import type { AgentCheckpoint } from './agentContracts';

export interface AgentStore {
  load(companyId: string, runId: string): Promise<AgentCheckpoint | null>;
  save(companyId: string, checkpoint: AgentCheckpoint): Promise<boolean>;
  list(companyId: string): Promise<AgentCheckpoint[]>;
}

const KEY = 'agent_checkpoints';
const LIMIT = 100;

async function readReportSettings(companyId: string): Promise<Record<string, unknown>> {
  // CHECKED (report_settings unit 1, 2026-11-12): a read error THROWS ReportSettingsUnreadableError;
  // it is never answered as `{}` (that `{}` used to be written back over the whole column).
  return (await readReportSettingsChecked(companyId)).settings;
}

function checkpointsOf(rs: Record<string, unknown>): AgentCheckpoint[] {
  const arr = rs[KEY];
  return Array.isArray(arr) ? (arr as AgentCheckpoint[]) : [];
}

/** The default report_settings-backed store. Never throws. */
export const reportSettingsAgentStore: AgentStore = {
  async load(companyId, runId) {
    if (!companyId || !runId) return null;
    try {
      const rs = await readReportSettings(companyId);
      return checkpointsOf(rs).find((c) => c.runId === runId) ?? null;
    } catch { return null; }
  },

  async save(companyId, checkpoint) {
    if (!companyId || !checkpoint?.runId) return false;
    try {
      const rs = await readReportSettings(companyId);
      const existing = checkpointsOf(rs);
      const byId = new Map<string, AgentCheckpoint>(existing.map((c) => [c.runId, c]));
      byId.set(checkpoint.runId, checkpoint);
      // Keep active (non-terminal) runs first; bound total.
      const active = (c: AgentCheckpoint) => (c.state === 'COMPLETED' || c.state === 'FAILED' || c.state === 'CANCELLED') ? 1 : 0;
      const merged = Array.from(byId.values())
        .sort((a, b) => active(a) - active(b) || b.executionMetadata.updatedAt.localeCompare(a.executionMetadata.updatedAt))
        .slice(0, LIMIT);
      // Replaces ONLY report_settings.agent_checkpoints, server-side; sibling keys are never rewritten.
      const written = await mergeReportSettingsKeys(companyId, { [KEY]: merged });
      if (!written) { logger.warn('agent_checkpoint_write_no_row', { companyId, runId: checkpoint.runId }); return false; }
      return true;
    } catch (err) {
      logger.warn('agent_checkpoint_write_threw', { companyId, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  async list(companyId) {
    if (!companyId) return [];
    try {
      const rs = await readReportSettings(companyId);
      return checkpointsOf(rs);
    } catch { return []; }
  },
};
