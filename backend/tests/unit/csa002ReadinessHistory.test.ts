/**
 * CSA-002 — Customer Readiness History activation (G27/G32).
 *
 * Locks: the daily snapshot job reuses the existing readiness + snapshot
 * authorities and is idempotent/retry-safe/deterministic with HARDEN
 * observability; the snapshot authority's per-day idempotency key prevents
 * duplicates; and the Evolution engine becomes operational (real trajectory)
 * once ≥2 snapshots of history exist, while preserving UNKNOWN with <2
 * (backward compatibility). No DB — authorities are injected.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import { runReadinessSnapshotJob } from '../../jobs/readinessSnapshotJob';
import {
  generateReadinessSnapshots,
  buildSnapshotRow,
  type SnapshotRow,
  type SnapshotWriter,
} from '../../services/customerReadinessSnapshotService';
import { computeCompanyEvolution, type ReadinessSnapshot } from '../../services/customerEvolutionService';
import type { CompanyReadiness } from '../../services/customerReadinessService';
import { recordRawCounter } from '../../observability/metrics';

const NOW = '2026-07-14T00:00:00.000Z';

/** A complete, valid CompanyReadiness fixture. */
function company(over: Partial<CompanyReadiness> = {}): CompanyReadiness {
  return {
    company_id: 'c1', company_name: 'Acme', plan: 'free',
    user_count: 3, active_user_count_30d: 2,
    created_at: '2026-06-01T00:00:00Z', last_activity_at: '2026-07-13T00:00:00Z',
    tenant_status: 'ACTIVE',
    company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'NOT_READY',
    gsc_ready: 'NOT_READY', social_ready: 'READY', community_ready: 'UNKNOWN',
    team_ready: 'READY', billing_ready: 'NOT_READY',
    overall_readiness_score: 55, readiness_bucket: 'PARTIAL', missing_areas: [],
    ...over,
  } as CompanyReadiness;
}

