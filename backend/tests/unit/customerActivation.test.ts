/**
 * Phase 14B — Customer Activation tests (pure, deterministic).
 */

import {
  classifyActivation,
  analyzeActivation,
  activationFromReadiness,
  type ActivationCompany,
} from '../../services/customerActivationService';
import type { ReadinessState } from '../../services/customerReadinessService';

const NOW = Date.parse('2026-06-23T00:00:00Z');
const co = (over: Partial<ActivationCompany> = {}): ActivationCompany => ({
  company_id: 'c1', company_name: 'Acme', created_at: '2026-05-01T00:00:00Z', is_active: false,
  profile: 'NOT_READY', domain: 'NOT_READY', ga: 'NOT_READY', gsc: 'NOT_READY', social: 'NOT_READY', team: 'NOT_READY',
  active_user_count_30d: 0, ...over,
});
const allReady = (): Partial<ActivationCompany> => ({ profile: 'READY' as ReadinessState, domain: 'READY', ga: 'READY', gsc: 'READY', social: 'READY', team: 'READY', active_user_count_30d: 3 });

describe('classifyActivation', () => {
  it('ACTIVATED when active', () => {
    expect(classifyActivation(co({ is_active: true }), NOW).status).toBe('ACTIVATED');
  });
  it('single unmet milestone → that blocker', () => {
    const c = classifyActivation(co({ ...allReady(), profile: 'NOT_READY' }), NOW); // activity 3 (engaged) → only profile unmet
    expect(c.blocker).toBe('PROFILE_INCOMPLETE');
    expect(c.status).toBe('IN_PROGRESS');
  });
  it('multiple unmet → MULTIPLE_BLOCKERS', () => {
    expect(classifyActivation(co(), NOW).blocker).toBe('MULTIPLE_BLOCKERS');
  });
  it('all milestones met but inactive → NO_MEANINGFUL_ACTIVITY when activity is the only gap', () => {
    const c = classifyActivation(co({ profile: 'READY', domain: 'READY', ga: 'READY', gsc: 'READY', social: 'READY', team: 'READY', active_user_count_30d: 0, created_at: '2026-06-22T00:00:00Z' }), NOW);
    expect(c.blocker).toBe('NO_MEANINGFUL_ACTIVITY');
  });
  it('engaged → IN_PROGRESS; stale+unengaged → ABANDONED; recent+unengaged → BLOCKED', () => {
    expect(classifyActivation(co({ active_user_count_30d: 2 }), NOW).status).toBe('IN_PROGRESS');
    expect(classifyActivation(co({ created_at: '2026-05-01T00:00:00Z', active_user_count_30d: 0 }), NOW).status).toBe('ABANDONED');
    expect(classifyActivation(co({ created_at: '2026-06-22T00:00:00Z', active_user_count_30d: 0 }), NOW).status).toBe('BLOCKED');
  });
  it('all-UNKNOWN signals → UNKNOWN', () => {
    const c = classifyActivation(co({ profile: 'UNKNOWN', domain: 'UNKNOWN', ga: 'UNKNOWN', gsc: 'UNKNOWN', social: 'UNKNOWN', team: 'UNKNOWN', active_user_count_30d: 0 }), NOW);
    expect(c.status).toBe('UNKNOWN');
  });
});

describe('analyzeActivation — funnel + correlation', () => {
  const companies = [
    co({ company_id: 'a', ...allReady(), is_active: true }),                 // activated
    co({ company_id: 'b', profile: 'READY', domain: 'READY' }),              // partial, stale, unengaged
    co({ company_id: 'c', profile: 'READY' }),                               // profile only
    co({ company_id: 'd' }),                                                 // nothing
  ];
  const r = analyzeActivation(companies, NOW);

  it('independent stage reach + conversion', () => {
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s.reached]));
    expect(by.COMPANY_CREATED).toBe(4);
    expect(by.PROFILE_COMPLETED).toBe(3); // a, b, c
    expect(by.DOMAIN_VERIFIED).toBe(2);   // a, b
    expect(by.ACTIVATED).toBe(1);
    expect(r.activation_conversion_pct).toBe(25);
  });
  it('largest drop-off identified', () => {
    expect(r.largest_dropoff).not.toBeNull();
    expect(r.largest_dropoff!.lost).toBeGreaterThan(0);
  });
  it('status distribution', () => {
    expect(r.by_status.ACTIVATED).toBe(1);
    expect(r.by_status.ABANDONED).toBeGreaterThanOrEqual(1);
  });
  it('correlation reports association (with vs without) per milestone', () => {
    const prof = r.correlations.find((c) => c.milestone === 'PROFILE_COMPLETED')!;
    expect(prof.population_with).toBe(3);
    expect(prof.activated_with).toBe(1); // only a is active among profile-complete
    expect(prof.rate_with).toBe(33.3);
    expect(prof.population_without).toBe(1);
    expect(prof.rate_without).toBe(0);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeActivation(companies, NOW))).toBe(JSON.stringify(r));
  });
});

describe('activationFromReadiness', () => {
  it('maps readiness fields to activation input', () => {
    const a = activationFromReadiness({
      company_id: 'x', company_name: 'X', created_at: null, tenant_status: 'ACTIVE',
      company_profile_ready: 'READY', website_ready: 'NOT_READY', ga_ready: 'UNKNOWN', gsc_ready: 'NOT_READY',
      social_ready: 'READY', team_ready: 'NOT_READY', active_user_count_30d: 5,
    });
    expect(a.is_active).toBe(true);
    expect(a.profile).toBe('READY');
    expect(a.domain).toBe('NOT_READY');
    expect(a.active_user_count_30d).toBe(5);
  });
});
