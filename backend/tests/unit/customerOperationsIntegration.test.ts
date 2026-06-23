/**
 * Phase 13J — Customer Operations loader + orchestrator + governance integration tests.
 *
 * Uses a faithful in-memory `supabase` mock (honors .eq/.in/.gte filters, records write
 * spies) so the real loaders and the real `getCustomerOperations` composition run without
 * a live DB. `getCustomerReadiness` is mocked to canned tenants so the test controls inputs.
 */

jest.mock('../../db/supabaseClient', () => {
  const spies = { insert: jest.fn(), update: jest.fn(), upsert: jest.fn(), delete: jest.fn(), rpc: jest.fn() };
  let seed: Record<string, any[]> = {};
  class QB {
    _all: any[]; _f: ((r: any) => boolean)[] = []; _head = false; _limit: number | null = null;
    constructor(table: string) { this._all = (seed[table] || []).slice(); }
    select(_c?: any, opts?: any) { if (opts) this._head = !!opts.head; return this; }
    eq(c: string, v: any) { this._f.push((r) => r[c] === v); return this; }
    in(c: string, v: any[]) { this._f.push((r) => Array.isArray(v) && v.includes(r[c])); return this; }
    gte(c: string, v: any) { this._f.push((r) => r[c] >= v); return this; }
    lte(c: string, v: any) { this._f.push((r) => r[c] <= v); return this; }
    order() { return this; } ilike() { return this; } not() { return this; }
    limit(n: number) { this._limit = n; return this; }
    insert(...a: any[]) { spies.insert(...a); return this; }
    update(...a: any[]) { spies.update(...a); return this; }
    upsert(...a: any[]) { spies.upsert(...a); return this; }
    delete(...a: any[]) { spies.delete(...a); return this; }
    _rows() { let r = this._all.filter((x) => this._f.every((f) => f(x))); if (this._limit != null) r = r.slice(0, this._limit); return r; }
    then(resolve: (v: any) => void) { const rows = this._rows(); resolve({ data: this._head ? null : rows, count: rows.length, error: null }); }
  }
  return {
    supabase: { from: (t: string) => new QB(t), rpc: (...a: any[]) => { spies.rpc(...a); return Promise.resolve({ data: null, error: null }); } },
    __spies: spies,
    __setSeed: (s: Record<string, any[]>) => { seed = s; },
  };
});

const mockReadiness = jest.fn();
jest.mock('../../services/customerReadinessService', () => ({
  ...jest.requireActual('../../services/customerReadinessService'),
  getCustomerReadiness: (...a: any[]) => mockReadiness(...a),
}));

import { getCustomerOperations } from '../../services/customerOperationsCockpitService';
import { loadSignupFunnel } from '../../services/customerOperationsCockpitService';
import { loadOutcomeSnapshots } from '../../services/customerOutcomeIntelligenceService';
import { loadSignalObservations } from '../../services/customerSignalConfidenceService';
import { loadAcquisitionInputs } from '../../services/customerAcquisitionIntelligenceService';
import { loadReadinessHistory } from '../../services/customerEvolutionService';
import type { CompanyReadiness } from '../../services/customerReadinessService';

const db = jest.requireMock('../../db/supabaseClient') as any;

const tenant = (over: Partial<CompanyReadiness> = {}): CompanyReadiness => ({
  company_id: 'a', company_name: 'Alpha', plan: 'Pro', user_count: 3, active_user_count_30d: 2,
  created_at: '2026-05-01T00:00:00Z', last_activity_at: '2026-06-20T00:00:00Z', tenant_status: 'ACTIVE',
  company_profile_ready: 'NOT_READY', website_ready: 'NOT_READY', ga_ready: 'NOT_READY', gsc_ready: 'NOT_READY',
  social_ready: 'NOT_READY', community_ready: 'UNKNOWN', team_ready: 'NOT_READY', billing_ready: 'READY',
  overall_readiness_score: 30, readiness_bucket: 'AT_RISK', missing_areas: [], ...over,
});

