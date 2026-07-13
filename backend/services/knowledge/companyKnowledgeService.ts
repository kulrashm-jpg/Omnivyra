/**
 * companyKnowledgeService.ts — THE canonical Company Knowledge API (CKRE-003 §10).
 *
 * The single service through which consumers obtain Company Knowledge. It
 * COMPOSES the existing implementations — company_profiles (live fields), the
 * knowledge model (domain projection), CKRE-002 knowledge_version + refresh
 * history, CKRE-001 fingerprints, ONBOARD-001 provenance, the immutable
 * snapshot store, diff engine, retention, and events. It introduces no new
 * knowledge store and duplicates no existing API.
 *
 * All reads are deterministic; all writes are additive + best-effort.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import {
  composeKnowledgeDomains,
  domainConfidence,
  KNOWLEDGE_DOMAINS,
  type CompanyKnowledgeDomains,
  type ProfileRow,
} from './companyKnowledgeModel';
import {
  buildKnowledgeEntity,
  deriveKnowledgeLifecycle,
  type KnowledgeConfidence,
  type KnowledgeEntity,
  type KnowledgeLifecycleState,
} from './companyKnowledgeEntity';
import { diffKnowledge, type KnowledgeDiff, type KnowledgeSnapshot } from './knowledgeDiffService';
import { getKnowledgeRetentionConfig, applyRetention } from './knowledgeRetention';
import { readSnapshots, writeSnapshots, readRollbacks, appendRollback, type RollbackRecord } from './knowledgeSnapshotStore';
import {
  emitKnowledgeEvent, recordRetentionCleanup, resolveKnowledgeCorrelationId,
} from './knowledgeEventService';
import { getKnowledgeState } from '../crawl/knowledgeVersionStore';
import { getLatestWebsiteFingerprint } from '../crawl/fingerprintStore';
import { extractRegistryHashes } from '../crawl/websiteFingerprintService';

async function loadProfileRow(companyId: string): Promise<ProfileRow | null> {
  try {
    const { data } = await supabase.from('company_profiles').select('*').eq('company_id', companyId).maybeSingle();
    return (data as ProfileRow | null) ?? null;
  } catch {
    return null;
  }
}

function confidenceFor(row: ProfileRow): KnowledgeConfidence {
  const byDomain: KnowledgeConfidence['byDomain'] = {};
  for (const d of KNOWLEDGE_DOMAINS) byDomain[d] = domainConfidence(row, d);
  const overall = Number(row.overall_confidence ?? 0);
  return { overall: Number.isFinite(overall) ? overall : 0, byDomain };
}

async function fingerprintRef(companyId: string) {
  const fp = await getLatestWebsiteFingerprint(companyId);
  if (!fp) return { source: null, provenance: null };
  return {
    source: { fingerprintVersion: fp.version ?? null, computedAt: fp.computedAt ?? null, hashes: extractRegistryHashes(fp) },
    provenance: fp.provenance
      ? { producer: fp.provenance.producer, generatedAt: fp.provenance.generatedAt, workflow: fp.provenance.workflow, generationReason: fp.provenance.generationReason }
      : null,
  };
}

/** Compose the live knowledge (domains) for a company. */
export async function getCurrentKnowledge(companyId: string): Promise<{ entity: KnowledgeEntity; domains: CompanyKnowledgeDomains['domains'] } | null> {
  if (!companyId) return null;
  // Prefer the stored ACTIVE snapshot; fall back to composing from live fields.
  const [snapshots, state, row] = await Promise.all([
    readSnapshots(companyId),
    getKnowledgeState(companyId),
    loadProfileRow(companyId),
  ]);
  const currentVersion = state.version?.version ?? 0;
  const active = snapshots.find((s) => s.entity.version === currentVersion);
  if (active) return { entity: active.entity, domains: active.domains };
  if (!row) return null;

  const composed = composeKnowledgeDomains(companyId, row);
  const { source, provenance } = await fingerprintRef(companyId);
  const entity = buildKnowledgeEntity({
    companyId, version: currentVersion,
    createdAt: String(row.last_refined_at ?? new Date().toISOString()),
    refreshReason: state.version?.refreshReason ?? 'composed_live',
    refreshPolicy: 'EXECUTE_REFRESH',
    sourceFingerprints: source, provenance,
    confidence: confidenceFor(row),
    dependencies: [],
    lifecycle: currentVersion > 0 ? 'ACTIVE' : 'CREATED',
  });
  return { entity, domains: composed.domains };
}

