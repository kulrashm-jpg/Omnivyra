/**
 * RF-3B-LIVE driver — env-gated live evaluation (skipped unless RUN_LIVE_EVAL=1
 * AND OPENAI_API_KEY present, so it NEVER runs/charges in CI). Reuses the RF-3A
 * harness with the live OpenAI runner + LLM-as-Judge, writes artifacts, and
 * emits a machine-readable summary. Does not modify production/grounding/rollout.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runEquivalenceHarness, WORKLOADS, toJson, toCsv, toMarkdown, DEFAULT_EXECUTION_PARAMS } from '../../evaluation/canonicalGrounding';
import { createLiveOpenAiRunner, judgePair, humanReviewHooks, promptKey, accurateCostUsd, type JudgeVerdict } from '../../evaluation/canonicalGrounding/liveRunner';
import type { WorkloadComparison } from '../../evaluation/canonicalGrounding/types';

const LIVE = process.env.RUN_LIVE_EVAL === '1' && !!process.env.OPENAI_API_KEY;
const ART = path.join(os.tmpdir(), 'canonical-grounding-live');
const params = DEFAULT_EXECUTION_PARAMS;
// Grounding assembly is Redis-free for the run (cache correctness already
// certified); this phase measures AI output + engineering, not cache warmth.
process.env.CACHE_KILL_OMNIVYRA_EVAL_CANONICAL_CTX = '1';

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx], idx); } }));
  return res;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const GOOD = ['factualCorrectness', 'relevance', 'completeness', 'instructionFollowing', 'brandConsistency', 'marketingQuality', 'campaignUsefulness', 'toneConsistency', 'contentRichness', 'reasoningQuality'] as const;
const composite = (d: any) => d && !Number.isNaN(d.factualCorrectness) ? mean([...GOOD.map((k) => d[k]), 1 - d.hallucination]) : NaN;

(LIVE ? describe : describe.skip)('RF-3B-LIVE — live equivalence evaluation', () => {
  jest.setTimeout(1_800_000);

  test('run full matrix live, judge, and emit artifacts + summary', async () => {
    fs.mkdirSync(ART, { recursive: true });
    const { runner, outputs, calls } = createLiveOpenAiRunner();

    // 1) full matrix with LIVE generation (both arms); engineering metrics real.
    const R = await runEquivalenceHarness({ aiRunner: runner });
    const C = R.comparisons;

    // 2) LLM-as-Judge over each legacy/canonical output pair (concurrency-limited).
    const verdicts: JudgeVerdict[] = await pool(C, 5, async (c) => {
      const lt = outputs.get(promptKey(c.legacy.prompt)) ?? '';
      const ct = outputs.get(promptKey(c.canonical.prompt)) ?? '';
      return judgePair(c, lt, ct, params);
    });

    // 3) provider-variance probe: 5 canonical prompts × 3 fresh generations.
    const probePrompts = [...new Set(C.map((c) => c.canonical.prompt))].filter((p) => p.length > 40).slice(0, 5);
    const variance = await pool(probePrompts, 3, async (p) => {
      const three = await Promise.all([0, 1, 2].map(async () => {
        const { runner: fresh, outputs: o } = createLiveOpenAiRunner();
        await fresh(p, params); return o.get(promptKey(p)) ?? '';
      }));
      return { identical: three[0] === three[1] && three[1] === three[2], lens: three.map((t) => t.length) };
    });

    // 4) aggregate quality + engineering, per workload → evidence-driven class.
    const valid = verdicts.filter((v) => !v.error && !Number.isNaN(v.canonical.factualCorrectness));
    const perWorkload = WORKLOADS.map((w) => {
      const cs = C.filter((c) => c.workload === w.key);
      const vs = valid.filter((v) => v.workload === w.key);
      const legComp = mean(vs.map((v) => composite(v.legacy)));
      const canComp = mean(vs.map((v) => composite(v.canonical)));
      const hallLeg = mean(vs.map((v) => v.legacy.hallucination));
      const hallCan = mean(vs.map((v) => v.canonical.hallucination));
      const wins = vs.filter((v) => v.preferred === 'canonical').length;
      const losses = vs.filter((v) => v.preferred === 'legacy').length;
      const ties = vs.filter((v) => v.preferred === 'tie').length;
      const overwrite = cs.reduce((s, c) => s + c.canonical.overwriteCount, 0);
      const errors = cs.filter((c) => c.canonical.error).length;
      const tokLeg = cs.reduce((s, c) => s + c.legacy.tokensIn, 0);
      const tokCan = cs.reduce((s, c) => s + c.canonical.tokensIn, 0);
      let cls: string;
      if (overwrite > 0 || errors > 0) cls = 'REQUIRES_ENGINEERING_CHANGES';
      else if (canComp >= legComp - 0.02 && hallCan <= hallLeg + 0.02) cls = 'SAFE_TO_ENFORCE';
      else cls = 'KEEP_IN_SHADOW';
      return { workload: w.key, n: cs.length, judged: vs.length, legComp, canComp, qualityDelta: canComp - legComp, hallLeg, hallCan, wins, ties, losses, overwrite, errors, tokLeg, tokCan, classification: cls };
    });

    // 5) cost + sparse P-1 (real tokens/cost).
    const cost = (c: WorkloadComparison, arm: 'legacy' | 'canonical') => accurateCostUsd(params.model, c[arm].tokensIn, c[arm].tokensOut);
    const costLegacy = C.reduce((s, c) => s + cost(c, 'legacy'), 0);
    const costCanonical = C.reduce((s, c) => s + cost(c, 'canonical'), 0);
    const sparse = C.filter((c) => c.completeness === 'sparse' || c.completeness === 'none');
    const sparseVerdicts = valid.filter((v) => sparse.some((c) => c.workload === v.workload && c.entryId === v.entryId));
    const p1 = {
      entries: sparse.length,
      promptCharsDeltaAvg: Math.round(mean(sparse.map((c) => c.delta.promptCharsDelta))),
      tokenInDeltaAvg: Math.round(mean(sparse.map((c) => c.canonical.tokensIn - c.legacy.tokensIn))),
      costDeltaTotalUsd: sparse.reduce((s, c) => s + (cost(c, 'canonical') - cost(c, 'legacy')), 0),
      qualityDeltaAvg: mean(sparseVerdicts.map((v) => composite(v.canonical) - composite(v.legacy))),
    };

    const summary = {
      generatedAt: new Date().toISOString(), model: params.model, temperature: params.temperature, seed: params.seed,
      comparisons: C.length, providerCalls: calls(), judged: valid.length, judgeErrors: verdicts.length - valid.length,
      engineering: {
        overwritesTotal: C.reduce((s, c) => s + c.canonical.overwriteCount, 0),
        errorsCanonical: C.filter((c) => c.canonical.error).length,
        retriesTotal: C.reduce((s, c) => s + c.canonical.retryCount, 0),
        tokensInLegacy: C.reduce((s, c) => s + c.legacy.tokensIn, 0),
        tokensInCanonical: C.reduce((s, c) => s + c.canonical.tokensIn, 0),
        tokensOutLegacy: C.reduce((s, c) => s + c.legacy.tokensOut, 0),
        tokensOutCanonical: C.reduce((s, c) => s + c.canonical.tokensOut, 0),
        latencyLegacyAvgMs: Math.round(mean(C.map((c) => c.legacy.executionLatencyMs))),
        latencyCanonicalAvgMs: Math.round(mean(C.map((c) => c.canonical.executionLatencyMs))),
      },
      cost: { legacyUsd: costLegacy, canonicalUsd: costCanonical, deltaUsd: costCanonical - costLegacy },
      quality: {
        legacyCompositeAvg: mean(valid.map((v) => composite(v.legacy))),
        canonicalCompositeAvg: mean(valid.map((v) => composite(v.canonical))),
        hallucinationLegacyAvg: mean(valid.map((v) => v.legacy.hallucination)),
        hallucinationCanonicalAvg: mean(valid.map((v) => v.canonical.hallucination)),
        preferredCanonical: valid.filter((v) => v.preferred === 'canonical').length,
        preferredLegacy: valid.filter((v) => v.preferred === 'legacy').length,
        preferredTie: valid.filter((v) => v.preferred === 'tie').length,
      },
      variance: { probed: variance.length, allIdentical: variance.every((v) => v.identical), detail: variance },
      sparseP1: p1,
      classification: perWorkload.reduce<Record<string, number>>((a, w) => ((a[w.classification] = (a[w.classification] ?? 0) + 1), a), {}),
      shadowData: 'NO SHADOW DATA AVAILABLE (flag never enabled)',
    };

    fs.writeFileSync(path.join(ART, 'engineering.json'), toJson(R));
    fs.writeFileSync(path.join(ART, 'engineering.csv'), toCsv(R));
    fs.writeFileSync(path.join(ART, 'engineering.md'), toMarkdown(R));
    fs.writeFileSync(path.join(ART, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
    fs.writeFileSync(path.join(ART, 'perWorkload.json'), JSON.stringify(perWorkload, null, 2));
    fs.writeFileSync(path.join(ART, 'humanReview.json'), JSON.stringify(humanReviewHooks(C, outputs), null, 2));
    fs.writeFileSync(path.join(ART, 'summary.json'), JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log('RF3B_LIVE_SUMMARY ' + JSON.stringify(summary));

    expect(C.length).toBe(WORKLOADS.length * 9);
    expect(valid.length).toBeGreaterThan(0);
  });
});
