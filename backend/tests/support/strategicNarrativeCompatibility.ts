/**
 * Strategic Narrative Compatibility Harness (PRODUCT-IMPLEMENTATION-001, Phase 5).
 *
 * Executable compatibility guarantees for Strategic Recommendation Intelligence.
 * PRODUCT-QUALITY-001 established that `campaign_angle` is a **control token**, not
 * display text — downstream systems pattern-match on it to assign execution stages
 * and classify blog angles. This harness converts those assumptions into gates.
 *
 * ── DESIGNED FOR REUSE ───────────────────────────────────────────────────────
 * A future narrative-quality package does NOT write new compatibility tests. It
 * passes its candidate producer to `runNarrativeCompatibilitySuite(candidate)` and
 * inherits every contract below. That is the point: future packages get smaller.
 *
 *     import { runNarrativeCompatibilitySuite } from '../support/strategicNarrativeCompatibility';
 *     it('candidate preserves all contracts', () => {
 *       runNarrativeCompatibilitySuite(myCandidateProducer);
 *     });
 *
 * This file contains NO product logic and changes NO runtime behaviour. It is not
 * collected by jest (not `*.test.ts`).
 */
import { createHash } from 'crypto';
import { sequenceRecommendations } from '../../services/recommendationSequencingService';
import { deriveAngleType } from '../../../lib/content/cardToContentBridgeSignals';
import { enrichRecommendationIntelligence } from '../../services/strategicRecommendationIntelligenceService';
import type { CompanyProfile } from '../../services/companyProfileService';

// ── Types ────────────────────────────────────────────────────────────────────

export type NarrativeRecommendation = Record<string, unknown> & { topic: string };

/** Any producer with the canonical enrichment signature (the real one, or a candidate). */
export type NarrativeProducer = (
  recommendations: NarrativeRecommendation[],
  profile: CompanyProfile | null,
) => Array<Record<string, unknown>>;

export interface StrategicIntelligenceShape {
  problem_being_solved: string | null;
  gap_being_filled: string | null;
  why_now: string | null;
  authority_reason: string | null;
  expected_transformation: string | null;
  campaign_angle: string | null;
}

export interface NarrativeCase {
  id: string;
  profile: CompanyProfile | null;
  recs: NarrativeRecommendation[];
}

/** The canonical field set, in canonical serialization order. */
export const STRATEGIC_FIELDS = [
  'problem_being_solved',
  'gap_being_filled',
  'why_now',
  'authority_reason',
  'expected_transformation',
  'campaign_angle',
] as const;

/** Fields that must always be non-null when a profile is present. */
export const ALWAYS_ON_FIELDS = STRATEGIC_FIELDS.filter((f) => f !== 'authority_reason');

/** Tokens that flip `deriveAngleType` away from 'analytical'. Introducing any of
 *  these into `campaign_angle` silently changes generated blog angle type. */
export const ANGLE_TYPE_TRIGGER_TOKENS = [
  'contrarian', 'challenge', 'myth', 'wrong',   // → 'contrarian'
  'strategic', 'lever', 'outcome', 'decision', 'roi', // → 'strategic'
] as const;

/** The current, intended classification of every produced angle. */
export const EXPECTED_ANGLE_TYPE = 'analytical';

/** The pinned execution-stage distribution over the canonical corpus (the
 *  compatibility reference). A candidate producer must reproduce it exactly. */
export const REFERENCE_STAGE_DISTRIBUTION: Readonly<Record<string, number>> = Object.freeze({
  education: 60, authority: 60, conversion: 60,
});

// ── Canonical corpus (shared with PRODUCT-VALIDATION-001 / QUALITY-001) ──────

const INDUSTRIES = [
  ['SaaS', 'RevOps leaders', 'fragmented revenue tooling', 'a unified pipeline view', 'revenue operations'],
  ['fintech', 'CFOs at scaleups', 'manual reconciliation overhead', 'continuous close', 'financial controls'],
  ['healthcare', 'clinic administrators', 'patient no-show losses', 'predictable scheduling', 'care operations'],
  ['e-commerce', 'DTC founders', 'rising acquisition costs', 'profitable repeat purchase', 'retention marketing'],
  ['manufacturing', 'plant managers', 'unplanned downtime', 'predictive maintenance', 'industrial IoT'],
  ['education', 'academic directors', 'low course completion', 'sustained learner progress', 'learning design'],
  ['legal', 'managing partners', 'billable leakage', 'transparent matter economics', 'legal operations'],
  ['real estate', 'brokerage owners', 'inconsistent lead follow-up', 'a reliable conversion engine', 'property marketing'],
  ['hospitality', 'hotel GMs', 'channel commission erosion', 'direct booking growth', 'guest experience'],
  ['logistics', 'fleet directors', 'empty-mile waste', 'optimized load matching', 'supply chain analytics'],
] as const;
const MATURITY = ['early', 'growth', 'established'] as const;