/** Fetch a specific version's immutable snapshot. */
export async function getKnowledgeByVersion(companyId: string, version: number): Promise<KnowledgeSnapshot | null> {
  const snapshots = await readSnapshots(companyId);
  return snapshots.find((s) => s.entity.version === version) ?? null;
}

/** Full knowledge history with derived lifecycle per version + rollback log. */
export async function getKnowledgeHistory(companyId: string): Promise<{
  versions: Array<{ version: number; lifecycle: KnowledgeLifecycleState; entity: KnowledgeEntity }>;
  rollbacks: RollbackRecord[];
}> {
  const [snapshots, state, rollbacks] = await Promise.all([
    readSnapshots(companyId), getKnowledgeState(companyId), readRollbacks(companyId),
  ]);
  const currentVersion = state.version?.version ?? 0;
  const versions = snapshots
    .map((s) => ({ version: s.entity.version, lifecycle: deriveKnowledgeLifecycle(s.entity.lifecycle, s.entity.version, currentVersion), entity: s.entity }))
    .sort((a, b) => b.version - a.version);
  return { versions, rollbacks };
}

/** Derived lifecycle state of a version. */
export async function getKnowledgeLifecycle(companyId: string, version: number): Promise<KnowledgeLifecycleState | null> {
  const [snap, state] = await Promise.all([getKnowledgeByVersion(companyId, version), getKnowledgeState(companyId)]);
  if (!snap) return null;
  return deriveKnowledgeLifecycle(snap.entity.lifecycle, version, state.version?.version ?? 0);
}

/** Deterministic diff between two versions (emits KnowledgeCompared). */
export async function diffKnowledgeVersions(companyId: string, fromVersion: number | null, toVersion: number): Promise<KnowledgeDiff | null> {
  const snapshots = await readSnapshots(companyId);
  const next = snapshots.find((s) => s.entity.version === toVersion);
  if (!next) return null;
  const prev = fromVersion == null ? null : snapshots.find((s) => s.entity.version === fromVersion) ?? null;
  const diff = diffKnowledge(prev, next);
  const correlationId = await resolveKnowledgeCorrelationId(null, companyId);
  void emitKnowledgeEvent({ event: 'KnowledgeCompared', outcome: 'allowed', correlationId, companyId, version: toVersion, reason: `diff_${fromVersion ?? 'none'}_to_${toVersion}`, metadata: { changedDomains: diff.changedDomains } });
  return diff;
}

export interface CaptureKnowledgeInput {
  companyId: string;
  version: number;
  refreshReason: string;
  refreshPolicy: string;
  createdBy?: string | null;
  dependencies?: string[];
  now?: string;
}

/**
 * Capture a new immutable knowledge version from the live profile: compose
 * domains, build the entity, prepend an immutable snapshot (superseding the
 * prior active), apply retention, and emit the lifecycle events. Called after a
 * successful refresh (CKRE-002 finalize / metadata path). Best-effort; never
 * throws (a capture failure never breaks the refresh).
 */
