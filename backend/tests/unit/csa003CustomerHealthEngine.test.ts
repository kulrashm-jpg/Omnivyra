/**
 * CSA-003 — the canonical Customer Health Engine.
 *
 * Locks the ONE health authority: deterministic health scoring + states + risk
 * from the existing signals (readiness, integration coverage, activity,
 * evolution, Platform Ready), deterministic explanation, idempotent daily health
 * snapshots, and backward-compatible/fail-safe behavior. No DB — authorities are
 * injected.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import {
  computeCustomerHealth,
  type HealthInputs,
  type ReadinessAreaState,
  type HealthArea,
} from '../../../lib/health/customerHealth';
import {
  generateHealthSnapshots,
  buildHealthSnapshotRow,
  gatherHealthInputs,
  type HealthResult,
  type HealthWriter,
  type HealthSnapshotRow,
} from '../../services/health/customerHealthService';
import { runHealthSnapshotJob } from '../../jobs/healthSnapshotJob';
import type { CompanyReadiness } from '../../services/customerReadinessService';

const NOW = '2026-07-14T00:00:00.000Z';

const allAreas = (s: ReadinessAreaState): Record<HealthArea, ReadinessAreaState> => ({
  COMPANY_PROFILE: s, WEBSITE: s, GOOGLE_ANALYTICS: s, GOOGLE_SEARCH_CONSOLE: s, SOCIAL_INTEGRATIONS: s,
});

function inputs(over: Partial<HealthInputs> = {}): HealthInputs {
  return {
    companyId: 'c1', now: NOW, platformReady: true,
    readinessScore: 90, readinessBucket: 'READY', tenantStatus: 'ACTIVE',
    lastActivityAt: '2026-07-13T00:00:00Z', areas: allAreas('READY'),
    trajectory: 'STABLE', scoreDelta: 0,
    usage: { totalEvents: 40, activeUsers: 3, activeDays: 12, capabilitiesUsed: ['publishing', 'campaign'] },
    ...over,
  };
}

describe('CSA-003 §2/§3 — deterministic health scoring + states', () => {
  test('a fully-ready, active, platform-ready company is EXCELLENT', () => {
    const h = computeCustomerHealth(inputs());
    expect(h.state).toBe('EXCELLENT');
    expect(h.score).toBeGreaterThanOrEqual(85);
  });

  test('low readiness + no integrations + stale activity → AT_RISK', () => {
    const h = computeCustomerHealth(inputs({
      platformReady: false, readinessScore: 20, readinessBucket: 'AT_RISK',
      areas: allAreas('NOT_READY'), lastActivityAt: '2026-07-01T00:00:00Z',
      usage: { totalEvents: 0, activeUsers: 0, activeDays: 0, capabilitiesUsed: [] },
    }));
    expect(h.state).toBe('AT_RISK');
    expect(h.score).toBeLessThan(40);
  });

  test('a company with no activity for 30+ days is INACTIVE regardless of score', () => {
    const h = computeCustomerHealth(inputs({ lastActivityAt: '2026-05-01T00:00:00Z' }));
    expect(h.state).toBe('INACTIVE');
  });

  test('tenant_status INACTIVE forces INACTIVE state', () => {
    const h = computeCustomerHealth(inputs({ tenantStatus: 'INACTIVE' }));
    expect(h.state).toBe('INACTIVE');
  });

  test('IMPROVING trajectory lifts, DECLINING lowers the score', () => {
    const base = computeCustomerHealth(inputs({ trajectory: 'STABLE' })).score;
    const up = computeCustomerHealth(inputs({ trajectory: 'IMPROVING' })).score;
    const down = computeCustomerHealth(inputs({ trajectory: 'DECLINING' })).score;
    expect(up).toBeGreaterThan(base);
    expect(down).toBeLessThan(base);
  });

  test('is deterministic — same inputs yield an identical result', () => {
    expect(JSON.stringify(computeCustomerHealth(inputs()))).toBe(JSON.stringify(computeCustomerHealth(inputs())));
  });
});

describe('CSA-003 §4 — risk classification (never duplicates readiness)', () => {
  test('healthy → NONE/LOW risk with no missing prerequisites', () => {
    const h = computeCustomerHealth(inputs());
    expect(['NONE', 'LOW']).toContain(h.risk.level);
    expect(h.risk.missingPrerequisites).toEqual([]);
  });

  test('at-risk → HIGH+, lists missing prerequisites, adoption gaps, and reasons', () => {
    const h = computeCustomerHealth(inputs({
      platformReady: false, readinessScore: 25, readinessBucket: 'AT_RISK',
      areas: { ...allAreas('READY'), WEBSITE: 'NOT_READY', GOOGLE_ANALYTICS: 'NOT_READY' },
      trajectory: 'DECLINING', scoreDelta: -10,
      lastActivityAt: '2026-07-10T00:00:00Z',
    }));
    expect(['HIGH', 'CRITICAL']).toContain(h.risk.level);
    expect(h.risk.missingPrerequisites).toEqual(expect.arrayContaining(['Website / CMS', 'Google Analytics']));
    expect(h.risk.adoptionGaps.length).toBeGreaterThan(0);
    expect(h.risk.reasons.length).toBeGreaterThan(0);
  });

  test('INACTIVE → CRITICAL risk with inactive duration', () => {
    const h = computeCustomerHealth(inputs({ lastActivityAt: '2026-05-01T00:00:00Z' }));
    expect(h.risk.level).toBe('CRITICAL');
    expect(h.risk.inactiveDays).toBeGreaterThanOrEqual(30);
  });
});

describe('CSA-003 §5 — health explanation', () => {
  test('explains why, contributors, and recommended improvements', () => {
    const h = computeCustomerHealth(inputs({
      readinessScore: 45, areas: { ...allAreas('READY'), GOOGLE_SEARCH_CONSOLE: 'NOT_READY' },
    }));
    expect(h.explanation.why.length).toBeGreaterThan(0);
    expect(h.explanation.majorContributors.length + h.explanation.negativeContributors.length).toBeGreaterThan(0);
    expect(h.explanation.recommendedImprovements).toEqual(expect.arrayContaining(['Complete Google Search Console.']));
  });
});

describe('CSA-003 §1 — gatherHealthInputs maps existing authorities (Platform Ready from readiness)', () => {
  const company = (over: Partial<CompanyReadiness> = {}): CompanyReadiness => ({
    company_id: 'c1', company_name: 'Acme', plan: 'free', user_count: 2, active_user_count_30d: 2,
    created_at: null, last_activity_at: '2026-07-13T00:00:00Z', tenant_status: 'ACTIVE',
    company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'NOT_READY', gsc_ready: 'NOT_READY',
    social_ready: 'READY', community_ready: 'UNKNOWN', team_ready: 'READY', billing_ready: 'NOT_READY',
    overall_readiness_score: 80, readiness_bucket: 'READY', missing_areas: [],
    ...over,
  } as CompanyReadiness);

  test('platformReady is derived from readiness_bucket READY, areas mapped from readiness', () => {
    const i = gatherHealthInputs(company(), { trajectory: 'IMPROVING', score_delta: 5 },
      { totalEvents: 1, activeUsers: 1, activeDays: 1, capabilitiesUsed: [] }, NOW);
    expect(i.platformReady).toBe(true);
    expect(i.areas.GOOGLE_ANALYTICS).toBe('NOT_READY');
    expect(i.readinessScore).toBe(80);
    expect(i.trajectory).toBe('IMPROVING');

    const partial = gatherHealthInputs(company({ readiness_bucket: 'PARTIAL' }), { trajectory: 'STABLE', score_delta: 0 },
      { totalEvents: 0, activeUsers: 0, activeDays: 0, capabilitiesUsed: [] }, NOW);
    expect(partial.platformReady).toBe(false);
  });
});

describe('CSA-003 §6/§7 — idempotent daily health snapshots', () => {
  function makeWriter() {
    const seen = new Set<string>();
    const rows: HealthSnapshotRow[] = [];
    const writer: HealthWriter = {
      upsertDaily: async (batch) => {
        let inserted = 0;
        for (const r of batch) {
          const key = `${r.company_id}|${r.snapshot_date}`;
          if (seen.has(key)) continue;
          seen.add(key); rows.push(r); inserted++;
        }
        return inserted;
      },
    };
    return { writer, rows };
  }

  const result = (over: Partial<HealthInputs> = {}): HealthResult => {
    const i = inputs(over);
    return { inputs: i, health: computeCustomerHealth(i) };
  };

  test('writes one snapshot per company; a same-day rerun inserts 0', async () => {
    const { writer, rows } = makeWriter();
    const results = [result(), result({ companyId: 'c2' })];
    const first = await generateHealthSnapshots(results, NOW, { writer });
    expect(first.inserted).toBe(2);
    const rerun = await generateHealthSnapshots(results, '2026-07-14T10:00:00Z', { writer });
    expect(rerun.inserted).toBe(0);
    expect(rerun.skipped).toBe(2);
    expect(rows).toHaveLength(2);
  });

  test('the snapshot row carries score/state/risk deterministically', () => {
    const row = buildHealthSnapshotRow(result(), NOW);
    expect(row.snapshot_date).toBe('2026-07-14');
    expect(row.health_state).toBe('EXCELLENT');
    expect(row.risk_level).toBeDefined();
    expect(row.readiness_score).toBe(90);
  });
});

describe('CSA-003 §8/§9 — the daily job (observable, fail-safe, backward compatible)', () => {
  test('generates snapshots + records distribution; idempotent rerun', async () => {
    const results: HealthResult[] = [
      { inputs: inputs(), health: computeCustomerHealth(inputs()) },
      { inputs: inputs({ companyId: 'c2', readinessScore: 20, areas: allAreas('NOT_READY'), platformReady: false, readinessBucket: 'AT_RISK' }),
        health: computeCustomerHealth(inputs({ companyId: 'c2', readinessScore: 20, areas: allAreas('NOT_READY'), platformReady: false, readinessBucket: 'AT_RISK' })) },
    ];
    const seen = new Set<string>();
    const generate = async (rs: HealthResult[], takenAt: string) => {
      const day = takenAt.slice(0, 10); let inserted = 0;
      for (const r of rs) { const k = `${r.health.companyId}|${day}`; if (!seen.has(k)) { seen.add(k); inserted++; } }
      return { total: rs.length, inserted, skipped: rs.length - inserted, taken_at: takenAt };
    };
    const first = await runHealthSnapshotJob({ build: async () => results, generate, now: NOW });
    expect(first.ok).toBe(true);
    expect(first.inserted).toBe(2);
    expect(Object.keys(first.stateDistribution).length).toBeGreaterThan(0);

    const second = await runHealthSnapshotJob({ build: async () => results, generate, now: NOW });
    expect(second.inserted).toBe(0);
  });

  test('fail-safe: a gather failure returns ok:false and never throws', async () => {
    const res = await runHealthSnapshotJob({ build: async () => { throw new Error('down'); }, now: NOW });
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(0);
  });
});
