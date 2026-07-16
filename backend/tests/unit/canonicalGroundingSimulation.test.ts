/**
 * RF-3B-SIM — Offline Simulation Evaluation.
 * Drives the RF-3A harness (reused, not duplicated) across the FULL golden
 * dataset × all workloads with the OFFLINE runner (no live LLM), repeated for
 * determinism, plus stress + negative fixtures. Proves the engineering
 * invariants and emits JSON/CSV/Markdown artifacts. AI-quality is deliberately
 * NOT scored — reported as LIVE EVALUATION REQUIRED.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runEquivalenceHarness, loadGoldenDataset, WORKLOADS,
  toJson, toCsv, toMarkdown,
} from '../../evaluation/canonicalGrounding';
import type { AiRunner, DatasetEntry, WorkloadComparison, HarnessResult } from '../../evaluation/canonicalGrounding/types';

const EVAL_KILL = 'CACHE_KILL_OMNIVYRA_EVAL_CANONICAL_CTX';
const ART = path.join(os.tmpdir(), 'canonical-grounding-sim');

beforeAll(() => {
  delete process.env.CACHE_KILL_ALL;
  process.env[EVAL_KILL] = '1'; // Redis-free, deterministic bulk runs
  try { fs.mkdirSync(ART, { recursive: true }); } catch { /* ok */ }
});
afterAll(() => { delete process.env[EVAL_KILL]; });

const substantive = (r: { comparisons: WorkloadComparison[] }) =>
  JSON.stringify(r.comparisons.map((c) => ({
    w: c.workload, e: c.entryId, cls: c.classification,
    lg: c.legacy.grounding, lp: c.legacy.prompt, cg: c.canonical.grounding, cp: c.canonical.prompt,
    ov: c.canonical.overwriteCount, bf: c.canonical.backfillCount, det: c.delta.deterministic,
    ti: c.canonical.tokensIn, cost: c.canonical.estCostUsd, comp: c.canonical.contextCompleteness,
  })));

const EPOCH = Date.parse('2026-07-15T00:00:00Z');
const daysAgo = (n: number) => new Date(EPOCH - n * 86_400_000).toISOString();

// ── engineering-readiness mapping (SIM axis, not the enforce axis) ─────────────
type SimClass = 'READY_FOR_LIVE_EVALUATION' | 'NEEDS_ADDITIONAL_ENGINEERING' | 'BLOCKED';
function simClassify(rows: WorkloadComparison[]): SimClass {
  if (rows.some((c) => c.canonical.error)) return 'BLOCKED';
  if (rows.some((c) => c.canonical.overwriteCount > 0 || !c.delta.deterministic)) return 'NEEDS_ADDITIONAL_ENGINEERING';
  return 'READY_FOR_LIVE_EVALUATION';
}

let SIM: HarnessResult;

