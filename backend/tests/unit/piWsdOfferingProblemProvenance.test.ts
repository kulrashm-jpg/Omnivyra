/**
 * PI Lane B — a stated problem stays distinguishable from a symptom.
 *
 * `customerProblems` flattens `core_problem_statement` and `pain_symptoms` into one array. The flat
 * shape is pinned by `piWsdOfferingActivation.test.ts` and is not changed here: the facet contract
 * takes a flat list, and a caller that does not care about the distinction must keep working
 * untouched. What was lost was the provenance of each element — and a caller that cannot tell a
 * problem from a symptom of one will eventually quote a symptom back as the problem it solves.
 *
 * `problemProvenance` records that alongside the flat array. These tests pin both halves: the flat
 * value shape is unchanged, and the split is recoverable from the derived result without re-reading
 * the profile row.
 *
 * Offline and deterministic: the one table read is an injected port.
 */

import {
  buildTenantOfferingContext,
  offeringSeedsFromProfile,
  readTenantOfferingUnderstanding,
  type TenantOfferingContextPorts,
  type TenantOfferingProfileRow,
  type TenantProblemProvenance,
} from '../../services/offeringIntelligence';

const ASOF = '2026-09-23T00:00:00.000Z';
const TENANT = 'org-1';

const STATED = 'teams act on numbers nobody can trace';
const SYMPTOMS = ['dashboards disagree', 'no audit trail'];

const profile = (over: Partial<TenantOfferingProfileRow> = {}): TenantOfferingProfileRow => ({
  products_services_list: ['Signal Desk', 'Onboarding Sprint'],
  core_problem_statement: STATED,
  pain_symptoms: [...SYMPTOMS],
  ...over,
});

const portsFor = (row: TenantOfferingProfileRow | null): TenantOfferingContextPorts => ({
  async loadProfile() { return row; },
});

const originOf = (
  provenance: readonly TenantProblemProvenance[],
  problem: string,
): string | undefined => provenance.find((p) => p.problem === problem)?.origin;

describe('Lane B · the pain-point / symptom distinction is recoverable', () => {
  it('names the column each problem came from, in the flat array order', () => {
    const { problemProvenance } = offeringSeedsFromProfile(profile(), { organizationId: TENANT, asOf: ASOF });
    expect(problemProvenance).toEqual([
      { problem: STATED, origin: 'core_problem_statement' },
      { problem: 'dashboards disagree', origin: 'pain_symptoms' },
      { problem: 'no audit trail', origin: 'pain_symptoms' },
    ]);
  });

  it('leaves the flattened value shape and order exactly as they were', () => {
    const { seeds, problemProvenance } = offeringSeedsFromProfile(profile(), { organizationId: TENANT, asOf: ASOF });
    // The pinned shape: one flat string array, statement first, then the symptoms in column order.
    expect(seeds[0].customerProblems).toEqual([STATED, ...SYMPTOMS]);
    // And it is DERIVED from the classified list — one reading of the columns, not two that drift.
    expect(seeds[0].customerProblems).toEqual(problemProvenance.map((p) => p.problem));
    // Nothing was added to the seed to carry the distinction.
    expect(Object.keys(seeds[0])).not.toContain('problemProvenance');
    expect(Object.keys(seeds[0])).not.toContain('painPoints');
  });

  it('handles a symptom-only and a statement-only profile without inventing the other', () => {
    const symptomsOnly = offeringSeedsFromProfile(
      profile({ core_problem_statement: null }), { organizationId: TENANT, asOf: ASOF },
    );
    expect(symptomsOnly.problemProvenance.map((p) => p.origin)).toEqual(['pain_symptoms', 'pain_symptoms']);
    expect(symptomsOnly.seeds[0].customerProblems).toEqual(SYMPTOMS);

    const statementOnly = offeringSeedsFromProfile(
      profile({ pain_symptoms: [] }), { organizationId: TENANT, asOf: ASOF },
    );
    expect(statementOnly.problemProvenance).toEqual([{ problem: STATED, origin: 'core_problem_statement' }]);

    const neither = offeringSeedsFromProfile(
      profile({ core_problem_statement: null, pain_symptoms: [] }), { organizationId: TENANT, asOf: ASOF },
    );
    expect(neither.problemProvenance).toEqual([]);
    expect(neither.seeds[0].customerProblems).toBeUndefined();     // abstains, not an empty array
  });

  it('describes the profile, so a tenant that names no offering still reports its problems', () => {
    const noOffering = offeringSeedsFromProfile(
      profile({ products_services_list: [], products_services: null }), { organizationId: TENANT, asOf: ASOF },
    );
    expect(noOffering.seeds).toEqual([]);
    expect(noOffering.problemProvenance.map((p) => p.origin)).toEqual([
      'core_problem_statement', 'pain_symptoms', 'pain_symptoms',
    ]);
    // "We could not look" carries nothing to classify.
    expect(offeringSeedsFromProfile(null, { organizationId: TENANT, asOf: ASOF }).problemProvenance).toEqual([]);
  });
});

describe('Lane B · the provenance travels to the derived read surface', () => {
  it('classifies every portfolio problem, and stays deterministic', async () => {
    const built = (await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(profile())))!;
    expect(built.problemProvenance.map((p) => p.origin)).toEqual([
      'core_problem_statement', 'pain_symptoms', 'pain_symptoms',
    ]);
    const again = (await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(profile())))!;
    expect(JSON.stringify(built)).toBe(JSON.stringify(again));

    const sell = (await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(profile())))!;
    // Every problem the sell side offers Problem Fit can be traced to its column — without the row.
    expect(sell.portfolioProblems).toEqual([STATED, ...SYMPTOMS]);
    for (const p of sell.portfolioProblems) expect(originOf(sell.problemProvenance, p)).toBeDefined();
    expect(originOf(sell.problemProvenance, STATED)).toBe('core_problem_statement');
    expect(originOf(sell.problemProvenance, 'dashboards disagree')).toBe('pain_symptoms');
    // The per-offering flat array is unchanged, and still carries both kinds.
    expect(sell.offerings[0].customerProblems).toEqual([STATED, ...SYMPTOMS]);
  });

  it('records a symptom as a symptom even when it is the only thing the tenant stated', async () => {
    const sell = (await readTenantOfferingUnderstanding(
      { organizationId: TENANT, asOf: ASOF }, portsFor(profile({ core_problem_statement: null })),
    ))!;
    expect(sell.portfolioProblems).toEqual(SYMPTOMS);
    // A symptom must not be promoted to a stated problem just because no statement exists.
    expect(sell.problemProvenance.every((p) => p.origin === 'pain_symptoms')).toBe(true);
  });
});
