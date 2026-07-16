/**
 * RF-3A — Golden Dataset Equivalence Harness validation.
 * Verifies deterministic replay, stable dataset, identical params, prompt
 * capture, diff generation, token accounting, cache metrics, configurable
 * classification, report emission, and regression safety (offline, no flags).
 */
import {
  runEquivalenceHarness, loadGoldenDataset, WORKLOADS,
  toJson, toCsv, toMarkdown, DEFAULT_EXECUTION_PARAMS, DEFAULT_CLASSIFICATION_CONFIG,
} from '../../evaluation/canonicalGrounding';
import { classify, pendingQuality } from '../../evaluation/canonicalGrounding/analysis';
import type { WorkloadComparison } from '../../evaluation/canonicalGrounding/types';

// Bulk runs bypass Redis (fast, deterministic) via the eval namespace kill; a
// single dedicated test below exercises the real Redis-backed warm-hit path.
const EVAL_KILL = 'CACHE_KILL_OMNIVYRA_EVAL_CANONICAL_CTX';
beforeAll(() => {
  delete process.env.CACHE_KILL_ALL;
  process.env[EVAL_KILL] = '1';
});
afterAll(() => { delete process.env[EVAL_KILL]; });

// Normalise environmental (non-substantive) fields: wall-clock latency and
// cache hit/miss flags (warm across repeated in-process runs). What must be
// byte-stable is the GROUNDING, PROMPT, DIFF, TOKENS, COST, and CLASSIFICATION.
const normArm = (a: WorkloadComparison['legacy']) => ({
  ...a, groundingLatencyMs: 0, assemblyLatencyMs: 0, executionLatencyMs: 0, cacheColdHit: false, cacheWarmHit: false,
});
const stripLatency = (r: { comparisons: WorkloadComparison[] }) =>
  JSON.stringify(r.comparisons.map((c) => ({
    ...c,
    legacy: normArm(c.legacy),
    canonical: normArm(c.canonical),
    delta: { ...c.delta, groundingLatencyDeltaMs: 0 },
  })));

describe('dataset', () => {
  test('stable + deterministic loading', () => {
    expect(JSON.stringify(loadGoldenDataset())).toEqual(JSON.stringify(loadGoldenDataset()));
    const ds = loadGoldenDataset();
    expect(ds.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ds.map((e) => e.size))).toEqual(new Set(['small', 'medium', 'enterprise']));
    expect(new Set(ds.map((e) => e.completeness))).toEqual(new Set(['none', 'sparse', 'rich']));
  });
});

describe('offline harness run', () => {
  // Curated subset (kept fast); the full registry sizes are asserted separately.
  const SUB_WORKLOADS = WORKLOADS.filter((w) => ['content_generation', 'brief_suggestions', 'reports'].includes(w.key));
  const SUB_DATASET = [0, 1, 3, 5].map((i) => loadGoldenDataset()[i]); // none, sparse, sparse+web, rich
  const runSub = () => runEquivalenceHarness({ workloads: SUB_WORKLOADS, dataset: SUB_DATASET });

  let A: Awaited<ReturnType<typeof runEquivalenceHarness>>;
  beforeAll(async () => { A = await runSub(); });

  test('cartesian coverage (workloads × entries) + full registry sizes', () => {
    expect(A.comparisons.length).toBe(SUB_WORKLOADS.length * SUB_DATASET.length);
    expect(A.workloadCount).toBe(SUB_WORKLOADS.length);
    // full harness enumerates all 13 workloads over the 9-entry golden set
    expect(WORKLOADS.length).toBe(13);
    expect(loadGoldenDataset().length).toBe(9);
  });

  test('deterministic replay: substantive results are byte-stable across runs', async () => {
    const B = await runSub();
    expect(stripLatency(A)).toEqual(stripLatency(B));
    // and the harness self-check flags every comparison deterministic
    expect(A.comparisons.every((c) => c.delta.deterministic)).toBe(true);
  });

  test('overlay NEVER overwrites (zero overwrite across the whole matrix)', () => {
    expect(A.comparisons.every((c) => c.canonical.overwriteCount === 0)).toBe(true);
  });

  test('prompt capture: RICH profile → canonical prompt identical to legacy (backfill workload)', () => {
    const c = A.comparisons.find((x) => x.workload === 'content_generation' && x.completeness === 'rich')!;
    expect(c).toBeDefined();
    expect(c.legacy.prompt).toEqual(c.canonical.prompt);
    expect(c.delta.promptChanged).toBe(false);
    expect(c.canonical.backfillCount).toBe(0);
  });

  test('prompt capture: SPARSE + enrichment sources → canonical backfills empty fields → prompt changes', () => {
    // A sparse profile WITHOUT sources (dormant, no site/market) honestly backfills
    // nothing; a sparse profile WITH sources does. Target the enriched one.
    const c = A.comparisons.find((x) => x.workload === 'content_generation' && x.completeness === 'sparse' && x.canonical.backfillCount > 0)!;
    expect(c).toBeDefined();
    expect(c.delta.promptChanged).toBe(true);
    expect(c.delta.backfilledFields.length).toBeGreaterThan(0);
    // and a source-less sparse profile adds nothing (canonical never fabricates)
    const barren = A.comparisons.find((x) => x.workload === 'content_generation' && x.entryId.includes('01-small-sparse'))!;
    expect(barren.canonical.backfillCount).toBe(0);
    expect(barren.delta.promptChanged).toBe(false);
  });

  test('additive workload (brief_suggestions) injects a facts block even for RICH', () => {
    const c = A.comparisons.find((x) => x.workload === 'brief_suggestions' && x.completeness === 'rich')!;
    expect(c.delta.promptChanged).toBe(true);
    expect(c.canonical.prompt).toContain('Company facts');
  });

  test('token accounting matches promptChars / charsPerToken', () => {
    const c = A.comparisons[0];
    expect(c.canonical.tokensIn).toBe(Math.ceil(c.canonical.promptChars / DEFAULT_EXECUTION_PARAMS.charsPerToken));
    expect(c.legacy.tokensIn).toBe(Math.ceil(c.legacy.promptChars / DEFAULT_EXECUTION_PARAMS.charsPerToken));
  });

  test('cache metrics are captured for the canonical arm (F-12 seam reused)', () => {
    // Redis-free: under the namespace kill the F-12 getOrLoad bypasses Redis, so
    // both flags read false. The harness REUSES the F-12 cache SDK; its live
    // cold/warm behaviour is certified by canonicalGroundingCache.test.ts. Here
    // we assert the harness correctly captures the flags per execution.
    const c = A.comparisons.find((x) => x.workload === 'content_generation')!;
    expect(typeof c.canonical.cacheColdHit).toBe('boolean');
    expect(typeof c.canonical.cacheWarmHit).toBe('boolean');
    expect(c.legacy.cacheColdHit).toBe(false); // legacy arm never assembles context
  });

  test('default classification: NO workload SAFE_TO_ENFORCE (quality pending, no output evidence)', () => {
    expect(A.summary.byClassification.SAFE_TO_ENFORCE).toBe(0);
    expect(A.summary.byClassification.REQUIRES_ENGINEERING_CHANGES).toBe(0);
    expect(A.summary.byClassification.KEEP_IN_SHADOW).toBe(A.comparisons.length);
  });

  test('reports emit JSON, CSV, Markdown', () => {
    expect(() => JSON.parse(toJson(A))).not.toThrow();
    const csv = toCsv(A);
    expect(csv.split('\n')[0]).toContain('classification');
    expect(csv.split('\n').length).toBe(A.comparisons.length + 1);
    expect(toMarkdown(A)).toContain('Classification summary');
  });
});

