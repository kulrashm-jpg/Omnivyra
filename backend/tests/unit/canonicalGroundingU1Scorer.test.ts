/**
 * DT-C2 — U1 scorer + pre-registered protocol invariants.
 *
 * ⚠️ ALL OUTPUT STRINGS IN THIS FILE ARE **SYNTHETIC TEST DATA**, hand-written to
 * exercise scorer branches. They are NOT model outputs, NOT evaluation results,
 * and NOT evidence of grounding efficacy. No U1 result may ever be quoted from
 * this file. Every fixture is prefixed SYNTHETIC_ to make that unmistakable.
 *
 * These tests prove ENGINEERING properties of the scorer and STRUCTURAL
 * properties of the protocol. They assert nothing about grounding efficacy.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  scorePair, aggregate, referenceValues,
  outputValidity, groundedFactUtilisation, entityIdentityFidelity,
  type PairedOutputs,
} from '../../evaluation/canonicalGrounding/u1Scorer';
import {
  METRICS, PRIMARY_METRIC, PROTOCOL_VERSION, ACCEPTANCE_RULES, EXCLUSION_RULES,
  STATISTICAL_TREATMENT, HUMAN_RATING_PROTOCOL, MIN_RELATIVE_REDUCTION,
  protocolFingerprint, getMetric,
} from '../../evaluation/canonicalGrounding/u1Protocol';
import { loadGoldenDataset } from '../../evaluation/canonicalGrounding/dataset';
import { WORKLOADS } from '../../evaluation/canonicalGrounding/workloads';

const SCORER_SRC = join(__dirname, '../../evaluation/canonicalGrounding/u1Scorer.ts');
const PROTOCOL_SRC = join(__dirname, '../../evaluation/canonicalGrounding/u1Protocol.ts');

const dataset = loadGoldenDataset();
/** A 'rich' entry — has checkable reference facts. */
const RICH = dataset.find((e) => e.completeness === 'rich')!;
/** A 'none' entry — no first-party profile at all. */
const NONE = dataset.find((e) => e.completeness === 'none')!;
const WL = WORKLOADS.find((w) => w.key === 'content_generation')!;
const FOREIGN = dataset.filter((e) => e.id !== RICH.id)
  .map((e) => e.profile.name).filter((n): n is string => typeof n === 'string');

// ── SYNTHETIC fixtures (NOT model outputs) ───────────────────────────────────
const SYNTHETIC_ALL_FACTS = [
  'Flagship product, Add-on module', 'Flagship product', 'Add-on module',
  'sharp, modern', 'AEO, attribution', 'AEO', 'attribution',
  'B2B marketing leaders at SaaS', 'generic AI output', 'slow production',
  RICH.profile.name as string,
].join('. ');
const SYNTHETIC_NO_FACTS = 'A generic paragraph containing none of the reference values whatsoever.';
const SYNTHETIC_EMPTY = '';
const SYNTHETIC_WHITESPACE = '    \n\t  ';
const SYNTHETIC_FOREIGN = `We recommend ${FOREIGN[0]} expand its offering.`;

