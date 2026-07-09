/**
 * PERF-002 — optimistic authenticated-session activation.
 *
 * WHY
 * ───
 * On a session restore / tab refresh the Supabase SDK has already validated the
 * LOCAL session before it emits INITIAL_SESSION. Previously CompanyContext still
 * blocked `authChecked` (and therefore the whole app behind AuthGate's
 * "Loading your workspace…" loader) on a full `/api/auth/post-login-route`
 * round-trip before rendering anything. That round-trip is the dominant
 * remaining activation latency on the most common repeat path.
 *
 * This helper lets the caller activate the app IMMEDIATELY from the local
 * session and verify against the backend in the BACKGROUND. Security is
 * identical: a 401 (ghost / soft-deleted / revoked session) runs the exact same
 * sign-out the blocking path did — it just happens asynchronously, and the
 * company-profile fetch's own 401 handling remains the backstop. No token is
 * ever trusted past expiry (the SDK enforces that), and the server still
 * re-validates every subsequent request.
 *
 * Extracted as an injected-dependency function purely so the decision logic is
 * unit-testable without React / the Supabase SDK. CompanyContext is otherwise
 * unchanged.
 */

export type SessionVerifyOutcome = 'verified' | 'revoked' | 'error';

export interface OptimisticVerifyDeps {
  /** Probe the backend — GET /api/auth/post-login-route (returns its Response). */
  probe: () => Promise<{ status: number }>;
  /** The existing sign-out (supabase.auth.signOut). */
  signOut: () => Promise<void>;
  /** Invoked when the backend reports the session is invalid (HTTP 401). */
  onRevoked: () => void;
  /** Optional outcome sink for observability. */
  onOutcome?: (outcome: SessionVerifyOutcome) => void;
}

/**
 * Verify an already-activated local session against the backend WITHOUT
 * blocking activation. Never throws.
 *   - 401 → run signOut() + onRevoked() (identical to the old blocking path).
 *   - 2xx/other → 'verified' (leave the app active).
 *   - network error → 'error' (tolerated; refreshCompanies' 401 path is the backstop).
 */
export async function verifySessionInBackground(
  deps: OptimisticVerifyDeps,
): Promise<SessionVerifyOutcome> {
  let outcome: SessionVerifyOutcome;
  try {
    const probe = await deps.probe();
    if (probe.status === 401) {
      try { await deps.signOut(); } catch { /* best-effort — onRevoked still fires */ }
      deps.onRevoked();
      outcome = 'revoked';
    } else {
      outcome = 'verified';
    }
  } catch {
    // Network/transient error: do NOT sign the user out — a valid local session
    // must survive an offline blip. The next data fetch re-checks server-side.
    outcome = 'error';
  }
  try { deps.onOutcome?.(outcome); } catch { /* fail-safe */ }
  return outcome;
}
