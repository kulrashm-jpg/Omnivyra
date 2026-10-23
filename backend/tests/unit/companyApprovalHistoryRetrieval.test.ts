/**
 * Fix 3 retention follow-up — `getCompanyApprovalHistory` query contract.
 *
 * WHAT THIS GUARDS. `getApprovalHistory` filters `.eq('content_id', …)`, which
 * can never match NULL, so an audit row retained by
 * `ON DELETE SET NULL (content_id)` is unreachable through it. The new
 * company-scoped reader is the only path to those rows, and the properties that
 * make it safe are all invisible from its return value alone:
 *
 *   - the company filter is ALWAYS applied (tenant isolation on a path that has
 *     no per-resource ownership proof),
 *   - orphan selection uses `.is('content_id', null)` and never `= null`,
 *     which matches nothing in SQL,
 *   - ordering carries an `id` tiebreaker, without which pagination can drop or
 *     repeat rows that share a `created_at`,
 *   - a query failure THROWS rather than returning an empty page that would
 *     misrepresent an audit trail as complete.
 *
 * So the builder is recorded and the emitted query is asserted, not just the
 * mapped output. MOCKED — this proves the query this code constructs, NOT that
 * PostgREST or RLS behave as expected at runtime.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

/** Recorded calls on the fake PostgREST builder. */
type Recorded = {
  table: string | null;
  select: string | null;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  order: Array<[string, { ascending?: boolean } | undefined]>;
  range: Array<[number, number]>;
};

let recorded: Recorded;
let resolveWith: { data: unknown[] | null; error: { message: string } | null };

function freshRecorder(): Recorded {
  return { table: null, select: null, eq: [], is: [], order: [], range: [] };
}

/**
 * Chainable builder. Every filter/order returns `this`; `.range(...)` is the
 * terminal call and resolves, mirroring the real client's thenable builder.
 */
function makeBuilder() {
  const builder: Record<string, unknown> = {
    select(cols: string) { recorded.select = cols; return builder; },
    eq(col: string, val: unknown) { recorded.eq.push([col, val]); return builder; },
    is(col: string, val: unknown) { recorded.is.push([col, val]); return builder; },
    order(col: string, opts?: { ascending?: boolean }) { recorded.order.push([col, opts]); return builder; },
    range(from: number, to: number) {
      recorded.range.push([from, to]);
      return Promise.resolve(resolveWith);
    },
  };
  return builder;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__recordTable(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (global as any).__makeBuilder();
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__recordTable = (t: string) => { recorded.table = t; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__makeBuilder = () => makeBuilder();

import { getCompanyApprovalHistory } from '../../services/content/approvalService';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY = '99999999-9999-4999-8999-999999999999';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    company_id: COMPANY,
    content_id: null,
    from_status: 'edited',
    to_status: 'quality_reviewed',
    actor: '44444444-4444-4444-8444-444444444444',
    note: 'sent for editorial review',
    created_at: '2026-07-18T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  recorded = freshRecorder();
  resolveWith = { data: [], error: null };
});

describe('company filter is always applied', () => {
  it('scopes every query by the authorized company id', async () => {
    await getCompanyApprovalHistory(COMPANY);

    expect(recorded.table).toBe('content_approval_history');
    expect(recorded.eq).toEqual([['company_id', COMPANY]]);
  });

  it('applies the company filter for scope=all too', async () => {
    await getCompanyApprovalHistory(COMPANY, { scope: 'all' });

    expect(recorded.eq).toEqual([['company_id', COMPANY]]);
    expect(recorded.eq.map(([, v]) => v)).not.toContain(OTHER_COMPANY);
  });

  it('rejects a missing or blank company id rather than querying unscoped', async () => {
    await expect(getCompanyApprovalHistory('')).rejects.toThrow(/companyId required/i);
    await expect(getCompanyApprovalHistory('   ')).rejects.toThrow(/companyId required/i);
    expect(recorded.table).toBeNull();
  });
});

describe('scope filtering', () => {
  it('defaults to orphaned and uses IS NULL, never equality to null', async () => {
    const page = await getCompanyApprovalHistory(COMPANY);

    expect(page.scope).toBe('orphaned');
    expect(recorded.is).toEqual([['content_id', null]]);
    // `= null` matches nothing in SQL; it must never appear as an eq filter.
    expect(recorded.eq).not.toContainEqual(['content_id', null]);
  });

  it('omits the orphan filter for scope=all but keeps company scoping', async () => {
    const page = await getCompanyApprovalHistory(COMPANY, { scope: 'all' });

    expect(page.scope).toBe('all');
    expect(recorded.is).toEqual([]);
    expect(recorded.eq).toEqual([['company_id', COMPANY]]);
  });

  it('rejects an unknown scope', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getCompanyApprovalHistory(COMPANY, { scope: 'everything' as any }),
    ).rejects.toThrow(/scope must be/i);
    expect(recorded.table).toBeNull();
  });
});

