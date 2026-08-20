/**
 * P1.9 — /api/reports list projection.
 *
 * The list query returned SELECT *, shipping two unbounded JSONB columns
 * (`data` ~8.3MB, `metadata` ~1.1MB of a 9.43MB / 74-row response) that no
 * consumer of the list reads. Full report bodies are served by the dedicated
 * /api/reports/[reportId] endpoint.
 *
 * These assert the projection structurally — filter, ordering and returned
 * rows must be untouched.
 */
const selectSpy = jest.fn();
const eqSpy = jest.fn();
const orderSpy = jest.fn();

let queryResult: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder = {
      select: (cols: string) => { selectSpy(table, cols); return builder; },
      eq: (col: string, val: unknown) => { eqSpy(col, val); return builder; },
      order: (col: string, opts: unknown) => { orderSpy(col, opts); return Promise.resolve(queryResult); },
    };
    return builder;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCompanyReports } = require('../../services/reportCardServiceModel');

const REQUIRED = ['id', 'report_id', 'report_type', 'status', 'domain', 'created_at', 'completed_at'];

beforeEach(() => {
  selectSpy.mockClear(); eqSpy.mockClear(); orderSpy.mockClear();
  queryResult = { data: [], error: null };
});

describe('getCompanyReports projection', () => {
  it('selects every consumer-required column', async () => {
    await getCompanyReports('company-1');
    const cols = String(selectSpy.mock.calls[0][1]).split(',').map((c) => c.trim());
    REQUIRED.forEach((c) => expect(cols).toContain(c));
  });

  it('CRITICAL — does not select the JSONB payload columns', async () => {
    await getCompanyReports('company-1');
    const cols = String(selectSpy.mock.calls[0][1]).split(',').map((c) => c.trim());
    expect(cols).not.toContain('*');
    expect(cols).not.toContain('data');
    expect(cols).not.toContain('metadata');
  });

  it('runs exactly one query against reports', async () => {
    await getCompanyReports('company-1');
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy.mock.calls[0][0]).toBe('reports');
  });

  it('keeps the tenant filter and ordering unchanged', async () => {
    await getCompanyReports('company-1');
    expect(eqSpy).toHaveBeenCalledWith('company_id', 'company-1');
    expect(orderSpy).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('returns rows unchanged, preserving reports.length behaviour', async () => {
    queryResult = { data: [{ id: 'r1' }, { id: 'r2' }], error: null };
    const rows = await getCompanyReports('company-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('r1');
  });

  it('still throws on query error', async () => {
    queryResult = { data: null, error: { message: 'boom' } };
    await expect(getCompanyReports('company-1')).rejects.toMatchObject({ code: 'REPORT_LIST_FAILED' });
  });
});
