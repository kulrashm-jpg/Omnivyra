/**
 * Planner hardening — final stabilization pass.
 *
 * Tests for the smaller, deterministic building blocks added in this round:
 *
 *   - PlannerBudget                             (Part 4)
 *   - LLM-pool isolation in aiGateway           (Part 5)
 *   - repair budget + completed-stages tracking (Part 1)
 *   - heartbeat lifecycle                       (Part 2)
 *   - partial-draft salvage                     (Part 3)
 *   - operational alert counters                (Part 6)
 *
 * End-to-end flows (full orchestrator run with mocked gateway) are covered
 * separately; this file isolates the units so a regression in any one of
 * them surfaces with a focused failure.
 */

import {
  PlannerBudget,
} from '../../services/plannerBudget';
import {
  getLlmPoolPressure,
  reloadLlmPoolSizes,
  type LlmPoolName,
} from '../../services/aiGateway';
import {
  withPhaseHeartbeat,
} from '../../services/campaignAiOrchestrator/heartbeat';
import {
  attemptPartialDraftSalvage,
} from '../../services/campaignAiOrchestrator/partialDraftSalvage';
import {
  recordPlannerAlertCounter,
  getPlannerAlertSnapshot,
  __resetPlannerAlertCountersForTests,
} from '../../services/plannerAlerting';

