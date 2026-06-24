/**
 * Top-up lock enforcement — derived availability gate (no balance mutation).
 */

import { isTopupUsable } from '../../services/subscriptionStateResolver';
import { computeAvailable, computeSplit, type WalletSnapshot } from '../../services/creditPriorityService';

const wallet: WalletSnapshot = {
  free_balance: 10, paid_balance: 100, incentive_balance: 5,
  reserved_free: 0, reserved_paid: 0, reserved_incentive: 0,
};

describe('isTopupUsable — usable through non-terminal states, locked when terminated', () => {
  it('ACTIVE / TRIALING / GRACE / PAST_DUE → usable', () => {
    for (const s of ['ACTIVE', 'TRIALING', 'GRACE', 'PAST_DUE'] as const) expect(isTopupUsable(s)).toBe(true);
  });
  it('EXPIRED / CANCELED → locked', () => {
    expect(isTopupUsable('EXPIRED')).toBe(false);
    expect(isTopupUsable('CANCELED')).toBe(false);
  });
});

describe('computeAvailable — derived top-up gate', () => {
  it('entitled (default) → paid included', () => {
    const a = computeAvailable(wallet);
    expect(a.paid).toBe(100);
    expect(a.total).toBe(115);
  });
  it('topupUsable=true → paid included', () => {
    expect(computeAvailable(wallet, { topupUsable: true }).paid).toBe(100);
  });
  it('topupUsable=false → paid = 0, free+incentive preserved', () => {
    const a = computeAvailable(wallet, { topupUsable: false });
    expect(a.paid).toBe(0);
    expect(a.free).toBe(10);
    expect(a.incentive).toBe(5);
    expect(a.total).toBe(15);
  });
  it('does NOT mutate the wallet (balance preserved)', () => {
    computeAvailable(wallet, { topupUsable: false });
    expect(wallet.paid_balance).toBe(100); // balance untouched
  });
});

describe('consumption ordering preserved under lock', () => {
  it('locked: a spend that needs paid is now insufficient (paid unavailable)', () => {
    const lockedAvail = computeAvailable(wallet, { topupUsable: false }); // {free10, incentive5, paid0}
    expect(computeSplit(20, lockedAvail)).toBeNull();        // 15 available < 20
    expect(computeSplit(15, lockedAvail)).toEqual({ free: 10, incentive: 5, paid: 0 }); // free→incentive only
  });
  it('unlocked: same spend draws free→incentive→paid (order unchanged)', () => {
    const avail = computeAvailable(wallet, { topupUsable: true });
    expect(computeSplit(20, avail)).toEqual({ free: 10, incentive: 5, paid: 5 });
  });
});