describe('DT-C2 protocol — structure and pre-registration', () => {
  it('declares a version, fingerprint and dataset identity', () => {
    expect(PROTOCOL_VERSION).toBe('u1-001');
    expect(protocolFingerprint()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is fingerprint-stable across repeated computation', () => {
    expect(protocolFingerprint()).toBe(protocolFingerprint());
  });

  it('declares exactly one primary endpoint, and it is the truthfulness metric', () => {
    const primaries = METRICS.filter((m) => m.role === 'primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(PRIMARY_METRIC);
    expect(primaries[0].mapsToLegacyDimension).toBe('hallucination');
    expect(primaries[0].direction).toBe('lower-is-better');
  });

  it('preserves all eight original harness dimensions without renaming them', () => {
    const mapped = METRICS.map((m) => m.mapsToLegacyDimension).filter(Boolean);
    for (const d of ['factualCorrectness', 'relevance', 'completeness', 'brandConsistency',
      'instructionFollowing', 'hallucination', 'campaignUsefulness', 'contentQuality']) {
      expect(mapped).toContain(d);
    }
  });

  it('fully specifies every metric', () => {
    for (const m of METRICS) {
      for (const f of ['id', 'name', 'definition', 'calculation', 'direction', 'range',
        'missingValueTreatment', 'tieTreatment', 'evaluator', 'role', 'limitations'] as const) {
        expect(m[f]).toBeDefined();
        if (typeof m[f] === 'string') expect((m[f] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('pre-registers success, failure, inconclusive AND falsification rules', () => {
    expect(ACCEPTANCE_RULES.success.length).toBeGreaterThan(0);
    expect(ACCEPTANCE_RULES.failure.length).toBeGreaterThan(0);
    expect(ACCEPTANCE_RULES.inconclusive.length).toBeGreaterThan(0);
    expect(ACCEPTANCE_RULES.falsification.length).toBeGreaterThan(0);
    expect(ACCEPTANCE_RULES.falsification.join(' ')).toMatch(/evidence AGAINST/i);
  });

  it('pre-registers a minimum effect size, so success is not merely "grounded > ungrounded"', () => {
    expect(MIN_RELATIVE_REDUCTION).toBeGreaterThan(0);
    expect(MIN_RELATIVE_REDUCTION).toBeLessThan(1);
    expect(ACCEPTANCE_RULES.success.join(' ')).toContain(String(MIN_RELATIVE_REDUCTION));
  });

  it('declares the analysis exploratory and refuses generalisation', () => {
    expect(STATISTICAL_TREATMENT.status).toMatch(/EXPLORATORY/);
    expect(STATISTICAL_TREATMENT.independence).toMatch(/VIOLATED/);
    expect(STATISTICAL_TREATMENT.generalisation).toMatch(/NONE/);
  });

  it('specifies the blinded human protocol without executing it', () => {
    expect(HUMAN_RATING_PROTOCOL.minRaters).toBeGreaterThanOrEqual(2);
    expect(HUMAN_RATING_PROTOCOL.blinding).toMatch(/hidden/i);
    expect(HUMAN_RATING_PROTOCOL.reliability).toMatch(/alpha/i);
    expect(HUMAN_RATING_PROTOCOL.missingRatings).toMatch(/never imputed/i);
  });

  it('forbids excluding a pair for being unfavourable', () => {
    expect(EXCLUSION_RULES.join(' ')).toMatch(/No pair may be excluded for producing an unfavourable result/);
  });

  it('embeds no results in the protocol', () => {
    const src = readFileSync(PROTOCOL_SRC, 'utf8');
    expect(src).not.toMatch(/\bobservedUCCR\b|\bresultValue\b|\bmeasuredDelta\b/);
    expect(src).toMatch(/NO RESULTS ARE STORED HERE/);
  });
});

describe('DT-C2 scorer — metric primitives', () => {
  it('(11) respects metric directionality declarations', () => {
    expect(getMetric('M-P1-unsupported-claim-rate').direction).toBe('lower-is-better');
    expect(getMetric('M-S1-grounded-fact-utilisation').direction).toBe('higher-is-better');
  });

  it('(8) boundary values: full and zero utilisation', () => {
    const refs = referenceValues(RICH, WL);
    expect(refs.length).toBeGreaterThan(0);
    expect(groundedFactUtilisation(SYNTHETIC_ALL_FACTS, refs)).toBe(1);
    expect(groundedFactUtilisation(SYNTHETIC_NO_FACTS, refs)).toBe(0);
  });

  it('(7) empty and whitespace-only outputs are invalid, not zero-scored', () => {
    expect(outputValidity(SYNTHETIC_EMPTY)).toBe(0);
    expect(outputValidity(SYNTHETIC_WHITESPACE)).toBe(0);
    expect(groundedFactUtilisation(SYNTHETIC_EMPTY, ['x'])).toBe('pending');
    expect(groundedFactUtilisation(SYNTHETIC_WHITESPACE, ['x'])).toBe('pending');
  });

  it('an empty reference set is not_applicable, never 0', () => {
    expect(groundedFactUtilisation(SYNTHETIC_NO_FACTS, [])).toBe('not_applicable');
  });

  it('entity fidelity: correct name scores 1, foreign name scores 0, no name is not_applicable', () => {
    const name = RICH.profile.name as string;
    expect(entityIdentityFidelity(`About ${name} today`, name, FOREIGN)).toBe(1);
    expect(entityIdentityFidelity(SYNTHETIC_FOREIGN, name, FOREIGN)).toBe(0);
    expect(entityIdentityFidelity(SYNTHETIC_NO_FACTS, name, FOREIGN)).toBe('not_applicable');
  });
});

describe('DT-C2 scorer — paired scoring branches', () => {
  const pair = (o: PairedOutputs) => scorePair(WL, RICH, o, FOREIGN);
  const m = (s: ReturnType<typeof scorePair>, id: string) => s.metrics.find((x) => x.metricId === id)!;

  it('(1) grounded clearly better on the screening metric', () => {
    const s = pair({ groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_NO_FACTS });
    const gfu = m(s, 'M-S1-grounded-fact-utilisation');
    expect(gfu.delta).toBeGreaterThan(0);
  });

  it('(2) ungrounded clearly better on the screening metric', () => {
    const s = pair({ groundedText: SYNTHETIC_NO_FACTS, ungroundedText: SYNTHETIC_ALL_FACTS });
    expect(m(s, 'M-S1-grounded-fact-utilisation').delta).toBeLessThan(0);
  });

  it('(3) an exact tie yields delta 0 and is counted as a tie, never as success', () => {
    const s = pair({ groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_ALL_FACTS });
    expect(m(s, 'M-S1-grounded-fact-utilisation').delta).toBe(0);
    const agg = aggregate([s]);
    const row = agg.metrics.find((x) => x.metricId === 'M-S1-grounded-fact-utilisation')!;
    expect(row.ties).toBe(1);
    expect(agg.outcome).toBeNull();
  });

  it('(4) missing grounded output → invalid, reason recorded, metrics pending not 0', () => {
    const s = pair({ groundedText: null, ungroundedText: SYNTHETIC_ALL_FACTS });
    expect(s.validity).toBe('invalid');
    expect(s.invalidReason).toMatch(/grounded arm produced no output/);
    expect(m(s, 'M-S1-grounded-fact-utilisation').grounded).toBe('pending');
    expect(m(s, 'M-S1-grounded-fact-utilisation').delta).toBeNull();
  });

  it('(5) missing ungrounded output → invalid with its own reason', () => {
    const s = pair({ groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: null });
    expect(s.validity).toBe('invalid');
    expect(s.invalidReason).toMatch(/ungrounded arm produced no output/);
  });

  it('(6) malformed / non-string output is handled without throwing', () => {
    const s = pair({ groundedText: undefined as unknown as string, ungroundedText: SYNTHETIC_NO_FACTS });
    expect(s.validity).toBe('invalid');
    expect(m(s, 'M-S3-output-validity').grounded).toBe(0);
  });

  it('both arms absent is recorded, not discarded', () => {
    const s = pair({ groundedText: null, ungroundedText: null });
    expect(s.validity).toBe('invalid');
    expect(s.invalidReason).toMatch(/both arms produced no output/);
    expect(aggregate([s]).exclusions).toHaveLength(1);
  });

  it('the PRIMARY endpoint is pending until human ratings are supplied', () => {
    const s = pair({ groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_NO_FACTS });
    const p = m(s, PRIMARY_METRIC);
    expect(p.grounded).toBe('pending');
    expect(p.ungrounded).toBe('pending');
    expect(p.delta).toBeNull();
    expect(p.reason).toBe('PENDING — REQUIRES HUMAN/EXTERNAL EVALUATION');
    expect(s.validity).toBe('partial');
  });

  it('accepts supplied blinded human ratings without inventing them', () => {
    const s = pair({
      groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_NO_FACTS,
      humanRatings: { [PRIMARY_METRIC]: { grounded: 0.1, ungrounded: 0.6 } },
    });
    const p = m(s, PRIMARY_METRIC);
    expect(p.grounded).toBe(0.1);
    expect(p.delta).toBeCloseTo(-0.5, 6);
    expect(s.validity).toBe('valid');
  });

  it('carries the protocol version + fingerprint on every scored pair', () => {
    const s = pair({ groundedText: 'a', ungroundedText: 'b' });
    expect(s.protocol.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(s.protocol.protocolFingerprint).toBe(protocolFingerprint());
    expect(s.subject.armGrounded).toBe('canonical');
    expect(s.subject.armUngrounded).toBe('ungrounded');
  });

  it('an entry with no profile yields not_applicable, never a fabricated 0', () => {
    const s = scorePair(WL, NONE, { groundedText: SYNTHETIC_NO_FACTS, ungroundedText: SYNTHETIC_NO_FACTS }, FOREIGN);
    expect(m(s, 'M-S1-grounded-fact-utilisation').grounded).toBe('not_applicable');
  });
});

describe('DT-C2 scorer — engineering invariants', () => {
  it('(9) repeated scoring is byte-identical', () => {
    const o: PairedOutputs = { groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_NO_FACTS };
    const a = JSON.stringify(scorePair(WL, RICH, o, FOREIGN));
    const b = JSON.stringify(scorePair(WL, RICH, o, FOREIGN));
    expect(a).toBe(b);
  });

  it('(10) aggregation counts valid, partial, invalid and pending correctly', () => {
    const scores = [
      scorePair(WL, RICH, { groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_NO_FACTS }, FOREIGN),
      scorePair(WL, RICH, { groundedText: null, ungroundedText: SYNTHETIC_NO_FACTS }, FOREIGN),
    ];
    const agg = aggregate(scores);
    expect(agg.totalPairs).toBe(2);
    expect(agg.invalidPairs).toBe(1);
    expect(agg.partialPairs).toBe(1);
    expect(agg.primaryEndpointPending).toBe(true);
    expect(agg.outcome).toBeNull();
    const primary = agg.metrics.find((x) => x.metricId === PRIMARY_METRIC)!;
    expect(primary.pairsScored).toBe(0);
    expect(primary.medianGrounded).toBeNull();
  });

  it('(12) does not mutate its inputs', () => {
    const entryBefore = JSON.stringify(RICH);
    const wlBefore = JSON.stringify(WL);
    const outputs: PairedOutputs = { groundedText: SYNTHETIC_ALL_FACTS, ungroundedText: SYNTHETIC_NO_FACTS };
    const outBefore = JSON.stringify(outputs);
    scorePair(WL, RICH, outputs, FOREIGN);
    expect(JSON.stringify(RICH)).toBe(entryBefore);
    expect(JSON.stringify(WL)).toBe(wlBefore);
    expect(JSON.stringify(outputs)).toBe(outBefore);
  });

  it('is pure: no I/O, no network, no clock, no database', () => {
    const src = readFileSync(SCORER_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/writeFileSync|readFileSync|createWriteStream/);
    expect(code).not.toMatch(/fetch\(|axios|http:|https:/);
    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\)|Math\.random\(\)/);
    expect(code).not.toMatch(/supabase|ownedDbTable|\.insert\(|\.upsert\(/);
    expect(code).not.toMatch(/openai|anthropic/i);
  });

  it('contains no dataset-specific exceptions', () => {
    const src = readFileSync(SCORER_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // No hard-coded entry ids, fixture company names, or workload keys.
    expect(code).not.toMatch(/eval-\d\d-/);
    expect(code).not.toMatch(/FintechCo|MartechCo|HealthtechCo|CybersecurityCo|LogisticsCo|EcommerceCo/);
    expect(code).not.toMatch(/'content_generation'|'campaign_planning'|'bolt'/);
  });

  it('produces no efficacy verdict', () => {
    const agg = aggregate([scorePair(WL, RICH, { groundedText: 'a', ungroundedText: 'b' }, FOREIGN)]);
    expect(agg.outcome).toBeNull();
    expect(agg).not.toHaveProperty('success');
    expect(agg).not.toHaveProperty('verdict');
  });
});
