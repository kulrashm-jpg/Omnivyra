/**
 * Rollout Kit — server-only admin/Redis surface (BUILD-CERTIFICATION-001).
 *
 * Split out of lib/platform/rollout.ts so that module — which is reachable from
 * CLIENT bundles (content builders → quality panel → an admin page) — carries no
 * import (static OR dynamic) of the Redis/BullMQ layer. webpack bundles dynamic
 * imports into whatever bundle reaches them, so a client-reachable module that
 * `await import('../redis/canonicalClient')` still drags child_process/net/fs/
 * dns/worker_threads into the client build and fails compilation.
 *
 * The client-safe flag API (types, registry, defineRolloutFlag, resolveRolloutSync)
 * stays in rollout.ts. Everything that touches Redis — the admin-config load/write
 * and the async/shadow execution paths that depend on it — lives here and must be
 * imported ONLY from server contexts (API routes, backend services, workers, tests).
 *
 * Behaviour is identical to the pre-split rollout.ts: the admin-config cache is
 * shared via rollout.ts accessors, so resolveRolloutSync still warms on it.
 */
import { recordRawCounter } from '../../backend/observability';
import {
  ROLLOUT_CONFIG_KEY,
  ROLLOUT_ADMIN_CACHE_TTL_MS,
  getRolloutFlag,
  applyRolloutPatch,
  resolveFromSources,
  __getRolloutAdminCache,
  __setRolloutAdminCache,
  __resetRolloutAdminCache,
  type RolloutFlag,
  type RolloutDecision,
  type RolloutAdminConfig,
  type RolloutFlagOverride,
  type RolloutOverridePatch,
  type RolloutRunArgs,
} from './rollout';

async function loadAdminConfig(): Promise<RolloutAdminConfig | null> {
  return (await loadAdminConfigStatus()).data;
}

const READ_TIMED_OUT = Symbol('rollout-admin-read-timeout');

/**
 * The admin config AND whether reading it worked. Behaviour for loadAdminConfig is unchanged
 * (any failure -> null -> env-only resolution); the extra `readable` lets a caller that must
 * fail SAFE tell "no override" from "could not read the override" (WhatsApp stop switch).
 */
async function loadAdminConfigStatus(): Promise<{ data: RolloutAdminConfig | null; readable: boolean | null }> {
  const cached = __getRolloutAdminCache();
  if (cached && Date.now() - cached.ts < ROLLOUT_ADMIN_CACHE_TTL_MS) {
    return { data: cached.data, readable: cached.readable ?? null };
  }
  let data: RolloutAdminConfig | null = null;
  let readable: boolean | null = null;
  try {
    // Redis is optional infrastructure for this kit: absent/unreachable Redis
    // (tests, local dev without Redis) degrades to env-only resolution.
    // F-06: access goes through the canonical Redis layer.
    const { redisConfigured, getStandaloneRedis } = await import('../redis/canonicalClient');
    if (process.env.NODE_ENV !== 'test' && redisConfigured()) {
      // LOAD-BEARING ORDER (05): set BEFORE the client is obtained, so a throw from the client
      // factory lands in the catch as UNREADABLE (fail safe for a stop flag) rather than as
      // "no admin layer" (null, env only). If a refactor moves this below getStandaloneRedis,
      // rolloutAdminReadable.test.ts "client cannot be obtained" fails - fix the code, not the test.
      readable = false;
      const client = await getStandaloneRedis('rate_limit');
      const raw = await Promise.race<string | null | typeof READ_TIMED_OUT>([
        client.get(ROLLOUT_CONFIG_KEY),
        new Promise<typeof READ_TIMED_OUT>((resolve) => setTimeout(() => resolve(READ_TIMED_OUT), 1_500)),
      ]);
      if (raw === null) {
        readable = true; // read, and no override stored
      } else if (raw !== READ_TIMED_OUT) {
        const parsed = JSON.parse(raw); // a parse error lands in catch: readable stays false
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.flags) {
          data = parsed as RolloutAdminConfig;
          readable = true;
        }
        // else: a stored value of the wrong shape is NOT "no override" - readable stays false.
      }
    }
  } catch {
    data = null; // fail-safe: env-only resolution
    // `readable` is false when the Redis layer is configured (client or read failed), and stays
    // null only when the failure came before that (the canonical client module unavailable).
  }
  __setRolloutAdminCache({ data, ts: Date.now(), readable });
  return { data, readable };
}

