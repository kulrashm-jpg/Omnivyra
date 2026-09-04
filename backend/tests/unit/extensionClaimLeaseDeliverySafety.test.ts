/**
 * Extension claim-lease protocol — duplicate external delivery analysis.
 *
 * These tests CHARACTERISE the protocol as it currently behaves. They do not
 * assert that it is safe, because it is not: they exist to pin the exposure so
 * it cannot silently change, and so the operator decision has evidence.
 *
 * THE FINDING
 *   /api/extension/commands re-offers a browser command whenever
 *   `dispatch_lease_expires_at < now`, filtering ONLY on
 *   (organization_id, status='pending', execution_mode='browser').
 *   It does NOT exclude commands an extension has already acknowledged.
 *
 *   The lease TTL is 90s. The extension's polling interval is 60s. A browser
 *   action slower than the lease (a backgrounded LinkedIn tab is enough) is
 *   therefore re-offered while the first claimant is still executing it — and
 *   the first claimant's eventual callback is REJECTED with LEASE_EXPIRED, so
 *   nothing records that it happened.
 *
 *   The claim CAS is a database lock. The send is an irreversible action that
 *   happens outside the database. Those are not the same thing:
 *
 *       CLAIM LEASE IS NOT A DELIVERY LOCK
 *
 * Scope note: this is the EXTENSION PROTOCOL, shared by every browser action
 * (likes, comments, DMs, publishing), not Engagement Center code. It is
 * deliberately not modified here — see the report's "IMPLEMENTATION BLOCKED".
 */

import { readFileSync } from 'fs';

const commandsSrc = readFileSync('pages/api/extension/commands.ts', 'utf8');
const actionResultSrc = readFileSync('pages/api/extension/action-result.ts', 'utf8');

/** Model of the server-side claim predicate, derived from the source above. */
type ActionRow = {
  id: string;
  organization_id: string;
  status: string;
  execution_mode: string;
  dispatch_lease_id: string | null;
  dispatch_lease_holder_id: string | null;
  dispatch_lease_expires_at: number | null;
  dispatch_acknowledged_at: number | null;
};

/** Mirrors commands.ts:143-151 exactly — including what it does NOT filter. */
function isOfferable(row: ActionRow, nowMs: number, orgId: string): boolean {
  return (
    row.organization_id === orgId &&
    row.status === 'pending' &&
    row.execution_mode === 'browser' &&
    (row.dispatch_lease_expires_at === null || row.dispatch_lease_expires_at < nowMs)
  );
}

/** Mirrors action-result.ts lease validation. */
function acceptsResult(row: ActionRow, nowMs: number, holderId: string, leaseId: string) {
  const TERMINAL = new Set(['executed', 'sent_unverified', 'failed', 'skipped', 'blocked']);
  if (TERMINAL.has(row.status)) return { ok: true, idempotent: true as const };
  if (!row.dispatch_lease_id || !row.dispatch_lease_holder_id) return { ok: false, error: 'NO_ACTIVE_LEASE' };
  if (row.dispatch_lease_holder_id !== holderId) return { ok: false, error: 'LEASE_HOLDER_MISMATCH' };
  if (leaseId !== row.dispatch_lease_id) return { ok: false, error: 'LEASE_ID_MISMATCH' };
  if (row.dispatch_lease_expires_at !== null && row.dispatch_lease_expires_at < nowMs) {
    return { ok: false, error: 'LEASE_EXPIRED' };
  }
  return { ok: true, idempotent: false as const };
}

const LEASE_TTL_MS = 90 * 1000;
const ORG = 'org_eng';

function claim(row: ActionRow, nowMs: number, holderId: string, leaseId: string) {
  row.dispatch_lease_id = leaseId;
  row.dispatch_lease_holder_id = holderId;
  row.dispatch_lease_expires_at = nowMs + LEASE_TTL_MS;
}

function pendingBrowserAction(over: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'act_1', organization_id: ORG, status: 'pending', execution_mode: 'browser',
    dispatch_lease_id: null, dispatch_lease_holder_id: null,
    dispatch_lease_expires_at: null, dispatch_acknowledged_at: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the claim predicate, pinned against source', () => {
  it('the re-offer query does NOT exclude acknowledged commands', () => {
    const claimQuery = commandsSrc.slice(
      commandsSrc.indexOf("from('community_ai_actions')"),
      commandsSrc.indexOf('.limit(10)'),
    );
    expect(claimQuery).toContain("eq('status', 'pending')");
    expect(claimQuery).toContain("eq('execution_mode', 'browser')");
    expect(claimQuery).toContain('dispatch_lease_expires_at.lt.');
    // The absence below is the defect. If someone later adds this filter, this
    // assertion fails loudly and the finding gets re-evaluated — which is the
    // point of pinning it.
    expect(claimQuery).not.toContain('dispatch_acknowledged_at');
  });

  it('nothing renews the lease of an in-progress action', () => {
    // Option A (extend lease) is unavailable. The only "heartbeat" present is
    // session liveness — it writes extension_sessions.last_seen, not the lease.
    expect(commandsSrc).toMatch(/extension_sessions[\s\S]{0,400}last_seen/);

    // dispatch_lease_expires_at is written in exactly one place: the initial
    // claim. No later code path pushes the expiry out.
    const expiryWrites = commandsSrc.match(/dispatch_lease_expires_at:\s*\w/g) ?? [];
    expect(expiryWrites).toHaveLength(1);

    // And the acknowledgement — the one signal that an extension took the work
    // — does not extend it either.
    const ackUpdate = commandsSrc.slice(
      commandsSrc.indexOf('dispatch_acknowledged_at: now'),
      commandsSrc.indexOf('ACK_PERSIST_FAILED'),
    );
    expect(ackUpdate).not.toContain('dispatch_lease_expires_at');
  });

  it('a late callback is rejected, so a slow claimant cannot record its send', () => {
    expect(actionResultSrc).toContain('LEASE_EXPIRED');
    expect(actionResultSrc).toContain('LEASE_HOLDER_MISMATCH');
  });
});

