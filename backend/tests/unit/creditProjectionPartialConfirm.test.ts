/**
 * MONEY (e9, 2026-11-12): computeFromLedger (the wallet rebuild used when a
 * projection is broken) must read token-priced settlements. A partial confirm
 * (live body: no remainder row; guarded 20270217000023: plus a
 * `<key>:remainder` release row) closes its hold; its per-bucket deltas are the
 * EXACT net balance effect, including an over-run drawn from another bucket.
 * Previously the hold read as OPEN: reserved inflated, balance understated,
 * consumption missing.
 */
import { computeFromLedger } from '../../services/creditProjectionReconciler';

type R = { execution_phase: string; free_delta: number; paid_delta: number; incentive_delta: number; idempotency_key: string | null };
const row = (phase: string, key: string | null, f = 0, p = 0, i = 0): R =>
  ({ execution_phase: phase, idempotency_key: key, free_delta: f, paid_delta: p, incentive_delta: i });

it('LIVE body (no remainder row): the hold is settled; balance = grant - consumed; nothing reserved', () => {
  const w = computeFromLedger([
    row('grant', 'g:grant', 100),
    row('hold', 'b:hold', -20),
    row('confirm_partial', 'b:confirm', -12),
  ] as any);
  expect(w).toMatchObject({ free_balance: 88, reserved_free: 0, lifetime_consumed: 12, lifetime_purchased: 100 });
});

it('GUARDED body: the :remainder release row belongs to its partial confirm (same wallet, not double-returned)', () => {
  const w = computeFromLedger([
    row('grant', 'g:grant', 100),
    row('hold', 'b:hold', -20),
    row('confirm_partial', 'b:confirm', -12),
    row('release', 'b:confirm:remainder', 8),
  ] as any);
  expect(w).toMatchObject({ free_balance: 88, reserved_free: 0, lifetime_consumed: 12 });
});

it('an OVER-RUN drawn across buckets (free hold, paid excess) is charged to the bucket that paid', () => {
  const w = computeFromLedger([
    row('grant', 'g:grant', 100, 50),
    row('hold', 'd:hold', -10),
    row('confirm_partial', 'd:confirm', -10, -5),
  ] as any);
  expect(w).toMatchObject({ free_balance: 90, paid_balance: 45, reserved_free: 0, reserved_paid: 0, lifetime_consumed: 15 });
});

it('control: plain confirm / release pairing is unchanged (the incident math)', () => {
  const w = computeFromLedger([
    row('grant', 'g:grant', 100),
    row('hold', 'a:hold', -50),
    row('confirm', 'a:confirm', -15),
    row('hold', 'c:hold', -5),
    row('release', 'c:release', 5),
  ] as any);
  expect(w).toMatchObject({ free_balance: 85, reserved_free: 0, lifetime_consumed: 15 });
});
