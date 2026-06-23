/**
 * Phase 13A — Customer Operations Command Center aggregation tests (pure).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  aggregateSignupFunnel,
  applyCockpitFilters,
  type CockpitCompany,
} from '../../services/customerOperationsCockpitService';

const co = (over: Partial<CockpitCompany> = {}): CockpitCompany => ({
  company_id: 'co_1', company_name: 'Acme', website: 'https://acme.com', website_domain: 'acme.com', admin_email_domain: 'acme.com',
  identity_health: 'OK', tenant_status: 'ACTIVE', plan: 'Pro', paying: true, user_count: 3, active_user_count_30d: 2,
  readiness_score: 70, readiness_bucket: 'PARTIAL', priority_score: 60, priority_tier: 'HIGH',
  key_insight: null, primary_blocker: null, primary_opportunity: null, narrative: '',
  trajectory: 'UNKNOWN', score_delta: null, outcome_classification: 'NO_HISTORY', net_change: null,
  impact_status: 'INSUFFICIENT_DATA',
  overall_signal_confidence: 'UNKNOWN', stale_sources: 0, low_confidence_sources: 0, unknown_sources: 0,
  recommended_playbooks: [],
  ga: 'NOT_READY', gsc: 'NOT_READY', social: 'READY', community: 'UNKNOWN',
  opportunity_count: 2, highest_severity: 'MEDIUM', last_activity_at: '2026-06-20T00:00:00Z',
  ...over,
});

describe('aggregateSignupFunnel — 6 buckets from telemetry', () => {
  it('maps eligibility / events / referrals to the right buckets with counts, last + domains', () => {
    const f = aggregateSignupFunnel({
      eligibility: [
        { domain: 'gmail.com', reason: 'PUBLIC_EMAIL', checked_at: '2026-06-10T00:00:00Z' },
        { domain: 'a.com', reason: 'FORWARDING_DOMAIN', checked_at: '2026-06-11T00:00:00Z' },
        { domain: 'b.com', reason: 'NO_WEBSITE_FOUND', checked_at: '2026-06-12T00:00:00Z' },
      ],
      events: [
        { event_type: 'DOMAIN_RESOLUTION_FAILED', final_domain: 'c.com', created_at: '2026-06-13T00:00:00Z' },
        { event_type: 'DOMAIN_NOT_CANONICAL', final_domain: 'd.com', created_at: '2026-06-14T00:00:00Z' },
        { event_type: 'DOMAIN_FORWARDING_BLOCKED', final_domain: 'a.com', created_at: '2026-06-15T00:00:00Z' },
      ],
      referrals: [
        { domain: 'e.com', last_attempt_at: '2026-06-16T00:00:00Z' },
        { domain: 'e.com', last_attempt_at: '2026-06-17T00:00:00Z' },
      ],
      onboarded: 38,
    });
    const byB = Object.fromEntries(f.failures.map((x) => [x.bucket, x]));
    expect(byB.PUBLIC_EMAIL.count).toBe(1);
    expect(byB.NO_WEBSITE_FOUND.count).toBe(1);
    expect(byB.DOMAIN_RESOLUTION_FAILED.count).toBe(1);
    expect(byB.DOMAIN_NOT_CANONICAL.count).toBe(1);
    expect(byB.FORWARDING_DOMAIN.count).toBe(2); // eligibility + event
    expect(byB.CLAIMED_DOMAIN.count).toBe(2);
    expect(byB.CLAIMED_DOMAIN.affected_domains).toEqual(['e.com']); // deduped
    expect(byB.CLAIMED_DOMAIN.last_occurrence).toBe('2026-06-17T00:00:00Z'); // max
    expect(f.total_failures).toBe(8);
    expect(f.onboarded).toBe(38);
  });

  it('all six buckets always present even with no data', () => {
    const f = aggregateSignupFunnel({ eligibility: [], events: [], referrals: [], onboarded: 0 });
    expect(f.failures.map((x) => x.bucket).sort()).toEqual(['CLAIMED_DOMAIN', 'DOMAIN_NOT_CANONICAL', 'DOMAIN_RESOLUTION_FAILED', 'FORWARDING_DOMAIN', 'NO_WEBSITE_FOUND', 'PUBLIC_EMAIL']);
    expect(f.total_failures).toBe(0);
  });
});

describe('applyCockpitFilters — filters + priority sort', () => {
  const list: CockpitCompany[] = [
    co({ company_id: 'a', company_name: 'Acme', tenant_status: 'ACTIVE', plan: 'Pro', priority_tier: 'CRITICAL', priority_score: 90, readiness_bucket: 'PARTIAL', trajectory: 'IMPROVING' }),
    co({ company_id: 'b', company_name: 'Beta', tenant_status: 'DORMANT', plan: 'Free', priority_tier: 'MEDIUM', priority_score: 50, readiness_bucket: 'AT_RISK', trajectory: 'DECLINING' }),
    co({ company_id: 'c', company_name: 'Gamma', tenant_status: 'ACTIVE', plan: 'Pro', priority_tier: 'HIGH', priority_score: 70, readiness_bucket: 'PARTIAL', trajectory: 'IMPROVING' }),
  ];

  it('sorts by priority_score desc (tiebreak company_id)', () => {
    expect(applyCockpitFilters(list, {}).map((c) => c.company_id)).toEqual(['a', 'c', 'b']);
  });
  it('filters by each dimension', () => {
    expect(applyCockpitFilters(list, { status: 'DORMANT' }).map((c) => c.company_id)).toEqual(['b']);
    expect(applyCockpitFilters(list, { plan: 'Free' }).map((c) => c.company_id)).toEqual(['b']);
    expect(applyCockpitFilters(list, { priority: 'CRITICAL' }).map((c) => c.company_id)).toEqual(['a']);
    expect(applyCockpitFilters(list, { readiness: 'AT_RISK' }).map((c) => c.company_id)).toEqual(['b']);
    expect(applyCockpitFilters(list, { trajectory: 'IMPROVING' }).map((c) => c.company_id)).toEqual(['a', 'c']);
    expect(applyCockpitFilters(list, { search: 'gam' }).map((c) => c.company_id)).toEqual(['c']);
  });
});

describe('read-only contract', () => {
  it('cockpit service + API perform no write operations', () => {
    const svc = readFileSync(resolve(__dirname, '../../services/customerOperationsCockpitService.ts'), 'utf8');
    const api = readFileSync(resolve(__dirname, '../../../pages/api/super-admin/customer-operations.ts'), 'utf8');
    for (const code of [svc, api]) {
      expect(code).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    }
  });
});