/** All four polish-flag combinations that occur in production, plus the empty case. */
export const FLAG_SETS = [
  { diamond_candidate: true, authority_elevated: true, is_generic_reframed: false },
  { diamond_candidate: true, authority_elevated: false, is_generic_reframed: false },
  { diamond_candidate: false, authority_elevated: true, is_generic_reframed: false },
  { diamond_candidate: false, authority_elevated: false, is_generic_reframed: true },
  { diamond_candidate: false, authority_elevated: false, is_generic_reframed: false },
] as const;

function makeProfile(i: number, m: number, rich: boolean): CompanyProfile {
  const [industry, audience, problem, transformation, authority] = INDUSTRIES[i];
  const maturity = MATURITY[m];
  const base: Record<string, unknown> = {
    industry, target_audience: audience, core_problem_statement: problem, desired_transformation: transformation,
  };
  if (rich) {
    Object.assign(base, {
      pain_symptoms: [`${problem} across teams`, 'no single source of truth'],
      life_with_problem: `constant firefighting around ${problem}`,
      life_after_solution: transformation,
      campaign_focus: `${industry} ${maturity}-stage growth`,
      content_themes: `${authority}, ${industry} strategy`,
      awareness_gap: `how ${transformation} compounds over time`,
      authority_domains: maturity === 'early' ? [] : [authority],
      ideal_customer_profile: audience,
    });
  } else {
    Object.assign(base, { authority_domains: maturity === 'established' ? [authority] : [] });
  }
  return base as unknown as CompanyProfile;
}

function makeRecs(i: number): NarrativeRecommendation[] {
  const [industry, , problem, , authority] = INDUSTRIES[i];
  const topics = [
    `${authority} benchmarks`, `${industry} cost control`, `reducing ${problem}`,
    `${industry} automation`, `${authority} playbook`,
  ];
  return topics.map((t, k) => ({
    topic: t,
    polished_title: t.replace(/\b\w/g, (c) => c.toUpperCase()),
    volume: [100, 80, 40, 20, 5][k],
    diamond_score: [0.9, 0.7, 0.4, 0.2, 0.1][k],
    frequency: [3, 1, 2, 1, 1][k],
    sources: [['a', 'b', 'c'], ['a'], ['a', 'b'], ['a'], ['a']][k],
    polish_flags: { ...FLAG_SETS[k] },
  }));
}