describe('configurable classification engine', () => {
  const base = (over: Partial<WorkloadComparison>): Omit<WorkloadComparison, 'classification' | 'classificationReasons'> => ({
    workload: 'w', entryId: 'e', size: 'small', completeness: 'rich',
    legacy: { promptChars: 100, overwriteCount: 0, error: null } as never,
    canonical: { promptChars: 100, overwriteCount: 0, error: null } as never,
    delta: { promptCharsDelta: 0, promptChanged: false, backfilledFields: [], overwrittenFields: [],
      missingFieldsLegacy: [], missingFieldsCanonical: [], completenessDelta: 0, groundingLatencyDeltaMs: 0,
      tokensInDelta: 0, estCostDeltaUsd: 0, deterministic: true } as never,
    quality: pendingQuality(),
    ...over,
  });

  test('overwrite > threshold → REQUIRES_ENGINEERING_CHANGES', () => {
    const c = base({ canonical: { promptChars: 100, overwriteCount: 1, error: null } as never });
    expect(classify(c, DEFAULT_CLASSIFICATION_CONFIG).classification).toBe('REQUIRES_ENGINEERING_CHANGES');
  });

  test('non-deterministic → REQUIRES_ENGINEERING_CHANGES', () => {
    const c = base({ delta: { ...base({}).delta, deterministic: false } as never });
    expect(classify(c, DEFAULT_CLASSIFICATION_CONFIG).classification).toBe('REQUIRES_ENGINEERING_CHANGES');
  });

  test('pending quality → KEEP_IN_SHADOW', () => {
    expect(classify(base({}), DEFAULT_CLASSIFICATION_CONFIG).classification).toBe('KEEP_IN_SHADOW');
  });

  test('scored quality + bounded growth/cost + config → SAFE_TO_ENFORCE', () => {
    const scored = base({
      quality: { factualCorrectness: 0.95, relevance: 0.95, completeness: 0.9, brandConsistency: 0.92,
        instructionFollowing: 0.95, hallucination: 0.01, campaignUsefulness: 0.9, contentQuality: 0.9, reviewer: 'eval-bot' },
    });
    expect(classify(scored, DEFAULT_CLASSIFICATION_CONFIG).classification).toBe('SAFE_TO_ENFORCE');
  });

  test('rules are configurable: relaxing quality requirement flips pending → SAFE', () => {
    const cfg = { ...DEFAULT_CLASSIFICATION_CONFIG, requireQualityForEnforce: false };
    expect(classify(base({}), cfg).classification).toBe('SAFE_TO_ENFORCE');
  });
});
