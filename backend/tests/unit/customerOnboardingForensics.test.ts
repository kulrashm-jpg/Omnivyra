/**
 * Phase 16D — Onboarding Setup Forensics tests (pure, deterministic). Evidence-only.
 */

import {
  milestoneState,
  classifyBottleneck,
  analyzeOnboardingForensics,
  type CustomerSetupRecords,
} from '../../services/customerOnboardingForensicsService';

const rec = (over: Partial<CustomerSetupRecords> = {}): CustomerSetupRecords => ({
  company_id: 'c1', company_name: 'Acme',
  profile: { exists: true, confidence: 0, refined: false }, domain: { rows: 0, verified: false }, ga: 'NONE', gsc: 'NONE', team: { users: 1, invites: 0 }, ...over,
});

describe('milestoneState', () => {
  it('PROFILE: unscored row (exists, conf 0, not refined) → ATTEMPTED_UNSCORED', () => {
    expect(milestoneState(rec(), 'PROFILE')).toBe('ATTEMPTED_UNSCORED');
  });
  it('PROFILE: scored ≥60 → COMPLETE; missing row → NEVER_STARTED', () => {
    expect(milestoneState(rec({ profile: { exists: true, confidence: 67, refined: true } }), 'PROFILE')).toBe('COMPLETE');
    expect(milestoneState(rec({ profile: { exists: false, confidence: 0, refined: false } }), 'PROFILE')).toBe('NEVER_STARTED');
  });
  it('DOMAIN: unverified row → ATTEMPTED_PENDING; no row → NEVER_STARTED; verified → COMPLETE', () => {
    expect(milestoneState(rec({ domain: { rows: 1, verified: false } }), 'DOMAIN')).toBe('ATTEMPTED_PENDING');
    expect(milestoneState(rec({ domain: { rows: 0, verified: false } }), 'DOMAIN')).toBe('NEVER_STARTED');
    expect(milestoneState(rec({ domain: { rows: 1, verified: true } }), 'DOMAIN')).toBe('COMPLETE');
  });
  it('GA: disconnected → ATTEMPTED_DISCONNECTED; none → NEVER_STARTED', () => {
    expect(milestoneState(rec({ ga: 'DISCONNECTED' }), 'GA')).toBe('ATTEMPTED_DISCONNECTED');
    expect(milestoneState(rec({ ga: 'NONE' }), 'GA')).toBe('NEVER_STARTED');
  });
  it('TEAM: invites or extra users → COMPLETE; else NEVER_STARTED', () => {
    expect(milestoneState(rec({ team: { users: 1, invites: 0 } }), 'TEAM')).toBe('NEVER_STARTED');
    expect(milestoneState(rec({ team: { users: 1, invites: 2 } }), 'TEAM')).toBe('COMPLETE');
  });
});

describe('classifyBottleneck', () => {
  it('attempted-but-failed → PRODUCT_FLOW', () => {
    const b = classifyBottleneck(['ATTEMPTED_UNSCORED', 'ATTEMPTED_UNSCORED', 'COMPLETE']);
    expect(b.classification).toBe('PRODUCT_FLOW');
  });
  it('all never-started → UNKNOWN (can\'t tell behavior from missing prompt)', () => {
    const b = classifyBottleneck(['NEVER_STARTED', 'NEVER_STARTED']);
    expect(b.classification).toBe('UNKNOWN');
    expect(b.confidence).toBe('LOW');
  });
  it('mixed attempt + never → PRODUCT_FLOW (attempts are direct evidence)', () => {
    expect(classifyBottleneck(['ATTEMPTED_PENDING', 'ATTEMPTED_PENDING', 'NEVER_STARTED']).classification).toBe('PRODUCT_FLOW');
  });
});

describe('analyzeOnboardingForensics — the live 5-customer forensic shape', () => {
  const customers: CustomerSetupRecords[] = [
    rec({ company_id: 'drishiq', company_name: 'Drishiq', profile: { exists: true, confidence: 67, refined: true }, domain: { rows: 0, verified: false }, ga: 'DISCONNECTED' }),
    rec({ company_id: 'unf', company_name: 'Unfinished', profile: { exists: true, confidence: 100, refined: true }, domain: { rows: 1, verified: false }, ga: 'DISCONNECTED', gsc: 'DISCONNECTED' }),
    rec({ company_id: 'embro', company_name: 'Embrosales', profile: { exists: true, confidence: 0, refined: false }, domain: { rows: 1, verified: false } }),
    rec({ company_id: 'afrost', company_name: 'Afrost', profile: { exists: true, confidence: 0, refined: false } }),
    rec({ company_id: 'infitoo', company_name: 'Infitoo', profile: { exists: true, confidence: 0, refined: false } }),
  ];
  const r = analyzeOnboardingForensics(customers);

  it('PROFILE: 2 complete, 3 ATTEMPTED_UNSCORED → PRODUCT_FLOW', () => {
    const p = r.friction.find((f) => f.milestone === 'PROFILE')!;
    expect(p.states.COMPLETE).toBe(2);
    expect(p.states.ATTEMPTED_UNSCORED).toBe(3);
    expect(p.bottleneck).toBe('PRODUCT_FLOW');
  });
  it('DOMAIN: 2 pending, 3 never started → PRODUCT_FLOW (attempts present)', () => {
    const d = r.friction.find((f) => f.milestone === 'DOMAIN')!;
    expect(d.states.ATTEMPTED_PENDING).toBe(2);
    expect(d.states.NEVER_STARTED).toBe(3);
    expect(d.bottleneck).toBe('PRODUCT_FLOW');
  });
  it('GA: 2 disconnected, 3 never → PRODUCT_FLOW', () => {
    expect(r.friction.find((f) => f.milestone === 'GA')!.bottleneck).toBe('PRODUCT_FLOW');
  });
  it('TEAM: 0 invites all → never started → UNKNOWN', () => {
    const t = r.friction.find((f) => f.milestone === 'TEAM')!;
    expect(t.states.NEVER_STARTED).toBe(5);
    expect(t.bottleneck).toBe('UNKNOWN');
  });
  it('single highest-confidence failure is PROFILE (PRODUCT_FLOW, HIGH)', () => {
    expect(r.single_highest_confidence_failure!.milestone).toBe('PROFILE');
    expect(r.single_highest_confidence_failure!.classification).toBe('PRODUCT_FLOW');
    expect(r.single_highest_confidence_failure!.confidence).toBe('HIGH');
  });
  it('per-customer first incomplete', () => {
    expect(r.per_customer.find((c) => c.company_id === 'unf')!.first_incomplete).toBe('DOMAIN');
    expect(r.per_customer.find((c) => c.company_id === 'afrost')!.first_incomplete).toBe('PROFILE');
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeOnboardingForensics(customers))).toBe(JSON.stringify(r));
  });
});
