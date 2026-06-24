/**
 * Subscription-state rehabilitation — resolver + allocation gate. Pure / injected; no mocking.
 */

import {
  resolveSubscriptionStateFrom,
  canReceiveSubscriptionCredits,
  isEntitled,
  GRACE_DAYS,
  type BillingSubscriptionRow,
} from '../../services/subscriptionStateResolver';
import { allocateMonthlyCreditsForOrg } from '../../services/subscriptionAllocationService';

const NOW = Date.parse('2026-06-24T00:00:00Z');
const future = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const past = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const sub = (over: Partial<BillingSubscriptionRow>): BillingSubscriptionRow => ({
  status: 'active', current_period_end: future(10), trial_ends_at: null, cancel_at_period_end: false, ...over,
});
const state = (s: BillingSubscriptionRow | null, hasPlan = true) =>
  resolveSubscriptionStateFrom({ subscription: s, hasPlanAssignment: hasPlan, nowMs: NOW });

describe('resolveSubscriptionStateFrom — the 6 canonical states', () => {
  it('active within period → ACTIVE', () => expect(state(sub({ status: 'active', current_period_end: future(10) }))).toBe('ACTIVE'));
  it('trialing within trial → TRIALING', () => expect(state(sub({ status: 'trialing', trial_ends_at: future(5) }))).toBe('TRIALING'));
  it('active, period ended, within grace → GRACE', () => expect(state(sub({ status: 'active', current_period_end: past(1) }))).toBe('GRACE'));
  it('active, period ended, past grace → EXPIRED', () => expect(state(sub({ status: 'active', current_period_end: past(GRACE_DAYS + 1) }))).toBe('EXPIRED'));
  it('past_due within grace → PAST_DUE; past grace → EXPIRED', () => {
    expect(state(sub({ status: 'past_due', current_period_end: past(1) }))).toBe('PAST_DUE');
    expect(state(sub({ status: 'past_due', current_period_end: past(GRACE_DAYS + 1) }))).toBe('EXPIRED');
  });
  it('canceled → CANCELED; expired → EXPIRED; paused → EXPIRED', () => {
    expect(state(sub({ status: 'canceled' }))).toBe('CANCELED');
    expect(state(sub({ status: 'expired' }))).toBe('EXPIRED');
    expect(state(sub({ status: 'paused' }))).toBe('EXPIRED');
  });
  it('active + cancel_at_period_end after period end → CANCELED', () => {
    expect(state(sub({ status: 'active', current_period_end: past(GRACE_DAYS + 1), cancel_at_period_end: true }))).toBe('CANCELED');
  });
  it('no subscription row: legacy plan assignment → ACTIVE; none → EXPIRED', () => {
    expect(state(null, true)).toBe('ACTIVE');
    expect(state(null, false)).toBe('EXPIRED');
  });
});

describe('entitlement predicates', () => {
  it('canReceiveSubscriptionCredits: only ACTIVE/TRIALING', () => {
    expect(canReceiveSubscriptionCredits('ACTIVE')).toBe(true);
    expect(canReceiveSubscriptionCredits('TRIALING')).toBe(true);
    for (const s of ['GRACE', 'PAST_DUE', 'EXPIRED', 'CANCELED'] as const) expect(canReceiveSubscriptionCredits(s)).toBe(false);
  });
  it('isEntitled: ACTIVE/TRIALING/GRACE', () => {
    for (const s of ['ACTIVE', 'TRIALING', 'GRACE'] as const) expect(isEntitled(s)).toBe(true);
    for (const s of ['PAST_DUE', 'EXPIRED', 'CANCELED'] as const) expect(isEntitled(s)).toBe(false);
  });
});

describe('allocation gate — canceled/expired blocked, active allowed (Step 6)', () => {
  const p = (subscriptionState: any, extra: any = {}) =>
    allocateMonthlyCreditsForOrg({ orgId: 'org1', planKey: 'growth', subscriptionState, now: new Date(NOW), ...extra });

  it('CANCELED → subscription_inactive, 0 credits, no grant', async () => {
    const r = await p('CANCELED');
    expect(r.status).toBe('subscription_inactive');
    expect(r.credits).toBe(0);
  });
  it('EXPIRED → subscription_inactive', async () => {
    expect((await p('EXPIRED')).status).toBe('subscription_inactive');
  });
  it('PAST_DUE / GRACE → subscription_inactive (no NEW subscription credits)', async () => {
    expect((await p('PAST_DUE')).status).toBe('subscription_inactive');
    expect((await p('GRACE')).status).toBe('subscription_inactive');
  });
  it('ACTIVE → passes gate (dry_run proceeds with full credits)', async () => {
    const r = await p('ACTIVE', { dryRun: true });
    expect(r.status).toBe('dry_run');
    expect(r.credits).toBe(700);
  });
  it('TRIALING → passes gate', async () => {
    expect((await p('TRIALING', { dryRun: true })).status).toBe('dry_run');
  });
  it('no_plan short-circuits before the subscription gate', async () => {
    const r = await allocateMonthlyCreditsForOrg({ orgId: 'org1', planKey: null, subscriptionState: 'CANCELED', now: new Date(NOW) });
    expect(r.status).toBe('no_plan');
  });
});
