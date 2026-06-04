/**
 * Phase 9B — pure presentation helpers (no DB, no React).
 */

import {
  summarizeCompanyCredits,
  groupCreditHistoryByActivity,
} from '../../../components/company-credits/creditPresentation';

describe('summarizeCompanyCredits (TASK 1)', () => {
  it('derives available/reserved/effective/consumed/purchased/bonus', () => {
    const s = summarizeCompanyCredits({
      freeBalance: 100, paidBalance: 50, incentiveBalance: 20,
      reservedFree: 10, reservedPaid: 5, reservedIncentive: 0,
      lifetimePurchased: 500, lifetimeConsumed: 300,
    });
    expect(s).toEqual({
      availableCredits: 170,    // 100+50+20
      reservedCredits: 15,      // 10+5+0
      effectiveCredits: 155,    // 170−15
      consumedCredits: 300,
      totalPurchasedCredits: 500,
      totalBonusCredits: 20,
    });
  });

  it('never returns negative effective', () => {
    const s = summarizeCompanyCredits({
      freeBalance: 0, paidBalance: 0, incentiveBalance: 0,
      reservedFree: 5, reservedPaid: 0, reservedIncentive: 0,
      lifetimePurchased: 0, lifetimeConsumed: 0,
    });
    expect(s.effectiveCredits).toBe(0);
  });
});

describe('groupCreditHistoryByActivity (TASK 4)', () => {
  it('groups consumed/reserved/released/settlements by activity', () => {
    const groups = groupCreditHistoryByActivity([
      { execution_phase: 'confirm', credits_delta: -60, reference_type: 'blog_generation' },
      { execution_phase: 'confirm', credits_delta: -20, reference_type: 'blog_generation' },
      { execution_phase: 'hold', credits_delta: -10, reference_type: 'content_basic' },
      { execution_phase: 'release', credits_delta: -4, reference_type: 'content_basic' },
    ]);
    const blog = groups.find((g) => g.activity === 'blog_generation')!;
    const content = groups.find((g) => g.activity === 'content_basic')!;
    expect(blog).toMatchObject({ consumed: 80, reserved: 0, released: 0, settlements: 2, events: 2 });
    expect(content).toMatchObject({ consumed: 0, reserved: 10, released: 4, settlements: 0, events: 2 });
    // sorted by consumed desc
    expect(groups[0].activity).toBe('blog_generation');
  });

  it('null reference_type falls back to "unknown"', () => {
    const groups = groupCreditHistoryByActivity([{ execution_phase: 'confirm', credits_delta: -5, reference_type: null }]);
    expect(groups[0].activity).toBe('unknown');
  });
});
