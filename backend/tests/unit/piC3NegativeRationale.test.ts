/**
 * PI-WP-C3 — the negative rationale.
 *
 * The evaluator has always been careful not to score a prospect on our own data
 * gaps. What it could not do was SAY SO: `unknown` covered both "nobody ever
 * enriched this company" and "a provider handed us a country called 'United
 * Kingdom' and we refused it", and neither was distinguishable from the score
 * simply being low. A console rendering that surface has no honest way to
 * answer "why not", and the answer it invents is almost always the same wrong
 * one — that the evidence is against the prospect.
 *
 * These suites prove FIVE states stay separable, that none of them can be
 * reached from absence, and — the part that matters most — that adding them
 * changed no score. The rationale is derived from the same readings the score
 * was derived from and is never read back, so a failure here is a failure of
 * EXPLANATION, never of scoring.
 *
 * PURE: no database, no clock, no network, no flag.
 */

import {
  evaluateIcpFit, ICP_RATIONALE_STATES, isMinorityCoverage, validateCriterion,
} from '../../services/prospectIcp';
import type {
  IcpCriterion, IcpFitEvaluation, IcpRationaleState, RatifiedIcp,
} from '../../services/prospectIcp';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ICP_ID = '00000000-0000-4000-8000-0000000000c1';
const AS_OF = '2026-09-01T00:00:00.000Z';

/** Every criterion goes through the REAL validator — no fixture can use a
 *  criterion the platform would refuse to store. */
const crit = (over: Partial<IcpCriterion> & Pick<IcpCriterion, 'id'>): IcpCriterion =>
  validateCriterion({
    kind: 'required', subject: 'account', attribute: 'industry',
    predicate: { op: 'one_of', values: ['Software'] },
    ...over,
  });

const ratified = (criteria: IcpCriterion[]): RatifiedIcp => ({
  organizationId: ORG,
  icpId: ICP_ID,
  icpKey: 'default',
  version: 3,
  criteria,
  ratifiedAt: '2026-08-01T00:00:00.000Z',
  ratifiedBy: 'user-1',
});

const evalAccount = (criteria: IcpCriterion[], attributes: Record<string, unknown>): IcpFitEvaluation =>
  evaluateIcpFit({ ratified: ratified(criteria), facts: { subject: 'account', attributes }, asOf: AS_OF });

// The reusable criteria. `industry` is exact text, `geo` is the mandatory gate.
const industry = crit({ id: 'industry', attribute: 'industry', predicate: { op: 'one_of', values: ['Software'] } });
const size = crit({ id: 'size', attribute: 'employee_count', predicate: { op: 'between', min: 50, max: 500 } });
const geo = crit({
  id: 'geo', kind: 'mandatory', attribute: 'country_code', predicate: { op: 'one_of', values: ['GB'] },
});
const tech = crit({
  id: 'tech', attribute: 'technologies', predicate: { op: 'includes_any', values: ['Salesforce'] },
});

const stateOf = (e: IcpFitEvaluation): IcpRationaleState => e.rationale.state;
const criterion = (e: IcpFitEvaluation, id: string) => e.rationale.criteria.find((c) => c.id === id);