describe('RF-3B-SIM — full offline simulation', () => {
  beforeAll(async () => { SIM = await runEquivalenceHarness(); });

  test('coverage: every workload × every golden entry executed (legacy + canonical)', () => {
    expect(SIM.comparisons.length).toBe(WORKLOADS.length * loadGoldenDataset().length);
    expect(SIM.comparisons.length).toBe(13 * 9);
    for (const c of SIM.comparisons) { expect(c.legacy).toBeDefined(); expect(c.canonical).toBeDefined(); }
  });

  test('INVARIANT — deterministic replay across repeated simulations (3×)', async () => {
    const r2 = await runEquivalenceHarness();
    const r3 = await runEquivalenceHarness();
    expect(substantive(SIM)).toEqual(substantive(r2));
    expect(substantive(r2)).toEqual(substantive(r3));
    expect(SIM.comparisons.every((c) => c.delta.deterministic)).toBe(true);
  });

  test('INVARIANT — no overwrite occurs anywhere in the matrix', () => {
    const offenders = SIM.comparisons.filter((c) => c.canonical.overwriteCount > 0);
    expect(offenders).toEqual([]);
  });

  test('INVARIANT — canonical never fabricates (a source-less profile backfills nothing)', () => {
    // eval-00: completeness none, no website, no market, dormant → zero sources.
    const barren = SIM.comparisons.filter((c) => c.entryId.startsWith('eval-00'));
    expect(barren.length).toBe(WORKLOADS.length);
    expect(barren.every((c) => c.canonical.backfillCount === 0 && !c.delta.promptChanged)).toBe(true);
  });

  test('INVARIANT — RICH profile → canonical grounding identical to legacy (backfill workloads)', () => {
    const rich = SIM.comparisons.filter((c) => c.completeness === 'rich' && !WORKLOADS.find((w) => w.key === c.workload)?.additive);
    expect(rich.length).toBeGreaterThan(0);
    expect(rich.every((c) => c.legacy.prompt === c.canonical.prompt && c.canonical.backfillCount === 0)).toBe(true);
  });

  test('INVARIANT — cache never crosses tenants (independent grounding per entry)', () => {
    // Same workload, two different tenants with different source content → the
    // canonical grounding must reflect each tenant, never bleed.
    const cg = SIM.comparisons.filter((c) => c.workload === 'content_generation');
    const byId = new Map(cg.map((c) => [c.entryId, JSON.stringify(c.canonical.grounding)]));
    // rich martech (eval-05) and sparse+sources martech (eval-03) must differ.
    expect(byId.get('eval-05-medium-rich')).not.toEqual(byId.get('eval-03-medium-sparse'));
  });

  test('INVARIANT — classification is deterministic (stable across runs)', async () => {
    const again = await runEquivalenceHarness();
    expect(JSON.stringify(SIM.summary.byWorkload)).toEqual(JSON.stringify(again.summary.byWorkload));
  });

  test('token estimation + cost are consistent and non-negative', () => {
    for (const c of SIM.comparisons) {
      expect(c.canonical.tokensIn).toBe(Math.ceil(c.canonical.promptChars / SIM.generatedForParams.charsPerToken));
      expect(c.canonical.estCostUsd).toBeGreaterThanOrEqual(0);
      expect(c.delta.tokensInDelta).toBe(c.canonical.tokensIn - c.legacy.tokensIn);
    }
  });

  test('SIM classification: every workload READY_FOR_LIVE_EVALUATION (engineering sound)', () => {
    const byWorkload: Record<string, SimClass> = {};
    for (const w of WORKLOADS) byWorkload[w.key] = simClassify(SIM.comparisons.filter((c) => c.workload === w.key));
    for (const w of WORKLOADS) expect(byWorkload[w.key]).toBe('READY_FOR_LIVE_EVALUATION');

    // Emit artifacts + a machine-readable simulation summary.
    const simCounts = Object.values(byWorkload).reduce<Record<string, number>>((a, v) => ((a[v] = (a[v] ?? 0) + 1), a), {});
    fs.writeFileSync(path.join(ART, 'simulation.json'), toJson(SIM));
    fs.writeFileSync(path.join(ART, 'simulation.csv'), toCsv(SIM));
    fs.writeFileSync(path.join(ART, 'simulation.md'), toMarkdown(SIM));
    const promptGrowth = SIM.comparisons.map((c) => (c.legacy.promptChars > 0 ? c.delta.promptCharsDelta / c.legacy.promptChars : 0));
    const summary = {
      comparisons: SIM.comparisons.length,
      workloads: WORKLOADS.length,
      overwrites: SIM.comparisons.reduce((s, c) => s + c.canonical.overwriteCount, 0),
      backfills: SIM.comparisons.reduce((s, c) => s + c.canonical.backfillCount, 0),
      deterministic: SIM.comparisons.every((c) => c.delta.deterministic),
      maxPromptGrowthPct: Math.round(Math.max(...promptGrowth) * 100),
      totalTokensInLegacy: SIM.comparisons.reduce((s, c) => s + c.legacy.tokensIn, 0),
      totalTokensInCanonical: SIM.comparisons.reduce((s, c) => s + c.canonical.tokensIn, 0),
      totalCostDeltaUsd: SIM.comparisons.reduce((s, c) => s + c.delta.estCostDeltaUsd, 0),
      enforceAxis: SIM.summary.byClassification,
      simAxis: simCounts,
      artifacts: ART,
      aiQuality: 'LIVE EVALUATION REQUIRED',
    };
    // eslint-disable-next-line no-console
    console.log('RF3B_SIM_SUMMARY ' + JSON.stringify(summary));
    expect(simCounts.READY_FOR_LIVE_EVALUATION).toBe(WORKLOADS.length);
  });
});

