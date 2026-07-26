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
 *
 * BUILD-CERTIFICATION-001: this module is reachable from CLIENT bundles, so it
 * must not import (statically or dynamically) the Redis/BullMQ layer. The
 * Redis-backed admin surface and the async/shadow execution runner live in the
 * server-only ./rolloutAdmin module and share this module's admin-config cache.
 */
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

/** Look up a registered flag by key (operator write-surface validation). */
export function getRolloutFlag(key: string): RolloutFlag | undefined {
  return flagsByKey.get(key);
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
/** Admin-config cache TTL. Shared with the server-only rolloutAdmin loader. */
export const ROLLOUT_ADMIN_CACHE_TTL_MS = 30_000;
let adminCache: CacheEntry | null = null;

/** Test seam: drop the cached admin config so the next resolve re-reads. */
export function __resetRolloutAdminCache(): void {
  adminCache = null;
}

/**
 * Internal seams for the server-only ./rolloutAdmin loader to read/write the
 * SAME admin-config cache that resolveRolloutSync warms on. Kept here (not in
 * rolloutAdmin) so this client-safe module owns the cache and carries no Redis
 * import; the loader in rolloutAdmin populates it.
 */
export function __getRolloutAdminCache(): CacheEntry | null {
  return adminCache;
}
export function __setRolloutAdminCache(entry: CacheEntry | null): void {
  adminCache = entry;
}

// ── Resolution ───────────────────────────────────────────────────────────────

export function resolveFromSources(
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

// ── Operator write surface ────────────────────────────────────────────────────
// The single canonical mutation path for the generic rollout kit. Writes the
// SAME admin-config namespace that loadAdminConfig() reads (ROLLOUT_CONFIG_KEY)
// — no parallel storage, registry, or evaluation. Resolution priority is
// unchanged (env-kill > admin-kill > admin-mode > env-mode > default; tenant
// promotion for shadow), so an override only takes effect where env does not
// already force the decision. Kill switches and planner-specific controls are
// untouched.

/** A single-flag operator mutation. `null` clears a field; `clear` removes the whole override. */
export interface RolloutOverridePatch {
  /** Set the mode; `null` clears it (falls back to env/default). */
  mode?: RolloutMode | null;
  /** Set/clear the admin kill switch. */
  killed?: boolean;
  /** Tenant allowlist for shadow→enforce promotion (canary); `null` clears it. */
  enforceTenants?: string[] | null;
  /** Remove this flag's override entirely (reset to env/default). */
  clear?: boolean;
}

/**
 * Pure config transform (no I/O) — apply a patch to an admin config and return
 * the new config plus before/after override for audit. Never mutates its input.
 */
export function applyRolloutPatch(
  config: RolloutAdminConfig | null,
  flagKey: string,
  patch: RolloutOverridePatch,
): { config: RolloutAdminConfig; previous: RolloutFlagOverride | null; next: RolloutFlagOverride | null } {
  const base: RolloutAdminConfig = { v: 1, flags: { ...(config?.flags ?? {}) } };
  const previous = base.flags[flagKey] ? { ...base.flags[flagKey] } : null;

  if (patch.clear) {
    delete base.flags[flagKey];
    return { config: base, previous, next: null };
  }

  const next: RolloutFlagOverride = { ...(previous ?? {}) };
  if (patch.mode === null) delete next.mode;
  else if (patch.mode !== undefined) next.mode = patch.mode;
  if (typeof patch.killed === 'boolean') next.killed = patch.killed;
  if (patch.enforceTenants === null) delete next.enforceTenants;
  else if (patch.enforceTenants !== undefined) next.enforceTenants = patch.enforceTenants;

  // An empty override carries no signal — drop it rather than persist noise.
  if (next.mode === undefined && next.killed === undefined && next.enforceTenants === undefined) {
    delete base.flags[flagKey];
    return { config: base, previous, next: null };
  }
  base.flags[flagKey] = next;
  return { config: base, previous, next };
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

// The shadow-execution runner (runWithRollout) and the Redis-backed admin
// surface (resolveRollout, setRolloutOverride) live in the server-only
// ./rolloutAdmin module — importing them into this client-reachable file would
// pull the Redis/BullMQ layer (child_process/net/fs/dns/worker_threads) into
// client bundles. Server callers import them from './rolloutAdmin'.
