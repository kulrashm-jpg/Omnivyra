/**
 * knowledgeSnapshotStore.ts — immutable knowledge snapshots + rollback metadata
 * (CKRE-003 §5/§7).
 *
 * ADDITIVE. Reuses company_profiles.report_settings JSONB — NO new table, no
 * duplicate store. Keys:
 *   - report_settings.knowledge_snapshots : newest-first, retention-bounded
 *     array of immutable { entity, domains } snapshots (never overwritten in
 *     place — a new version is prepended).
 *   - report_settings.knowledge_rollbacks : append-only (bounded) rollback log.
 * Writes merge into report_settings so siblings (knowledge_version,
 * refresh_history, website_fingerprint, discovered_metadata, …) are preserved.
 * Best-effort/fail-safe.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import type { KnowledgeSnapshot } from './knowledgeDiffService';

const SNAPSHOTS_KEY = 'knowledge_snapshots';
const ROLLBACKS_KEY = 'knowledge_rollbacks';
const ROLLBACK_LOG_LIMIT = 50;

export interface RollbackRecord {
  at: string;
  fromVersion: number | null;
  targetVersion: number;
  reason: string;
  validated: boolean;
}

async function readReportSettings(companyId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('company_profiles')
    .select('report_settings')
    .eq('company_id', companyId)
    .maybeSingle();
  return ((data as { report_settings?: Record<string, unknown> } | null)?.report_settings) ?? {};
}

async function mergeReportSettings(companyId: string, patch: Record<string, unknown>, now: string): Promise<boolean> {
  const current = await readReportSettings(companyId);
  const { error } = await supabase
    .from('company_profiles')
    .update({ report_settings: { ...current, ...patch }, updated_at: now })
    .eq('company_id', companyId);
  if (error) {
    logger.warn('knowledge_snapshot_store_failed', { companyId, message: error.message });
    return false;
  }
  return true;
}

/** Read the snapshot array (newest-first). Never throws. */
export async function readSnapshots(companyId: string): Promise<KnowledgeSnapshot[]> {
  if (!companyId) return [];
  try {
    const rs = await readReportSettings(companyId);
    const arr = rs[SNAPSHOTS_KEY];
    return Array.isArray(arr) ? (arr as KnowledgeSnapshot[]) : [];
  } catch {
    return [];
  }
}

/** Overwrite the snapshot array (used after prepend + retention). Never throws. */
export async function writeSnapshots(companyId: string, snapshots: KnowledgeSnapshot[], now: string = new Date().toISOString()): Promise<boolean> {
  if (!companyId) return false;
  try {
    return await mergeReportSettings(companyId, { [SNAPSHOTS_KEY]: snapshots }, now);
  } catch (err) {
    logger.warn('knowledge_snapshot_write_threw', { companyId, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Read the rollback log (newest-first). Never throws. */
export async function readRollbacks(companyId: string): Promise<RollbackRecord[]> {
  if (!companyId) return [];
  try {
    const rs = await readReportSettings(companyId);
    const arr = rs[ROLLBACKS_KEY];
    return Array.isArray(arr) ? (arr as RollbackRecord[]) : [];
  } catch {
    return [];
  }
}

/** Append a rollback record (bounded, newest-first). Does NOT overwrite history. Never throws. */
export async function appendRollback(companyId: string, record: RollbackRecord, now: string = new Date().toISOString()): Promise<boolean> {
  if (!companyId) return false;
  try {
    const existing = await readRollbacks(companyId);
    const next = [record, ...existing].slice(0, ROLLBACK_LOG_LIMIT);
    return await mergeReportSettings(companyId, { [ROLLBACKS_KEY]: next }, now);
  } catch (err) {
    logger.warn('knowledge_rollback_append_threw', { companyId, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