// ───────────────────────────────────────────────────────────────────────────
describe('PI-WP-C3 — the five states are genuinely different states', () => {
  it('explicit NEGATIVE EVIDENCE: we looked, and the observed value does not match', () => {
    const out = evalAccount([industry], { industry: 'Mining' });

    expect(stateOf(out)).toBe('negative_evidence');
    expect(out.rationale.negativeEvidence).toEqual(['industry']);
    expect(criterion(out, 'industry')?.basis).toBe('observed');
    expect(criterion(out, 'industry')?.state).toBe('negative_evidence');
    // A real claim, backed by a real observation — so it DOES score.
    expect(out.abstained).toBe(false);
    expect(out.contributions[0].value).toBe(0);
  });

  it('MISSING EVIDENCE: we hold nothing, and that is not a negative', () => {
    const out = evalAccount([industry], {});

    expect(stateOf(out)).toBe('no_evidence');
    expect(out.rationale.missingEvidence).toEqual(['industry']);
    expect(out.rationale.negativeEvidence).toEqual([]);
    expect(criterion(out, 'industry')?.basis).toBe('absent');
    expect(criterion(out, 'industry')?.state).toBe('no_evidence');
    // Nothing is claimed, so nothing is contributed.
    expect(out.abstained).toBe(true);
    expect(out.contributions).toEqual([]);
  });

  it('UNKNOWN: we hold something, and it cannot be interpreted', () => {
    // A provider that returns a country NAME where an ISO alpha-2 code belongs.
    // We looked, we received something, and we refuse to guess what it means.
    const out = evalAccount([geo], { country_code: 'United Kingdom' });

    expect(stateOf(out)).toBe('uninterpretable');
    expect(out.rationale.uninterpretable).toEqual(['geo']);
    expect(out.rationale.missingEvidence).toEqual([]);
    expect(out.rationale.negativeEvidence).toEqual([]);
    expect(criterion(out, 'geo')?.basis).toBe('unreadable');
    expect(out.abstained).toBe(true);
  });

  it('SUPPRESSED: a mandatory criterion was observed and failed', () => {
    const out = evalAccount([geo, industry], { country_code: 'FR', industry: 'Software' });

    expect(stateOf(out)).toBe('suppressed');
    expect(out.rationale.suppressedBy).toEqual(['geo']);
    expect(criterion(out, 'geo')?.suppressing).toBe(true);
    expect(criterion(out, 'industry')?.suppressing).toBe(false);
    // The suppressing criterion is ALSO negative evidence — it was observed.
    expect(out.rationale.contributing).toContain('negative_evidence');
    // Distinguishable from a merely low score: the value is forced, not derived.
    expect(out.contributions[0].value).toBe(0);
    expect(out.satisfied).toEqual(['industry']);
  });

  it('INSUFFICIENT CONFIDENCE: evidence exists, but the verdict rests on too little', () => {
    const four = [
      industry,
      crit({ id: 'city', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
      crit({ id: 'region', attribute: 'region', predicate: { op: 'one_of', values: ['England'] } }),
      crit({ id: 'market', attribute: 'market', predicate: { op: 'one_of', values: ['SMB'] } }),
    ];
    const out = evalAccount(four, { industry: 'Software' });

    expect(stateOf(out)).toBe('insufficient_confidence');
    expect(out.rationale.coverage).toEqual({ evaluable: 1, total: 4 });
    // The verdict itself is positive; it is the WEIGHT that is insufficient.
    expect(out.contributions[0].value).toBe(1);
    expect(out.rationale.negativeEvidence).toEqual([]);
  });

  it('every one of the five states is reachable, and they are all distinct', () => {
    const reached = [
      stateOf(evalAccount([industry], { industry: 'Mining' })),
      stateOf(evalAccount([industry], {})),
      stateOf(evalAccount([geo], { country_code: 'United Kingdom' })),
      stateOf(evalAccount([geo, industry], { country_code: 'FR', industry: 'Software' })),
      stateOf(evalAccount([industry, size, geo], { industry: 'Software' })),
    ];
    expect(new Set(reached).size).toBe(5);
    expect(reached.sort()).toEqual([
      'insufficient_confidence', 'negative_evidence', 'no_evidence', 'suppressed', 'uninterpretable',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-WP-C3 — absence never becomes a negative', () => {
  it.each([
    ['a missing key', {}],
    ['null', { industry: null }],
    ['undefined', { industry: undefined }],
    ['an empty string', { industry: '' }],
    ['whitespace', { industry: '   ' }],
  ])('%s is `no_evidence` with basis `absent` — never `negative_evidence`', (_label, attributes) => {
    const out = evalAccount([industry], attributes);

    expect(criterion(out, 'industry')?.state).toBe('no_evidence');
    expect(criterion(out, 'industry')?.basis).toBe('absent');
    expect(out.rationale.negativeEvidence).toEqual([]);
    expect(out.rationale.contributing).not.toContain('negative_evidence');
    expect(out.rationale.statement).not.toMatch(/not satisfy/);
  });

  it.each([
    ['a headcount that is not a number', size, { employee_count: 'lots' }],
    ['a fractional headcount', size, { employee_count: 12.5 }],
    ['a negative headcount', size, { employee_count: -4 }],
    ['a country name where a code belongs', geo, { country_code: 'United Kingdom' }],
    ['a three-letter country code', geo, { country_code: 'GBR' }],
    ['a boolean where text belongs', industry, { industry: true }],
    ['an unparseable technology list', tech, { technologies: '{not json' }],
  ])('%s is `uninterpretable`, never `negative_evidence`', (_label, c, attributes) => {
    const out = evalAccount([c], attributes);

    expect(criterion(out, c.id)?.state).toBe('uninterpretable');
    expect(criterion(out, c.id)?.basis).toBe('unreadable');
    expect(out.rationale.negativeEvidence).toEqual([]);
    expect(out.unsatisfied).toEqual([]);
  });

  it('an EMPTY technology list is `uninterpretable` with its own basis — not absence, not a negative', () => {
    const out = evalAccount([tech], { technologies: [] });

    // We DO hold a list, so this is not `absent`; it holds nothing to test a
    // membership predicate against, so it is not an answer either.
    expect(criterion(out, 'tech')?.basis).toBe('empty');
    expect(criterion(out, 'tech')?.state).toBe('uninterpretable');
    expect(out.rationale.negativeEvidence).toEqual([]);

    // ...and it is a DIFFERENT record from holding no list at all.
    const none = evalAccount([tech], {});
    expect(criterion(none, 'tech')?.basis).toBe('absent');
    expect(criterion(none, 'tech')?.state).toBe('no_evidence');
  });

  it('`negative_evidence` is reachable ONLY from an observed value', () => {
    const fixtures: Array<Record<string, unknown>> = [
      {}, { industry: null }, { industry: '' }, { industry: true },
      { industry: 'Software' }, { industry: 'Mining' },
    ];
    for (const attributes of fixtures) {
      const out = evalAccount([industry], attributes);
      const c = criterion(out, 'industry');
      if (c?.state === 'negative_evidence') {
        expect(c.basis).toBe('observed');
        expect(c.outcome).toBe('unsatisfied');
      }
      // Stated the other way: an unobserved criterion is never negative.
      if (c?.basis !== 'observed') expect(c?.state).not.toBe('negative_evidence');
    }
  });

  it('NO RATIFIED ICP is `not_applicable` — a gap in the PROFILE, not in the prospect', () => {
    const out = evaluateIcpFit({
      ratified: null,
      facts: { subject: 'account', attributes: { industry: 'Software', employee_count: 100 } },
      asOf: AS_OF,
    });

    // Emphatically NOT `no_evidence`: we hold plenty of evidence here. There is
    // simply no profile to judge it against.
    expect(stateOf(out)).toBe('not_applicable');
    expect(out.rationale.criteria).toEqual([]);
    expect(out.rationale.negativeEvidence).toEqual([]);
    expect(out.rationale.missingEvidence).toEqual([]);
    expect(out.rationale.statement).toContain('no_ratified_icp');
  });

  it('NO CRITERIA FOR THIS SUBJECT is `not_applicable`, and names the reason', () => {
    const personOnly = crit({
      id: 'sen', subject: 'person', attribute: 'seniority', predicate: { op: 'one_of', values: ['vp'] },
    });
    const out = evalAccount([personOnly], { industry: 'Software' });

    expect(stateOf(out)).toBe('not_applicable');
    expect(out.rationale.statement).toContain('no_criteria_for_subject');
    expect(out.rationale.coverage).toEqual({ evaluable: 0, total: 0 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-WP-C3 — the suppression invariant is UNCHANGED', () => {
  it('an unsatisfied mandatory criterion still forces 0 and still contributes', () => {
    const out = evalAccount([geo, industry], { country_code: 'FR', industry: 'Software' });

    expect(out.contributions[0].value).toBe(0);
    expect(out.reason).toBe('mandatory_unsatisfied');
    expect(out.abstained).toBe(false);
    expect(out.unsatisfied).toEqual(['geo']);
    // Suppression outranks the positive: `industry` passed and is reported as
    // passed, and the score is 0 anyway.
    expect(out.satisfied).toEqual(['industry']);
    expect(stateOf(out)).toBe('suppressed');
  });

  it('an UNKNOWN mandatory criterion still does not force zero — and is labelled, not blamed', () => {
    const out = evalAccount([geo, industry], { industry: 'Software' });

    // The scoring invariant, untouched.
    expect(out.contributions[0].value).toBe(1);
    expect(out.reason).toBe('evaluated');
    expect(out.unknown).toEqual(['geo']);

    // The rationale says the gate was never run, which is the honest reading —
    // and it must NOT say the prospect failed it.
    expect(out.rationale.unevaluableMandatory).toEqual(['geo']);
    expect(out.rationale.suppressedBy).toEqual([]);
    expect(out.rationale.negativeEvidence).toEqual([]);
    expect(criterion(out, 'geo')?.suppressing).toBe(false);
    expect(stateOf(out)).toBe('insufficient_confidence');
  });

  it('the score is re-derivable from `results` alone, with the rationale deleted', () => {
    const fixtures: Array<[IcpCriterion[], Record<string, unknown>]> = [
      [[industry], { industry: 'Software' }],
      [[industry], { industry: 'Mining' }],
      [[geo, industry], { country_code: 'FR', industry: 'Software' }],
      [[geo, industry], { country_code: 'GB', industry: 'Mining' }],
      [[industry, size], { industry: 'Software', employee_count: 100 }],
      [[industry, size], { industry: 'Software', employee_count: 5 }],
      [[geo, industry, size], { industry: 'Software' }],
    ];

    for (const [criteria, attributes] of fixtures) {
      const out = evalAccount(criteria, attributes);
      if (out.abstained) continue;

      const mandatoryFailed = out.results.some((r) => r.kind === 'mandatory' && r.outcome === 'unsatisfied');
      const evaluable = out.satisfied.length + out.unsatisfied.length;
      const expected = mandatoryFailed ? 0 : out.satisfied.length / evaluable;

      // The formula the module documents, computed WITHOUT consulting the
      // rationale. If the rationale had leaked into scoring this would drift.
      expect(out.contributions[0].value).toBe(expected);
      expect(out.contributions[0].confidence).toBeCloseTo(0.5 + 0.5 * (evaluable / out.results.length), 4);
    }
  });

  it('`insufficient_confidence` is a LABEL — it never alters value or confidence', () => {
    const three = [
      industry,
      crit({ id: 'city', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
      crit({ id: 'region', attribute: 'region', predicate: { op: 'one_of', values: ['England'] } }),
    ];
    const thin = evalAccount(three, { industry: 'Software' });
    const full = evalAccount(three, { industry: 'Software', city: 'London', region: 'England' });

    expect(thin.contributions[0].value).toBe(full.contributions[0].value);      // same verdict
    expect(thin.contributions[0].confidence).toBeCloseTo(0.6667, 4);            // unchanged formula
    expect(full.contributions[0].confidence).toBe(1);
    // 1 of 3 is a minority; 3 of 3 is not.
    expect(isMinorityCoverage(1, 3)).toBe(true);
    expect(isMinorityCoverage(3, 3)).toBe(false);
    expect(stateOf(thin)).toBe('insufficient_confidence');
    expect(stateOf(full)).toBe('satisfied');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-WP-C3 — no reason is invented, and the same evidence gives the same reason', () => {
  const many = [industry, size, geo, tech];
  const attributes = { industry: 'Mining', employee_count: 'lots', technologies: [] };

  it('every id in the rationale is a real criterion of this evaluation', () => {
    const out = evalAccount(many, attributes);
    const ids = new Set(out.results.map((r) => r.id));

    const named = [
      ...out.rationale.negativeEvidence, ...out.rationale.missingEvidence,
      ...out.rationale.uninterpretable, ...out.rationale.suppressedBy,
      ...out.rationale.unevaluableMandatory, ...out.rationale.criteria.map((c) => c.id),
    ];
    for (const id of named) expect(ids.has(id)).toBe(true);
  });

  it('the rationale partitions the outcomes exactly — nothing added, nothing dropped', () => {
    const out = evalAccount(many, attributes);

    expect(out.rationale.criteria.map((c) => c.id)).toEqual(out.results.map((r) => r.id));
    expect(out.rationale.negativeEvidence).toEqual(out.unsatisfied);
    expect([...out.rationale.missingEvidence, ...out.rationale.uninterpretable].sort())
      .toEqual([...out.unknown].sort());
    // Every unknown is on exactly ONE side of the missing/uninterpretable split.
    const overlap = out.rationale.missingEvidence.filter((id) => out.rationale.uninterpretable.includes(id));
    expect(overlap).toEqual([]);
    expect(out.rationale.coverage.evaluable).toBe(out.satisfied.length + out.unsatisfied.length);
    expect(out.rationale.coverage.total).toBe(out.results.length);
  });

  it('a statement mentions a criterion only when that criterion produced it', () => {
    const out = evalAccount([industry, size], { industry: 'Mining' });

    // `industry` was observed and failed; `size` was never observed. The
    // negative statement must name the first and NOT the second.
    expect(out.rationale.statement).toContain('industry');
    expect(out.rationale.statement).not.toContain('size');
    expect(criterion(out, 'size')?.statement).toContain('not a negative');
    expect(criterion(out, 'industry')?.statement).toContain('does not satisfy');
  });

  it('is deterministic — identical inputs give a byte-identical rationale', () => {
    const first = evalAccount(many, attributes);
    const second = evalAccount(many, attributes);
    expect(JSON.stringify(first.rationale)).toBe(JSON.stringify(second.rationale));
    // ...and criterion records follow the evaluator's own id ordering.
    expect(first.rationale.criteria.map((c) => c.id)).toEqual(['geo', 'industry', 'size', 'tech']);
  });

  it('`contributing` is non-empty, ordered by declared precedence, and led by `state`', () => {
    const fixtures: IcpFitEvaluation[] = [
      evalAccount([industry], { industry: 'Mining' }),
      evalAccount([industry], {}),
      evalAccount([geo], { country_code: 'United Kingdom' }),
      evalAccount([geo, industry], { country_code: 'FR', industry: 'Software' }),
      evalAccount(many, attributes),
      evalAccount([industry], { industry: 'Software' }),
      evaluateIcpFit({ ratified: null, facts: { subject: 'account', attributes: {} }, asOf: AS_OF }),
    ];

    for (const out of fixtures) {
      const { contributing, state } = out.rationale;
      expect(contributing.length).toBeGreaterThan(0);
      expect(contributing[0]).toBe(state);
      const ranks = contributing.map((s) => ICP_RATIONALE_STATES.indexOf(s));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(new Set(contributing).size).toBe(contributing.length);
    }
  });

  it('a thin AND unflattering verdict reports the thinness first, but hides neither', () => {
    // 1 of 4 evaluable, and that one failed. Announcing "the evidence says no"
    // would overstate a verdict built on a quarter of the profile.
    const out = evalAccount([industry, size, tech, geo], { industry: 'Mining' });

    expect(stateOf(out)).toBe('insufficient_confidence');
    expect(out.rationale.contributing).toEqual(['insufficient_confidence', 'negative_evidence']);
    expect(out.rationale.negativeEvidence).toEqual(['industry']);
  });

  it('the PERSON subject is explained by the same rules as the ACCOUNT subject', () => {
    const seniority = crit({
      id: 'sen', subject: 'person', attribute: 'seniority', predicate: { op: 'one_of', values: ['vp'] },
    });
    const icp = ratified([seniority]);

    const missing = evaluateIcpFit({ ratified: icp, facts: { subject: 'person', attributes: {} }, asOf: AS_OF });
    const wrong = evaluateIcpFit({
      ratified: icp, facts: { subject: 'person', attributes: { seniority: 'manager' } }, asOf: AS_OF,
    });

    expect(stateOf(missing)).toBe('no_evidence');
    expect(stateOf(wrong)).toBe('negative_evidence');
    expect(missing.rationale.criteria[0].subject).toBe('person');
  });
});
