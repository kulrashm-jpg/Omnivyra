/**
 * PERF-002 — optimistic authenticated-session activation.
 *
 * Verifies the background-verification decision preserves IDENTICAL security to
 * the old blocking path: a 401 always signs out + flips auth off; a valid
 * session stays active; a network error is tolerated (never signs out).
 */
import {
  verifySessionInBackground,
  type SessionVerifyOutcome,
} from '../../../lib/auth/optimisticSession';

function deps(overrides: Partial<Parameters<typeof verifySessionInBackground>[0]> = {}) {
  const calls = { signOut: 0, revoked: 0, outcomes: [] as SessionVerifyOutcome[] };
  const base = {
    probe: async () => ({ status: 200 }),
    signOut: async () => { calls.signOut += 1; },
    onRevoked: () => { calls.revoked += 1; },
    onOutcome: (o: SessionVerifyOutcome) => { calls.outcomes.push(o); },
    ...overrides,
  };
  return { d: base, calls };
}

describe('verifySessionInBackground — security parity', () => {
  it('a valid session (2xx) stays active — no signOut, no revoke', async () => {
    const { d, calls } = deps({ probe: async () => ({ status: 200 }) });
    const outcome = await verifySessionInBackground(d);
    expect(outcome).toBe('verified');
    expect(calls.signOut).toBe(0);
    expect(calls.revoked).toBe(0);
    expect(calls.outcomes).toEqual(['verified']);
  });

  it('a 401 (ghost / soft-deleted / revoked) signs out AND flips auth off', async () => {
    const { d, calls } = deps({ probe: async () => ({ status: 401 }) });
    const outcome = await verifySessionInBackground(d);
    expect(outcome).toBe('revoked');
    expect(calls.signOut).toBe(1);
    expect(calls.revoked).toBe(1);
    expect(calls.outcomes).toEqual(['revoked']);
  });

  it('still flips auth off even if signOut() itself throws (best-effort)', async () => {
    const { d, calls } = deps({
      probe: async () => ({ status: 401 }),
      signOut: async () => { throw new Error('network'); },
    });
    const outcome = await verifySessionInBackground(d);
    expect(outcome).toBe('revoked');
    expect(calls.revoked).toBe(1); // onRevoked fires regardless
  });

  it('a network error does NOT sign the user out (offline blip tolerated)', async () => {
    const { d, calls } = deps({ probe: async () => { throw new Error('offline'); } });
    const outcome = await verifySessionInBackground(d);
    expect(outcome).toBe('error');
    expect(calls.signOut).toBe(0);
    expect(calls.revoked).toBe(0);
    expect(calls.outcomes).toEqual(['error']);
  });

  it('a non-401 error status (e.g. 500) is treated as verified (not a revocation)', async () => {
    const { d, calls } = deps({ probe: async () => ({ status: 500 }) });
    const outcome = await verifySessionInBackground(d);
    // A server hiccup must not sign a user out; only an explicit 401 revokes.
    expect(outcome).toBe('verified');
    expect(calls.signOut).toBe(0);
  });

  it('never throws, even if onOutcome throws', async () => {
    const { d } = deps({ onOutcome: () => { throw new Error('sink boom'); } });
    await expect(verifySessionInBackground(d)).resolves.toBe('verified');
  });
});