/** Resolve the effective mode (env + cached admin override + tenant targeting). */
export async function resolveRollout(
  flag: RolloutFlag,
  opts: { tenantId?: string } = {},
): Promise<RolloutDecision> {
  try {
    const admin = await loadAdminConfig();
    return resolveFromSources(flag, admin?.flags?.[flag.key], opts.tenantId);
  } catch {
    return { mode: 'off', source: 'fail-safe' };
  }
}

/**
 * resolveRollout plus whether the admin override could be READ. `adminReadable`: true = read,
 * false = the read failed (the decision then reflects env only), null = no admin layer here.
 * For a flag whose override is a STOP (kill = stop), the caller must treat false as "stopped":
 * resolveRollout alone cannot tell "no override" from "could not read one".
 */
export async function resolveRolloutChecked(
  flag: RolloutFlag,
  opts: { tenantId?: string } = {},
): Promise<{ decision: RolloutDecision; adminReadable: boolean | null }> {
  try {
    const { data, readable } = await loadAdminConfigStatus();
    return { decision: resolveFromSources(flag, data?.flags?.[flag.key], opts.tenantId), adminReadable: readable };
  } catch {
    return { decision: { mode: 'off', source: 'fail-safe' }, adminReadable: false };
  }
}

/**
 * Canonical operator write: read → apply → persist the admin-config namespace,
 * then drop the in-process cache so the next resolve re-reads (no redeploy).
 * Requires Redis (the admin-config transport); without it, only env controls
 * exist and this throws so the caller can report the limitation honestly.
 */
export async function setRolloutOverride(
  flagKey: string,
  patch: RolloutOverridePatch,
): Promise<{ previous: RolloutFlagOverride | null; next: RolloutFlagOverride | null }> {
  const flag = getRolloutFlag(flagKey);
  if (!flag) throw new Error(`unknown rollout flag: ${flagKey}`);

  const { redisConfigured, getStandaloneRedis } = await import('../redis/canonicalClient');
  if (!redisConfigured()) {
    throw new Error('rollout admin config unavailable: Redis not configured (use env controls)');
  }
  const client = await getStandaloneRedis('rate_limit');
  const raw = await client.get(ROLLOUT_CONFIG_KEY);
  let current: RolloutAdminConfig | null = null;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.flags) {
      current = parsed as RolloutAdminConfig;
    }
  }
  const { config, previous, next } = applyRolloutPatch(current, flagKey, patch);
  await client.set(ROLLOUT_CONFIG_KEY, JSON.stringify(config));
  __resetRolloutAdminCache(); // next resolveRollout() re-reads; resolveRolloutSync warms on it
  return { previous, next };
}

// ── Shadow execution ─────────────────────────────────────────────────────────

function defaultEquivalent<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function count(flag: RolloutFlag, result: string): void {
  try {
    recordRawCounter('rollout.shadow', 1, { flag: flag.key, result });
  } catch { /* fail-safe */ }
}

/**
 * Execute under the flag's effective mode. The GATE-C contract: in shadow the
 * caller's observable result is ALWAYS the legacy result; candidate failures
 * and divergences are recorded, never surfaced.
 */
export async function runWithRollout<T>(flag: RolloutFlag, args: RolloutRunArgs<T>): Promise<T> {
  const { mode } = await resolveRollout(flag, { tenantId: args.tenantId });

  if (mode === 'off') return args.legacy();

  if (mode === 'enforce') {
    try { recordRawCounter('rollout.enforce', 1, { flag: flag.key }); } catch { /* fail-safe */ }
    return args.candidate();
  }

  // shadow — run both; legacy remains authoritative.
  const [legacy, candidate] = await Promise.allSettled([args.legacy(), args.candidate()]);

  if (legacy.status === 'rejected') {
    // Legacy failed: propagate exactly as production would today. Record
    // whether the candidate would have survived (a useful promotion signal).
    count(flag, candidate.status === 'fulfilled' ? 'legacy_error_candidate_ok' : 'both_error');
    throw legacy.reason;
  }
  if (candidate.status === 'rejected') {
    count(flag, 'candidate_error');
    return legacy.value;
  }

  let equivalent: boolean | undefined;
  try {
    equivalent = (args.isEquivalent ?? defaultEquivalent)(legacy.value, candidate.value);
  } catch {
    count(flag, 'compare_error');
    return legacy.value;
  }

  count(flag, equivalent ? 'match' : 'divergence');
  if (!equivalent && args.onDivergence) {
    try {
      args.onDivergence({ flag: flag.key, legacy: legacy.value, candidate: candidate.value });
    } catch { /* fail-safe */ }
  }
  return legacy.value;
}