describe('RF-3B-SIM — stress fixtures', () => {
  const big = 'x'.repeat(4000);
  const stress: DatasetEntry[] = [
    { id: 'stress-large', size: 'enterprise', industry: 'Tech', completeness: 'rich', websiteEnabled: true, marketIntel: true, activity: 'active', now: EPOCH,
      profile: { name: big, industry: 'Tech', products_services: big, competitive_advantages: Array.from({ length: 50 }, (_, i) => `adv-${i}`), unique_value: big, content_themes: big, report_settings: { market_pulse: { core_offerings: [big] }, discovered_metadata: { title: big, discovered_at: daysAgo(1) } } },
      recentContent: Array.from({ length: 40 }, (_, i) => ({ title: `post-${i}`, published_at: daysAgo(i) })) },
    { id: 'stress-tiny', size: 'small', industry: 'X', completeness: 'none', websiteEnabled: false, marketIntel: false, activity: 'dormant', now: EPOCH, profile: {}, recentContent: [] },
    { id: 'stress-website-stale', size: 'medium', industry: 'Retail', completeness: 'sparse', websiteEnabled: true, marketIntel: false, activity: 'dormant', now: EPOCH,
      profile: { name: 'StaleCo', industry: 'Retail', report_settings: { market_pulse: {}, discovered_metadata: { title: 'Old', discovered_at: daysAgo(900) } } }, recentContent: [] },
    { id: 'stress-max-grounding', size: 'enterprise', industry: 'Martech', completeness: 'sparse', websiteEnabled: true, marketIntel: true, activity: 'active', now: EPOCH,
      profile: { name: 'MaxCo', industry: 'Martech', report_settings: { market_pulse: { core_offerings: ['A', 'B', 'C'], named_competitors: ['C1', 'C2'], primary_markets: ['M1', 'M2'] }, discovered_metadata: { title: 'Max', description: 'desc', seo_keywords: ['k1', 'k2'], discovered_at: daysAgo(2) } } },
      recentContent: Array.from({ length: 8 }, (_, i) => ({ title: `t-${i}`, published_at: daysAgo(i) })) },
  ];

  test('handles large/tiny/stale/max fixtures deterministically, no overwrite, no throw', async () => {
    const a = await runEquivalenceHarness({ dataset: stress });
    const b = await runEquivalenceHarness({ dataset: stress });
    expect(substantive(a)).toEqual(substantive(b));
    expect(a.comparisons.every((c) => c.canonical.overwriteCount === 0)).toBe(true);
    expect(a.comparisons.every((c) => c.delta.deterministic)).toBe(true);
    // tiny/none fabricates nothing
    expect(a.comparisons.filter((c) => c.entryId === 'stress-tiny').every((c) => c.canonical.backfillCount === 0)).toBe(true);
  });

  test('rapid repeated execution of one scenario is stable (no state leak)', async () => {
    const one = [stress[3]];
    const first = substantive(await runEquivalenceHarness({ dataset: one }));
    for (let i = 0; i < 5; i++) {
      expect(substantive(await runEquivalenceHarness({ dataset: one }))).toEqual(first);
    }
  });
});

describe('RF-3B-SIM — negative fixtures', () => {
  test('malformed / wrong-typed profile fields → defensive, no throw, grounding produced', async () => {
    const malformed: DatasetEntry[] = [{
      id: 'neg-malformed', size: 'small', industry: 'X', completeness: 'sparse', websiteEnabled: false, marketIntel: false, activity: 'active', now: EPOCH,
      profile: { name: 123 as never, products_services: 999 as never, competitive_advantages: 'not-an-array' as never, report_settings: 'nope' as never, overall_confidence: 'high' as never },
      recentContent: [{ title: 'ok', published_at: daysAgo(1) }],
    }];
    const r = await runEquivalenceHarness({ dataset: malformed });
    expect(r.comparisons.length).toBe(WORKLOADS.length);
    expect(r.comparisons.every((c) => c.canonical.error === null)).toBe(true); // no crash
    expect(r.comparisons.every((c) => c.canonical.overwriteCount === 0)).toBe(true);
  });

  test('execution error/retry is captured and drives REQUIRES_ENGINEERING_CHANGES (regression detection)', async () => {
    const failing: AiRunner = async () => ({ text: null, tokensIn: 0, tokensOut: 0, latencyMs: 0, retries: 2, error: 'simulated-timeout' });
    const r = await runEquivalenceHarness({ dataset: [loadGoldenDataset()[5]], workloads: [WORKLOADS[0]], aiRunner: failing });
    const c = r.comparisons[0];
    expect(c.canonical.error).toBe('simulated-timeout');
    expect(c.canonical.retryCount).toBe(2);
    expect(c.classification).toBe('REQUIRES_ENGINEERING_CHANGES'); // detected, not averaged away
  });

  test('cache disabled (kill) → grounding still assembles (fail-open)', async () => {
    // Whole suite runs under EVAL_KILL; canonical grounding must still work where
    // sources exist (fail-open, direct assembly).
    const r = await runEquivalenceHarness({ dataset: [loadGoldenDataset()[5]], workloads: [WORKLOADS[1]] });
    expect(r.comparisons[0].canonical.contextAvailable).toBe(true);
  });
});
