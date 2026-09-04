/**
 * P2B — firmographics can actually reach `prospect_accounts`.
 *
 * The persistence mechanism is LI-2's boundary, not a new one. These tests pin
 * the two things that make that work: the normalisers produce values a jsonb /
 * numeric / timestamptz column will accept, and the boundary's rules apply to
 * the new attributes exactly as they already do to the old ones.
 *
 * The most important assertion is architectural — that P2B added NO second
 * writer. `resolveOrCreateAccount` still writes identity only.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  toAccountAttributes,
  normalizeAnnualRevenue,
  normalizeFoundedYear,
  normalizeTechnologies,
  normalizeInstant,
  ACCOUNT_ATTRIBUTE_COLUMNS,
} from '../../services/prospectIdentity/attributes';
import { decideCanonicalUpdates } from '../../services/prospectIdentity/ingestionBoundary';

const ACCOUNT_RESOLUTION_SRC = readFileSync(
  join(__dirname, '../../services/prospectIdentity/accountResolution.ts'), 'utf8');

describe('P2B — annual revenue', () => {
  it('accepts a number and a provider string alike', () => {
    expect(normalizeAnnualRevenue(1_250_000)).toBe(1_250_000);
    expect(normalizeAnnualRevenue('1250000')).toBe(1_250_000);
  });

  it('keeps fractions — revenue is not a headcount', () => {
    expect(normalizeAnnualRevenue(1250000.5)).toBe(1250000.5);
  });

  it('accepts zero as a stateable fact', () => {
    expect(normalizeAnnualRevenue(0)).toBe(0);
  });

  it('refuses a negative figure rather than clamping it to zero', () => {
    // Clamping would assert "revenue is 0", which the provider never said.
    expect(normalizeAnnualRevenue(-1)).toBeNull();
  });

  it.each([[''], [null], [undefined], ['not-a-number'], [Infinity], [NaN]])('drops unusable input (%s)', (v) => {
    expect(normalizeAnnualRevenue(v as never)).toBeNull();
  });
});

describe('P2B — founded year', () => {
  it.each([[1800], [2015], [2200], ['2015']])('accepts an in-range year (%s)', (v) => {
    expect(normalizeFoundedYear(v as never)).toBe(Number(v));
  });

  it.each([[1799], [2201], [20150], [1_700_000_000]])('drops an out-of-range value (%s)', (v) => {
    // A timestamp or row number reaching this field is a parsing artefact, and
    // the column's CHECK would reject it anyway.
    expect(normalizeFoundedYear(v)).toBeNull();
  });

  it('refuses a fractional year', () => {
    expect(normalizeFoundedYear(2015.5)).toBeNull();
  });
});

describe('P2B — technologies become jsonb-safe text', () => {
  it('serialises an array to JSON, not to a comma string', () => {
    // String(['a','b']) is 'a,b' — not JSON, and the column CHECK would reject it.
    expect(normalizeTechnologies(['postgres', 'nextjs'])).toBe('["postgres","nextjs"]');
  });

  it('the result survives String() unchanged — the boundary stringifies everything', () => {
    const normalised = normalizeTechnologies(['postgres']);
    expect(String(normalised)).toBe('["postgres"]');
    expect(JSON.parse(String(normalised))).toEqual(['postgres']);
  });

  it('trims, drops blanks and de-duplicates', () => {
    expect(normalizeTechnologies([' postgres ', 'postgres', '', '   ', 'nextjs']))
      .toBe('["postgres","nextjs"]');
  });

  it('preserves an empty list — "we looked and found none" is a fact', () => {
    expect(normalizeTechnologies([])).toBe('[]');
  });

  it('accepts a JSON array string from a provider', () => {
    expect(normalizeTechnologies('["postgres"]')).toBe('["postgres"]');
  });

  it.each([['{"a":1}'], ['"postgres"'], ['42'], ['not json'], ['']])('refuses non-array input (%s)', (v) => {
    expect(normalizeTechnologies(v)).toBeNull();
  });

  it('drops non-string entries rather than coercing them', () => {
    expect(normalizeTechnologies([1, null, 'postgres'] as never)).toBe('["postgres"]');
  });
});

describe('P2B — last funding instant', () => {
  it('normalises to UTC ISO so two offsets do not look like disagreement', () => {
    // LI-2 WITHHOLDS an attribute whose sources disagree, so an unnormalised
    // offset difference would suppress a fact both providers actually agree on.
    const a = normalizeInstant('2026-01-01T00:00:00Z');
    const b = normalizeInstant('2026-01-01T05:30:00+05:30');
    expect(a).toBe(b);
    expect(a).toBe('2026-01-01T00:00:00.000Z');
  });

  it.each([[''], ['not-a-date'], [null], [undefined]])('drops unparseable input (%s)', (v) => {
    expect(normalizeInstant(v as never)).toBeNull();
  });
});

describe('P2B — the whole account shape', () => {
  it('normalises every firmographic in one pass', () => {
    const out = toAccountAttributes({
      industry: ' SaaS ', employeeCount: '250', employeeBand: '201-500',
      countryCode: 'gb', region: ' London ', city: 'London', description: 'x',
      annualRevenue: '12500000', revenueBand: ' $10M-$50M ', foundedYear: '2015',
      technologies: ['postgres', 'postgres'], fundingStage: ' Series B ',
      lastFundingAt: '2026-01-01T00:00:00Z',
    });
    expect(out.annualRevenue).toBe(12_500_000);
    expect(out.revenueBand).toBe('$10M-$50M');
    expect(out.foundedYear).toBe(2015);
    expect(out.technologies).toBe('["postgres"]');
    expect(out.fundingStage).toBe('Series B');
    expect(out.lastFundingAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('invents nothing when the provider says nothing', () => {
    const out = toAccountAttributes({});
    for (const v of Object.values(out)) expect(v).toBeNull();
  });

  it('imposes no vocabulary on revenueBand or fundingStage', () => {
    const out = toAccountAttributes({ revenueBand: 'ARR 10-50M', fundingStage: 'bootstrapped' });
    expect(out.revenueBand).toBe('ARR 10-50M');
    expect(out.fundingStage).toBe('bootstrapped');
  });
});

describe('P2B — the boundary rules apply unchanged to the new attributes', () => {
  const cols = [...ACCOUNT_ATTRIBUTE_COLUMNS];

  it('RULE A — one uncontested value is applied', () => {
    const out = decideCanonicalUpdates(
      { annual_revenue: null, technologies: null },
      [{ attribute: 'annual_revenue', normalized_value: '12500000', id: 'a1' },
       { attribute: 'technologies', normalized_value: '["postgres"]', id: 'a2' }],
      cols,
    );
    expect(out.apply.map((a) => a.attribute).sort()).toEqual(['annual_revenue', 'technologies']);
    expect(out.apply.every((a) => a.reason === 'single_uncontested_assertion')).toBe(true);
  });

  it('RULE B — disagreeing sources write nothing', () => {
    const out = decideCanonicalUpdates(
      { funding_stage: null },
      [{ attribute: 'funding_stage', normalized_value: 'Series A', id: 'a1' },
       { attribute: 'funding_stage', normalized_value: 'Series B', id: 'a2' }],
      cols,
    );
    expect(out.apply).toHaveLength(0);
    expect(out.withhold[0]).toMatchObject({ attribute: 'funding_stage', reason: 'sources_disagree' });
  });

  it('RULE C — an existing canonical value is never overwritten', () => {
    const out = decideCanonicalUpdates(
      { founded_year: 2015 },
      [{ attribute: 'founded_year', normalized_value: '1999', id: 'a1' }],
      cols,
    );
    expect(out.apply).toHaveLength(0);
    expect(out.withhold[0]).toMatchObject({ attribute: 'founded_year', reason: 'canonical_value_already_set' });
  });

  it('a column outside the account surface is never written', () => {
    const out = decideCanonicalUpdates(
      { valuation: null },
      [{ attribute: 'valuation', normalized_value: '1000000', id: 'a1' }],
      cols,
    );
    expect(out.apply).toHaveLength(0);
    expect(out.withhold).toHaveLength(0);
  });
});

describe('P2B — NO second persistence mechanism was created', () => {
  it('resolveOrCreateAccount still writes identity columns only', () => {
    const insertBlock = ACCOUNT_RESOLUTION_SRC.slice(
      ACCOUNT_RESOLUTION_SRC.indexOf('const row = {'),
      ACCOUNT_RESOLUTION_SRC.indexOf('.insert(row)'),
    );
    for (const col of ['industry', 'employee_count', 'employee_band', 'annual_revenue',
      'revenue_band', 'founded_year', 'technologies', 'funding_stage', 'last_funding_at']) {
      expect(insertBlock).not.toContain(`${col}:`);
    }
  });

  it('accountResolution imports no attribute normaliser — LI-2 owns that', () => {
    expect(ACCOUNT_RESOLUTION_SRC).not.toContain('toAccountAttributes');
    expect(ACCOUNT_RESOLUTION_SRC).not.toContain('ACCOUNT_ATTRIBUTE_COLUMNS');
  });

  it('the account surface still carries no identity column', () => {
    for (const c of ACCOUNT_ATTRIBUTE_COLUMNS) {
      expect(['name', 'legal_name', 'domain_normalized', 'website_url', 'source', 'source_reference'])
        .not.toContain(c);
    }
  });
});
