/**
 * F-04 — Rollout Kit (Foundation Batch A).
 *
 * The reusable off → shadow → enforce rollout lifecycle, promoted from two
 * proven in-repo patterns:
 *   - the staged-mode convention (PLANNER_CONTRACT_ENFORCEMENT_MODE:
 *     shadow/warn/strict) — generalized to off/shadow/enforce, with one
 *     deliberate difference: rollout modes are re-resolved per call (env read
 *     each time + 30 s-cached admin override) so operators can flip a flag
 *     without a redeploy. Enforcement of *contracts* is rightly frozen at
 *     module load; rollout of *implementations* must be reversible live.
 *   - the adminRuntimeConfig storage pattern (Redis key + 30 s in-memory
 *     cache + code-default fallback) for hot overrides and the kill switch.
 *
 * Semantics:
 *   off     → legacy path only. Candidate never runs.
 *   shadow  → legacy result is returned; candidate runs alongside and results
 *             are compared. Divergences/errors are counted, never surfaced.
 *   enforce → candidate is authoritative.
 *   Per-tenant: `enforceTenants` promotes listed tenants (or '*') from shadow
 *   to enforce; it never promotes from off.
 *   Kill switches: ROLLOUT_KILL_SWITCH (global), <PREFIX>_KILL (per flag), or
 *   `killed: true` in the admin override — all resolve to off.
 *
 * Metrics (HARDEN-001 registry): rollout.shadow{flag,result} with result ∈
 * match | divergence | candidate_error | compare_error |
 * legacy_error_candidate_ok, and rollout.enforce{flag}.
 *
 * Fail-safe: any resolution failure yields 'off' (legacy behavior).
 * No production flag is defined in Batch A — first consumer is W2-1.
 */
import { recordRawCounter } from '../../backend/observability';

export type RolloutMode = 'off' | 'shadow' | 'enforce';

export interface RolloutFlagDef {
  /** Stable kebab-case key, e.g. 'tenant-guard-rpc'. Also the metrics label. */
  key: string;
  description: string;
  /** Env prefix; defaults to ROLLOUT_<KEY> (kebab → SCREAMING_SNAKE). */
  envPrefix?: string;
  /** Mode when neither env nor admin override says otherwise. Default 'off'. */
  defaultMode?: RolloutMode;
}

export interface RolloutFlag extends Required<RolloutFlagDef> {}

export interface RolloutDecision {
  mode: RolloutMode;
  /** Where the decision came from (diagnostics + tests). */
  source:
    | 'global-kill' | 'env-kill' | 'admin-kill'
    | 'admin' | 'env' | 'default'
    | 'tenant-promotion' | 'fail-safe';
}

const flagsByKey = new Map<string, RolloutFlag>();

