/**
 * REGRESSION SUITE — incident 2026-07-09 (org 4bdbec26): the credit
 * projection self-heal rebuilt a HEALTHY wallet from per-row ledger deltas
 * and stranded 1,185 already-settled credits in reserved_free
 * (free 2399 → 1214).
 *
 * Root causes fixed and locked here:
 *  1. MATH — confirm rows carry the ACTUAL cost, not the held amount; the
 *     live RPC returns each hold's unspent remainder WITHOUT a ledger row.
 *     computeFromLedger now pairs hold↔confirm/release by reservation
 *     idempotency key: settled holds contribute nothing to reserved and
 *     their remainder returns to balance.
 *  2. TRIGGER — a transiently failed wallet read looked identical to "row
 *     absent" and fired the rebuild. readCreditRow now distinguishes read
 *     ERROR (no self-heal, "unavailable") from row-absent, and
 *     reconcileImpl re-reads and refuses to overwrite a healthy row.
 */

// ── Scripted supabase for reconcileImpl paths ──
let ledgerRows: any[] = [];
let walletRow: any = null;
const upsertCalls: any[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'order', 'limit']) builder[op] = () => builder;
      builder.range = (from: number, to: number) => ({
        then: (res: any, rej: any) =>
          Promise.resolve({ data: ledgerRows.slice(from, to + 1), error: null }).then(res, rej),
      });
      builder.maybeSingle = () => ({
        then: (res: any, rej: any) =>
          Promise.resolve({ data: walletRow, error: null }).then(res, rej),
      });
      builder.upsert = (payload: any) => {
        upsertCalls.push({ table, payload });
        return { then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) };
      };
      return builder;
    },
  },
}));

import {
  computeFromLedger,
  reconcileOrgCreditProjection,
} from '../../services/creditProjectionReconciler';

const row = (
  phase: string,
  free: number,
  key: string | null,
  paid = 0,
  incentive = 0,
) => ({
  execution_phase: phase,
  free_delta: free,
  paid_delta: paid,
  incentive_delta: incentive,
  idempotency_key: key,
});

beforeEach(() => {
  ledgerRows = [];
  walletRow = null;
  upsertCalls.length = 0;
});

describe('computeFromLedger — keyed hold/confirm pairing (the incident math)', () => {
  it('a settled hold returns its remainder to balance and reserves NOTHING', () => {
    // The exact incident shape: 50-credit free-bucket exposure hold, settled
    // by a confirm whose delta (5) is recorded in the PAID bucket.
    const w = computeFromLedger([
      row('grant', 100, null),
      row('hold', -50, 'job-1:hold'),
      row('confirm', 0, 'job-1:confirm', -5),
    ]);
    expect(w.free_balance).toBe(95);    // 100 − actual 5 (old math: 50)
    expect(w.reserved_free).toBe(0);    // settled ⇒ not reserved (old math: 45 stranded)
    expect(w.lifetime_consumed).toBe(5);
  });

  it('an OPEN hold stays reserved and out of balance', () => {
    const w = computeFromLedger([
      row('grant', 100, null),
      row('hold', -50, 'job-2:hold'),
    ]);
    expect(w.free_balance).toBe(50);
    expect(w.reserved_free).toBe(50);
  });

  it('a RELEASED hold is fully returned', () => {
    const w = computeFromLedger([
      row('grant', 100, null),
      row('hold', -50, 'job-3:hold'),
      row('release', 50, 'job-3:release'),
    ]);
    expect(w.free_balance).toBe(100);
    expect(w.reserved_free).toBe(0);
  });

  it('legacy keyless rows keep the previous net accounting', () => {
    const w = computeFromLedger([
      row('grant', 100, null),
      row('hold', -50, null),
      row('confirm', -5, null),
    ]);
    expect(w.free_balance).toBe(50);   // unchanged legacy behavior
    expect(w.reserved_free).toBe(45);  // unchanged legacy behavior
  });

  it('reproduces the incident aggregate: settled exposure holds leave balance = grants − consumed', () => {
    const rows = [row('grant', 4300, null)];
    // 20 jobs: hold 50 free, settle actual 5 (recorded in paid bucket).
    for (let i = 0; i < 20; i++) {
      rows.push(row('hold', -50, `job-${i}:hold`));
      rows.push(row('confirm', 0, `job-${i}:confirm`, -5));
    }
    const w = computeFromLedger(rows);
    expect(w.free_balance).toBe(4300 - 20 * 5); // 4200 — NOT 4300 − 1000
    expect(w.reserved_free).toBe(0);            // NOT 20 × 45 = 900 stranded
  });
});

describe('reconcileImpl write guard — never clobber a healthy wallet', () => {
  it('skips the write when a healthy row exists (transient-read trigger)', async () => {
    ledgerRows = [row('grant', 100, null), row('hold', -50, 'j:hold'), row('confirm', 0, 'j:confirm', -5)];
    walletRow = {
      free_balance: 95, paid_balance: 0, incentive_balance: 0,
      lifetime_purchased: 100, lifetime_consumed: 5,
    };
    const result = await reconcileOrgCreditProjection('org-healthy');
    expect(result.outcome).toBe('skipped_healthy');
    expect(upsertCalls).toHaveLength(0);
  });

  it('rebuilds when the row is genuinely broken (negative balance)', async () => {
    ledgerRows = [row('grant', 100, null)];
    walletRow = {
      free_balance: -7, paid_balance: 0, incentive_balance: 0,
      lifetime_purchased: 100, lifetime_consumed: 0,
    };
    const result = await reconcileOrgCreditProjection('org-broken');
    expect(result.outcome).toBe('rebuilt');
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload.free_balance).toBe(100);
  });

  it('rebuilds when the row is genuinely ABSENT but ledger has activity', async () => {
    ledgerRows = [row('grant', 100, null), row('hold', -50, 'k:hold')];
    walletRow = null;
    const result = await reconcileOrgCreditProjection('org-missing');
    expect(result.outcome).toBe('rebuilt');
    expect(upsertCalls[0].payload.free_balance).toBe(50);
    expect(upsertCalls[0].payload.reserved_free).toBe(50);
  });
});
