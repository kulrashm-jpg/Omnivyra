/**
 * Extension claim-lease protocol — duplicate external delivery analysis.
 *
 * HISTORY
 *   This file originally CHARACTERISED an unsafe protocol and said so: if
 *   someone fixed it, the pinned assertions would "fail loudly and the finding
 *   gets re-evaluated". 20270111100012_extension_dispatch_safety fixed it, so
 *   the finding was re-evaluated and the pins now hold the SAFE behaviour:
 *
 *   - /api/extension/commands offers ONLY never-claimed work
 *     (dispatch_lease_id IS NULL) to every client — the legacy lapsed-lease
 *     re-offer (`dispatch_lease_expires_at.lt.`) is gone — and claims through
 *     claim_community_ai_browser_command, whose single UPDATE re-checks
 *     dispatch_lease_id IS NULL.
 *   - A lapsed claim is reaped to 'uncertain' (may have acted; never retried)
 *     with its lease id/holder kept.
 *   - /api/extension/action-result no longer rejects a late result as
 *     LEASE_EXPIRED: the holder's result is accepted while the row is still
 *     claimed, or recorded as reconciliation evidence once it is 'uncertain'.
 *
 *       CLAIM LEASE IS NOT A DELIVERY LOCK — so a claim is never re-offered.
 *
 * Behavioural coverage against the real routes lives in
 * extensionDispatchSafety.routes.test.ts; this file pins the source and the
 * protocol model.
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
  late_results?: unknown[];
};

/** Mirrors the commands.ts offer query + claim RPC predicate. */
function isOfferable(row: ActionRow, _nowMs: number, orgId: string): boolean {
  return (
    row.organization_id === orgId &&
    row.status === 'pending' &&
    row.execution_mode === 'browser' &&
    row.dispatch_lease_id === null
  );
}

/** Mirrors the lease reaper: a lapsed claim becomes 'uncertain', lease kept. */
function reap(row: ActionRow, nowMs: number) {
  if (row.status === 'pending' && row.dispatch_lease_expires_at !== null && row.dispatch_lease_expires_at < nowMs) {
    row.status = 'uncertain';
  }
}

/** Mirrors action-result.ts lease validation + late-result reconciliation. */
function acceptsResult(row: ActionRow, _nowMs: number, holderId: string, leaseId: string) {
  const TERMINAL = new Set(['executed', 'sent_unverified', 'failed', 'skipped', 'blocked']);
  if (TERMINAL.has(row.status)) return { ok: true, idempotent: true as const };
  if (!row.dispatch_lease_id || !row.dispatch_lease_holder_id) return { ok: false, error: 'NO_ACTIVE_LEASE' };
  if (row.dispatch_lease_holder_id !== holderId) return { ok: false, error: 'LEASE_HOLDER_MISMATCH' };
  if (leaseId !== row.dispatch_lease_id) return { ok: false, error: 'LEASE_ID_MISMATCH' };
  if (row.status === 'uncertain') {
    row.late_results = [...(row.late_results ?? []), { holderId }];
    return { ok: true, idempotent: false as const, reconciliation: 'recorded' as const };
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
  it('the offer query only returns never-claimed, uncancelled work — for every client', () => {
    const claimQuery = commandsSrc.slice(
      commandsSrc.indexOf("from('community_ai_actions')"),
      commandsSrc.indexOf('.limit(10)'),
    );
    expect(claimQuery).toContain("eq('status', 'pending')");
    expect(claimQuery).toContain("eq('execution_mode', 'browser')");
    expect(claimQuery).toContain(".is('dispatch_lease_id', null)");
    expect(claimQuery).toContain(".is('cancel_requested_at', null)");
    // The legacy lapsed-lease re-offer is gone, and is not gated on a header.
    expect(claimQuery).not.toContain('dispatch_lease_expires_at.lt.');
    expect(commandsSrc).not.toMatch(/supportsRenewal/);
  });

  it('the claim itself is the atomic RPC (no client-side compare-and-set on expiry)', () => {
    expect(commandsSrc).toContain("supabase.rpc('claim_community_ai_browser_command'");
    expect(commandsSrc).not.toMatch(/\.update\(\{\s*dispatch_lease_id: leaseId/);
    // Acknowledgement still does not extend the lease.
    const ackUpdate = commandsSrc.slice(
      commandsSrc.indexOf('dispatch_acknowledged_at: now'),
      commandsSrc.indexOf('ACK_PERSIST_FAILED'),
    );
    expect(ackUpdate).not.toContain('dispatch_lease_expires_at');
  });

  it('a late callback is no longer rejected as LEASE_EXPIRED; it is recorded', () => {
    expect(actionResultSrc).not.toContain("error: 'LEASE_EXPIRED'");
    expect(actionResultSrc).toContain("supabase.rpc('record_community_ai_late_dispatch_result'");
    expect(actionResultSrc).toContain('LEASE_HOLDER_MISMATCH');
  });
});

describe('T5/T6 — lease expiry no longer re-offers a claimed command', () => {
  it('T5: before expiry the command is NOT re-offered', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    expect(isOfferable(row, t0 + 30_000, ORG)).toBe(false);
  });

  it('T6: after expiry the SAME command is still NOT offered', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    expect(isOfferable(row, t0 + LEASE_TTL_MS + 1, ORG)).toBe(false);
  });

  it('an ACKNOWLEDGED command is not re-offered after expiry either', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    row.dispatch_acknowledged_at = t0 + 1_000;
    expect(isOfferable(row, t0 + LEASE_TTL_MS + 1, ORG)).toBe(false);
  });
});

