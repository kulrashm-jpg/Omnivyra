/**
 * LI-1 — attribute contract lock.
 *
 * The failure this guards against is quiet fabrication: a normaliser that turns
 * "United Kingdom" into "UK", or an unrecognised seniority into 'other', would
 * put a value into the canonical spine that no source ever asserted. The tests
 * therefore assert hardest on what these functions REFUSE to do.
 */
import {
  SENIORITY_VALUES, EMPLOYEE_BANDS,
  PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS,
  normalizeDisplayText, normalizeCountryCode, normalizeEmployeeCount,
  isSeniority, isEmployeeBand, toPersonAttributes, toAccountAttributes,
} from '../../services/prospectIdentity/attributes';

describe('normalizeDisplayText', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeDisplayText('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(normalizeDisplayText('Head of\nEngineering')).toBe('Head of Engineering');
  });

  it('maps blank to null so the database never stores an empty attribute', () => {
    for (const blank of ['', '   ', '\t', '\n', null, undefined]) {
      expect(normalizeDisplayText(blank as string | null)).toBeNull();
    }
  });

  it('does not alter meaningful punctuation or case', () => {
    expect(normalizeDisplayText("O'Brien-Smith, Jr.")).toBe("O'Brien-Smith, Jr.");
    expect(normalizeDisplayText('VP, EMEA')).toBe('VP, EMEA');
  });

  it('is deterministic', () => {
    const input = '  Senior   Director ';
    expect(normalizeDisplayText(input)).toBe(normalizeDisplayText(input));
  });

  it('rejects non-strings rather than coercing them', () => {
    expect(normalizeDisplayText(42 as unknown as string)).toBeNull();
    expect(normalizeDisplayText({} as unknown as string)).toBeNull();
  });
});

