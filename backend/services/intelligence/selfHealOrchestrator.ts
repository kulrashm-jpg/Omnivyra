/**
 * Self-heal orchestration engine.
 *
 * Coordinates ONLY pre-existing, idempotent, rate-limited recovery primitives
 * — it introduces no new mutation path:
 *   - canonical API-base rediscovery → cmsApiBaseResolver.rediscoverAndRepairApiBase
 *   - legacy connection normalization → cmsConnectionNormalizationService
 * Adds an orchestration layer: per-tenant cooldown, repair-attempt history,
 * repair-confidence scoring, safe-mode fallback, and telemetry. Tenant-safe
 * (company-scoped), rollback-safe (delegates to idempotent ops), observable.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { rediscoverAndRepairApiBase } from '../cms/cmsApiBaseResolver';
import { normalizeCmsConnections } from '../cms/cmsConnectionNormalizationService';
import { isCmsProvider } from '../cms/registry';
import {
  acquireLease,
  durableCooldownRemainingMs,
  getDurableHistory,
  newCorrelationId,
  recordOrchestrationEvent,
  releaseLease,
  type DurableAttemptRecord,
} from './durableOrchestrationStore';

export interface RepairAttempt {
  at: string;
  connectionId: string;
  provider: string;
  action: 'api_base_rediscovery';
  outcome: 'repaired' | 'unchanged' | 'degraded' | 'error';
  detail: string;
}

export interface SelfHealResult {
  companyId: string;
  startedAt: string;
  finishedAt: string;
  mode: 'ran' | 'cooldown' | 'safe_mode';
  scanned: number;
  repaired: number;
  unchanged: number;
  errors: number;
  normalizationRun: boolean;
  repairConfidence: number; // 0..100
  attempts: RepairAttempt[];
  notes: string[];
}

const COOLDOWN_MS = 5 * 60_000;
const HISTORY_LIMIT = 50;
const SAFE_MODE_ERROR_RATIO = 0.7; // >70% errors in a sweep → safe-mode next time

const lastRunAt = new Map<string, number>();
const safeModeUntil = new Map<string, number>();
const history = new Map<string, RepairAttempt[]>();

function pushHistory(companyId: string, attempts: RepairAttempt[]): void {
  const cur = history.get(companyId) ?? [];
  const next = [...attempts, ...cur].slice(0, HISTORY_LIMIT);
  history.set(companyId, next);
}

/** Fast in-memory history (process-local). */
export function getSelfHealHistory(companyId: string): RepairAttempt[] {
  return history.get(companyId) ?? [];
}

/**
 * Durable, multi-instance history (audit_events-backed). Falls back to the
 * in-memory snapshot when the durable store is unavailable.
 */
export async function getSelfHealHistoryDurable(
  companyId: string,
  limit = 50,
): Promise<{ source: 'durable' | 'in_memory'; records: Array<DurableAttemptRecord | RepairAttempt> }> {
  const durable = await getDurableHistory(companyId, limit);
  if (durable.length > 0) return { source: 'durable', records: durable };
  return { source: 'in_memory', records: getSelfHealHistory(companyId) };
}

interface ConnRow {
  id: string;
  provider: string;
  health_status: string | null;
  non_secret_config: Record<string, unknown> | null;
}

/**
 * Run a bounded, idempotent self-heal sweep for one company.
 * @param opts.includeNormalization also run the idempotent normalization job.
 * @param opts.force bypass the per-tenant cooldown (still safe-mode aware).
 */