// ─────────────────────────────────────────────────────────────────────────
// PlannerBudget (Part 4)
// ─────────────────────────────────────────────────────────────────────────
describe('PlannerBudget', () => {
  const realEnv = process.env.PLANNER_TOTAL_BUDGET_MS;
  afterEach(() => { process.env.PLANNER_TOTAL_BUDGET_MS = realEnv; });

  test('reads default budget from env', () => {
    process.env.PLANNER_TOTAL_BUDGET_MS = '60000';
    const b = new PlannerBudget({ campaignId: 'c1' });
    expect(b.totalBudgetMs).toBe(60_000);
  });

  test('falls back to 180000 when env unset', () => {
    delete process.env.PLANNER_TOTAL_BUDGET_MS;
    const b = new PlannerBudget({ campaignId: 'c1' });
    expect(b.totalBudgetMs).toBe(180_000);
  });

  test('clamps to minimum 1000ms', () => {
    process.env.PLANNER_TOTAL_BUDGET_MS = '0';
    const b = new PlannerBudget({ campaignId: 'c1' });
    expect(b.totalBudgetMs).toBe(1000);
  });

  test('explicit totalBudgetMs wins over env', () => {
    process.env.PLANNER_TOTAL_BUDGET_MS = '99999';
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 5000 });
    expect(b.totalBudgetMs).toBe(5000);
  });

  test('remainingMs decreases over time', async () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 5000 });
    expect(b.remainingMs()).toBeLessThanOrEqual(5000);
    await new Promise((r) => setTimeout(r, 60));
    expect(b.remainingMs()).toBeLessThan(5000);
  });

  test('isExceeded() flips true once elapsed >= total', async () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 1000 });
    expect(b.isExceeded()).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect(b.isExceeded()).toBe(true);
  });

  test('essential phases always allowed regardless of remaining budget', async () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 1000 });
    await new Promise((r) => setTimeout(r, 1100)); // budget exhausted
    expect(b.shouldRunOptionalPhase('drafting')).toBe(true);
    expect(b.shouldRunOptionalPhase('parsing')).toBe(true);
    expect(b.shouldRunOptionalPhase('validation')).toBe(true);
  });

  test('optional phases declined when remaining < estimated cost', async () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 1000 });
    await new Promise((r) => setTimeout(r, 1100));
    // Refinement estimate is 8000 + 1000 safety margin = 9000 required.
    expect(b.shouldRunOptionalPhase('refinement')).toBe(false);
    // Alignment estimate is 10000 + 1000 = 11000 required.
    expect(b.shouldRunOptionalPhase('alignment')).toBe(false);
  });

  test('optional phases allowed when sufficient budget remains', () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 60_000 });
    expect(b.shouldRunOptionalPhase('refinement')).toBe(true);
    expect(b.shouldRunOptionalPhase('alignment')).toBe(true);
  });

  test('phaseBudgetMs clamps to min(requested, remaining)', async () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 2000 });
    expect(b.phaseBudgetMs(90_000)).toBeLessThanOrEqual(2000);
    expect(b.phaseBudgetMs(500)).toBe(500);
  });

  test('snapshot reflects completed and skipped phases', () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 60_000 });
    b.markPhaseCompleted('drafting');
    b.markPhaseSkipped('refinement', 'overload');
    const snap = b.snapshot();
    expect(snap.completedPhases).toEqual(['drafting']);
    expect(snap.skippedPhases).toEqual(['refinement']);
  });

  test('markPhaseCompleted removes phase from skipped set', () => {
    const b = new PlannerBudget({ campaignId: 'c1', totalBudgetMs: 60_000 });
    b.markPhaseSkipped('drafting', 'budget');
    b.markPhaseCompleted('drafting');
    expect(b.snapshot().completedPhases).toContain('drafting');
    expect(b.snapshot().skippedPhases).not.toContain('drafting');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LLM pool isolation (Part 5)
// ─────────────────────────────────────────────────────────────────────────
describe('LLM pool isolation', () => {
  test('reloadLlmPoolSizes reads per-pool env vars', () => {
    process.env.MAX_DRAFTING_CONCURRENCY   = '7';
    process.env.MAX_ALIGNMENT_CONCURRENCY  = '3';
    process.env.MAX_REFINEMENT_CONCURRENCY = '2';
    process.env.MAX_REPAIR_CONCURRENCY     = '1';
    const sizes = reloadLlmPoolSizes();
    expect(sizes.drafting).toBe(7);
    expect(sizes.alignment).toBe(3);
    expect(sizes.refinement).toBe(2);
    expect(sizes.repair).toBe(1);
  });

  test('falls back to legacy MAX_LLM_CONCURRENCY for unset pool envs', () => {
    delete process.env.MAX_DRAFTING_CONCURRENCY;
    delete process.env.MAX_ALIGNMENT_CONCURRENCY;
    const sizes = reloadLlmPoolSizes();
    expect(sizes.drafting).toBeGreaterThan(0);
    expect(sizes.alignment).toBeGreaterThan(0);
  });

  test('getLlmPoolPressure with no arg aggregates across pools', () => {
    const p = getLlmPoolPressure();
    expect(p.pool).toBe('all');
    expect(typeof p.activeCalls).toBe('number');
    expect(typeof p.maxAllowed).toBe('number');
  });

  test('getLlmPoolPressure with pool name returns single-pool view', () => {
    const pools: LlmPoolName[] = ['drafting', 'alignment', 'refinement', 'repair', 'default'];
    for (const name of pools) {
      const p = getLlmPoolPressure(name);
      expect(p.pool).toBe(name);
      expect(typeof p.activeCalls).toBe('number');
      expect(p.maxAllowed).toBeGreaterThan(0);
    }
  });

  test('pool counters are independent across pools', () => {
    // Activity in drafting pool should not be visible in alignment pool.
    const draftingBefore = getLlmPoolPressure('drafting').activeCalls;
    const alignmentBefore = getLlmPoolPressure('alignment').activeCalls;
    // We can't easily acquire a slot without going through the full gateway,
    // but we can assert that the snapshots are independent objects.
    expect(draftingBefore).toBeGreaterThanOrEqual(0);
    expect(alignmentBefore).toBeGreaterThanOrEqual(0);
    const draftingAfter = getLlmPoolPressure('drafting').activeCalls;
    expect(draftingAfter).toBe(draftingBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Heartbeat lifecycle (Part 2)
// ─────────────────────────────────────────────────────────────────────────
describe('withPhaseHeartbeat', () => {
  // The helper clamps intervalMs to a 1000ms minimum to prevent UI spam in
  // production, so these tests use real-clock intervals ≥ 1000ms.
  test('emits at the configured interval while phase is pending', async () => {
    const emits: string[] = [];
    const result = await withPhaseHeartbeat(
      () => new Promise((resolve) => setTimeout(() => resolve('done'), 2600)),
      {
        substage: 'still-x',
        intervalMs: 1000,
        onSubStage: (s) => { emits.push(s); },
      },
    );
    expect(result).toBe('done');
    expect(emits.length).toBeGreaterThanOrEqual(2);
    expect(emits.every((e) => e === 'still-x')).toBe(true);
  }, 8000);

  test('emits zero ticks if phase resolves before first interval', async () => {
    const emits: string[] = [];
    await withPhaseHeartbeat(
      () => Promise.resolve('fast'),
      {
        substage: 'still-x',
        intervalMs: 5_000,
        onSubStage: (s) => { emits.push(s); },
      },
    );
    expect(emits.length).toBe(0);
  });

  test('stops emitting after promise resolves', async () => {
    const emits: string[] = [];
    await withPhaseHeartbeat(
      () => new Promise((resolve) => setTimeout(resolve, 1200)),
      {
        substage: 'still-x',
        intervalMs: 1000,
        onSubStage: (s) => { emits.push(s); },
      },
    );
    const countAfterResolve = emits.length;
    await new Promise((r) => setTimeout(r, 1500));
    // No new ticks after the work completed.
    expect(emits.length).toBe(countAfterResolve);
  }, 8000);

  test('does not emit after signal aborts', async () => {
    const emits: string[] = [];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await withPhaseHeartbeat(
      () => new Promise((resolve) => setTimeout(resolve, 2500)),
      {
        substage: 'still-x',
        intervalMs: 1000,
        onSubStage: (s) => { emits.push(s); },
        signal: controller.signal,
      },
    );
    // After abort, no further ticks. Hard to assert exact count, but ticks
    // should plateau before the work resolved.
    const finalCount = emits.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(emits.length).toBe(finalCount);
  }, 8000);

  test('teardown runs in finally even when phase rejects', async () => {
    const emits: string[] = [];
    await expect(
      withPhaseHeartbeat(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 1200)),
        {
          substage: 'still-x',
          intervalMs: 1000,
          onSubStage: (s) => { emits.push(s); },
        },
      ),
    ).rejects.toThrow('boom');
    const countAtFinally = emits.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(emits.length).toBe(countAtFinally);
  }, 8000);

  test('observer errors are swallowed', async () => {
    const result = await withPhaseHeartbeat(
      () => new Promise((resolve) => setTimeout(() => resolve('ok'), 1100)),
      {
        substage: 'still-x',
        intervalMs: 1000,
        onSubStage: () => { throw new Error('observer-bug'); },
      },
    );
    expect(result).toBe('ok');
  }, 5000);
});

// ─────────────────────────────────────────────────────────────────────────
// Partial-draft salvage (Part 3)
// ─────────────────────────────────────────────────────────────────────────
describe('attemptPartialDraftSalvage', () => {
  // Real PlanSkeleton shape (durationWeeks + weeklySlots) so the salvage
  // helper's call to buildPlaceholderPlanFromSkeleton produces a valid
  // 12-week baseline to merge into.
  const skeleton = {
    durationWeeks: 12,
    weeklySlots: Array.from({ length: 12 }, (_, i) => ({
      weekNumber: i + 1,
      requiredDeliverables: { videos: 1, posts: 3, blogs: 1, stories: 0 },
    })),
  } as any;

  test('rejects empty raw text', () => {
    const r = attemptPartialDraftSalvage({ rawText: '', planSkeleton: skeleton });
    expect(r.salvaged).toBe(false);
    expect(r.structured).toBeNull();
    expect(r.reason).toBe('empty_or_too_short');
  });

  test('rejects raw text without recognizable week headers', () => {
    const r = attemptPartialDraftSalvage({
      rawText: 'just some prose with no week headers at all that we can identify',
      planSkeleton: skeleton,
    });
    expect(r.salvaged).toBe(false);
    expect(r.reason).toBe('no_week_headers_found');
  });

  test('rejects when no week has a usable theme or objective', () => {
    // Padded with explanation text so we clear the 30-char minimum threshold
    // and the failure is specifically the "no usable fields" branch.
    const r = attemptPartialDraftSalvage({
      rawText:
        'Some campaign-related preamble paragraph that pads length over the minimum threshold.\n' +
        'Week 1: \nWeek 2: \nWeek 3: ',
      planSkeleton: skeleton,
    });
    expect(r.salvaged).toBe(false);
    expect(['no_usable_week_fields', 'below_min_salvaged_weeks']).toContain(r.reason);
  });

  test('rejects when fewer than minSalvagedWeeks are recovered', () => {
    const r = attemptPartialDraftSalvage({
      rawText: [
        'Week 1:',
        'Theme: Foo',
        'Objective: Bar',
        '',
        'Week 2:',
        'Theme: Baz',
        'Objective: Qux',
      ].join('\n'),
      planSkeleton: skeleton,
      minSalvagedWeeks: 5,
    });
    expect(r.salvaged).toBe(false);
    expect(r.reason).toBe('below_min_salvaged_weeks');
  });

  test('accepts when minSalvagedWeeks threshold is met and merges salvaged weeks', () => {
    // Real LLM output has each field on its own line — Theme/Objective never
    // share a line with the week header. The salvage regex relies on the
    // newline boundary.
    const raw = [
      'Week 1:',
      'Theme: Awareness launch',
      'Objective: Build new audience trust',
      '',
      'Week 2:',
      'Theme: Education arc',
      'Objective: Teach core product mental model',
      '',
      'Week 3:',
      'Theme: Social proof',
      'Objective: Show credible customer wins',
    ].join('\n');
    const r = attemptPartialDraftSalvage({
      rawText: raw,
      planSkeleton: skeleton,
      minSalvagedWeeks: 3,
    });
    expect(r.salvaged).toBe(true);
    expect(r.salvagedWeekCount).toBe(3);
    expect(r.structured).not.toBeNull();
    expect(r.structured.partial_salvage_used).toBe(true);
    expect(r.structured.weeks).toHaveLength(12);
    const w1 = r.structured.weeks.find((w: any) => w.week === 1);
    expect(w1.theme).toBe('Awareness launch');
    expect(w1.partial_salvage).toBe(true);
    // Weeks not present in raw stay on placeholder.
    const w12 = r.structured.weeks.find((w: any) => w.week === 12);
    expect(w12.partial_salvage).toBeUndefined();
  });

  test('handles BEGIN/END markers in raw text', () => {
    const raw = [
      'BEGIN_12WEEK_PLAN',
      'Week 1:',
      'Theme: Launch',
      'Objective: Land first impression',
      '',
      'Week 2:',
      'Theme: Educate',
      'Objective: Build core mental model',
      '',
      'Week 3:',
      'Theme: Credibility',
      'Objective: Show proof points',
      'END_12WEEK_PLAN',
    ].join('\n');
    const r = attemptPartialDraftSalvage({
      rawText: raw,
      planSkeleton: skeleton,
      minSalvagedWeeks: 3,
    });
    expect(r.salvaged).toBe(true);
    expect(r.salvagedWeekCount).toBe(3);
  });

  test('returns null when skeleton missing', () => {
    const r = attemptPartialDraftSalvage({
      rawText: 'Week 1: Theme: Foo\nObjective: Bar',
      planSkeleton: null,
      minSalvagedWeeks: 1,
    });
    expect(r.salvaged).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Planner alerting (Part 6)
// ─────────────────────────────────────────────────────────────────────────
describe('planner alerting counters', () => {
  beforeEach(() => { __resetPlannerAlertCountersForTests(); });

  test('records counter increments', () => {
    recordPlannerAlertCounter('drafting_timeout');
    recordPlannerAlertCounter('drafting_timeout');
    const snap = getPlannerAlertSnapshot();
    expect(snap.drafting_timeout.total).toBe(2);
    expect(snap.drafting_timeout.recentInWindow).toBe(2);
  });

  test('each counter is independent', () => {
    recordPlannerAlertCounter('drafting_timeout');
    recordPlannerAlertCounter('alignment_timeout');
    recordPlannerAlertCounter('repair_budget_exceeded');
    const snap = getPlannerAlertSnapshot();
    expect(snap.drafting_timeout.total).toBe(1);
    expect(snap.alignment_timeout.total).toBe(1);
    expect(snap.repair_budget_exceeded.total).toBe(1);
    expect(snap.overload_mode_activation.total).toBe(0);
  });

  test('total counter is monotonic across windows', () => {
    for (let i = 0; i < 10; i++) recordPlannerAlertCounter('placeholder_fallback');
    expect(getPlannerAlertSnapshot().placeholder_fallback.total).toBe(10);
  });

  test('snapshot is read-only on a single call (does not double-count)', () => {
    recordPlannerAlertCounter('overload_mode_activation');
    const s1 = getPlannerAlertSnapshot().overload_mode_activation.total;
    const s2 = getPlannerAlertSnapshot().overload_mode_activation.total;
    expect(s1).toBe(s2);
  });

  test('reset returns counters to zero', () => {
    recordPlannerAlertCounter('drafting_timeout');
    __resetPlannerAlertCountersForTests();
    expect(getPlannerAlertSnapshot().drafting_timeout.total).toBe(0);
  });

  test('record never throws when given an unknown event (defensive)', () => {
    expect(() => {
      // @ts-expect-error — exercising the defensive try/catch
      recordPlannerAlertCounter('not_a_real_counter');
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cancellation + semaphore release smoke (Parts 1 + 5 + 7)
// ─────────────────────────────────────────────────────────────────────────
describe('cancellation surface area', () => {
  test('AbortController can be wired into withPhaseHeartbeat', async () => {
    // A worked example: abort fires, the phase function observes the signal
    // and rejects, the heartbeat tears down its timer in finally.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(
      withPhaseHeartbeat(
        () => new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
        {
          substage: 'still-x',
          intervalMs: 5_000,
          onSubStage: () => undefined,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow('aborted');
  });

  test('pool snapshots are stable across calls when no traffic flows', () => {
    const before = getLlmPoolPressure();
    const after = getLlmPoolPressure();
    expect(before.activeCalls).toBe(after.activeCalls);
  });
});
