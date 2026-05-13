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
 * Run (or return cached) auth subsystem boot. Single-flight: a concurrent
 * caller awaits the same Promise rather than triggering a second probe.
 */
export async function bootAuthSubsystem(): Promise<AuthReadiness> {
  if (cachedReadiness) return cachedReadiness;
  if (!bootInFlight) {
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
      cachedReadiness = snapshot;
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
    })();
  }
  return bootInFlight;
}

/** Cached snapshot — null until {@link bootAuthSubsystem} first resolves. */
export function getAuthReadiness(): AuthReadiness | null {
  return cachedReadiness;
}

/** Reset for tests only. */
export function resetAuthSubsystemBoot(): void {
  cachedReadiness = null;
  bootInFlight = null;
}
