/**
 * CAMPAIGN-IMPL-003 — deterministic lifecycle, trace, metrics, regeneration.
 */
import {
  LIFECYCLE_TRANSITIONS,
  TERMINAL_STATES,
  canTransition,
  isTerminal,
  assertTransition,
  computePlannerMetrics,
  PlannerTrace,
  regenerateBeforeDrop,
  PIPELINE_STAGE_ORDER,
  type ContentLifecycleState,
} from '../../../lib/shared/campaign/campaignLifecycle';
import { buildReconciliation, type DroppedItem } from '../../../lib/shared/campaign/plannerDiagnostics';

const drop = (over: Partial<DroppedItem> = {}): DroppedItem => ({
  content_type: 'poll', platform: 'x', reason: 'platform_blocked', stage: 'structure_generation', ...over,
});

describe('lifecycle state machine is deterministic', () => {
  it('every state has an explicit (possibly empty) transition set', () => {
    const states: ContentLifecycleState[] = [
      'PLANNED', 'VALIDATED', 'ALLOCATED', 'GENERATING', 'GENERATED', 'ADAPTED', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'DROPPED',
    ];
    for (const s of states) expect(Array.isArray(LIFECYCLE_TRANSITIONS[s])).toBe(true);
  });

  it('terminal states allow no outgoing transitions', () => {
    for (const t of TERMINAL_STATES) {
      expect(isTerminal(t)).toBe(true);
      expect(LIFECYCLE_TRANSITIONS[t]).toHaveLength(0);
    }
  });

  it('happy path PLANNED→…→PUBLISHED is fully legal', () => {
    const path: ContentLifecycleState[] = ['PLANNED', 'VALIDATED', 'ALLOCATED', 'GENERATING', 'GENERATED', 'SCHEDULED', 'PUBLISHED'];
    for (let i = 0; i < path.length - 1; i += 1) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('every non-terminal state can reach DROPPED (no silent loss escape hatch)', () => {
    const nonTerminal: ContentLifecycleState[] = ['PLANNED', 'VALIDATED', 'ALLOCATED', 'GENERATING', 'GENERATED', 'ADAPTED', 'SCHEDULED', 'FAILED'];
    for (const s of nonTerminal) expect(canTransition(s, 'DROPPED')).toBe(true);
  });

  it('FAILED can retry back into GENERATING', () => {
    expect(canTransition('FAILED', 'GENERATING')).toBe(true);
  });

  it('rejects illegal jumps and logs them without throwing', () => {
    const logs: unknown[] = [];
    expect(canTransition('PLANNED', 'PUBLISHED')).toBe(false);
    expect(assertTransition('PLANNED', 'PUBLISHED', (m, meta) => logs.push({ m, meta }))).toBe(false);
    expect(logs).toHaveLength(1);
    expect(() => assertTransition('GENERATED', 'PLANNED')).not.toThrow();
  });
});

describe('planner metrics', () => {
  it('computes success %, integrity %, and drop-reason breakdown', () => {
    const recon = buildReconciliation(10, 7, [drop(), drop({ reason: 'duplicate_content' }), drop({ reason: 'platform_blocked' })]);
    const m = computePlannerMetrics(recon, { regenerated: 2, attempts: [2, 3] });
    expect(m.requested).toBe(10);
    expect(m.generated).toBe(7);
    expect(m.dropped).toBe(3);
    expect(m.generation_success_pct).toBe(70);
    expect(m.planner_integrity_pct).toBe(100); // 7 + 3 === 10 → perfect
    expect(m.regenerated).toBe(2);
    expect(m.average_regeneration_attempts).toBe(2.5);
    expect(m.drop_reasons[0]).toEqual({ reason: 'platform_blocked', count: 2 });
  });

  it('integrity degrades when a shortfall is unattributed', () => {
    const recon = buildReconciliation(10, 7, [drop()]); // 7 + 1 = 8, 2 unaccounted
    const m = computePlannerMetrics(recon);
    expect(m.planner_integrity_pct).toBe(80); // 1 - 2/10
    expect(m.average_regeneration_attempts).toBe(0);
  });

  it('is safe on an empty plan', () => {
    const m = computePlannerMetrics(buildReconciliation(0, 0, []));
    expect(m.planner_integrity_pct).toBe(100);
    expect(m.generation_success_pct).toBe(0);
  });
});

describe('PlannerTrace collector — the only way to lose an item is an explicit drop', () => {
  it('records drops, traces, and regeneration stats', () => {
    const t = new PlannerTrace();
    t.drop(drop());
    t.record('w1::poll::linkedin::0', { stage: 'assignment', state: 'ALLOCATED' }, { content_type: 'poll', platform: 'linkedin' });
    t.record('w1::poll::linkedin::0', { stage: 'generation', state: 'GENERATED' });
    t.regenerated(2);
    expect(t.getDrops()).toHaveLength(1);
    const traces = t.getTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].entries).toHaveLength(2);
    expect(traces[0].final).toBe('GENERATED');
    expect(t.getRegeneration()).toEqual({ regenerated: 1, attempts: [2] });
  });

  it('pipeline stage order matches the documented flow', () => {
    expect(PIPELINE_STAGE_ORDER).toEqual(['assignment', 'platform_selection', 'generation', 'adaptation', 'scheduling', 'publishing']);
  });
});

describe('regenerateBeforeDrop — regenerate instead of drop', () => {
  it('accepts the first non-duplicate candidate without regenerating', async () => {
    const seen = new Set<string>();
    const out = await regenerateBeforeDrop(
      async () => 'fresh',
      (c: string) => !seen.has(c),
      2,
    );
    expect(out.result).toBe('fresh');
    expect(out.attempts).toBe(1);
    expect(out.regenerated).toBe(false);
  });

  it('regenerates past duplicates up to the budget, then succeeds', async () => {
    const candidates = ['dup', 'dup', 'unique'];
    const seen = new Set(['dup']);
    let i = 0;
    const out = await regenerateBeforeDrop(
      async () => candidates[i++],
      (c: string) => !seen.has(c),
      2,
    );
    expect(out.result).toBe('unique');
    expect(out.attempts).toBe(3);
    expect(out.regenerated).toBe(true);
  });

  it('gives up (result null) after the budget is exhausted → caller drops', async () => {
    const seen = new Set(['dup']);
    const out = await regenerateBeforeDrop(
      async () => 'dup',
      (c: string) => !seen.has(c),
      2,
    );
    expect(out.result).toBeNull();
    expect(out.attempts).toBe(3); // 1 initial + 2 regen
    expect(out.regenerated).toBe(true);
  });
});