export function defineRolloutFlag(def: RolloutFlagDef): RolloutFlag {
  const envPrefix =
    def.envPrefix ??
    `ROLLOUT_${def.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  const flag: RolloutFlag = {
    key: def.key,
    description: def.description,
    envPrefix,
    defaultMode: def.defaultMode ?? 'off',
  };
  flagsByKey.set(flag.key, flag);
  return flag;
}

/** Registered flags (operator/diagnostic surface). */
export function listRolloutFlags(): RolloutFlag[] {
  return Array.from(flagsByKey.values());
}

function truthyEnv(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function parseMode(raw: string | undefined): RolloutMode | undefined {
  if (!raw) return undefined;
  const v = String(raw).trim().toLowerCase();
  return v === 'off' || v === 'shadow' || v === 'enforce' ? v : undefined;
}

function parseTenants(raw: string | undefined): string[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

// ── Admin override (Redis-backed, adminRuntimeConfig pattern) ────────────────

export const ROLLOUT_CONFIG_KEY = 'omnivyra:admin:config:rollout';

export interface RolloutFlagOverride {
  mode?: RolloutMode;
  enforceTenants?: string[];
  killed?: boolean;
}

export interface RolloutAdminConfig {
  v: 1;
  flags: Record<string, RolloutFlagOverride>;
}

interface CacheEntry { data: RolloutAdminConfig | null; ts: number }
const ADMIN_CACHE_TTL_MS = 30_000;
let adminCache: CacheEntry | null = null;

/** Test seam: drop the cached admin config so the next resolve re-reads. */
export function __resetRolloutAdminCache(): void {
  adminCache = null;
}

async function loadAdminConfig(): Promise<RolloutAdminConfig | null> {
  if (adminCache && Date.now() - adminCache.ts < ADMIN_CACHE_TTL_MS) return adminCache.data;
  let data: RolloutAdminConfig | null = null;
  try {
    // Redis is optional infrastructure for this kit: absent/unreachable Redis
    // (tests, local dev without Redis) degrades to env-only resolution.
    // F-06: access goes through the canonical Redis layer.
    const { redisConfigured, getStandaloneRedis } = await import('../redis/canonicalClient');
    if (process.env.NODE_ENV !== 'test' && redisConfigured()) {
      const client = await getStandaloneRedis('rate_limit');
      const raw = await Promise.race<string | null>([
        client.get(ROLLOUT_CONFIG_KEY),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
      ]);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.flags) {
          data = parsed as RolloutAdminConfig;
        }
      }
    }
  } catch {
    data = null; // fail-safe: env-only resolution
  }
  adminCache = { data, ts: Date.now() };
  return data;
}

// ── Resolution ───────────────────────────────────────────────────────────────

function resolveFromSources(
  flag: RolloutFlag,
  override: RolloutFlagOverride | undefined,
  tenantId?: string,
): RolloutDecision {
  if (truthyEnv('ROLLOUT_KILL_SWITCH')) return { mode: 'off', source: 'global-kill' };
  if (truthyEnv(`${flag.envPrefix}_KILL`)) return { mode: 'off', source: 'env-kill' };
  if (override?.killed) return { mode: 'off', source: 'admin-kill' };

  let mode: RolloutMode;
  let source: RolloutDecision['source'];
  const adminMode = parseMode(override?.mode);
  const envMode = parseMode(process.env[`${flag.envPrefix}_MODE`]);
  if (adminMode) { mode = adminMode; source = 'admin'; }
  else if (envMode) { mode = envMode; source = 'env'; }
  else { mode = flag.defaultMode; source = 'default'; }

  // Tenant promotion: shadow → enforce for targeted tenants. Never from off.
  if (mode === 'shadow' && tenantId) {
    const tenants =
      override?.enforceTenants ?? parseTenants(process.env[`${flag.envPrefix}_TENANTS`]);
    if (tenants && (tenants.includes('*') || tenants.includes(tenantId))) {
      return { mode: 'enforce', source: 'tenant-promotion' };
    }
  }
  return { mode, source };
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
 * Synchronous resolution for non-async call sites: env + the LAST CACHED
 * admin override (may be up to 30 s stale, absent until first async resolve).
 */
export function resolveRolloutSync(
  flag: RolloutFlag,
  opts: { tenantId?: string } = {},
): RolloutDecision {
  try {
    return resolveFromSources(flag, adminCache?.data?.flags?.[flag.key], opts.tenantId);
  } catch {
    return { mode: 'off', source: 'fail-safe' };
  }
}

// ── Shadow execution ─────────────────────────────────────────────────────────

export interface RolloutRunArgs<T> {
  tenantId?: string;
  /** The current production implementation. Authoritative in off/shadow. */
  legacy: () => Promise<T>;
  /** The new implementation. Authoritative in enforce. */
  candidate: () => Promise<T>;
  /** Equivalence check for shadow comparison. Default: JSON deep-equality. */
  isEquivalent?: (legacy: T, candidate: T) => boolean;
  /** Observer hook on divergence (log/sample). Errors are swallowed. */
  onDivergence?: (info: { flag: string; legacy: T; candidate: T }) => void;
}

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
