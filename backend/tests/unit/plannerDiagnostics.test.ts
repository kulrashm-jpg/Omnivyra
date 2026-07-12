/**
 * CAMPAIGN-IMPL-002 — planner integrity invariant.
 * planned === generated + dropped.length must hold; drops carry structured reasons.
 */
import {
  buildReconciliation,
  assertPlannerInvariant,
  summarizeDrops,
  dropReasonMessage,
  publicDropReason,
  formatDiagnosticsSummary,
  type DroppedItem,
} from '../../../lib/shared/campaign/plannerDiagnostics';

const drop = (over: Partial<DroppedItem> = {}): DroppedItem => ({
  content_type: 'poll', platform: 'x', reason: 'platform_blocked', stage: 'structure_generation', ...over,
});

describe('planner invariant — planned = generated + dropped', () => {
  it('holds when counts reconcile', () => {
    const r = buildReconciliation(10, 7, [drop(), drop({ content_type: 'article', reason: 'duplicate_content' }), drop({ content_type: 'poll' })]);
    expect(r.ok).toBe(true);
    expect(r.planned).toBe(10);
    expect(r.generated).toBe(7);
    expect(r.dropped).toHaveLength(3);
  });

  it('flags a mismatch (silent loss) and logs it', () => {
    const logs: Array<{ msg: string; meta: Record<string, unknown> }> = [];
    const r = buildReconciliation(10, 7, [drop()]); // 7 + 1 = 8 ≠ 10 → silent loss of 2
    expect(r.ok).toBe(false);
    const held = assertPlannerInvariant(r, (msg, meta) => logs.push({ msg, meta }));
    expect(held).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta.delta).toBe(2);
  });

  it('never throws on mismatch (diagnostics must not break generation)', () => {
    expect(() => assertPlannerInvariant(buildReconciliation(5, 1, []))).not.toThrow();
  });
});

describe('drop reasons + summary', () => {
  it('every reason has a user-facing message', () => {
    expect(dropReasonMessage('platform_blocked')).toMatch(/not allowed/i);
    expect(dropReasonMessage('duplicate_content')).toMatch(/identical/i);
  });

  it('summarizes drops by reason, most-common first', () => {
    const summary = summarizeDrops([
      drop({ reason: 'platform_blocked' }),
      drop({ reason: 'platform_blocked' }),
      drop({ reason: 'duplicate_content' }),
    ]);
    expect(summary[0]).toMatchObject({ reason: 'platform_blocked', count: 2 });
    expect(summary[1]).toMatchObject({ reason: 'duplicate_content', count: 1 });
  });

  it('maps every reason to a public uppercase name', () => {
    expect(publicDropReason('platform_blocked')).toBe('FORMAT_BLOCKED');
    expect(publicDropReason('duplicate_platform_content')).toBe('DUPLICATE_CONTENT');
    expect(publicDropReason('account_unavailable')).toBe('ACCOUNT_NOT_CONNECTED');
    expect(publicDropReason('unknown_error')).toBe('UNKNOWN_ERROR');
  });
});

describe('formatDiagnosticsSummary — never hides the gap', () => {
  it('explains drops with requested/generated/reason', () => {
    const r = buildReconciliation(10, 8, [drop({ reason: 'duplicate_content' }), drop({ reason: 'duplicate_content' })]);
    const s = formatDiagnosticsSummary(r);
    expect(s).toMatch(/Requested 10/);
    expect(s).toMatch(/generated 8/);
    expect(s).toMatch(/2 not scheduled/);
    expect(s).toMatch(/×2/);
  });

  it('confirms a clean run', () => {
    expect(formatDiagnosticsSummary(buildReconciliation(6, 6, []))).toBe('Requested 6, generated 6 — all scheduled.');
  });

  it('is empty when nothing was requested', () => {
    expect(formatDiagnosticsSummary(buildReconciliation(0, 0, []))).toBe('');
  });
});
