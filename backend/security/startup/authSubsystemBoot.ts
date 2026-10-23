/**
 * authSubsystemBoot — single deterministic entry point that runs the
 * auth subsystem's boot-time checks and snapshots the result for the
 * lifetime of the process.
 *
 * What runs here
 * ──────────────
 *  1. Schema health probe (via {@link getSchemaHealth}). Detects missing
 *     lifecycle columns and emits a structured warning.
 *  2. Boot fingerprint log (via {@link emitBootFingerprint}). Logs
 *     auth-contract version, manifest hash, runtime env, and Node version
 *     so a single log line lets ops correlate "what's deployed" with
 *     "what's behaving weirdly."
 *  3. Readiness snapshot (cached). Drives {@link getAuthReadiness} which
 *     `/api/health/readiness` exposes.
 *
 * Determinism guarantees
 * ──────────────────────
 *  - Runs at most once per process. A concurrent caller awaits the same
 *    in-flight promise.
 *  - Never throws — every failure mode is converted into a degraded
 *    readiness state with a structured log.
 *  - Idempotent: subsequent calls return the cached snapshot.
 *
 * Where this is invoked
 * ─────────────────────
 *  - {@link resolveAuthenticatedUser} — fires the probe on the first
 *    authenticated request (lazy fallback for serverless cold starts).
 *  - `/api/health/readiness` — explicit fetch; will boot the subsystem
 *    if the resolver hasn't yet.
 *  - Worker entry points (best-effort eager): call
 *    `bootAuthSubsystem()` at process start.
 */

import { getSchemaHealth, type SchemaHealthResult } from './schemaHealthCheck';
import { emitBootFingerprint, type BootFingerprint, AUTH_CONTRACT_VERSION } from './bootFingerprint';
import { logger } from '../../services/logger';

export interface AuthReadiness {
  /** True iff every load-bearing check passed AND the subsystem is fully
   *  serving traffic. False indicates degraded operation (graceful) OR
   *  an unrecoverable boot failure (rare). */
  ready: boolean;
  /** Granular per-check status. */
  schemaHealthy: boolean;
  /** When the boot completed (or last failed). */
  bootedAt: string;
  /** Why the subsystem is degraded, if applicable. */
  reasons: string[];
  /** Frozen snapshot of the schema health result. */
  schema: SchemaHealthResult;
  /** Frozen boot fingerprint (contract version, hashes, env). */
  fingerprint: BootFingerprint;
  /** Bump this on every breaking change to the readiness contract. */
  readinessVersion: number;
}

const READINESS_VERSION = 1;

let cachedReadiness: AuthReadiness | null = null;
let bootInFlight: Promise<AuthReadiness> | null = null;
/**
 * Incremented by {@link resetAuthSubsystemBoot}. An attempt captures the value
 * current when it STARTED and refuses to publish its snapshot if that value has
 * moved on, so a boot still in flight across a reset cannot write its result
 * into the fresh state. Without this, a reset during an in-flight boot left the
 * old attempt free to overwrite `cachedReadiness` afterwards — stale completion
 * corrupting the next attempt.
 */
let bootGeneration = 0;

/**
 * The readiness snapshot that represents a boot which did not complete.
 *
 * Required by this module's own documented contract: "Never throws — every
 * failure mode is converted into a degraded readiness state with a structured
 * log". `AuthReadiness.ready` is documented as covering "an unrecoverable boot
 * failure (rare)" and `bootedAt` as "when the boot completed (or last failed)",
 * so a failure is something this type already expects to REPRESENT rather than
 * propagate.
 *
 * `schema.missing` is EMPTY rather than listing every required column: the
 * probe did not complete, so this process does not know what is missing, and
 * naming a specific drift would be fabricated detail. `schema.ok: false` plus
 * the `boot_failed:` reason is the honest shape. The cause is carried as a
 * message only — never the error object, which can hold fields that echo data.
 */
function degradedBootSnapshot(error: unknown): AuthReadiness {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  let fingerprint: BootFingerprint;
  try {
    // May already be cached from a partial success. If the fingerprint step is
    // itself what failed, this throws again and the literal below is used.
    fingerprint = emitBootFingerprint();
  } catch {
    fingerprint = {
      fingerprint: '',
      authContractVersion: AUTH_CONTRACT_VERSION,
      schemaManifestHash: null,
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
      deploymentId: null,
      vercelEnv: null,
      railwayEnv: null,
      emittedAt: now,
    };
  }
  return {
    ready: false,
    schemaHealthy: false,
    bootedAt: now,
    reasons: [`boot_failed:${message}`],
    schema: { ok: false, missing: [], checkedAt: now },
    fingerprint,
    readinessVersion: READINESS_VERSION,
  };
}