/** The canonical evaluation corpus: 10 industries × 3 maturity × rich/sparse = 60 cases, 300 cards. */
export function buildNarrativeCorpus(): NarrativeCase[] {
  const cases: NarrativeCase[] = [];
  for (let i = 0; i < INDUSTRIES.length; i++) {
    for (let m = 0; m < MATURITY.length; m++) {
      for (const rich of [true, false]) {
        cases.push({
          id: `${INDUSTRIES[i][0]}/${MATURITY[m]}/${rich ? 'rich' : 'sparse'}`,
          profile: makeProfile(i, m, rich),
          recs: makeRecs(i),
        });
      }
    }
  }
  return cases;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const intelligenceOf = (row: Record<string, unknown>): StrategicIntelligenceShape =>
  row.intelligence as unknown as StrategicIntelligenceShape;

const flagsOf = (rec: NarrativeRecommendation) =>
  (rec.polish_flags ?? {}) as { diamond_candidate?: boolean; authority_elevated?: boolean; is_generic_reframed?: boolean };

export const hashOf = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

/** The production producer — the default subject and the compatibility reference. */
export const currentNarrativeProducer: NarrativeProducer = enrichRecommendationIntelligence as NarrativeProducer;

// ── Contract checks ──────────────────────────────────────────────────────────

/**
 * CONTRACT 1 — `campaign_angle` token contract.
 * "Conversion" must appear **iff** `diamond_candidate`, because
 * `recommendationSequencingService` matches `.includes('conversion')` to assign the
 * `conversion` execution stage. Also pins the funnel shape and total flag coverage.
 */
export function checkCampaignAngleTokenContract(producer: NarrativeProducer) {
  let checked = 0;
  const flagCombosSeen = new Set<string>();
  for (const c of buildNarrativeCorpus()) {
    const out = producer(c.recs.map((r) => ({ ...r })), c.profile);
    out.forEach((row, k) => {
      const angle = intelligenceOf(row).campaign_angle ?? '';
      const flags = flagsOf(c.recs[k]);
      flagCombosSeen.add(JSON.stringify(flags));
      expect(typeof angle).toBe('string');
      expect(angle.length).toBeGreaterThan(0);            // no missing combination
      expect(angle).toContain('→');                        // funnel shape preserved
      // the load-bearing biconditional
      expect(/conversion/i.test(angle)).toBe(Boolean(flags.diamond_candidate));
      checked++;
    });
  }
  // every production flag combination was exercised
  expect(flagCombosSeen.size).toBe(FLAG_SETS.length);
  return { checked, flagCombosCovered: flagCombosSeen.size };
}

/**
 * CONTRACT 2 — angle classification.
 * `deriveAngleType` pattern-matches trigger words; introducing one silently changes
 * generated blog angle type. Every angle must classify as `expected` (today
 * 'analytical') and contain no trigger token.
 */
export function checkAngleClassificationContract(
  producer: NarrativeProducer,
  expected: string = EXPECTED_ANGLE_TYPE,
) {
  const classes: Record<string, number> = {};
  let checked = 0;
  for (const c of buildNarrativeCorpus()) {
    for (const row of producer(c.recs.map((r) => ({ ...r })), c.profile)) {
      const angle = intelligenceOf(row).campaign_angle ?? '';
      const lower = angle.toLowerCase();
      for (const token of ANGLE_TYPE_TRIGGER_TOKENS) expect(lower).not.toContain(token);
      const cls = deriveAngleType(angle);
      classes[cls] = (classes[cls] ?? 0) + 1;
      expect(cls).toBe(expected);
      checked++;
    }
  }
  return { checked, classes };
}

/**
 * CONTRACT 3 — execution-stage parity.
 * The stage distribution a producer induces must equal the pinned reference.
 */
export function checkSequencingStageParity(
  producer: NarrativeProducer,
  reference: Readonly<Record<string, number>> = REFERENCE_STAGE_DISTRIBUTION,
) {
  const stages: Record<string, number> = {};
  for (const c of buildNarrativeCorpus()) {
    const enriched = producer(c.recs.map((r) => ({ ...r })), c.profile);
    const withIntel = c.recs.map((r, k) => ({ ...r, intelligence: intelligenceOf(enriched[k]) }));
    for (const rung of sequenceRecommendations(withIntel as never, null).ladder) {
      stages[rung.stage] = (stages[rung.stage] ?? 0) + 1;
    }
  }
  expect(stages).toEqual(reference);
  return { stages };
}

/**
 * CONTRACT 4 — `authority_reason` nullability.
 * Non-null-ness is load-bearing: `recommendationSequencingService` promotes a card
 * to the `authority` stage when it is a non-empty string.
 */
export function checkAuthorityReasonContract(producer: NarrativeProducer) {
  let nullCases = 0; let valueCases = 0;
  for (const c of buildNarrativeCorpus()) {
    const out = producer(c.recs.map((r) => ({ ...r })), c.profile);
    out.forEach((row, k) => {
      const value = intelligenceOf(row).authority_reason;
      const flags = flagsOf(c.recs[k]);
      const domains = (c.profile as unknown as { authority_domains?: unknown[] } | null)?.authority_domains ?? [];
      const eligible = Boolean(flags.authority_elevated) && Array.isArray(domains) && domains.length > 0;
      if (eligible) {
        expect(typeof value).toBe('string');
        expect(String(value).length).toBeGreaterThan(0);
        valueCases++;
      } else {
        expect(value).toBeNull();
        nullCases++;
      }
    });
  }
  expect(nullCases).toBeGreaterThan(0);
  expect(valueCases).toBeGreaterThan(0);
  return { nullCases, valueCases };
}

/**
 * CONTRACT 5 — determinism. Identical corpus, N runs: identical values, identical
 * hash, identical ordering. No randomness, no clock, no ambient state.
 */
export function checkDeterminism(producer: NarrativeProducer, runs = 3) {
  const corpus = buildNarrativeCorpus();
  const snapshots: string[] = [];
  const orderings: string[] = [];
  for (let r = 0; r < runs; r++) {
    const all = corpus.map((c) => producer(c.recs.map((x) => ({ ...x })), c.profile).map(intelligenceOf));
    snapshots.push(hashOf(all));
    orderings.push(hashOf(corpus.map((c, ci) =>
      producer(c.recs.map((x) => ({ ...x })), c.profile).map((row, k) => `${ci}:${k}:${String((row as { topic?: string }).topic ?? '')}`))));
  }
  expect(new Set(snapshots).size).toBe(1);   // identical outputs + identical hash
  expect(new Set(orderings).size).toBe(1);   // identical ordering
  return { runs, hash: snapshots[0], orderingHash: orderings[0] };
}

/**
 * CONTRACT 6 — schema / serialization backward compatibility.
 * Exact property names, exact key count, nullability, and stable JSON key order.
 */
export function checkSchemaContract(producer: NarrativeProducer) {
  let checked = 0;
  for (const c of buildNarrativeCorpus()) {
    for (const row of producer(c.recs.map((r) => ({ ...r })), c.profile)) {
      const intel = intelligenceOf(row) as unknown as Record<string, unknown>;
      const keys = Object.keys(intel);                              // insertion order — do NOT mutate
      expect([...keys].sort()).toEqual([...STRATEGIC_FIELDS].sort()); // exact property names, no extras
      expect(keys).toEqual([...STRATEGIC_FIELDS]);                   // canonical key ORDER is stable
      for (const f of ALWAYS_ON_FIELDS) {
        expect(typeof intel[f]).toBe('string');                     // non-nullable in practice
        expect(String(intel[f]).length).toBeGreaterThan(0);
      }
      const auth = intel.authority_reason;
      expect(auth === null || typeof auth === 'string').toBe(true);  // nullable by contract
      // serialization round-trips without loss or reordering
      const json = JSON.stringify(intel);
      expect(JSON.parse(json)).toEqual(intel);
      expect(Object.keys(JSON.parse(json))).toEqual(keys);
      // the enriched row preserves the source recommendation's own fields
      expect(row).toHaveProperty('topic');
      checked++;
    }
  }
  return { checked };
}

// ── Aggregate entry point ────────────────────────────────────────────────────

export interface CompatibilityReport {
  cases: number;
  cards: number;
  angleTokenChecked: number;
  angleClasses: Record<string, number>;
  stages: Record<string, number>;
  authorityNullCases: number;
  authorityValueCases: number;
  determinismRuns: number;
  outputHash: string;
  schemaChecked: number;
}

/**
 * Run EVERY compatibility contract against a producer. A future narrative-quality
 * package calls this with its candidate and inherits all guarantees — no new
 * compatibility tests required.
 */
export function runNarrativeCompatibilitySuite(
  producer: NarrativeProducer = currentNarrativeProducer,
  opts: { expectedAngleType?: string; stageReference?: Readonly<Record<string, number>>; determinismRuns?: number } = {},
): CompatibilityReport {
  const corpus = buildNarrativeCorpus();
  const angle = checkCampaignAngleTokenContract(producer);
  const cls = checkAngleClassificationContract(producer, opts.expectedAngleType ?? EXPECTED_ANGLE_TYPE);
  const seq = checkSequencingStageParity(producer, opts.stageReference ?? REFERENCE_STAGE_DISTRIBUTION);
  const auth = checkAuthorityReasonContract(producer);
  const det = checkDeterminism(producer, opts.determinismRuns ?? 3);
  const schema = checkSchemaContract(producer);
  return {
    cases: corpus.length,
    cards: corpus.reduce((s, c) => s + c.recs.length, 0),
    angleTokenChecked: angle.checked,
    angleClasses: cls.classes,
    stages: seq.stages,
    authorityNullCases: auth.nullCases,
    authorityValueCases: auth.valueCases,
    determinismRuns: det.runs,
    outputHash: det.hash,
    schemaChecked: schema.checked,
  };
}
