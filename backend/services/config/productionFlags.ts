/**
 * Production Flags — frozen at module load.
 *
 * Reads the runtime-critical env vars once at first import and exposes them
 * via a frozen singleton. The intent is two-fold:
 *   1. Callers import from here instead of `process.env.*` directly, so any
 *      grep for `process.env.USE_UNIFIED_LEDGER_ONLY` outside this file is
 *      an immediate review red flag.
 *   2. `Object.freeze` on the returned object prevents in-process mutation
 *      after boot — someone doing `flags.USE_UNIFIED_LEDGER_ONLY = false`
 *      at runtime gets a TypeError (in strict mode) or a silent no-op.
 *
 * Note: Node's `process.env` itself is still mutable. This module protects
 * against accidental in-code flips, not against a deliberate adversary.
 */

interface ProductionFlags {
  readonly USE_UNIFIED_LEDGER_ONLY: boolean;
  readonly NODE_ENV: string;
  readonly IS_PRODUCTION: boolean;
  readonly IS_NON_PRODUCTION: boolean;
}

function readFlags(): ProductionFlags {
  const useUnifiedLedger = process.env.USE_UNIFIED_LEDGER_ONLY === 'true';
  const rawNodeEnv       = process.env.NODE_ENV;
  const nodeEnv          = rawNodeEnv ?? 'development';
  const isProd           = nodeEnv === 'production';
  // Strict, fail-CLOSED: the RAW value must be exactly one of these. Unset is NOT non-production here (the
  // 'development' default above is for the legacy flags only).
  const isNonProd        = rawNodeEnv === 'development' || rawNodeEnv === 'test';

  return Object.freeze({
    USE_UNIFIED_LEDGER_ONLY: useUnifiedLedger,
    NODE_ENV:                nodeEnv,
    IS_PRODUCTION:           isProd,
    IS_NON_PRODUCTION:       isNonProd,
  });
}

// Read-once at module load. Subsequent changes to process.env have no effect.
const _frozenFlags: ProductionFlags = readFlags();

/**
 * Returns the frozen production-flag snapshot captured at module load.
 * Safe to call at any time; the returned object is frozen.
 */
export function getProductionFlags(): ProductionFlags {
  return _frozenFlags;
}

/** Convenience accessor for the most-called flag. */
export function isUnifiedLedgerOnly(): boolean {
  return _frozenFlags.USE_UNIFIED_LEDGER_ONLY;
}

/** Convenience accessor for prod-gating code paths. */
export function isProduction(): boolean {
  return _frozenFlags.IS_PRODUCTION;
}

/**
 * Strict companion for SECURITY gates on dev-only / debug routes (e9 ruling 2026-11-13): true ONLY when NODE_ENV
 * was exactly 'development' or 'test' at module load. Unset, 'Production', 'prod', 'staging' or anything else ->
 * false, so such a gate fails CLOSED. Serve a debug route only when this is true; 404 otherwise. Do not use
 * `!isProduction()` for that - it fails open on any value other than the exact string 'production'.
 */
export function isNonProduction(): boolean {
  return _frozenFlags.IS_NON_PRODUCTION;
}

/**
 * Startup log marker. Call once from the app entry point so operators can
 * verify the flags that were captured. No-op in test runs.
 */
export function logProductionFlagsAtBoot(): void {
  if (process.env.NODE_ENV === 'test') return;
  console.info('[production-flags] captured at boot', {
    USE_UNIFIED_LEDGER_ONLY: _frozenFlags.USE_UNIFIED_LEDGER_ONLY,
    NODE_ENV:                _frozenFlags.NODE_ENV,
    IS_PRODUCTION:           _frozenFlags.IS_PRODUCTION,
  });
}
