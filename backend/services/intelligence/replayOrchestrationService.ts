/**
 * Replay / DLQ orchestration BOUNDARY (append-only, idempotent, isolated).
 *
 * Design constraint honoured: this NEVER mutates live ingestion/queue write
 * paths. A "replay" re-invokes an ALREADY-IDEMPOTENT service entrypoint behind
 * an isolated orchestration boundary, under an atomic lock, with dedupe +
 * append-only audit lineage. Persistence is the existing append-only
 * `audit_events` substrate (resource_type 'dead_letter' | 'replay_job') — no
 * new table, no migration dependency.
 *
 * Replay targets (whitelist of idempotent ops only):
 *   - api_base_rediscovery   → cmsApiBaseResolver.rediscoverAndRepairApiBase
 *   - connection_revalidate  → integrationService.validateIntegration
 *   - normalization          → cmsConnectionNormalizationService.normalizeCmsConnections
 * Raw ingestion/webhook byte-replay is intentionally NOT supported here
 * (would require live write-path access) — reported as a limitation.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { acquireAtomicLock, releaseAtomicLock } from './atomicLockService';
import { rediscoverAndRepairApiBase } from '../cms/cmsApiBaseResolver';
import { normalizeCmsConnections } from '../cms/cmsConnectionNormalizationService';
import { validateIntegration } from '../integrationService';

export type ReplayTarget = 'api_base_rediscovery' | 'connection_revalidate' | 'normalization';
const REPLAY_TARGETS: ReplayTarget[] = ['api_base_rediscovery', 'connection_revalidate', 'normalization'];

export interface DeadLetterInput {
  companyId: string;
  source: string;            // e.g. 'publish' | 'reconciliation' | 'attribution'
  target: ReplayTarget;
  dedupeKey: string;         // caller-stable: replays of same key are deduped
  payload: Record<string, unknown>;
  error: string;
}

export async function recordDeadLetter(input: DeadLetterInput): Promise<{ correlationId: string }> {
  return recordComplianceAudit({
    companyId: input.companyId,
    actor: { userId: null, type: 'system', label: 'dlq' },
    action: `dead_letter.${input.source}`,
    resourceType: 'dead_letter',
    resourceId: input.dedupeKey,
    entityLineage: ['company', 'dead_letter', input.source, input.target],
    severity: 'warning',
    outcome: 'failure',
    detail: { source: input.source, target: input.target, dedupeKey: input.dedupeKey, payload: input.payload, error: input.error, status: 'pending' },
  });
}

export async function listDeadLetters(companyId: string, limit = 100): Promise<any[]> {
  try {
    const { data, error } = await ownedDbTable('audit_events')
      .select('resource_id, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'dead_letter')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      dedupeKey: r.resource_id,
      at: r.created_at,
      ...(r.metadata ?? {}),
    }));
  } catch {
    return [];
  }
}

/** True if a successful replay for this dedupeKey already exists (idempotency). */
async function alreadyReplayedOk(companyId: string, dedupeKey: string): Promise<boolean> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('metadata')
      .eq('company_id', companyId)
      .eq('resource_type', 'replay_job')
      .eq('resource_id', dedupeKey)
      .order('created_at', { ascending: false })
      .limit(5);
    return ((data ?? []) as any[]).some((r) => (r.metadata ?? {}).outcome === 'succeeded');
  } catch {
    return false;
  }
}

async function dispatch(
  companyId: string,
  target: ReplayTarget,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (target === 'normalization') {
      const r = await normalizeCmsConnections(companyId);
      return { ok: true, detail: `normalized=${r.connectionsBackfilled} discovered=${r.apiBasesDiscovered}` };
    }
    if (target === 'connection_revalidate') {
      const id = String(payload.integrationId ?? '');
      if (!id) return { ok: false, detail: 'missing integrationId' };
      const r = await validateIntegration(id, companyId, { rediscover: true });
      return { ok: r.success, detail: r.message };
    }
    if (target === 'api_base_rediscovery') {
      const provider = String(payload.provider ?? '');
      const siteUrl = String(payload.siteUrl ?? '');
      const connectionId = (payload.connectionId as string) ?? null;
      if (!provider || !siteUrl) return { ok: false, detail: 'missing provider/siteUrl' };
      const r = await rediscoverAndRepairApiBase({ provider, siteUrl, connectionId, fetchFn: (u) => fetch(u) });
      return { ok: !r.degraded, detail: `source=${r.source} degraded=${r.degraded}` };
    }
    return { ok: false, detail: 'unsupported target' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'dispatch error' };
  }
}

export interface ReplayResult {
  companyId: string;
  dedupeKey: string;
  status: 'succeeded' | 'failed' | 'deduped' | 'throttled';
  detail: string;
  correlationId: string;
}

/**
 * Execute a replay: atomic-locked, deduped, idempotent-target dispatch, with
 * append-only attempt + outcome lineage. Safe to call repeatedly.
 */
export async function executeReplay(args: {
  companyId: string;
  target: ReplayTarget;
  dedupeKey: string;
  payload: Record<string, unknown>;
}): Promise<ReplayResult> {
  const { companyId, target, dedupeKey, payload } = args;
  if (!REPLAY_TARGETS.includes(target)) {
    return { companyId, dedupeKey, status: 'failed', detail: `unsupported target ${target}`, correlationId: '' };
  }
  if (await alreadyReplayedOk(companyId, dedupeKey)) {
    return { companyId, dedupeKey, status: 'deduped', detail: 'already replayed successfully', correlationId: '' };
  }

  const lock = await acquireAtomicLock({
    companyId,
    scope: `replay:${target}`,
    owner: `replay:${process.pid}:${dedupeKey}`,
    ttlMs: 90_000,
  }).catch(() => null);
  if (!lock) {
    return { companyId, dedupeKey, status: 'throttled', detail: 'replay lock held — retry later', correlationId: '' };
  }

  try {
    const res = await dispatch(companyId, target, payload);
    const { correlationId } = await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'replay-orchestrator' },
      action: `replay.${target}`,
      resourceType: 'replay_job',
      resourceId: dedupeKey,
      entityLineage: ['company', 'replay_job', target],
      outcome: res.ok ? 'success' : 'failure',
      detail: { target, dedupeKey, fencing: lock.fencing, lockMode: lock.mode, outcome: res.ok ? 'succeeded' : 'failed', detail: res.detail },
    });
    return {
      companyId,
      dedupeKey,
      status: res.ok ? 'succeeded' : 'failed',
      detail: res.detail,
      correlationId,
    };
  } finally {
    await releaseAtomicLock(lock).catch(() => undefined);
  }
}
