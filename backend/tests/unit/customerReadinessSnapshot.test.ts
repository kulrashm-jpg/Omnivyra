/**
 * Phase 12H — Customer Readiness Snapshot tests (pure + injected in-memory store).
 */

import {
  buildSnapshotRow,
  generateReadinessSnapshots,
  SNAPSHOT_VERSION,
  type SnapshotRow,
  type SnapshotWriter,
} from '../../services/customerReadinessSnapshotService';
import { computeCompanyEvolution, type ReadinessSnapshot } from '../../services/customerEvolutionService';
import type { CompanyReadiness, ReadinessArea, ReadinessState } from '../../services/customerReadinessService';

const cr = (over: Partial<CompanyReadiness> = {}): CompanyReadiness => ({
  company_id: 'co_1', company_name: 'Acme', plan: 'Pro', user_count: 3, active_user_count_30d: 2,
  created_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-06-20T00:00:00Z', tenant_status: 'ACTIVE',
  company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'READY', gsc_ready: 'READY',
  social_ready: 'READY', community_ready: 'UNKNOWN', team_ready: 'READY', billing_ready: 'READY',
  overall_readiness_score: 100, readiness_bucket: 'READY', missing_areas: [],
  ...over,
});

// In-memory writer enforcing the DB's (company_id, snapshot_date) uniqueness.
function memStore() {
  const rows: SnapshotRow[] = [];
  const writer: SnapshotWriter = {
    upsertDaily: async (incoming) => {
      let inserted = 0;
      for (const r of incoming) {
        if (!rows.some((x) => x.company_id === r.company_id && x.snapshot_date === r.snapshot_date)) { rows.push(r); inserted += 1; }
      }
      return inserted;
    },
  };
  return { rows, writer };
}

// Mirror of loadReadinessHistory's column→areas mapping (kept in sync with the schema).
const rowToSnapshot = (r: SnapshotRow): ReadinessSnapshot => ({
  company_id: r.company_id, taken_at: r.taken_at,
  overall_readiness_score: r.overall_readiness_score, readiness_bucket: r.readiness_bucket as any,
  tenant_status: r.tenant_status as any, opportunity_count: r.opportunity_count, priority_tier: r.priority_tier as any,
  areas: {
    COMPANY_PROFILE: r.company_profile_ready as ReadinessState, WEBSITE: r.website_ready as ReadinessState,
    GOOGLE_ANALYTICS: r.ga_ready as ReadinessState, GOOGLE_SEARCH_CONSOLE: r.gsc_ready as ReadinessState,
    SOCIAL_INTEGRATIONS: r.social_ready as ReadinessState, COMMUNITY: r.community_ready as ReadinessState,
    TEAM_MEMBERS: r.team_ready as ReadinessState, BILLING: r.billing_ready as ReadinessState,
  } as Record<ReadinessArea, ReadinessState>,
});

describe('snapshot creation', () => {
  it('buildSnapshotRow maps readiness + derives priority/opportunity', () => {
    const row = buildSnapshotRow(cr({ website_ready: 'NOT_READY', readiness_bucket: 'AT_RISK', overall_readiness_score: 30 }), '2026-06-23T08:00:00Z');
    expect(row.company_id).toBe('co_1');
    expect(row.snapshot_date).toBe('2026-06-23');
    expect(row.website_ready).toBe('NOT_READY');
    expect(row.overall_readiness_score).toBe(30);
    expect(row.opportunity_count).toBeGreaterThan(0); // derived
    expect(row.priority_tier).toBeTruthy();           // derived
    expect(row.snapshot_version).toBe(SNAPSHOT_VERSION);
  });

  it('generates one row per company', async () => {
    const { rows, writer } = memStore();
    const res = await generateReadinessSnapshots([cr({ company_id: 'a' }), cr({ company_id: 'b' })], '2026-06-23T08:00:00Z', { writer });
    expect(res).toMatchObject({ total: 2, inserted: 2, skipped: 0 });
    expect(rows).toHaveLength(2);
  });
});

describe('idempotency + reruns', () => {
  it('a same-day rerun inserts 0 (one snapshot per company per day)', async () => {
    const { rows, writer } = memStore();
    const companies = [cr({ company_id: 'a' }), cr({ company_id: 'b' })];
    const first = await generateReadinessSnapshots(companies, '2026-06-23T08:00:00Z', { writer });
    const second = await generateReadinessSnapshots(companies, '2026-06-23T20:00:00Z', { writer }); // later same UTC day
    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(rows).toHaveLength(2); // no duplicates
  });

  it('a new day inserts again', async () => {
    const { rows, writer } = memStore();
    const c = [cr({ company_id: 'a' })];
    await generateReadinessSnapshots(c, '2026-06-23T08:00:00Z', { writer });
    const day2 = await generateReadinessSnapshots(c, '2026-06-24T08:00:00Z', { writer });
    expect(day2.inserted).toBe(1);
    expect(rows).toHaveLength(2);
  });
});

describe('evolution activation from real snapshots', () => {
  it('two days of snapshots → real IMPROVING trajectory', async () => {
    const { rows, writer } = memStore();
    // Day 1: at-risk, unverified website, score 40
    await generateReadinessSnapshots([cr({ website_ready: 'NOT_READY', readiness_bucket: 'AT_RISK', overall_readiness_score: 40 })], '2026-06-23T08:00:00Z', { writer });
    // Day 2: partial, verified website, score 70
    await generateReadinessSnapshots([cr({ website_ready: 'READY', readiness_bucket: 'PARTIAL', overall_readiness_score: 70 })], '2026-06-24T08:00:00Z', { writer });

    const evo = computeCompanyEvolution(rows.map(rowToSnapshot), 'Acme');
    expect(evo.trajectory).toBe('IMPROVING');
    expect(evo.score_delta).toBe(30);
    expect(evo.readiness_movement).toBe('AT_RISK → PARTIAL');
    expect(evo.biggest_improvement?.area).toBe('WEBSITE');
  });

  it('multi-day progression: 3 improving days → IMPROVING; single day → UNKNOWN', async () => {
    const { rows, writer } = memStore();
    await generateReadinessSnapshots([cr({ readiness_bucket: 'AT_RISK', overall_readiness_score: 30 })], '2026-06-22T08:00:00Z', { writer });
    expect(computeCompanyEvolution(rows.map(rowToSnapshot)).trajectory).toBe('UNKNOWN'); // 1 snapshot
    await generateReadinessSnapshots([cr({ readiness_bucket: 'AT_RISK', overall_readiness_score: 50 })], '2026-06-23T08:00:00Z', { writer });
    await generateReadinessSnapshots([cr({ readiness_bucket: 'PARTIAL', overall_readiness_score: 75 })], '2026-06-24T08:00:00Z', { writer });
    const evo = computeCompanyEvolution(rows.map(rowToSnapshot));
    expect(evo.snapshots_available).toBe(3);
    expect(evo.trajectory).toBe('IMPROVING'); // compares latest two (50→75)
    expect(evo.score_delta).toBe(25);
  });
});
