/**
 * Phase 13F — Customer Acquisition Intelligence tests (pure, deterministic).
 */

import {
  buildAcquisitionIntelligence,
  getCustomerAcquisitionIntelligence,
  type AcquisitionInputs,
} from '../../services/customerAcquisitionIntelligenceService';

const inputs = (over: Partial<AcquisitionInputs> = {}): AcquisitionInputs => ({
  signup_intents_total: 24, signup_intents_completed: 5,
  companies_total: 38, profiles_total: 29, profiles_completed: 3, active_total: 4,
  claimed_domain: { count: 2, last: '2026-06-14T00:00:00Z', domains: ['drishiq.com', 'omnivyra.com'] },
  eligibility_failures: { no_mx: 2 },
  domain_event_types: { DOMAIN_UNVERIFIED_USAGE: 2 },
  ...over,
});

describe('buildAcquisitionIntelligence — funnel', () => {
  it('reports measurable stage counts and marks blind-spot stages UNKNOWN (null)', () => {
    const r = buildAcquisitionIntelligence(inputs());
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s]));
    expect(by.SIGNUP_STARTED.count).toBe(24);
    expect(by.COMPANY_CREATED.count).toBe(38);
    expect(by.PROFILE_COMPLETED.count).toBe(3);
    expect(by.ACTIVE_CUSTOMER.count).toBe(4);
    expect(by.VISITOR.count).toBeNull();
    expect(by.VISITOR.measurable).toBe(false);
    expect(by.EMAIL_VERIFIED.measurable).toBe(false);
    expect(by.IDENTITY_VALIDATED.measurable).toBe(false);
  });
});

describe('conversions', () => {
  it('computes compatible rates and refuses incompatible cross-population ones', () => {
    const r = buildAcquisitionIntelligence(inputs());
    const by = Object.fromEntries(r.conversions.map((c) => [c.label, c]));
    expect(by['signup_intent completion (started → completed)'].rate).toBe(20.8); // 5/24
    expect(by['company → active'].rate).toBe(10.5); // 4/38
    expect(by['company → profile completed'].rate).toBe(7.9); // 3/38
    expect(by['signup_started → company_created'].rate).toBeNull(); // incompatible windows
  });
  it('rate is null when denominator is 0 (no guessing)', () => {
    const r = buildAcquisitionIntelligence(inputs({ companies_total: 0, active_total: 0, profiles_total: 0, profiles_completed: 0 }));
    expect(r.conversions.find((c) => c.label === 'company → active')!.rate).toBeNull();
  });
});

describe('loss classification', () => {
  it('classifies from evidence; PROFILE_ABANDONED = companies without a profile', () => {
    const r = buildAcquisitionIntelligence(inputs());
    const by = Object.fromEntries(r.loss_reasons.map((l) => [l.reason, l]));
    expect(by.CLAIMED_DOMAIN.count).toBe(2);
    expect(by.DOMAIN_BLOCKED.count).toBe(2);      // no_mx
    expect(by.PROFILE_ABANDONED.count).toBe(9);   // 38 - 29
    expect(by.UNKNOWN.count).toBe(19);            // 24 - 5 pending intents
    expect(by.PUBLIC_EMAIL.count).toBe(0);
    expect(by.EMAIL_UNVERIFIED.count).toBe(0);
  });
  it('UNKNOWN only reflects truly unattributed pending intents', () => {
    const r = buildAcquisitionIntelligence(inputs({ signup_intents_total: 10, signup_intents_completed: 10 }));
    expect(r.loss_reasons.find((l) => l.reason === 'UNKNOWN')!.count).toBe(0);
  });
  it('every loss reason carries evidence text', () => {
    const r = buildAcquisitionIntelligence(inputs());
    expect(r.loss_reasons.every((l) => l.evidence.length > 0)).toBe(true);
  });
});

describe('portfolio + determinism', () => {
  it('most common blockers ranked desc, only > 0', () => {
    const r = buildAcquisitionIntelligence(inputs());
    expect(r.portfolio.most_common_blockers[0].reason).toBe('UNKNOWN'); // 19
    expect(r.portfolio.most_common_blockers.every((b) => b.count > 0)).toBe(true);
    expect(r.portfolio.company_to_active.rate).toBe(10.5);
  });
  it('identical inputs → identical output', () => {
    expect(JSON.stringify(buildAcquisitionIntelligence(inputs()))).toBe(JSON.stringify(buildAcquisitionIntelligence(inputs())));
  });
  it('orchestrator uses injected loader', async () => {
    const r = await getCustomerAcquisitionIntelligence({ companies_total: 38, active_total: 4 }, { load: async () => inputs() });
    expect(r.funnel.find((s) => s.stage === 'COMPANY_CREATED')!.count).toBe(38);
  });
});
