import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

/**
 * Lightweight cooperative-cancel probe. The RPA runner calls `check()`
 * between Playwright steps; a returned `true` means the API-level cancel
 * endpoint stamped `cancel_requested_at` on the action row and the
 * runner should abort.
 *
 * The probe is throttled client-side to one query per CHECK_INTERVAL_MS
 * so tight loops do not DDoS the DB.
 */

const CHECK_INTERVAL_MS = 500;

export type CancellationChecker = () => Promise<boolean>;

export function makeCancellationChecker(actionId: string): CancellationChecker {
  let lastChecked = 0;
  let cancelled = false;

  return async function checkCancelled(): Promise<boolean> {
    if (cancelled) return true;
    const now = Date.now();
    if (now - lastChecked < CHECK_INTERVAL_MS) return false;
    lastChecked = now;
    try {
      const { data } = await supabase
        .from('community_ai_actions')
        .select('cancel_requested_at')
        .eq('id', actionId)
        .maybeSingle();
      if (data && (data as any).cancel_requested_at) {
        cancelled = true;
        return true;
      }
    } catch {
      /* transient DB errors: treat as "not cancelled" — better to run
         than to false-abort a task on a blip. */
    }
    return false;
  };
}

/** Error thrown when a runner aborts due to a cancel signal. */
export class RpaCancelledError extends Error {
  constructor(message = 'RPA_CANCELLED') {
    super(message);
    this.name = 'RpaCancelledError';
  }
}
