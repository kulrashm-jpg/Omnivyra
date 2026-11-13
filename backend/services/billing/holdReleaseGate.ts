/**
 * Default-OFF gate for every path that RELEASES credit holds in bulk: the orphan-hold reaper and the durable
 * reservation reconciler (e9 ruling 2026-11-13). Until 20270217000053 (settle guards on the live bodies) and an
 * in-flight-aware resolver ship, a bulk release can race a job that is still running: the live apply_credit_reservation
 * has no already-settled guard, so the later confirm double-settles. The gate sits in the SERVICES, so it covers every
 * caller - the cron routes, the super-admin operations route and any future one - and the routes answer a plain 409.
 * Remove it only together with 053 + the resolver.
 */
export const HOLD_RELEASE_ENV = 'CREDIT_HOLD_REAP_ENABLED';

export const HOLD_RELEASE_DISABLED_REASON =
  'Bulk credit-hold release (orphan reaper / reservation reconciler) is disabled until the settle guards (migration ' +
  '20270217000053) and an in-flight-aware resolver ship: releasing a hold whose work is still running can double-settle.';

export class HoldReleaseDisabledError extends Error {
  readonly code = 'HOLD_RELEASE_DISABLED' as const;
  readonly retryable = false as const;
  constructor(readonly path: string) {
    super(`${path}: ${HOLD_RELEASE_DISABLED_REASON}`);
    this.name = 'HoldReleaseDisabledError';
  }
}

export function isHoldReleaseEnabled(): boolean {
  return process.env[HOLD_RELEASE_ENV] === 'true';
}

/** Throws HoldReleaseDisabledError unless CREDIT_HOLD_REAP_ENABLED === 'true'. */
export function assertHoldReleaseEnabled(path: string): void {
  if (!isHoldReleaseEnabled()) throw new HoldReleaseDisabledError(path);
}