describe('normalizeCountryCode', () => {
  it('accepts and upper-cases an ISO-3166-1 alpha-2 code', () => {
    expect(normalizeCountryCode('gb')).toBe('GB');
    expect(normalizeCountryCode(' us ')).toBe('US');
    expect(normalizeCountryCode('IN')).toBe('IN');
  });

  it('REFUSES to guess — a country name is not a code', () => {
    // The alternative is storing a plausible-but-wrong country, which is worse
    // than storing nothing. Mapping belongs in the provider adapter (LI-7).
    for (const bad of ['United Kingdom', 'England', 'GBR', 'USA', '826', 'G', '']) {
      expect(normalizeCountryCode(bad)).toBeNull();
    }
  });

  it('produces only values the database CHECK will accept', () => {
    for (const v of ['gb', 'US', ' in ', 'United Kingdom', null]) {
      const out = normalizeCountryCode(v as string | null);
      if (out !== null) expect(out).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('normalizeEmployeeCount', () => {
  it('accepts non-negative integers, including zero', () => {
    expect(normalizeEmployeeCount(0)).toBe(0);
    expect(normalizeEmployeeCount(240)).toBe(240);
    expect(normalizeEmployeeCount('1500')).toBe(1500);
  });

  it('rejects negatives and fractions instead of rounding them', () => {
    expect(normalizeEmployeeCount(-1)).toBeNull();
    expect(normalizeEmployeeCount(12.5)).toBeNull();
    expect(normalizeEmployeeCount('abc')).toBeNull();
  });

  it('treats absent as absent', () => {
    expect(normalizeEmployeeCount(null)).toBeNull();
    expect(normalizeEmployeeCount(undefined)).toBeNull();
    expect(normalizeEmployeeCount('')).toBeNull();
  });
});

describe('closed vocabularies match the database', () => {
  it('seniority accepts only the twelve permitted values', () => {
    expect(SENIORITY_VALUES).toHaveLength(12);
    for (const v of SENIORITY_VALUES) expect(isSeniority(v)).toBe(true);
    for (const v of ['Chief Wizard', 'VP', 'c-suite', '', null, 7]) expect(isSeniority(v)).toBe(false);
  });

  it('employee band accepts only the eight permitted bands', () => {
    expect(EMPLOYEE_BANDS).toHaveLength(8);
    for (const v of EMPLOYEE_BANDS) expect(isEmployeeBand(v)).toBe(true);
    for (const v of ['medium', '50-100', '', null]) expect(isEmployeeBand(v)).toBe(false);
  });
});

describe('toPersonAttributes', () => {
  it('normalises every field it owns', () => {
    expect(toPersonAttributes({
      fullName: '  Ada  Lovelace ', firstName: 'Ada', lastName: ' Lovelace',
      jobTitle: ' Head of  Engines ', department: 'Engineering', seniority: 'head',
      countryCode: 'gb', region: ' England ', city: 'London', timezone: 'Europe/London',
    })).toEqual({
      fullName: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace',
      jobTitle: 'Head of Engines', department: 'Engineering', seniority: 'head',
      countryCode: 'GB', region: 'England', city: 'London', timezone: 'Europe/London',
    });
  });

  it('does NOT split a full name into parts — that would be inference', () => {
    const out = toPersonAttributes({ fullName: 'Ada Lovelace' });
    expect(out.fullName).toBe('Ada Lovelace');
    expect(out.firstName).toBeNull();
    expect(out.lastName).toBeNull();
  });

  it('does NOT derive seniority or department from a job title', () => {
    const out = toPersonAttributes({ jobTitle: 'VP of Enterprise Sales' });
    expect(out.jobTitle).toBe('VP of Enterprise Sales');
    expect(out.seniority).toBeNull();
    expect(out.department).toBeNull();
  });

  it('drops an unrecognised seniority to null rather than bucketing it as "other"', () => {
    // 'other' is a claim a source made; inventing it here fabricates evidence.
    expect(toPersonAttributes({ seniority: 'Grand Poobah' as never }).seniority).toBeNull();
  });

  it('returns an all-null shape for empty input', () => {
    const out = toPersonAttributes({});
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });
});

describe('toAccountAttributes', () => {
  it('normalises firmographics', () => {
    expect(toAccountAttributes({
      industry: ' Software ', employeeCount: '240', employeeBand: '201-500',
      countryCode: 'gb', region: 'England', city: ' London ', description: 'A  company',
    })).toEqual({
      industry: 'Software', employeeCount: 240, employeeBand: '201-500',
      countryCode: 'GB', region: 'England', city: 'London', description: 'A company',
    });
  });

  it('keeps exact headcount and band as separate claims', () => {
    const out = toAccountAttributes({ employeeCount: 240 });
    expect(out.employeeCount).toBe(240);
    // A band is NOT derived from the count — that would assert a claim the
    // source did not make.
    expect(out.employeeBand).toBeNull();
  });

  it('drops an unrecognised band to null', () => {
    expect(toAccountAttributes({ employeeBand: 'medium' as never }).employeeBand).toBeNull();
  });

  it('carries no identity field', () => {
    const out = toAccountAttributes({}) as Record<string, unknown>;
    for (const forbidden of ['name', 'legalName', 'domain', 'domainNormalized', 'websiteUrl', 'source', 'sourceReference']) {
      expect(out[forbidden]).toBeUndefined();
    }
  });
});

describe('column lists match the migration', () => {
  it('person has the 12 LI-1 columns', () => {
    expect([...PERSON_ATTRIBUTE_COLUMNS]).toEqual([
      'full_name', 'first_name', 'last_name', 'job_title', 'department', 'seniority',
      'country_code', 'region', 'city', 'timezone', 'attributes_source', 'attributes_updated_at']);
  });

  it('account has the 9 LI-1 columns and no identity column', () => {
    expect([...ACCOUNT_ATTRIBUTE_COLUMNS]).toEqual([
      'industry', 'employee_count', 'employee_band', 'country_code', 'region', 'city',
      'description', 'attributes_source', 'attributes_updated_at']);
    for (const c of ACCOUNT_ATTRIBUTE_COLUMNS) {
      expect(['name', 'legal_name', 'domain_normalized', 'website_url', 'source', 'source_reference'])
        .not.toContain(c);
    }
  });

  it('no attribute column is named for a profile identifier', () => {
    for (const c of [...PERSON_ATTRIBUTE_COLUMNS, ...ACCOUNT_ATTRIBUTE_COLUMNS]) {
      expect(c).not.toMatch(/linkedin|twitter|github|profile_url/i);
    }
  });
});