describe('T5/T6 — lease expiry re-offers a claimed command', () => {
  it('T5: before expiry the command is NOT re-offered', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    expect(isOfferable(row, t0 + 30_000, ORG)).toBe(false);
  });

  it('T6: after expiry the SAME command is offered again', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    expect(isOfferable(row, t0 + LEASE_TTL_MS + 1, ORG)).toBe(true);
  });

  it('an ACKNOWLEDGED command is still re-offered after expiry', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    row.dispatch_acknowledged_at = t0 + 1_000;   // extension confirmed receipt
    // Acknowledgement proves an extension took the work. It does not protect it.
    expect(isOfferable(row, t0 + LEASE_TTL_MS + 1, ORG)).toBe(true);
  });
});

describe('T7–T10 — how many external sends can occur?', () => {
  it('T7/T8/T9: claimant A executing past the lease is joined by claimant B', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();

    claim(row, t0, 'holder-A', 'lease-A');        // A claims, starts a slow send
    row.dispatch_acknowledged_at = t0 + 500;

    const tAfter = t0 + LEASE_TTL_MS + 1;
    expect(isOfferable(row, tAfter, ORG)).toBe(true);
    claim(row, tAfter, 'holder-B', 'lease-B');    // B claims the SAME command

    // Both A and B now perform the same browser action. Two external sends.
    expect(row.dispatch_lease_holder_id).toBe('holder-B');
  });

  it('T10: A\'s late callback is REJECTED, so its send is never recorded', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    const tAfter = t0 + LEASE_TTL_MS + 1;
    claim(row, tAfter, 'holder-B', 'lease-B');

    const late = acceptsResult(row, tAfter + 100, 'holder-A', 'lease-A');
    expect(late.ok).toBe(false);
    expect(late.error).toBe('LEASE_HOLDER_MISMATCH');
    // The row stays pending: the system has no record that A ever sent.
    expect(row.status).toBe('pending');
  });

  it('T11: B\'s callback IS accepted and terminalises the row', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-B', 'lease-B');
    const r = acceptsResult(row, t0 + 1_000, 'holder-B', 'lease-B');
    expect(r.ok).toBe(true);
  });

  it('T12: a duplicate callback on a terminal row is an idempotent no-op', () => {
    const row = pendingBrowserAction({ status: 'executed' });
    const r = acceptsResult(row, 1, 'holder-B', 'lease-B');
    expect(r).toMatchObject({ ok: true, idempotent: true });
  });

  it('QUANTIFIED: maximum external dispatch attempts is UNBOUNDED, not one', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    let externalSends = 0;

    // Simulate an action whose browser step never completes (or whose callbacks
    // are all rejected as late), polled over 15 minutes.
    for (let t = t0; t <= t0 + 15 * 60_000; t += 60_000) {   // 60s polling
      if (isOfferable(row, t, ORG)) {
        claim(row, t, `holder-${t}`, `lease-${t}`);
        externalSends += 1;                                   // the DM is sent again
      }
    }

    expect(externalSends).toBeGreaterThan(1);
    // Concretely: one re-send roughly every lease TTL for as long as it runs.
    expect(externalSends).toBeGreaterThanOrEqual(8);
  });
});

describe('what IS still guaranteed', () => {
  it('cross-tenant claim is impossible', () => {
    const row = pendingBrowserAction({ organization_id: 'org_rival' });
    expect(isOfferable(row, Date.now(), ORG)).toBe(false);
  });

  it('a terminal command is never re-offered', () => {
    for (const s of ['executed', 'failed', 'skipped', 'sent_unverified', 'blocked']) {
      expect(isOfferable(pendingBrowserAction({ status: s }), Date.now(), ORG)).toBe(false);
    }
  });

  it('api-mode actions are never offered to the extension', () => {
    const row = pendingBrowserAction({ execution_mode: 'api' });
    expect(isOfferable(row, Date.now(), ORG)).toBe(false);
  });

  it('the never-claimed case — which recovery DOES handle — is distinguishable', () => {
    const never = pendingBrowserAction();
    const claimed = pendingBrowserAction();
    claim(claimed, 1_000_000, 'holder-A', 'lease-A');
    expect(never.dispatch_lease_id).toBeNull();
    expect(claimed.dispatch_lease_id).not.toBeNull();
  });
});