/**
 * Run (or return cached) auth subsystem boot. Single-flight: a concurrent
 * caller awaits the same Promise rather than triggering a second probe.
 *
 * WHAT WAS WRONG (OD-8), and why a rejection was reachable. The body below runs
 * two operations that are NOT internally contained:
 *
 *   - `getSchemaHealth()` — `probeSchema` has its own try/catch and returns a
 *     degraded result, but the wrapper around it logs before caching, so a
 *     logger or console failure rejects it.
 *   - `emitBootFingerprint()` — SYNCHRONOUS, and it emits a structured log
 *     (bootFingerprint.ts:126) BEFORE assigning its own cache at :137. A throw
 *     from that log, or from `createHash`, propagates straight out.
 *
 * Either one rejected the IIFE. `cachedReadiness` was assigned inside it, so it
 * stayed null, and `bootInFlight` retained the REJECTED promise — which the
 * `if (!bootInFlight)` guard then handed to every later caller for the lifetime
 * of the process. One transient failure permanently broke the endpoint whose
 * documented contract is 200/ready or 503/degraded: `/api/health/readiness`
 * awaits this with no try/catch, so it would answer 500 instead, forever.
 *
 * WHAT IS GUARANTEED NOW:
 *   - The promise RESOLVES in every case. A failure resolves to a degraded
 *     snapshot, so no caller receives a rejection and no unhandled rejection is
 *     possible even when nothing awaits it.
 *   - A failure AFTER the snapshot was built — i.e. in the logging below — does
 *     not fabricate a degraded result. The real snapshot is returned, because a
 *     log failure is not a boot failure.
 *   - NO RETRY is introduced. "Runs at most once per process" and "subsequent
 *     calls return the cached snapshot" are the documented contract, and
 *     `getSchemaHealth` already caches a degraded probe the same way. Whether a
 *     failed boot should ever be retried is a policy question this module does
 *     not answer and this change does not decide.
 */
export async function bootAuthSubsystem(): Promise<AuthReadiness> {
  if (cachedReadiness) return cachedReadiness;
  if (!bootInFlight) {
    const generation = bootGeneration;
    bootInFlight = (async () => {
      const schema = await getSchemaHealth();
      const fingerprint = emitBootFingerprint({ schemaManifestHash: schema.checkedAt });
      const reasons: string[] = [];
      if (!schema.ok) {
        reasons.push(
          `schema_missing_columns:${schema.missing.map((m) => `${m.table}.${m.column}`).join(',')}`,
        );
      }
      const ready = reasons.length === 0;
      const snapshot: AuthReadiness = {
        ready,
        schemaHealthy: schema.ok,
        bootedAt: new Date().toISOString(),
        reasons,
        schema,
        fingerprint,
        readinessVersion: READINESS_VERSION,
      };
      if (generation === bootGeneration) cachedReadiness = snapshot;
      if (ready) {
        logger.info('auth_subsystem_ready', {
          contract: AUTH_CONTRACT_VERSION,
          fingerprintShort: fingerprint.fingerprint.slice(0, 12),
        });
      } else {
        logger.error('auth_subsystem_degraded', {
          contract: AUTH_CONTRACT_VERSION,
          reasons,
          missing: schema.missing,
        });
      }
      return snapshot;
    })().catch((error) => {
      // The snapshot was already built and published, so only a later step —
      // the logging above — failed. Overwriting a real result with a fabricated
      // degraded one would be a worse answer than the truth.
      if (cachedReadiness) return cachedReadiness;

      const snapshot = degradedBootSnapshot(error);
      try {
        logger.error('auth_subsystem_boot_failed', {
          contract: AUTH_CONTRACT_VERSION,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Narrow and deliberate: if the LOGGER is what failed, logging the
        // failure re-throws and would re-poison the very promise this handler
        // exists to settle. Scoped to this one call, never around the boot.
      }
      if (generation === bootGeneration) cachedReadiness = snapshot;
      return snapshot;
    });
  }
  return bootInFlight;
}

/** Cached snapshot — null until {@link bootAuthSubsystem} first resolves. */
export function getAuthReadiness(): AuthReadiness | null {
  return cachedReadiness;
}

/**
 * Reset for tests only.
 *
 * Advances the boot generation so an attempt still in flight cannot publish its
 * snapshot into the state this reset just cleared.
 */
export function resetAuthSubsystemBoot(): void {
  cachedReadiness = null;
  bootInFlight = null;
  bootGeneration += 1;
}