describe('pagination', () => {
  it('requests pageSize + 1 rows with the inclusive range convention', async () => {
    await getCompanyApprovalHistory(COMPANY, { page: 0, pageSize: 50 });

    expect(recorded.range).toEqual([[0, 50]]);
  });

  it('offsets later pages by page * pageSize', async () => {
    await getCompanyApprovalHistory(COMPANY, { page: 3, pageSize: 10 });

    expect(recorded.range).toEqual([[30, 40]]);
  });

  it('reports hasMore and trims to pageSize when an extra row comes back', async () => {
    resolveWith = {
      data: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })],
      error: null,
    };

    const page = await getCompanyApprovalHistory(COMPANY, { pageSize: 2 });

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('reports hasMore false when the page is not full', async () => {
    resolveWith = { data: [row({ id: 'a' })], error: null };

    const page = await getCompanyApprovalHistory(COMPANY, { pageSize: 2 });

    expect(page.hasMore).toBe(false);
    expect(page.items).toHaveLength(1);
  });

  it('enforces the hard maximum page size of 200', async () => {
    const page = await getCompanyApprovalHistory(COMPANY, { pageSize: 1000 });

    expect(page.pageSize).toBe(200);
    expect(recorded.range).toEqual([[0, 200]]);
  });

  it('rejects negative and non-integer pagination without querying', async () => {
    await expect(getCompanyApprovalHistory(COMPANY, { page: -1 })).rejects.toThrow(/page must be/i);
    await expect(getCompanyApprovalHistory(COMPANY, { page: 1.5 })).rejects.toThrow(/page must be/i);
    await expect(getCompanyApprovalHistory(COMPANY, { pageSize: 0 })).rejects.toThrow(/pageSize must be/i);
    await expect(getCompanyApprovalHistory(COMPANY, { pageSize: -10 })).rejects.toThrow(/pageSize must be/i);
    await expect(getCompanyApprovalHistory(COMPANY, { pageSize: 2.5 })).rejects.toThrow(/pageSize must be/i);
    await expect(getCompanyApprovalHistory(COMPANY, { page: NaN })).rejects.toThrow(/page must be/i);

    expect(recorded.table).toBeNull();
  });
});

describe('deterministic ordering for equal timestamps', () => {
  it('orders by created_at DESC then id DESC', async () => {
    await getCompanyApprovalHistory(COMPANY);

    expect(recorded.order).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('keeps the id tiebreaker so rows sharing created_at paginate stably', async () => {
    const shared = '2026-07-18T10:00:00.000Z';
    resolveWith = {
      data: [row({ id: 'b', created_at: shared }), row({ id: 'a', created_at: shared })],
      error: null,
    };

    const page = await getCompanyApprovalHistory(COMPANY, { pageSize: 5 });

    // The secondary sort must be requested; without it the server order for
    // equal timestamps is unspecified and pages can drop or repeat rows.
    expect(recorded.order[1]).toEqual(['id', { ascending: false }]);
    expect(page.items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('mapping and derived contentExists', () => {
  it('maps a null content_id to contentId null with contentExists false', async () => {
    resolveWith = { data: [row({ content_id: null })], error: null };

    const page = await getCompanyApprovalHistory(COMPANY);

    expect(page.items[0].contentId).toBeNull();
    expect(page.items[0].contentExists).toBe(false);
  });

  it('maps a populated content_id with contentExists true', async () => {
    const cid = '33333333-3333-4333-8333-333333333333';
    resolveWith = { data: [row({ content_id: cid })], error: null };

    const page = await getCompanyApprovalHistory(COMPANY, { scope: 'all' });

    expect(page.items[0].contentId).toBe(cid);
    expect(page.items[0].contentExists).toBe(true);
  });

  it('preserves every audit field on an orphaned row', async () => {
    resolveWith = { data: [row({ content_id: null })], error: null };

    const [item] = (await getCompanyApprovalHistory(COMPANY)).items;

    expect(item.companyId).toBe(COMPANY);
    expect(item.fromStatus).toBe('edited');
    expect(item.toStatus).toBe('quality_reviewed');
    expect(item.actor).toBe('44444444-4444-4444-8444-444444444444');
    expect(item.note).toBe('sent for editorial review');
    expect(item.createdAt).toBe('2026-07-18T10:00:00.000Z');
  });

  it('exposes no fabricated content fields', async () => {
    resolveWith = { data: [row({ content_id: null })], error: null };

    const [item] = (await getCompanyApprovalHistory(COMPANY)).items;

    expect(Object.keys(item).sort()).toEqual([
      'actor', 'companyId', 'contentExists', 'contentId',
      'createdAt', 'fromStatus', 'id', 'note', 'toStatus',
    ]);
  });
});

describe('query failures are never an empty successful page', () => {
  it('throws with a generic message and does not leak the driver detail', async () => {
    resolveWith = { data: null, error: { message: 'permission denied for relation content_approval_history' } };

    await expect(getCompanyApprovalHistory(COMPANY)).rejects.toThrow(
      /Failed to load company approval history/i,
    );
    await expect(getCompanyApprovalHistory(COMPANY)).rejects.not.toThrow(/permission denied/i);
  });

  it('attaches status 500 so the route cannot render it as a 200 empty page', async () => {
    resolveWith = { data: null, error: { message: 'boom' } };

    await expect(getCompanyApprovalHistory(COMPANY)).rejects.toMatchObject({
      status: 500,
      code: 'HISTORY_QUERY_FAILED',
    });
  });

  it('attaches status 400 for validation failures', async () => {
    await expect(getCompanyApprovalHistory(COMPANY, { page: -1 })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION',
    });
  });
});
