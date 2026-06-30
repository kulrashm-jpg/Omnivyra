/**
 * Phase 33 — request-scoped memoization. Proves: duplicate compose calls share one Promise
 * (one composition, one provide() per plugin per request); different contexts/keys never
 * share (parallel requests isolated, freshness preserved); memoized === non-memoized output.
 */
import { composePluginSnapshot, composePluginSnapshotMemoized, createCompositionContext, type IntelligencePlugin } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const makePlugin = (id: string, spy: jest.Mock): IntelligencePlugin => ({
  id, displayName: id, domain: id, entityLabel: id, supportedReports: ['snapshot'], supportedDashboards: [],
  impactConfig: { graph: {}, moduleDimensions: { m: { revenue: 50 } }, dimensionTail: { revenue: 'revenue' } },
  provide: spy as any,
});
const data = { modules: [{ key: 'm', label: 'M', source: 'x', score: 50, status: 'partial' as const, available: true, findings: [], lastUpdated: '2026-06-01T00:00:00Z' }], recommendationInputs: [], score: 50, lastUpdated: '2026-06-01T00:00:00Z' };

describe('Phase 33 — registry memoization', () => {
  it('same (plugin, company, nowMs) within one ctx → one Promise, one provide() call', async () => {
    const spy = jest.fn(async () => data); const p = makePlugin('memoA', spy);
    const ctx = createCompositionContext();
    const a = composePluginSnapshotMemoized(p, 'co1', NOW, ctx);
    const b = composePluginSnapshotMemoized(p, 'co1', NOW, ctx);
    expect(a).toBe(b); // identical Promise stored synchronously (dedupes concurrent calls)
    await Promise.all([a, b]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('different contexts do NOT share (parallel requests isolated)', async () => {
    const spy = jest.fn(async () => data); const p = makePlugin('memoB', spy);
    await composePluginSnapshotMemoized(p, 'co1', NOW, createCompositionContext());
    await composePluginSnapshotMemoized(p, 'co1', NOW, createCompositionContext());
    expect(spy).toHaveBeenCalledTimes(2); // new request → new cache
  });

  it('distinct company or nowMs are distinct keys (freshness preserved)', async () => {
    const spy = jest.fn(async () => data); const p = makePlugin('memoC', spy);
    const ctx = createCompositionContext();
    await composePluginSnapshotMemoized(p, 'co1', NOW, ctx);
    await composePluginSnapshotMemoized(p, 'co2', NOW, ctx);
    await composePluginSnapshotMemoized(p, 'co1', NOW + 1, ctx);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('memoized output is byte-identical to non-memoized', async () => {
    const p = makePlugin('memoD', jest.fn(async () => data));
    const plain = await composePluginSnapshot(p, 'co1', NOW);
    const memo = await composePluginSnapshotMemoized(p, 'co1', NOW, createCompositionContext());
    expect(memo).toEqual(plain);
  });

  it('shared ctx across report-like + meta-consumer reuse → each plugin composes once', async () => {
    const sa = jest.fn(async () => data); const sb = jest.fn(async () => data);
    const a = makePlugin('memoE_a', sa); const b = makePlugin('memoE_b', sb);
    const ctx = createCompositionContext();
    // "report" composes A + B
    await Promise.all([composePluginSnapshotMemoized(a, 'co1', NOW, ctx), composePluginSnapshotMemoized(b, 'co1', NOW, ctx)]);
    // "decision/unified" re-request A + B with the SAME ctx
    await Promise.all([composePluginSnapshotMemoized(a, 'co1', NOW, ctx), composePluginSnapshotMemoized(b, 'co1', NOW, ctx)]);
    expect(sa).toHaveBeenCalledTimes(1);
    expect(sb).toHaveBeenCalledTimes(1);
  });

  it('Phase H — before: a plugin re-composes per consumer; after: composes once', async () => {
    const sa = jest.fn(async () => data); const a = makePlugin('perfA', sa);
    // a meta-consumer (decision/unified-like) that composes A through the registry
    const meta = makePlugin('perfMeta', jest.fn(async (c: any) => { await composePluginSnapshotMemoized(a, 'co1', NOW, c.ctx); return data; }));

    // BEFORE (no shared ctx): direct compose of A + meta-consumer (which composes A again) → A twice
    sa.mockClear();
    await composePluginSnapshot(a, 'co1', NOW);
    await composePluginSnapshot(meta, 'co1', NOW);
    expect(sa).toHaveBeenCalledTimes(2); // O(domains²) duplication

    // AFTER (one shared ctx): A composes exactly once across both consumers
    sa.mockClear();
    const ctx = createCompositionContext();
    await composePluginSnapshotMemoized(a, 'co1', NOW, ctx);
    await composePluginSnapshotMemoized(meta, 'co1', NOW, ctx);
    expect(sa).toHaveBeenCalledTimes(1); // O(domains)
  });
});
