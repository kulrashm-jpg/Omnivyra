/**
 * /api/company-profile?mode=list — conditional profile fallback.
 *
 * The profile read exists only to name a company the `companies` row cannot.
 * companies.name is NOT NULL and every write path rejects a blank name, so in
 * the normal case the old unconditional fan-out spent one DB round trip per
 * company to compute a fallback that was then discarded — a sequential hop on
 * the request that gates the Command Center shell.
 *
 * It cannot be removed outright: user_company_roles.company_id has no FK to
 * companies.id, so an orphan id can appear and today takes its name from
 * company_profiles.
 */
type CompanyRow = { id: string; name?: string | null };
type Profile = { company_id: string; name?: string | null } | null;

/** Mirrors the deployed block in pages/api/company-profile/index.ts. */
async function buildCompanies(
  companyIds: string[],
  companyById: Map<string, CompanyRow>,
  getProfile: (id: string) => Promise<Profile>,
) {
  const idsNeedingFallbackName = companyIds.filter((id) => !companyById.get(id)?.name);
  const fallbackNameById = new Map<string, string>();
  if (idsNeedingFallbackName.length) {
    const fallbacks = await Promise.all(
      idsNeedingFallbackName.map(async (id) => {
        const profile = await getProfile(id);
        return [id, String(profile?.name || '')] as const;
      }),
    );
    fallbacks.forEach(([id, name]) => { if (name) fallbackNameById.set(id, name); });
  }
  return companyIds.map((id) => ({
    company_id: id,
    name: companyById.get(id)?.name || fallbackNameById.get(id) || id,
  }));
}

/** The pre-change unconditional fan-out, kept to prove Test A is load-bearing. */
async function buildCompaniesUnconditional(
  companyIds: string[],
  companyById: Map<string, CompanyRow>,
  getProfile: (id: string) => Promise<Profile>,
) {
  const profiles = await Promise.all(
    companyIds.map(async (id) => (await getProfile(id)) || { company_id: id, name: id }),
  );
  return profiles.map((p) => ({
    company_id: p!.company_id,
    name: companyById.get(p!.company_id)?.name || p!.name || p!.company_id,
  }));
}

const spy = jest.fn<Promise<Profile>, [string]>();
beforeEach(() => spy.mockReset());

describe('A — every company row supplies a name', () => {
  const ids = ['c1', 'c2', 'c3'];
  const rows = new Map<string, CompanyRow>([
    ['c1', { id: 'c1', name: 'Acme' }],
    ['c2', { id: 'c2', name: 'Bravo' }],
    ['c3', { id: 'c3', name: 'Cirrus' }],
  ]);

  it('issues zero profile reads and returns the same names, count and order', async () => {
    const out = await buildCompanies(ids, rows, spy);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(out).toEqual([
      { company_id: 'c1', name: 'Acme' },
      { company_id: 'c2', name: 'Bravo' },
      { company_id: 'c3', name: 'Cirrus' },
    ]);
  });

  it('mutation check — the unconditional fan-out calls getProfile once per company', async () => {
    spy.mockResolvedValue(null);
    const out = await buildCompaniesUnconditional(ids, rows, spy);
    expect(spy).toHaveBeenCalledTimes(3);        // the assertion above would fail here
    expect(out.map((c) => c.name)).toEqual(['Acme', 'Bravo', 'Cirrus']); // output identical
  });
});

describe('B — one orphan id missing from companyById', () => {
  const ids = ['c1', 'orphan', 'c3'];
  const rows = new Map<string, CompanyRow>([
    ['c1', { id: 'c1', name: 'Acme' }],
    ['c3', { id: 'c3', name: 'Cirrus' }],
  ]);

  it('reads the profile for the orphan only, and preserves its name', async () => {
    spy.mockImplementation(async (id) => ({ company_id: id, name: 'Orphan Co' }));
    const out = await buildCompanies(ids, rows, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('orphan');
    expect(out).toEqual([
      { company_id: 'c1', name: 'Acme' },
      { company_id: 'orphan', name: 'Orphan Co' },
      { company_id: 'c3', name: 'Cirrus' },
    ]);
  });

  it('an empty companies.name is treated as missing, matching the || chain', async () => {
    spy.mockResolvedValue({ company_id: 'blank', name: 'From Profile' });
    const out = await buildCompanies(['blank'], new Map([['blank', { id: 'blank', name: '' }]]), spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out[0].name).toBe('From Profile');
  });
});

describe('C — orphan with no usable profile name', () => {
  it('falls back to the raw company id, exactly as before', async () => {
    spy.mockResolvedValue(null);
    const out = await buildCompanies(['c1', 'orphan'], new Map([['c1', { id: 'c1', name: 'Acme' }]]), spy);
    expect(out).toEqual([
      { company_id: 'c1', name: 'Acme' },
      { company_id: 'orphan', name: 'orphan' },
    ]);
  });

  it('a profile with a blank name also falls back to the id', async () => {
    spy.mockResolvedValue({ company_id: 'orphan', name: '' });
    const out = await buildCompanies(['orphan'], new Map(), spy);
    expect(out[0].name).toBe('orphan');
  });
});

describe('D — response contract and source shape', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../pages/api/company-profile/index.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('mode=list still returns every existing field', () => {
    ['userId: user.id', 'userName: resolvedUserName', 'activeCompanyId: resolvedActiveCompanyId',
     'companies: companyIds.map', 'rolesByCompany'].forEach((f) => expect(code).toContain(f));
  });

  it('the profile fan-out is conditional, not unconditional', () => {
    expect(code).toContain('const idsNeedingFallbackName = companyIds.filter((id) => !companyById.get(id)?.name);');
    expect(code).toContain('if (idsNeedingFallbackName.length) {');
    expect(code).not.toContain('companyIds.map(async (id) => {\n            const profile = await getProfile(id');
  });

  it('the name precedence chain is unchanged', () => {
    expect(code).toContain("name: companyById.get(id)?.name || fallbackNameById.get(id) || id,");
  });
});
