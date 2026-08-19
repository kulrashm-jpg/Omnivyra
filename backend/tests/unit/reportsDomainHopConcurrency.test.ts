/**
 * P1.9 — domain must not sit on the critical path.
 *
 * `reports` and `role` need only companyId; only `state` consumes the domain.
 * The domain lookup was awaited before the parallel group started, serializing
 * both behind a round trip they never use (~280ms against ap-southeast-1).
 *
 * These gate the domain query open and assert reports/role have already been
 * issued while it is still pending.
 */
const issued: string[] = [];
let releaseDomain!: () => void;
let domainGate!: Promise<void>;
const resetGate = () => { domainGate = new Promise<void>((res) => { releaseDomain = res; }); };
resetGate();

function builder(table: string) {
  let selectCols = '';
  const label = () => (table === 'reports'
    ? (selectCols.includes('is_free') ? 'state' : 'reports')
    : table === 'companies' ? 'domain' : 'role');

  const settle = async () => {
    const key = label();
    issued.push(key);
    if (key === 'domain') await domainGate;          // hold the domain hop open
    if (key === 'domain') return { data: { website: 'acme.com', website_domain: null }, error: null };
    if (key === 'state') return { data: [{ is_free: true, status: 'completed' }], error: null };
    if (key === 'role') return { data: [{ role: 'COMPANY_ADMIN', status: 'active' }], error: null };
    return { data: [{ id: 'r1' }, { id: 'r2' }], error: null };
  };

  const chain: Record<string, unknown> = {
    select: (c: string) => { selectCols = c; return chain; },
    eq: () => chain,
    limit: () => chain,
    order: () => settle(),
    maybeSingle: () => settle(),
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
  };
  return chain;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCompanyReportsForCard } = require('../../services/reportCardServiceModel');

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { issued.length = 0; resetGate(); });

describe('domain hop is off the critical path', () => {
  it('CRITICAL — reports and role are issued while the domain lookup is still pending', async () => {
    const pending = getCompanyReportsForCard('user-1', 'company-1');
    await flush();

    expect(issued).toContain('domain');
    expect(issued).toContain('reports');  // must NOT wait for domain
    expect(issued).toContain('role');     // must NOT wait for domain
    expect(issued).not.toContain('state'); // state DOES wait for domain

    releaseDomain();
    await pending;
  });

  it('state runs only after the domain resolves', async () => {
    const pending = getCompanyReportsForCard('user-1', 'company-1');
    await flush();
    expect(issued).not.toContain('state');
    releaseDomain();
    await pending;
    expect(issued).toContain('state');
  });

  it('all four operations complete and returned values are unchanged', async () => {
    const pending = getCompanyReportsForCard('user-1', 'company-1');
    await flush();
    releaseDomain();
    const result = await pending;

    expect(result.domain).toBe('acme.com');
    expect(result.userRole).toBe('COMPANY_ADMIN');
    expect(result.reports).toHaveLength(2);
    expect(result.hasFreeReportUsed).toBe(true);
    expect(result.hasGeneratingReport).toBe(false);
    expect(result.reportState).toBe('used');
    expect(typeof result.canGenerateFreeReport).toBe('boolean');
    expect(new Set(issued)).toEqual(new Set(['reports', 'role', 'domain', 'state']));
  });

  it('an explicit domain argument skips the lookup entirely', async () => {
    const result = await getCompanyReportsForCard('user-1', 'company-1', 'given.com');
    expect(issued).not.toContain('domain');
    expect(result.domain).toBe('given.com');
  });
});
