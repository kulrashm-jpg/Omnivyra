/**
 * knowledgeRetention.ts — configurable knowledge retention (CKRE-003 §6).
 *
 * PURE decision + env-driven config. Decides which stored knowledge versions to
 * keep vs archive. NEVER archives or drops the ACTIVE version (safety
 * invariant). Deterministic given the same snapshots + config + now.
 */

import type { KnowledgeSnapshot } from './knowledgeDiffService';

export interface KnowledgeRetentionConfig {
  /** Keep at most this many versions in the live array; older are archived. */
  maxVersions: number;
  /** Archive versions older than this many days (0 = disabled). */
  archiveOlderThanDays: number;
}

function envNum(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

export function getKnowledgeRetentionConfig(): KnowledgeRetentionConfig {
  return {
    maxVersions: envNum('CKRE_KNOWLEDGE_MAX_VERSIONS', 10),
    archiveOlderThanDays: envNum('CKRE_KNOWLEDGE_ARCHIVE_DAYS', 0),
  };
}

export interface RetentionResult {
  kept: KnowledgeSnapshot[];
  archived: KnowledgeSnapshot[];
}

/**
 * Apply retention to a newest-first snapshot array. The ACTIVE version
 * (currentActiveVersion) is always kept. Archived snapshots are removed from the
 * live array but returned so callers can log/count (§9) — never deleted here.
 * Pure.
 */
export function applyRetention(
  snapshots: KnowledgeSnapshot[],
  config: KnowledgeRetentionConfig,
  currentActiveVersion: number,
  nowMs: number,
): RetentionResult {
  const kept: KnowledgeSnapshot[] = [];
  const archived: KnowledgeSnapshot[] = [];
  const cutoff = config.archiveOlderThanDays > 0 ? nowMs - config.archiveOlderThanDays * 86_400_000 : null;

  // Newest-first; keep the most recent `maxVersions`, and anything within the
  // age cutoff, and ALWAYS the active version.
  snapshots.forEach((snap, index) => {
    const isActive = snap.entity.version === currentActiveVersion;
    const withinCount = index < Math.max(1, config.maxVersions);
    const createdMs = Date.parse(snap.entity.createdAt);
    const withinAge = cutoff === null || !Number.isFinite(createdMs) || createdMs >= cutoff;
    if (isActive || (withinCount && withinAge)) kept.push(snap);
    else archived.push(snap);
  });

  return { kept, archived };
}