/** In-memory SnapshotWriter honoring the (company_id, snapshot_date) idempotency key. */
function makeWriter() {
  const seen = new Set<string>();
  const rows: SnapshotRow[] = [];
  const writer: SnapshotWriter = {
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

describe('CSA-002 §1/§3 — snapshot authority (reused) populates history idempotently', () => {
  test('generates one snapshot per company for the day', async () => {
    const { writer, rows } = makeWriter();
    const res = await generateReadinessSnapshots([company(), company({ company_id: 'c2' })], NOW, { writer });
    expect(res.inserted).toBe(2);
    expect(res.skipped).toBe(0);
    expect(rows.map((r) => r.snapshot_date)).toEqual(['2026-07-14', '2026-07-14']);
  });

  test('§6 same-day rerun inserts 0 (idempotency key = company_id + snapshot_date)', async () => {
    const { writer } = makeWriter();
    await generateReadinessSnapshots([company()], NOW, { writer });
    const rerun = await generateReadinessSnapshots([company()], '2026-07-14T09:30:00Z', { writer });
    expect(rerun.inserted).toBe(0);
    expect(rerun.skipped).toBe(1);
  });

  test('a new day produces a new snapshot', async () => {
    const { writer, rows } = makeWriter();
    await generateReadinessSnapshots([company()], '2026-07-14T00:00:00Z', { writer });
    await generateReadinessSnapshots([company()], '2026-07-15T00:00:00Z', { writer });
    expect(rows.map((r) => r.snapshot_date)).toEqual(['2026-07-14', '2026-07-15']);
  });

  test('buildSnapshotRow is deterministic for the same input', () => {
    const a = buildSnapshotRow(company(), NOW);
    const b = buildSnapshotRow(company(), NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.snapshot_date).toBe('2026-07-14');
  });
});

describe('CSA-002 §2/§6/§7 — the daily job (reuses authorities, idempotent, observable)', () => {
  const tenants = [{ company_id: 'c1' }, { company_id: 'c2' }] as CompanyReadiness[];

  /** Stateful fake generate honoring per-day idempotency (bypasses DB). */
  function makeGenerate() {
    const seen = new Set<string>();
    const generate = async (list: CompanyReadiness[], takenAt: string) => {
      const day = takenAt.slice(0, 10);
      let inserted = 0;
      for (const t of list) { const k = `${t.company_id}|${day}`; if (!seen.has(k)) { seen.add(k); inserted++; } }
      return { total: list.length, inserted, skipped: list.length - inserted, taken_at: takenAt };
    };
    return { generate };
  }

  test('generates snapshots for every tenant and emits observability', async () => {
    (recordRawCounter as jest.Mock).mockClear();
    const { generate } = makeGenerate();
    const res = await runReadinessSnapshotJob({ getReadiness: async () => ({ tenants }), generate, now: NOW });
    expect(res.ok).toBe(true);
    expect(res.total).toBe(2);
    expect(res.inserted).toBe(2);
    const names = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toContain('csa.readiness_snapshot.generated');
  });

  test('§6 rerun/retry the same day inserts 0 and counts duplicates', async () => {
    (recordRawCounter as jest.Mock).mockClear();
    const { generate } = makeGenerate();
    const deps = { getReadiness: async () => ({ tenants }), generate, now: NOW };
    await runReadinessSnapshotJob(deps);
    const second = await runReadinessSnapshotJob(deps);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
    const names = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toContain('csa.readiness_snapshot.duplicates');
  });

  test('fail-safe: a readiness-enumeration failure returns ok:false + a failure metric (never throws)', async () => {
    (recordRawCounter as jest.Mock).mockClear();
    const res = await runReadinessSnapshotJob({
      getReadiness: async () => { throw new Error('db down'); },
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(0);
    expect((recordRawCounter as jest.Mock).mock.calls.map((c) => c[0])).toContain('csa.readiness_snapshot.failures');
  });

  test('is deterministic — same inputs yield the same result', async () => {
    const g = makeGenerate();
    const a = await runReadinessSnapshotJob({ getReadiness: async () => ({ tenants }), generate: g.generate, now: NOW });
    const g2 = makeGenerate();
    const b = await runReadinessSnapshotJob({ getReadiness: async () => ({ tenants }), generate: g2.generate, now: NOW });
    expect(a).toEqual(b);
  });
});

describe('CSA-002 §4 — Evolution becomes operational once history exists (G32)', () => {
  const snap = (over: Partial<ReadinessSnapshot>): ReadinessSnapshot => ({
    company_id: 'c1', taken_at: '2026-07-13T00:00:00Z',
    overall_readiness_score: 40, readiness_bucket: 'AT_RISK', tenant_status: 'ACTIVE',
    opportunity_count: 5, priority_tier: 'P2',
    areas: {
      COMPANY_PROFILE: 'READY', WEBSITE: 'NOT_READY', GOOGLE_ANALYTICS: 'NOT_READY',
      GOOGLE_SEARCH_CONSOLE: 'NOT_READY', SOCIAL_INTEGRATIONS: 'NOT_READY',
      COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: 'READY', BILLING: 'NOT_READY',
    },
    ...over,
  });

  test('with a single snapshot → UNKNOWN (backward compatible, no guessing)', () => {
    const e = computeCompanyEvolution([snap({})]);
    expect(e.trajectory).toBe('UNKNOWN');
    expect(e.snapshots_available).toBe(1);
  });

  test('with ≥2 snapshots showing improvement → IMPROVING with real deltas', () => {
    const e = computeCompanyEvolution([
      snap({ taken_at: '2026-07-13T00:00:00Z', overall_readiness_score: 40, readiness_bucket: 'AT_RISK' }),
      snap({
        taken_at: '2026-07-14T00:00:00Z', overall_readiness_score: 70, readiness_bucket: 'PARTIAL',
        areas: { COMPANY_PROFILE: 'READY', WEBSITE: 'READY', GOOGLE_ANALYTICS: 'READY', GOOGLE_SEARCH_CONSOLE: 'NOT_READY', SOCIAL_INTEGRATIONS: 'NOT_READY', COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: 'READY', BILLING: 'NOT_READY' },
      }),
    ]);
    expect(e.trajectory).toBe('IMPROVING');
    expect(e.score_delta).toBe(30);
    expect(e.readiness_movement).toBe('AT_RISK → PARTIAL');
    expect(e.snapshots_available).toBe(2);
  });

  test('a decline is detected as DECLINING', () => {
    const e = computeCompanyEvolution([
      snap({ taken_at: '2026-07-13T00:00:00Z', overall_readiness_score: 70, readiness_bucket: 'PARTIAL' }),
      snap({ taken_at: '2026-07-14T00:00:00Z', overall_readiness_score: 40, readiness_bucket: 'AT_RISK' }),
    ]);
    expect(e.trajectory).toBe('DECLINING');
    expect(e.score_delta).toBe(-30);
  });
});
