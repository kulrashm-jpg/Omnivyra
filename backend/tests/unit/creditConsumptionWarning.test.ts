/**
 * Consumption warning logic — thresholds (once each) + forecast-gated email.
 */

import {
  newlyCrossedThresholds,
  sessionWarningToShow,
  shouldSendLowCreditEmail,
  evaluateConsumptionWarnings,
  type WarningDeps,
} from '../../services/creditConsumptionWarningService';

describe('newlyCrossedThresholds', () => {
  it('fires only newly-crossed thresholds', () => {
    expect(newlyCrossedThresholds(82, [])).toEqual([80]);
    expect(newlyCrossedThresholds(91, [80])).toEqual([90]);
    expect(newlyCrossedThresholds(96, [80, 90])).toEqual([95]);
    expect(newlyCrossedThresholds(96, [])).toEqual([80, 90, 95]);
    expect(newlyCrossedThresholds(79, [])).toEqual([]);
    expect(newlyCrossedThresholds(95, [80, 90, 95])).toEqual([]); // none repeat
  });
});

describe('sessionWarningToShow', () => {
  it('shows the highest newly-crossed (no stacking)', () => {
    expect(sessionWarningToShow(96, [])).toBe(95);
    expect(sessionWarningToShow(82, [])).toBe(80);
    expect(sessionWarningToShow(82, [80])).toBeNull();
  });
});

describe('shouldSendLowCreditEmail — ≥85% AND forecast insufficient AND not sent', () => {
  it('fires only on the full conjunction', () => {
    expect(shouldSendLowCreditEmail(86, { insufficientBeforePeriodEnd: true }, false)).toBe(true);
    expect(shouldSendLowCreditEmail(80, { insufficientBeforePeriodEnd: true }, false)).toBe(false); // <85
    expect(shouldSendLowCreditEmail(90, { insufficientBeforePeriodEnd: false }, false)).toBe(false); // forecast ok
    expect(shouldSendLowCreditEmail(90, { insufficientBeforePeriodEnd: true }, true)).toBe(false); // already sent
  });
  it('80% reached alone does NOT email', () => {
    expect(shouldSendLowCreditEmail(80, { insufficientBeforePeriodEnd: true }, false)).toBe(false);
  });
});

describe('evaluateConsumptionWarnings orchestration', () => {
  const mkDeps = (over: Partial<WarningDeps> & { consumed: number; fired: number[]; forecast: boolean; emailSent: boolean }, sink: { inApp: any[]; emails: number }): WarningDeps => ({
    getConsumedPct: async () => over.consumed,
    getFiredThresholds: async () => over.fired,
    getForecast: async () => ({ insufficientBeforePeriodEnd: over.forecast }),
    emailAlreadySent: async () => over.emailSent,
    emitInApp: async (_o, t) => { sink.inApp.push(t); },
    sendEmail: async () => { sink.emails += 1; },
  });

  it('92% consumed, 80 already fired, forecast insufficient → fires 90 in-app + email', async () => {
    const sink = { inApp: [] as any[], emails: 0 };
    const r = await evaluateConsumptionWarnings('o', mkDeps({ consumed: 92, fired: [80], forecast: true, emailSent: false }, sink));
    expect(r.inAppFired).toEqual([90]);
    expect(r.emailSent).toBe(true);
    expect(sink.inApp).toEqual([90]);
    expect(sink.emails).toBe(1);
  });
  it('88% but forecast OK → in-app fires (80) but NO email', async () => {
    const sink = { inApp: [] as any[], emails: 0 };
    const r = await evaluateConsumptionWarnings('o', mkDeps({ consumed: 88, fired: [], forecast: false, emailSent: false }, sink));
    expect(r.inAppFired).toEqual([80]);
    expect(r.emailSent).toBe(false);
    expect(sink.emails).toBe(0);
  });
  it('re-run same session (thresholds already fired) → no duplicate in-app, email idempotent', async () => {
    const sink = { inApp: [] as any[], emails: 0 };
    const r = await evaluateConsumptionWarnings('o', mkDeps({ consumed: 92, fired: [80, 90], forecast: true, emailSent: true }, sink));
    expect(r.inAppFired).toEqual([]);
    expect(r.emailSent).toBe(false);
  });
});
