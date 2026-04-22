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
}

function readFlags(): ProductionFlags {
  const useUnifiedLedger = process.env.USE_UNIFIED_LEDGER_ONLY === 'true';
  const nodeEnv          = process.env.NODE_ENV ?? 'development';
  const isProd           = nodeEnv === 'production';

  return Object.freeze({
    USE_UNIFIED_LEDGER_ONLY: useUnifiedLedger,
    NODE_ENV:                nodeEnv,
    IS_PRODUCTION:           isProd,
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
