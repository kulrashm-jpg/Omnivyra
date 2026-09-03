/**
 * D1 — the tenant ICP model: contract 17 (vocabulary) and contract 18
 * (abstain, never default), plus the properties of the migration that the
 * TypeScript layer assumes but cannot itself enforce.
 *
 * These suites are PURE: no database, no clock, no network. The real-schema
 * suite (`backend/tests/realschema/d1_tenant_icp.test.ts`) proves the database
 * half against live PostgreSQL; the assertions here that read the migration
 * FILE prove only that the SQL says what this layer believes it says — which is
 * still worth proving, because a silent divergence between the two is exactly
 * how a partial unique index quietly becomes a total one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { combineDimension } from '../../services/intelligence/canonical/scoring';
import { EMPLOYEE_BANDS, SENIORITY_VALUES } from '../../services/prospectIdentity/attributes';
import {
  attributeKind, attributesFor, evaluateIcpFit, IcpContractError,
  MAX_CRITERIA, validateCriteria, validateCriterion,
} from '../../services/prospectIcp';
import type { IcpCriterion, RatifiedIcp } from '../../services/prospectIcp';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ICP_ID = '00000000-0000-4000-8000-0000000000c1';
const AS_OF = '2026-09-01T00:00:00.000Z';

/** Every criterion here goes through the REAL validator, so no test can use a
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

const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return e instanceof IcpContractError ? e.code : `unexpected:${String(e)}`; }
  return 'no_error';
};

// ───────────────────────────────────────────────────────────────────────────
describe('D1 contract 17 — criteria may use ONLY DB-enforced vocabularies', () => {
  it('accepts every value of the closed seniority vocabulary, and nothing else', () => {
    const ok = crit({
      id: 'sen', subject: 'person', attribute: 'seniority',
      predicate: { op: 'one_of', values: [...SENIORITY_VALUES] },
    });
    expect((ok.predicate as { values: string[] }).values.sort()).toEqual([...SENIORITY_VALUES].sort());

    // 'cxo' and 'c_level' are plausible and are NOT in the DB CHECK. The
    // evaluator would mark every real person unsatisfied against them forever.
    for (const bad of ['cxo', 'c_level', 'executive', 'CEO', 'Senior']) {
      expect(codeOf(() => crit({
        id: 'sen', subject: 'person', attribute: 'seniority',
        predicate: { op: 'one_of', values: [bad] },
      }))).toBe('value_outside_vocabulary');
    }
  });

  it('accepts every employee band the DB CHECK accepts, and nothing else', () => {
    expect(() => crit({
      id: 'band', attribute: 'employee_band',
      predicate: { op: 'one_of', values: [...EMPLOYEE_BANDS] },
    })).not.toThrow();

    // '10-50' and '51-250' are the bands a person would guess. Neither exists.
    for (const bad of ['10-50', '51-250', '1-10 employees', 'enterprise']) {
      expect(codeOf(() => crit({
        id: 'band', attribute: 'employee_band',
        predicate: { op: 'one_of', values: [bad] },
      }))).toBe('value_outside_vocabulary');
    }
  });

  it('country_code is ISO-3166-1 alpha-2 or nothing, normalised to upper case', () => {
    const ok = crit({
      id: 'geo', attribute: 'country_code',
      predicate: { op: 'one_of', values: ['gb', 'us', 'gb'] },
    });
    // Deduplicated and sorted, so two equivalent submissions store identically.
    expect((ok.predicate as { values: string[] }).values).toEqual(['GB', 'US']);

    for (const bad of ['United Kingdom', 'GBR', '826', 'U']) {
      expect(codeOf(() => crit({
        id: 'geo', attribute: 'country_code',
        predicate: { op: 'one_of', values: [bad] },
      }))).toBe('country_code_invalid');
    }
  });

  it('industry is EXACT MATCH ONLY — no contains, prefix, regex or fuzzy predicate', () => {
    expect(() => crit({
      id: 'ind', attribute: 'industry',
      predicate: { op: 'one_of', values: ['Software', 'Fintech'] },
    })).not.toThrow();

    for (const op of ['contains', 'like', 'prefix', 'matches', 'similar_to', 'not_one_of']) {
      expect(codeOf(() => crit({
        id: 'ind', attribute: 'industry',
        predicate: { op, values: ['software'] } as never,
      }))).toBe('predicate_not_permitted');
    }
  });

  it('the fields P2A left vocabulary-less get exact match and NOTHING is invented for them', () => {
    // The point is negative: no list of "valid" industries / revenue bands /
    // funding stages / regions exists anywhere in this module, so a tenant's
    // own provider label is accepted verbatim and nothing is refused for being
    // off a list D1 made up.
    for (const attribute of ['industry', 'revenue_band', 'funding_stage', 'region', 'city']) {
      expect(() => crit({
        id: 'x', attribute,
        predicate: { op: 'one_of', values: ['a wholly unexpected provider label'] },
      })).not.toThrow();
    }
    for (const attribute of ['department', 'job_title']) {
      expect(() => crit({
        id: 'x', subject: 'person', attribute,
        predicate: { op: 'one_of', values: ['Revenue Operations'] },
      })).not.toThrow();
    }
  });

  it('numeric attributes take ranges only; text attributes never take a range', () => {
    expect(() => crit({
      id: 'size', attribute: 'employee_count', predicate: { op: 'between', min: 50, max: 500 },
    })).not.toThrow();
    expect(() => crit({
      id: 'rev', attribute: 'annual_revenue', predicate: { op: 'at_least', value: 1_000_000 },
    })).not.toThrow();
    expect(() => crit({
      id: 'age', attribute: 'founded_year', predicate: { op: 'at_most', value: 2020 },
    })).not.toThrow();

    expect(codeOf(() => crit({
      id: 'size', attribute: 'employee_count', predicate: { op: 'one_of', values: ['100'] } as never,
    }))).toBe('predicate_not_permitted');
    expect(codeOf(() => crit({
      id: 'ind', attribute: 'industry', predicate: { op: 'between', min: 1, max: 2 } as never,
    }))).toBe('predicate_not_permitted');
  });

  it('an inverted or non-finite numeric range is refused, not silently clamped', () => {
    expect(codeOf(() => crit({
      id: 'size', attribute: 'employee_count', predicate: { op: 'between', min: 500, max: 50 },
    }))).toBe('range_inverted');
    expect(codeOf(() => crit({
      id: 'size', attribute: 'employee_count', predicate: { op: 'at_least', value: Number.NaN },
    }))).toBe('bound_not_finite');
    expect(codeOf(() => crit({
      id: 'size', attribute: 'employee_count', predicate: { op: 'at_least', value: '100' as never },
    }))).toBe('bound_not_finite');
  });

  it('technologies is an array attribute — membership predicates only', () => {
    expect(() => crit({
      id: 'tech', attribute: 'technologies', predicate: { op: 'includes_any', values: ['Salesforce'] },
    })).not.toThrow();
    expect(codeOf(() => crit({
      id: 'tech', attribute: 'technologies', predicate: { op: 'one_of', values: ['Salesforce'] } as never,
    }))).toBe('predicate_not_permitted');
  });

  it('the attribute surface is CLOSED — only real columns may be named', () => {
    // WS-6 added market/business_model/growth_stage; WS-7 added
    // authority/influence/buying_role. Every one is a real, writable column —
    // which is precisely what this test exists to enforce.
    expect(attributesFor('account')).toEqual([
      'annual_revenue', 'business_model', 'city', 'country_code', 'employee_band',
      'employee_count', 'founded_year', 'funding_stage', 'growth_stage', 'industry',
      'market', 'region', 'revenue_band', 'technologies',
    ]);
    expect(attributesFor('person')).toEqual([
      'authority', 'buying_role', 'city', 'country_code', 'department',
      'influence', 'job_title', 'region', 'seniority',
    ]);

    // An invented attribute would be permanently `unknown` and would read as a
    // data gap rather than the modelling error it is.
    // 'product_alignment' and 'problem_relevance' are in this list deliberately:
    // WS-6/WS-7 declined to add them because both are FIT concepts, not intrinsic
    // attributes, and an ICP matching a value the ICP produced is circular.
    for (const bad of ['mrr', 'headcount', 'arr', 'ideal_customer_profile', 'nps',
      'product_alignment', 'problem_relevance']) {
      expect(codeOf(() => crit({ id: 'x', attribute: bad }))).toBe('attribute_unknown');
    }
    // Subject scoping is real: seniority is a person attribute, not an account one.
    expect(attributeKind('account', 'seniority')).toBeNull();
    expect(attributeKind('person', 'seniority')).toBe('closed_vocabulary');
    expect(codeOf(() => crit({ id: 'x', subject: 'account', attribute: 'seniority' }))).toBe('attribute_unknown');
  });

  it('rejects malformed criteria shapes rather than coercing them', () => {
    expect(codeOf(() => validateCriterion('not an object'))).toBe('criterion_not_object');
    expect(codeOf(() => crit({ id: 'Bad Id' }))).toBe('criterion_id_invalid');
    expect(codeOf(() => crit({ id: 'k', kind: 'nice_to_have' as never }))).toBe('kind_invalid');
    expect(codeOf(() => crit({ id: 'k', subject: 'company' as never }))).toBe('subject_invalid');
    expect(codeOf(() => crit({
      id: 'k', predicate: { op: 'one_of', values: [] },
    }))).toBe('values_empty');
    expect(codeOf(() => crit({
      id: 'k', predicate: { op: 'one_of', values: ['  '] },
    }))).toBe('value_blank');
    expect(codeOf(() => crit({
      id: 'k', predicate: { op: 'one_of', values: [42 as never] },
    }))).toBe('value_not_string');
  });

  it('validateCriteria enforces unique ids, a ceiling, and deterministic order', () => {
    expect(codeOf(() => validateCriteria('nope'))).toBe('criteria_not_array');
    expect(validateCriteria([])).toEqual([]);   // an empty draft is legitimate

    const dup = [crit({ id: 'a' }), crit({ id: 'a' })];
    expect(codeOf(() => validateCriteria(dup))).toBe('criterion_id_duplicate');

    const sorted = validateCriteria([crit({ id: 'zulu' }), crit({ id: 'alpha' }), crit({ id: 'mike' })]);
    expect(sorted.map((c) => c.id)).toEqual(['alpha', 'mike', 'zulu']);

    const tooMany = Array.from({ length: MAX_CRITERIA + 1 }, (_, i) => crit({ id: `c${i}` }));
    expect(codeOf(() => validateCriteria(tooMany))).toBe('criteria_too_many');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 contract 18 — abstain, never default', () => {
  const industry = crit({ id: 'industry', attribute: 'industry', predicate: { op: 'one_of', values: ['Software'] } });
  const size = crit({ id: 'size', attribute: 'employee_count', predicate: { op: 'between', min: 50, max: 500 } });

  it('NO ratified ICP emits NO contribution — not 0, not 0.5, nothing', () => {
    const out = evaluateIcpFit({
      ratified: null,
      facts: { subject: 'account', attributes: { industry: 'Software', employee_count: 100 } },
      asOf: AS_OF,
    });

    expect(out.contributions).toEqual([]);      // the whole contract, in one line
    expect(out.abstained).toBe(true);
    expect(out.reason).toBe('no_ratified_icp');
    expect(out.icpId).toBeNull();
    expect(out.version).toBeNull();
    expect(out.evidence).toEqual([]);

    // Stated negatively too: no contribution carrying a neutral or zero value
    // was emitted, which is the specific failure this contract forbids.
    expect(out.contributions.some((c) => c.value === 0 || c.value === 0.5)).toBe(false);
  });

  it('conforms to the FROZEN combiner: no contribution ⇒ combineDimension abstains', () => {
    const none = evaluateIcpFit({
      ratified: null, facts: { subject: 'account', attributes: {} }, asOf: AS_OF,
    });
    const dim = combineDimension('icp', none.contributions);
    expect(dim.abstained).toBe(true);
    expect(dim.value).toBeNull();
    expect(dim.confidence).toBe(0);

    // ...and a real evaluation is USABLE by that same combiner, which requires
    // `value !== null` AND `evidence.length > 0`. Producing a contribution the
    // frozen combiner would silently discard would be worse than abstaining.
    const some = evaluateIcpFit({
      ratified: ratified([industry, size]),
      facts: { subject: 'account', attributes: { industry: 'Software', employee_count: 100 } },
      asOf: AS_OF,
    });
    const scored = combineDimension('icp', some.contributions);
    expect(scored.abstained).toBe(false);
    expect(scored.value).toBe(1);
    expect(scored.contributors).toEqual(['prospect_icp']);
  });

  it('a MISSING attribute makes the criterion `unknown` — never unsatisfied', () => {
    const out = evaluateIcpFit({
      ratified: ratified([industry, size]),
      // industry present and matching; headcount never enriched.
      facts: { subject: 'account', attributes: { industry: 'Software' } },
      asOf: AS_OF,
    });

    expect(out.unknown).toEqual(['size']);
    expect(out.unsatisfied).toEqual([]);
    expect(out.satisfied).toEqual(['industry']);
    // The unknown is excluded from the denominator: 1 of 1 EVALUABLE, not 1 of 2.
    expect(out.contributions[0].value).toBe(1);
    expect(out.results.find((r) => r.id === 'size')?.outcome).toBe('unknown');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace', '   '],
  ])('an attribute that is %s is unknown, not a failed match', (_label, value) => {
    const out = evaluateIcpFit({
      ratified: ratified([industry]),
      facts: { subject: 'account', attributes: { industry: value } },
      asOf: AS_OF,
    });
    expect(out.unknown).toEqual(['industry']);
    expect(out.unsatisfied).toEqual([]);
  });

  it('an empty technologies list is unknown — "we hold no list" is not "they use none"', () => {
    const tech = crit({
      id: 'tech', attribute: 'technologies', predicate: { op: 'includes_any', values: ['Salesforce'] },
    });
    const empty = evaluateIcpFit({
      ratified: ratified([tech]), facts: { subject: 'account', attributes: { technologies: [] } }, asOf: AS_OF,
    });
    expect(empty.abstained).toBe(true);
    expect(empty.reason).toBe('no_evaluable_criteria');
    expect(empty.contributions).toEqual([]);

    const held = evaluateIcpFit({
      ratified: ratified([tech]),
      facts: { subject: 'account', attributes: { technologies: ['HubSpot', 'Salesforce'] } },
      asOf: AS_OF,
    });
    expect(held.satisfied).toEqual(['tech']);
  });

  it('EVERY criterion unknown ⇒ abstain outright, with no contribution', () => {
    const out = evaluateIcpFit({
      ratified: ratified([industry, size]),
      facts: { subject: 'account', attributes: {} },
      asOf: AS_OF,
    });
    expect(out.abstained).toBe(true);
    expect(out.reason).toBe('no_evaluable_criteria');
    expect(out.contributions).toEqual([]);
    expect(out.unknown.sort()).toEqual(['industry', 'size']);
    // The ICP is still named, so an explanation can say WHICH profile abstained.
    expect(out.icpId).toBe(ICP_ID);
    expect(out.version).toBe(3);
  });

  it('a ratified ICP with no criteria for this subject abstains rather than scoring a perfect fit', () => {
    const personOnly = crit({
      id: 'sen', subject: 'person', attribute: 'seniority',
      predicate: { op: 'one_of', values: ['vp'] },
    });
    const out = evaluateIcpFit({
      ratified: ratified([personOnly]),
      facts: { subject: 'account', attributes: { industry: 'Software' } },
      asOf: AS_OF,
    });
    expect(out.reason).toBe('no_criteria_for_subject');
    expect(out.contributions).toEqual([]);
    expect(out.abstained).toBe(true);
  });

  it('EVERY contribution carries an EvidenceRef naming (icp_id, version), as evidence[0]', () => {
    const out = evaluateIcpFit({
      ratified: ratified([industry, size]),
      facts: { subject: 'account', attributes: { industry: 'Software', employee_count: 100 } },
      asOf: AS_OF,
    });

    expect(out.contributions).toHaveLength(1);
    for (const contribution of out.contributions) {
      expect(contribution.evidence.length).toBeGreaterThan(0);
      const [versionRef] = contribution.evidence;
      expect(versionRef.label).toBe('icp_version');
      // Both coordinates are present, and in the durable id as well as the value.
      expect(versionRef.id).toContain(ICP_ID);
      expect(versionRef.id).toContain('v3');
      expect(versionRef.value).toBe(`${ICP_ID}@v3`);
      expect(versionRef.source.ref).toBe(`${ICP_ID}@v3`);
      // Every criterion reference is bound to the same version too, so a single
      // stored evidence item is enough to resolve the profile that produced it.
      for (const ev of contribution.evidence) expect(ev.source.ref).toBe(`${ICP_ID}@v3`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 — fit derivation (deterministic, kind-aware)', () => {
  const mandatory = crit({
    id: 'geo', kind: 'mandatory', attribute: 'country_code',
    predicate: { op: 'one_of', values: ['GB'] },
  });
  const optional = crit({
    id: 'ind', kind: 'optional', attribute: 'industry',
    predicate: { op: 'one_of', values: ['Software'] },
  });

  it('an UNSATISFIED mandatory criterion forces the value to 0 — but still contributes', () => {
    const out = evaluateIcpFit({
      ratified: ratified([mandatory, optional]),
      facts: { subject: 'account', attributes: { country_code: 'FR', industry: 'Software' } },
      asOf: AS_OF,
    });
    expect(out.contributions[0].value).toBe(0);
    expect(out.reason).toBe('mandatory_unsatisfied');
    // 0 here is a CLAIM backed by evidence ("we checked, they are in France"),
    // which is categorically different from the abstention above.
    expect(out.abstained).toBe(false);
    expect(out.unsatisfied).toEqual(['geo']);
  });

  it('an UNKNOWN mandatory criterion does NOT force zero — absence is not failure', () => {
    const out = evaluateIcpFit({
      ratified: ratified([mandatory, optional]),
      facts: { subject: 'account', attributes: { industry: 'Software' } },
      asOf: AS_OF,
    });
    expect(out.unknown).toEqual(['geo']);
    expect(out.contributions[0].value).toBe(1);
    expect(out.reason).toBe('evaluated');
  });

  it('confidence tracks COVERAGE, so a verdict from fewer criteria is held more weakly', () => {
    const three = [
      crit({ id: 'a', attribute: 'industry', predicate: { op: 'one_of', values: ['Software'] } }),
      crit({ id: 'b', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
      crit({ id: 'c', attribute: 'region', predicate: { op: 'one_of', values: ['England'] } }),
    ];
    const full = evaluateIcpFit({
      ratified: ratified(three),
      facts: { subject: 'account', attributes: { industry: 'Software', city: 'London', region: 'England' } },
      asOf: AS_OF,
    });
    const thin = evaluateIcpFit({
      ratified: ratified(three),
      facts: { subject: 'account', attributes: { industry: 'Software' } },
      asOf: AS_OF,
    });
    expect(full.contributions[0].value).toBe(thin.contributions[0].value);   // same verdict
    expect(full.contributions[0].confidence).toBe(1);
    expect(thin.contributions[0].confidence).toBeCloseTo(0.6667, 4);
    expect(thin.contributions[0].confidence).toBeLessThan(full.contributions[0].confidence);
  });

  it('matching is EXACT — a near miss is a miss, never a partial credit', () => {
    const out = evaluateIcpFit({
      ratified: ratified([optional]),
      // 'Software Training' is a different market. A `contains` predicate would
      // have called this a match; contract 17 does not permit one.
      facts: { subject: 'account', attributes: { industry: 'Software Training' } },
      asOf: AS_OF,
    });
    expect(out.unsatisfied).toEqual(['ind']);
    expect(out.contributions[0].value).toBe(0);
  });

  it('person fit and account fit are two EVALUATIONS of the ONE ICP', () => {
    const icp = ratified([
      crit({ id: 'ind', attribute: 'industry', predicate: { op: 'one_of', values: ['Software'] } }),
      crit({
        id: 'sen', subject: 'person', attribute: 'seniority',
        predicate: { op: 'one_of', values: ['vp', 'c_suite'] },
      }),
    ]);

    const account = evaluateIcpFit({
      ratified: icp, facts: { subject: 'account', attributes: { industry: 'Software' } }, asOf: AS_OF,
    });
    const person = evaluateIcpFit({
      ratified: icp, facts: { subject: 'person', attributes: { seniority: 'vp' } }, asOf: AS_OF,
    });

    // Each evaluation sees ONLY its own subject's criteria...
    expect(account.results.map((r) => r.id)).toEqual(['ind']);
    expect(person.results.map((r) => r.id)).toEqual(['sen']);
    // ...and both cite the SAME icp_id and version, because there is one ICP.
    expect(account.icpId).toBe(person.icpId);
    expect(account.version).toBe(person.version);
  });

  it('is deterministic and reads no clock — identical inputs give identical output', () => {
    const icp = ratified([
      crit({ id: 'b', attribute: 'industry', predicate: { op: 'one_of', values: ['Software'] } }),
      crit({ id: 'a', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
    ]);
    const facts = { subject: 'account' as const, attributes: { industry: 'Software', city: 'Leeds' } };
    const first = evaluateIcpFit({ ratified: icp, facts, asOf: AS_OF });
    const second = evaluateIcpFit({ ratified: icp, facts, asOf: AS_OF });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.results.map((r) => r.id)).toEqual(['a', 'b']);   // sorted by id
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 — the migration states what the TypeScript layer assumes', () => {
  const root = join(__dirname, '..', '..', '..');
  const sql = readFileSync(
    join(root, 'supabase', 'migrations', '20261012000000_d1_tenant_icp_model.sql'), 'utf8',
  );

  /**
   * The DDL with `--` comments stripped.
   *
   * The migration is a long-form design document, and its prose deliberately
   * QUOTES the shapes it refuses — `company_profiles`' `company_id text`, and
   * the `effective_from` / `effective_until` columns v1 does not have. An
   * assertion about what the schema DOES must therefore read the statements,
   * not the explanation of why they are written that way.
   */
  const ddl = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('the tenant column is uuid with a REAL FK to companies, ON DELETE CASCADE — on BOTH tables', () => {
    const fks = ddl.match(
      /organization_id\s+uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/g,
    );
    expect(fks).toHaveLength(2);
    // The company_profiles anti-pattern is not reproduced in any statement.
    expect(ddl).not.toMatch(/company_id\s+text/);
  });

  it('the one-active-version rule is a PARTIAL UNIQUE index — so ON CONFLICT cannot infer it', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_icp_versions_one_ratified[\s\S]*?WHERE status = 'ratified'/,
    );
  });

  it('identity is (organization_id, icp_id, version), with companion (id, organization_id) indexes', () => {
    expect(sql).toMatch(/uq_prospect_icp_versions_identity[\s\S]*?\(organization_id, icp_id, version\)/);
    expect(sql).toMatch(/uq_prospect_icps_id_org[\s\S]*?\(id, organization_id\)/);
    expect(sql).toMatch(/uq_prospect_icp_versions_id_org[\s\S]*?\(id, organization_id\)/);
  });

  it('the reference to the ICP object is a tenant-safe COMPOSITE foreign key', () => {
    expect(sql).toMatch(
      /FOREIGN KEY \(icp_id, organization_id\)\s*\n?\s*REFERENCES public\.prospect_icps \(id, organization_id\) ON DELETE CASCADE/,
    );
  });

  it('a ratified version is made immutable by a trigger, not by convention', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_prospect_icp_versions_immutable/);
    expect(sql).toMatch(/BEFORE UPDATE ON public\.prospect_icp_versions/);
    expect(sql).toMatch(/prospect_icp_versions_guard_immutable/);
  });

  it('a draft or proposed version can never carry a ratifier', () => {
    expect(sql).toMatch(
      /prospect_icp_versions_ratification_coherent[\s\S]*?status IN \('draft', 'proposed'\) AND ratified_at IS NULL AND ratified_by IS NULL/,
    );
  });

  it('there is NO effective-period concept in v1', () => {
    expect(ddl).not.toMatch(/\beffective_from\b/);
    expect(ddl).not.toMatch(/\beffective_until\b/);
    // The prose still explains the omission — that is where it belongs.
    expect(sql).toMatch(/NO effective-period concept in v1/);
  });

  it('RLS is enabled on both tables, and is documented as NOT the tenant boundary', () => {
    expect(sql).toMatch(/ALTER TABLE public\.prospect_icps\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.prospect_icp_versions ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/RLS IS NOT THE TENANT BOUNDARY HERE/);
  });

  it('carries a fail-closed preflight and a postcondition assertion', () => {
    expect(sql).toMatch(/\$preflight\$/);
    expect(sql).toMatch(/\$verify\$/);
    expect(sql).toMatch(/must be empty on arrival/);
  });

  it('a real rollback file exists and refuses to run without an explicit acknowledgement', () => {
    const rollback = readFileSync(
      join(root, 'supabase', 'migrations', 'rollbacks', 'd1_tenant_icp_model_rollback.sql'), 'utf8',
    );
    expect(rollback).toMatch(/d1\.confirm_drop_prospect_icp/);
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.prospect_icp_versions/);
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.prospect_icps/);
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.prospect_icp_versions_guard_immutable/);
  });
});