export async function runSelfHeal(
  companyId: string,
  opts: { includeNormalization?: boolean; force?: boolean } = {},
): Promise<SelfHealResult> {
  const startedAt = new Date().toISOString();
  const notes: string[] = [];

  const sm = safeModeUntil.get(companyId) ?? 0;
  if (Date.now() < sm) {
    notes.push('Safe-mode active after a high-error sweep — skipping automated repair.');
    return {
      companyId, startedAt, finishedAt: new Date().toISOString(), mode: 'safe_mode',
      scanned: 0, repaired: 0, unchanged: 0, errors: 0, normalizationRun: false,
      repairConfidence: 0, attempts: [], notes,
    };
  }

  const correlationId = newCorrelationId();
  const last = lastRunAt.get(companyId) ?? 0;
  // Cooldown is the MAX of process-local and durable (multi-instance) state,
  // so two app instances cannot both sweep within the window.
  let durableRemaining = 0;
  if (!opts.force) {
    durableRemaining = await durableCooldownRemainingMs(
      companyId,
      'self_heal_sweep',
      COOLDOWN_MS,
    ).catch(() => 0);
  }
  const localRemaining = opts.force ? 0 : Math.max(0, COOLDOWN_MS - (Date.now() - last));
  const remaining = Math.max(localRemaining, durableRemaining);
  if (!opts.force && remaining > 0) {
    notes.push(`Cooldown active (${Math.ceil(remaining / 1000)}s left${durableRemaining > localRemaining ? ', durable' : ''}).`);
    return {
      companyId, startedAt, finishedAt: new Date().toISOString(), mode: 'cooldown',
      scanned: 0, repaired: 0, unchanged: 0, errors: 0, normalizationRun: false,
      repairConfidence: 0, attempts: [], notes,
    };
  }
  lastRunAt.set(companyId, Date.now());

  // Distributed mutex: only one instance sweeps a company at a time. TTL makes
  // a crashed holder self-recover; a lost race still can't double-sweep
  // because the durable cooldown above already gated us.
  const lease = await acquireLease({
    companyId,
    scope: 'self_heal_sweep',
    owner: `${process.pid}:${correlationId}`,
    ttlMs: 2 * 60_000,
  }).catch(() => null);
  if (!lease) {
    notes.push('Another instance holds the self-heal lease — skipping to prevent concurrent sweeps.');
    return {
      companyId, startedAt, finishedAt: new Date().toISOString(), mode: 'cooldown',
      scanned: 0, repaired: 0, unchanged: 0, errors: 0, normalizationRun: false,
      repairConfidence: 0, attempts: [], notes,
    };
  }

  // Resolve company's CMS connections (tenant-scoped).
  let rows: ConnRow[] = [];
  try {
    const { data: ints } = await ownedDbTable('company_integrations')
      .select('type, website_connection_id')
      .eq('company_id', companyId);
    const ids = ((ints ?? []) as Array<{ type: string; website_connection_id: string | null }>)
      .filter((i) => isCmsProvider(i.type))
      .map((i) => i.website_connection_id)
      .filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const { data } = await ownedDbTable('website_connections')
        .select('id, provider, health_status, non_secret_config')
        .in('id', ids);
      rows = (data ?? []) as ConnRow[];
    }
  } catch (err) {
    notes.push(`Could not load connections: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // Only act on connections that look unhealthy — never churn healthy ones.
  const targets = rows.filter(
    (c) => c.health_status === 'degraded' || c.health_status === 'failed',
  );

  const attempts: RepairAttempt[] = [];
  let repaired = 0;
  let unchanged = 0;
  let errors = 0;

  for (const c of targets) {
    const cfg = (c.non_secret_config ?? {}) as Record<string, string>;
    const siteUrl = String(cfg.site_url || cfg.endpoint_url || cfg.shop_domain || '').replace(/\/+$/, '');
    if (!siteUrl) {
      unchanged += 1;
      attempts.push({ at: new Date().toISOString(), connectionId: c.id, provider: c.provider, action: 'api_base_rediscovery', outcome: 'unchanged', detail: 'no site URL to rediscover' });
      continue;
    }
    try {
      const before = (cfg as any)?.api_discovery?.canonical_api_base ?? null;
      const resolved = await rediscoverAndRepairApiBase({
        provider: c.provider,
        siteUrl,
        connectionId: c.id,
        fetchFn: (url) => fetch(url),
      });
      let outcome: RepairAttempt['outcome'];
      if (resolved.degraded) { outcome = 'degraded'; }
      else if (before && resolved.apiBase && resolved.apiBase !== before) { outcome = 'repaired'; repaired += 1; }
      else if (!before && resolved.apiBase && resolved.source === 'runtime_discovery') { outcome = 'repaired'; repaired += 1; }
      else { outcome = 'unchanged'; unchanged += 1; }
      attempts.push({ at: new Date().toISOString(), connectionId: c.id, provider: c.provider, action: 'api_base_rediscovery', outcome, detail: `source=${resolved.source} degraded=${resolved.degraded}` });
    } catch (err) {
      errors += 1;
      attempts.push({ at: new Date().toISOString(), connectionId: c.id, provider: c.provider, action: 'api_base_rediscovery', outcome: 'error', detail: err instanceof Error ? err.message : 'unknown' });
    }
  }

  let normalizationRun = false;
  if (opts.includeNormalization) {
    try {
      await normalizeCmsConnections(companyId);
      normalizationRun = true;
    } catch (err) {
      notes.push(`Normalization failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  const acted = targets.length || 1;
  if (errors / acted > SAFE_MODE_ERROR_RATIO) {
    safeModeUntil.set(companyId, Date.now() + 30 * 60_000);
    notes.push('High error ratio — entering 30m safe-mode (no automated repair).');
  }

  // Repair confidence: weight successful repairs, penalise errors/degraded.
  const repairConfidence =
    targets.length === 0
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(((repaired + unchanged * 0.6) / targets.length) * 100 - errors * 10),
          ),
        );

  pushHistory(companyId, attempts);
  if (targets.length === 0) notes.push('No degraded/failed connections — nothing to heal.');

  // Durable, multi-instance-safe record of the sweep (append-only audit_events;
  // soft-fails — never blocks or throws into the heal path).
  await recordOrchestrationEvent({
    companyId,
    kind: 'self_heal_sweep',
    correlationId,
    actorType: 'worker',
    detail: {
      scanned: rows.length,
      repaired,
      unchanged,
      errors,
      normalizationRun,
      repairConfidence,
      attempts,
    },
  });

  await releaseLease(companyId, lease).catch(() => undefined);

  return {
    companyId,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: 'ran',
    scanned: rows.length,
    repaired,
    unchanged,
    errors,
    normalizationRun,
    repairConfidence,
    attempts,
    notes,
  };
}
