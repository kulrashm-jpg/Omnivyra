/**
 * CSA-004 — the canonical Customer Lifecycle Engine.
 *
 * Locks the ONE lifecycle authority: deterministic stage classification and
 * deterministic transitions from the existing signals (Platform Ready, CSA-003
 * health, CSA-002 evolution, CSA-001 usage, activity), deterministic
 * explanation, idempotent daily lifecycle snapshots, and fail-safe/backward-
 * compatible behavior. No DB — authorities are injected.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import {
  computeCustomerLifecycle,
  type LifecycleInputs,
  type LifecycleStage,
} from '../../../lib/lifecycle/customerLifecycle';
import {
  generateLifecycleSnapshots,
  buildLifecycleSnapshotRow,
  type LifecycleWriter,
  type LifecycleSnapshotRow,
} from '../../services/lifecycle/customerLifecycleService';
import { runLifecycleSnapshotJob, type LifecycleBuild } from '../../jobs/lifecycleSnapshotJob';

const NOW = '2026-07-14T00:00:00.000Z';
const YESTERDAY = '2026-07-13T00:00:00.000Z';

function inputs(over: Partial<LifecycleInputs> = {}): LifecycleInputs {
  return {
    companyId: 'c1', now: NOW, platformReady: true,
    healthScore: 90, healthState: 'EXCELLENT', trajectory: 'STABLE', scoreDelta: 0,
    integrationCoverage: 100, inactiveDays: 1, usageActiveDays: 12, activeUsers: 3,
    previousStage: null, previousStageSince: null,
    ...over,
  };
}

describe('CSA-004 §3 — deterministic stage classification', () => {
  test('not Platform Ready → Onboarding', () => {
    expect(computeCustomerLifecycle(inputs({ platformReady: false })).stage).toBe('ONBOARDING');
  });
  test('INACTIVE health → Dormant (overrides score)', () => {
    expect(computeCustomerLifecycle(inputs({ healthState: 'INACTIVE' })).stage).toBe('DORMANT');
  });
  test('DECLINING trajectory → Declining', () => {
    expect(computeCustomerLifecycle(inputs({ trajectory: 'DECLINING', healthScore: 65 })).stage).toBe('DECLINING');
  });
  test('high health → Mature', () => {
    expect(computeCustomerLifecycle(inputs({ healthScore: 90 })).stage).toBe('MATURE');
  });
  test('healthy → Growing', () => {
    expect(computeCustomerLifecycle(inputs({ healthScore: 72, trajectory: 'STABLE' })).stage).toBe('GROWING');
  });
  test('stable-improving mid health → Growing', () => {
    expect(computeCustomerLifecycle(inputs({ healthScore: 58, trajectory: 'IMPROVING' })).stage).toBe('GROWING');
  });
  test('mid health → Adopting', () => {
    expect(computeCustomerLifecycle(inputs({ healthScore: 52, trajectory: 'STABLE' })).stage).toBe('ADOPTING');
  });
  test('ready but low adoption → Activated', () => {
    expect(computeCustomerLifecycle(inputs({ healthScore: 42, trajectory: 'STABLE' })).stage).toBe('ACTIVATED');
  });
  test('is deterministic', () => {
    expect(JSON.stringify(computeCustomerLifecycle(inputs()))).toBe(JSON.stringify(computeCustomerLifecycle(inputs())));
  });
});

describe('CSA-004 §4 — deterministic transitions', () => {
  test('first evaluation → INITIAL, changed=false, stageSince=now', () => {
    const l = computeCustomerLifecycle(inputs({ previousStage: null }));
    expect(l.transition.direction).toBe('INITIAL');
    expect(l.transition.changed).toBe(false);
    expect(l.stageSince).toBe(NOW);
  });

  test('advancing the ladder → PROMOTION with a reason and now timestamp', () => {
    const l = computeCustomerLifecycle(inputs({ healthScore: 90, previousStage: 'ADOPTING', previousStageSince: YESTERDAY }));
    expect(l.stage).toBe('MATURE');
    expect(l.transition.changed).toBe(true);
    expect(l.transition.direction).toBe('PROMOTION');
    expect(l.transition.from).toBe('ADOPTING');
    expect(l.transition.at).toBe(NOW);
    expect(l.transition.reason).toMatch(/mature/i);
  });

  test('falling back → REGRESSION', () => {
    const l = computeCustomerLifecycle(inputs({ healthState: 'INACTIVE', previousStage: 'GROWING', previousStageSince: YESTERDAY }));
    expect(l.stage).toBe('DORMANT');
    expect(l.transition.direction).toBe('REGRESSION');
    expect(l.transition.reason).toMatch(/inactive/i);
  });

  test('unchanged stage → NONE, stageSince carried forward (no fabricated transition)', () => {
    const l = computeCustomerLifecycle(inputs({ healthScore: 90, previousStage: 'MATURE', previousStageSince: YESTERDAY }));
    expect(l.transition.changed).toBe(false);
    expect(l.transition.direction).toBe('NONE');
    expect(l.stageSince).toBe(YESTERDAY); // carried, not reset to now
    expect(l.transition.at).toBe(YESTERDAY);
  });
});

describe('CSA-004 §5 — lifecycle explanation', () => {
  test('explains why, signals, blocking factors, and next milestone', () => {
    const l = computeCustomerLifecycle(inputs({ platformReady: false, healthScore: 30, healthState: 'AT_RISK', integrationCoverage: 0, usageActiveDays: 0 }));
    expect(l.explanation.why.length).toBeGreaterThan(0);
    expect(l.explanation.blockingFactors).toContain('Mandatory setup incomplete');
    expect(l.explanation.nextMilestone).toBe('Activated');
    expect(l.explanation.recommendedProgression.length).toBeGreaterThan(0);
  });
});

describe('CSA-004 §6/§7 — idempotent daily lifecycle snapshots', () => {
  function makeWriter() {
    const seen = new Set<string>();
    const rows: LifecycleSnapshotRow[] = [];
    const writer: LifecycleWriter = {
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
  const health = new Map([['c1', { score: 90, state: 'EXCELLENT' }], ['c2', { score: 40, state: 'AT_RISK' }]]);

  test('writes one snapshot per company; same-day rerun inserts 0', async () => {
    const { writer, rows } = makeWriter();
    const lifecycles = [computeCustomerLifecycle(inputs()), computeCustomerLifecycle(inputs({ companyId: 'c2', healthScore: 40 }))];
    const first = await generateLifecycleSnapshots(lifecycles, health, NOW, { writer });
    expect(first.inserted).toBe(2);
    const rerun = await generateLifecycleSnapshots(lifecycles, health, '2026-07-14T09:00:00Z', { writer });
    expect(rerun.inserted).toBe(0);
    expect(rerun.skipped).toBe(2);
    expect(rows).toHaveLength(2);
  });

  test('snapshot row carries stage/transition/health deterministically', () => {
    const row = buildLifecycleSnapshotRow(
      computeCustomerLifecycle(inputs({ previousStage: 'ADOPTING', previousStageSince: YESTERDAY })),
      { score: 90, state: 'EXCELLENT' }, NOW,
    );
    expect(row.snapshot_date).toBe('2026-07-14');
    expect(row.lifecycle_stage).toBe('MATURE');
    expect(row.previous_stage).toBe('ADOPTING');
    expect(row.transition_changed).toBe(true);
    expect(row.health_score).toBe(90);
  });
});

describe('CSA-004 §8/§9 — the daily job (observable, fail-safe, backward compatible)', () => {
  const build = async (): Promise<LifecycleBuild> => ({
    lifecycles: [
      computeCustomerLifecycle(inputs()),
      computeCustomerLifecycle(inputs({ companyId: 'c2', platformReady: false, healthScore: 20, healthState: 'AT_RISK', previousStage: 'ACTIVATED', previousStageSince: YESTERDAY })),
    ],
    health: new Map([['c1', { score: 90, state: 'EXCELLENT' }], ['c2', { score: 20, state: 'AT_RISK' }]]),
  });

  test('generates snapshots + records stage/transition distributions; idempotent rerun', async () => {
    const seen = new Set<string>();
    const generate = async (ls: ReturnType<typeof computeCustomerLifecycle>[], _h: unknown, takenAt: string) => {
      const day = takenAt.slice(0, 10); let inserted = 0;
      for (const l of ls) { const k = `${l.companyId}|${day}`; if (!seen.has(k)) { seen.add(k); inserted++; } }
      return { total: ls.length, inserted, skipped: ls.length - inserted, taken_at: takenAt };
    };
    const first = await runLifecycleSnapshotJob({ build, generate, now: NOW });
    expect(first.ok).toBe(true);
    expect(first.inserted).toBe(2);
    expect(Object.keys(first.stageDistribution).length).toBeGreaterThan(0);
    expect(Object.keys(first.transitionCounts).length).toBeGreaterThan(0); // c2 regressed to ONBOARDING

    const second = await runLifecycleSnapshotJob({ build, generate, now: NOW });
    expect(second.inserted).toBe(0);
  });

  test('fail-safe: a build failure returns ok:false and never throws', async () => {
    const res = await runLifecycleSnapshotJob({ build: async () => { throw new Error('down'); }, now: NOW });
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(0);
  });
});