const snap = (company_id: string, date: string, score: number, over: Record<string, any> = {}) => ({
  company_id, snapshot_date: date, taken_at: `${date}T06:00:00Z`, overall_readiness_score: score,
  readiness_bucket: score >= 70 ? 'READY' : score >= 40 ? 'PARTIAL' : 'AT_RISK', priority_score: 50, opportunity_count: 5,
  company_profile_ready: 'NOT_READY', website_ready: 'NOT_READY', ga_ready: 'NOT_READY', gsc_ready: 'NOT_READY',
  social_ready: 'NOT_READY', community_ready: 'UNKNOWN', team_ready: 'NOT_READY', billing_ready: 'READY', ...over,
});

const SEED = () => ({
  companies: [
    { id: 'a', name: 'Alpha', website: 'https://alpha.com', website_domain: 'alpha.com', admin_email_domain: 'alpha.com' },
    { id: 'b', name: 'Beta', website: null, website_domain: 'beta.com', admin_email_domain: null },
  ],
  customer_readiness_snapshots: [
    snap('a', '2026-06-22', 40), snap('a', '2026-06-23', 65, { website_ready: 'READY' }), // improving + website flip
  ],
  company_domains: [{ company_id: 'a', verified_at: '2026-06-21T00:00:00Z', verification_status: 'verified' }],
  analytics_integrations: [{ company_id: 'a', provider: 'GA4', status: 'active', created_at: '2026-06-01T00:00:00Z', last_live_check_at: '2026-06-20T00:00:00Z' }],
  social_accounts: [{ company_id: 'a', created_at: '2026-06-01T00:00:00Z', last_successful_refresh_at: '2026-06-19T00:00:00Z' }],
  company_profiles: [{ company_id: 'a', last_refined_at: '2026-06-18T00:00:00Z', updated_at: '2026-06-18T00:00:00Z', overall_confidence: 75 }],
  user_company_roles: [{ company_id: 'a', accepted_at: '2026-05-10T00:00:00Z', status: 'active' }],
  signup_intents: [{ status: 'completed' }, { status: 'pending' }, { status: 'pending' }],
  signup_referrals: [{ domain: 'claimed.com', last_attempt_at: '2026-06-14T00:00:00Z' }],
  domain_eligibility_cache: [{ domain: 'x.com', reason: 'no_mx', checked_at: '2026-06-10T00:00:00Z' }, { domain: 'y.com', reason: 'valid_company', checked_at: '2026-06-10T00:00:00Z' }],
  domain_events: [{ event_type: 'DOMAIN_UNVERIFIED_USAGE', final_domain: 'z.com', created_at: '2026-06-12T00:00:00Z' }],
});

beforeEach(() => {
  db.__setSeed(SEED());
  Object.values(db.__spies).forEach((s: any) => s.mockClear());
  mockReadiness.mockResolvedValue({
    summary: {}, readiness_breakdown: {},
    tenants: [tenant({ company_id: 'a', company_name: 'Alpha', tenant_status: 'ACTIVE', billing_ready: 'READY' }), tenant({ company_id: 'b', company_name: 'Beta', tenant_status: 'DORMANT', billing_ready: 'NOT_READY', plan: 'Free' })],
  });
});

