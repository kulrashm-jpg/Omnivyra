/**
 * knowledgeVersionStore.ts — canonical knowledge version + refresh history
 * (CKRE-002 §5/§7).
 *
 * ADDITIVE. Reuses company_profiles.report_settings JSONB — NO new table, no
 * migration, no replacement of the existing profile storage. Two keys:
 *   - report_settings.knowledge_version  : the current version + rollback meta
 *   - report_settings.refresh_history    : bounded array of refresh records
 * Writes merge into report_settings so siblings (discovered_metadata,
 * website_fingerprint, activation_latch, …) are preserved. Best-effort/fail-safe.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import type { RefreshAction } from './refreshPolicyEngine';
import type { ChangeVerdict } from './changeDetectionService';

export interface KnowledgeVersion {
  version: number;
  previousVersion: number | null;
  refreshReason: string;
  affectedSections: string[];
  createdAt: string;
  /** Rollback metadata — enough to identify the prior state. */
  rollback: { previousVersion: number | null; previousCreatedAt: string | null };
}

export interface RefreshHistoryRecord {
  at: string;
  reason: string;
  action: RefreshAction;
  verdict: ChangeVerdict | null;
  knowledgeVersion: number | null;
  affectedSections: string[];
  executionMs: number | null;
  tokens: number | null;
  cacheHit: boolean;
  cacheMiss: boolean;
}

export interface KnowledgeState {
  version: KnowledgeVersion | null;
  history: RefreshHistoryRecord[];
}

async function readReportSettings(companyId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('company_profiles')
    .select('report_settings')
    .eq('company_id', companyId)
    .maybeSingle();
  return ((data as { report_settings?: Record<string, unknown> } | null)?.report_settings) ?? {};
}

/** Read the current knowledge version + history. Never throws. */
export async function getKnowledgeState(companyId: string): Promise<KnowledgeState> {
  if (!companyId) return { version: null, history: [] };
  try {
    const rs = await readReportSettings(companyId);
    const version = (rs.knowledge_version && typeof rs.knowledge_version === 'object')
      ? (rs.knowledge_version as KnowledgeVersion) : null;
    const history = Array.isArray(rs.refresh_history) ? (rs.refresh_history as RefreshHistoryRecord[]) : [];
    return { version, history };
  } catch {
    return { version: null, history: [] };
  }
}

/** True when a knowledge baseline exists for this company. */
export async function hasKnowledgeVersion(companyId: string): Promise<boolean> {
  return (await getKnowledgeState(companyId)).version !== null;
}

export interface RecordRefreshInput {
  companyId: string;
  /** When true, a new knowledge version is minted (successful content refresh). */
  createVersion: boolean;
  refreshReason: string;
  action: RefreshAction;
  verdict: ChangeVerdict | null;
  affectedSections: string[];
  executionMs?: number | null;
  tokens?: number | null;
  cacheHit?: boolean;
  cacheMiss?: boolean;
  historyLimit: number;
  now?: string;
}

export interface RecordRefreshResult {
  version: number | null;
  created: boolean;
}

/**
 * Record a refresh outcome: append a bounded history record and, when
 * createVersion is set, mint the next knowledge version (additive, monotonic).
 * Merges into report_settings; best-effort. Returns the resulting version.
 */
export async function recordRefresh(input: RecordRefreshInput): Promise<RecordRefreshResult> {
  const now = input.now ?? new Date().toISOString();
  if (!input.companyId) return { version: null, created: false };
  try {
    const rs = await readReportSettings(input.companyId);
    const prior = (rs.knowledge_version && typeof rs.knowledge_version === 'object')
      ? (rs.knowledge_version as KnowledgeVersion) : null;
    const existingHistory = Array.isArray(rs.refresh_history) ? (rs.refresh_history as RefreshHistoryRecord[]) : [];

    let nextVersion: KnowledgeVersion | null = prior;
    let created = false;
    if (input.createVersion) {
      const priorNum = prior?.version ?? 0;
      nextVersion = {
        version: priorNum + 1,
        previousVersion: prior?.version ?? null,
        refreshReason: input.refreshReason,
        affectedSections: input.affectedSections,
        createdAt: now,
        rollback: { previousVersion: prior?.version ?? null, previousCreatedAt: prior?.createdAt ?? null },
      };
      created = true;
    }

    const record: RefreshHistoryRecord = {
      at: now,
      reason: input.refreshReason,
      action: input.action,
      verdict: input.verdict,
      knowledgeVersion: nextVersion?.version ?? null,
      affectedSections: input.affectedSections,
      executionMs: input.executionMs ?? null,
      tokens: input.tokens ?? null,
      cacheHit: input.cacheHit ?? false,
      cacheMiss: input.cacheMiss ?? false,
    };
    // Newest-first, bounded.
    const history = [record, ...existingHistory].slice(0, Math.max(1, input.historyLimit));

    const next = { ...rs, refresh_history: history, ...(nextVersion ? { knowledge_version: nextVersion } : {}) };
    const { error } = await supabase
      .from('company_profiles')
      .update({ report_settings: next, updated_at: now })
      .eq('company_id', input.companyId);
    if (error) {
      logger.warn('knowledge_version_record_failed', { companyId: input.companyId, message: error.message });
      return { version: prior?.version ?? null, created: false };
    }
    return { version: nextVersion?.version ?? null, created };
  } catch (err) {
    logger.warn('knowledge_version_record_threw', {
      companyId: input.companyId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { version: null, created: false };
  }
}