export async function captureKnowledgeVersion(input: CaptureKnowledgeInput): Promise<{ ok: boolean; version: number }> {
  const { companyId } = input;
  if (!companyId || !(input.version > 0)) return { ok: false, version: input.version };
  const now = input.now ?? new Date().toISOString();
  try {
    const row = await loadProfileRow(companyId);
    if (!row) return { ok: false, version: input.version };

    const composed = composeKnowledgeDomains(companyId, row);
    const { source, provenance } = await fingerprintRef(companyId);
    const entity = buildKnowledgeEntity({
      companyId, version: input.version, createdAt: now, createdBy: input.createdBy ?? null,
      refreshReason: input.refreshReason, refreshPolicy: input.refreshPolicy,
      sourceFingerprints: source, provenance,
      confidence: confidenceFor(row),
      dependencies: (input.dependencies ?? []) as never[],
      lifecycle: 'ACTIVE',
    });
    const snapshot: KnowledgeSnapshot = { entity, domains: composed.domains };

    const existing = await readSnapshots(companyId);
    // Prior active becomes superseded (marker); immutable — we prepend, never edit in place.
    const priorActive = existing.find((s) => s.entity.lifecycle === 'ACTIVE');
    const prepended = [snapshot, ...existing.filter((s) => s.entity.version !== input.version)];

    const config = getKnowledgeRetentionConfig();
    const { kept, archived } = applyRetention(prepended, config, input.version, Date.parse(now) || Date.now());
    await writeSnapshots(companyId, kept, now);

    const correlationId = await resolveKnowledgeCorrelationId(null, companyId);
    const emit = (event: Parameters<typeof emitKnowledgeEvent>[0]['event'], version?: number | null, reason?: string) =>
      emitKnowledgeEvent({ event, outcome: 'allowed', correlationId, companyId, version: version ?? input.version, reason: reason ?? input.refreshReason });
    await emit('KnowledgeCreated');
    await emit('KnowledgeValidated');
    await emit('KnowledgeActivated');
    await emit('KnowledgeSnapshotCreated');
    if (priorActive && priorActive.entity.version !== input.version) await emit('KnowledgeSuperseded', priorActive.entity.version, 'superseded_by_new_version');
    for (const a of archived) await emit('KnowledgeArchived', a.entity.version, 'retention');
    recordRetentionCleanup(archived.length);

    return { ok: true, version: input.version };
  } catch (err) {
    logger.warn('capture_knowledge_version_threw', { companyId, message: err instanceof Error ? err.message : String(err) });
    return { ok: false, version: input.version };
  }
}

/**
 * Record deterministic rollback metadata to a target version (§7). Validates
 * the target exists and is not archived; appends to the rollback history; emits
 * KnowledgeRolledBack. Does NOT overwrite history and does NOT mutate the live
 * profile — field restoration is orchestration (CKRE-004). Returns the target
 * snapshot for the caller to act on.
 */
export async function rollbackKnowledge(companyId: string, targetVersion: number, reason: string, now: string = new Date().toISOString()): Promise<{ ok: boolean; validated: boolean; target: KnowledgeSnapshot | null; error?: string }> {
  if (!companyId) return { ok: false, validated: false, target: null, error: 'NO_COMPANY' };
  const [snapshots, state] = await Promise.all([readSnapshots(companyId), getKnowledgeState(companyId)]);
  const target = snapshots.find((s) => s.entity.version === targetVersion) ?? null;
  const currentVersion = state.version?.version ?? 0;

  const validated = !!target && deriveKnowledgeLifecycle(target.entity.lifecycle, targetVersion, currentVersion) !== 'ARCHIVED' && targetVersion !== currentVersion;
  const record: RollbackRecord = { at: now, fromVersion: currentVersion || null, targetVersion, reason, validated };
  await appendRollback(companyId, record, now);

  const correlationId = await resolveKnowledgeCorrelationId(null, companyId);
  void emitKnowledgeEvent({ event: 'KnowledgeRolledBack', outcome: validated ? 'allowed' : 'denied', correlationId, companyId, version: targetVersion, reason, metadata: { fromVersion: currentVersion, validated } });

  if (!target) return { ok: false, validated: false, target: null, error: 'TARGET_NOT_FOUND' };
  if (!validated) return { ok: false, validated: false, target, error: 'INVALID_ROLLBACK_TARGET' };
  return { ok: true, validated: true, target };
}