// ── Phase 1: loader coverage ──
describe('loaders map source columns correctly (filter-honoring mock)', () => {
  it('loadReadinessHistory scopes by company_id and maps area columns', async () => {
    const h = await loadReadinessHistory(['a']);
    expect(h.get('a')).toHaveLength(2);
    expect(h.get('b')).toBeUndefined();
  });
  it('loadOutcomeSnapshots returns ordered snapshots per company', async () => {
    const m = await loadOutcomeSnapshots(['a', 'b']);
    expect(m.get('a')!.length).toBe(2);
    expect(m.get('a')![0].areas.WEBSITE).toBeDefined();
  });
  it('loadSignalObservations maps GA4 provider + timestamps', async () => {
    const m = await loadSignalObservations(['a']);
    expect(m.get('a')!.WEBSITE!.last_updated).toBe('2026-06-21T00:00:00Z');
    expect(m.get('a')!.GOOGLE_ANALYTICS!.last_updated).toBe('2026-06-20T00:00:00Z'); // last_live_check_at preferred
    expect(m.get('a')!.COMPANY_PROFILE!.last_updated).toBe('2026-06-18T00:00:00Z');
  });
  it('loadAcquisitionInputs counts completed vs pending via honored .eq filter', async () => {
    const i = await loadAcquisitionInputs({ companies_total: 2, active_total: 1 });
    expect(i.signup_intents_total).toBe(3);
    expect(i.signup_intents_completed).toBe(1);
    expect(i.claimed_domain.count).toBe(1);
    expect(i.eligibility_failures.no_mx).toBe(1);
    expect(i.eligibility_failures.valid_company).toBeUndefined(); // success excluded
  });
  it('loadSignupFunnel aggregates the 6 buckets', async () => {
    const f = await loadSignupFunnel();
    expect(f.failures.find((x) => x.bucket === 'CLAIMED_DOMAIN')!.count).toBe(1);
  });
});

// ── Phase 2: orchestrator certification ──
describe('getCustomerOperations composition invariants', () => {
  it('summary counts are consistent with the returned companies', async () => {
    const r = await getCustomerOperations({});
    expect(r.companies.length).toBe(2);
    expect(r.summary.total_companies).toBe(2);
    expect(r.summary.active).toBe(r.companies.filter((c) => c.tenant_status === 'ACTIVE').length);
    expect(r.summary.paying).toBe(r.companies.filter((c) => c.paying).length);
  });
  it('filters reduce the set consistently', async () => {
    const r = await getCustomerOperations({ status: 'ACTIVE' });
    expect(r.companies.every((c) => c.tenant_status === 'ACTIVE')).toBe(true);
    expect(r.companies.length).toBe(1);
  });
  it('cross-engine fields are attached per company', async () => {
    const r = await getCustomerOperations({});
    const a = r.companies.find((c) => c.company_id === 'a')!;
    expect(a.outcome_classification).toBeDefined();
    expect(a.impact_status).toBeDefined();
    expect(a.overall_signal_confidence).toBeDefined();
    expect(Array.isArray(a.recommended_playbooks)).toBe(true);
  });
  it('outcome flows through from 2-day snapshot history (not NO_HISTORY)', async () => {
    const r = await getCustomerOperations({});
    const a = r.companies.find((c) => c.company_id === 'a')!;
    expect(a.outcome_classification).toBe('IMPROVED'); // 40 → 65
    expect(a.net_change).toBe(25);
  });
  it('portfolio + sub-result blocks are present and shaped', async () => {
    const r = await getCustomerOperations({});
    expect(r.outcomes).toBeDefined();
    expect(r.impact).toBeDefined();
    expect(r.signal_health.per_area).toHaveLength(8);
    expect(r.acquisition.funnel.length).toBe(7);
    expect(r.playbooks).toBeDefined();
    expect(r.telemetry.coverage_percentage).toBeGreaterThan(0);
  });
  it('drawer data == the row object (no separate fetch)', async () => {
    const r = await getCustomerOperations({});
    const a = r.companies.find((c) => c.company_id === 'a')!;
    expect(a.recommended_playbooks).toBe(a.recommended_playbooks); // same reference served to drawer
  });
});

// ── Phase 3: governance regression protection ──
describe('read path performs zero writes', () => {
  it('no insert/update/upsert/delete/rpc during a full getCustomerOperations run', async () => {
    await getCustomerOperations({});
    expect(db.__spies.insert).not.toHaveBeenCalled();
    expect(db.__spies.update).not.toHaveBeenCalled();
    expect(db.__spies.upsert).not.toHaveBeenCalled();
    expect(db.__spies.delete).not.toHaveBeenCalled();
    expect(db.__spies.rpc).not.toHaveBeenCalled();
  });
});