describe('T7–T10 — how many external sends can occur?', () => {
  it('T7/T8/T9: claimant A executing past the lease is NOT joined by claimant B', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-A', 'lease-A');
    row.dispatch_acknowledged_at = t0 + 500;
    const tAfter = t0 + LEASE_TTL_MS + 1;
    expect(isOfferable(row, tAfter, ORG)).toBe(false);
    expect(row.dispatch_lease_holder_id).toBe('holder-A');
  });

  it('T10: A\'s late callback is RECORDED — before the reaper as a result, after it as evidence', () => {
    const t0 = 1_000_000;
    const before = pendingBrowserAction();
    claim(before, t0, 'holder-A', 'lease-A');
    expect(acceptsResult(before, t0 + LEASE_TTL_MS + 100, 'holder-A', 'lease-A')).toMatchObject({ ok: true });

    const after = pendingBrowserAction();
    claim(after, t0, 'holder-A', 'lease-A');
    reap(after, t0 + LEASE_TTL_MS + 1);
    expect(after.status).toBe('uncertain');
    const late = acceptsResult(after, t0 + LEASE_TTL_MS + 100, 'holder-A', 'lease-A');
    expect(late).toMatchObject({ ok: true, reconciliation: 'recorded' });
    expect(after.status).toBe('uncertain');           // never auto-resolved
    expect(after.late_results).toHaveLength(1);
  });

  it('T11: the holder\'s callback is accepted and terminalises the row', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    claim(row, t0, 'holder-B', 'lease-B');
    expect(acceptsResult(row, t0 + 1_000, 'holder-B', 'lease-B').ok).toBe(true);
  });

  it('T12: a duplicate callback on a terminal row is an idempotent no-op', () => {
    const row = pendingBrowserAction({ status: 'executed' });
    expect(acceptsResult(row, 1, 'holder-B', 'lease-B')).toMatchObject({ ok: true, idempotent: true });
  });

  it('QUANTIFIED: maximum external dispatch attempts is ONE', () => {
    const t0 = 1_000_000;
    const row = pendingBrowserAction();
    let externalSends = 0;
    for (let t = t0; t <= t0 + 15 * 60_000; t += 60_000) {   // 60s polling for 15 minutes
      if (isOfferable(row, t, ORG)) {
        claim(row, t, `holder-${t}`, `lease-${t}`);
        externalSends += 1;
      }
      reap(row, t);
    }
    expect(externalSends).toBe(1);
    expect(row.status).toBe('uncertain');
  });
});

describe('what IS still guaranteed', () => {
  it('cross-tenant claim is impossible', () => {
    const row = pendingBrowserAction({ organization_id: 'org_rival' });
    expect(isOfferable(row, Date.now(), ORG)).toBe(false);
  });

  it('a terminal (or uncertain) command is never re-offered', () => {
    for (const s of ['executed', 'failed', 'skipped', 'sent_unverified', 'blocked', 'uncertain']) {
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
