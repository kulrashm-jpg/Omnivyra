/**
 * REPORT_IN_PROGRESS must carry the id of the report that blocked the request,
 * so the snapshot page can open it instead of dead-ending on
 * "Report already in progress" (double submit, 2026-10-24).
 */
type Scenario = {
  stateRows: Array<{ is_free: boolean; status: string }>;
  insertError: { message: string } | null;
  lookupId: string | null;
  lookupThrows: boolean;
};

let scenario: Scenario;
const lookups: Array<Record<string, unknown>> = [];

function builder(table: string) {
  let selectCols = '';
  const filters: Record<string, unknown> = {};
  let inserting = false;

  const settle = async () => {
    if (table !== 'reports') return { data: null, error: null };
    if (inserting) return { data: null, error: scenario.insertError };
    if (selectCols === 'id') {
      lookups.push({ ...filters });
      if (scenario.lookupThrows) throw new Error('lookup down');
      return { data: scenario.lookupId ? { id: scenario.lookupId } : null, error: null };
    }
    if (selectCols.includes('is_free')) return { data: scenario.stateRows, error: null };
    return { data: null, error: null }; // retry-ceiling lookup: no prior row
  };

  const chain: Record<string, unknown> = {
    select: (c: string) => { if (!inserting) selectCols = c; return chain; },
    insert: () => { inserting = true; return chain; },
    eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
    in: (k: string, v: unknown) => { filters[k] = v; return chain; },
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => settle(),
    maybeSingle: () => settle(),
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
  };
  return chain;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createPaidReport, ReportRequestError } = require('../../services/reportCardServiceModel');

beforeEach(() => {
  lookups.length = 0;
  scenario = { stateRows: [], insertError: null, lookupId: 'rep-running', lookupThrows: false };
});

async function attempt() {
  try {
    await createPaidReport('user-1', 'company-1', 'acme.com', { reportCategory: 'snapshot' });
  } catch (e) {
    return e as InstanceType<typeof ReportRequestError>;
  }
  throw new Error('expected createPaidReport to throw');
}

describe('REPORT_IN_PROGRESS carries the blocking report id', () => {
  it('pre-check hit: attaches the in-flight report id, scoped to company + domain', async () => {
    scenario.stateRows = [{ is_free: false, status: 'generating' }];
    const err = await attempt();
    expect(err.code).toBe('REPORT_IN_PROGRESS');
    expect(err.httpStatus).toBe(409);
    expect(err.reportId).toBe('rep-running');
    expect(lookups).toEqual([
      { company_id: 'company-1', domain: 'acme.com', status: ['generating', 'completed'] },
    ]);
  });

  it('lost insert race (unique index): attaches the winning report id', async () => {
    scenario.insertError = {
      message: 'duplicate key value violates unique constraint "unique_generating_report_per_company_domain"',
    };
    const err = await attempt();
    expect(err.code).toBe('REPORT_IN_PROGRESS');
    expect(err.reportId).toBe('rep-running');
  });

  it('lookup failure still yields the plain 409', async () => {
    scenario.stateRows = [{ is_free: false, status: 'generating' }];
    scenario.lookupThrows = true;
    const err = await attempt();
    expect(err.code).toBe('REPORT_IN_PROGRESS');
    expect(err.httpStatus).toBe(409);
    expect(err.reportId).toBeUndefined();
  });

  it('no matching report: no id attached', async () => {
    scenario.stateRows = [{ is_free: false, status: 'generating' }];
    scenario.lookupId = null;
    const err = await attempt();
    expect(err.reportId).toBeUndefined();
  });

  it('other insert conflicts are unchanged (no lookup)', async () => {
    scenario.insertError = { message: 'violates unique constraint "unique_free_report_per_domain"' };
    const err = await attempt();
    expect(err.code).toBe('FREE_REPORT_LIMIT');
    expect(lookups).toHaveLength(0);
  });
});
