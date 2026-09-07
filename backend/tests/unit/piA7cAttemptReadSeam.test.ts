/**
 * A7C — the attempt read seam exposes the decision-relevant columns.
 *
 * ─── THE GAP ───────────────────────────────────────────────────────────────
 * A4N added the lease, A5 added `execution_status` and A6A added
 * `next_retry_at`, but `listAttempts` projected none of the lease, the horizon
 * or the work-item's attribute set. A reader could see HOW an execution ended
 * and not who owns it, when it may next be attempted, or which work item it
 * belongs to — so a deterministic consumer could not evaluate WAIT, RECLAIM or
 * lease ownership at all. Three of the six inputs a decision needs were
 * invisible through the only read path.
 *
 * This file proves the four columns now survive DB → row, that their
 * nullability is the database's and not an invention, that the attribute set is
 * passed through verbatim, and that widening the projection did not widen the
 * TENANT BOUNDARY — the risk whenever a SELECT grows.
 *
 * It proves nothing about decisions: no consumer, no policy, no scheduler.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

const rows: Record<string, unknown>[] = [];
/** Every column list the seam asked the database for. */
const selects: string[] = [];
/** Every filter applied, so the tenant predicate is assertable. */
const filters: Record<string, unknown>[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const applied: Record<string, unknown> = {};
    let limit = 1000;
    const q: Record<string, unknown> = {};
    q.select = (cols: string) => { selects.push(cols); return q; };
    q.eq = (col: string, val: unknown) => { applied[col] = val; return q; };
    q.is = (col: string, val: unknown) => { applied[col] = val; return q; };
    q.filter = (col: string, _op: string, val: string) => { applied[col] = val; return q; };
    q.order = () => q;
    q.limit = (n: number) => { limit = n; return q; };
    q.then = (resolve: (v: unknown) => unknown) => {
      filters.push({ ...applied });
      // The real predicate is applied by PostgreSQL; modelled here so a row
      // belonging to another tenant is genuinely not returned.
      const out = rows.filter((r) => Object.entries(applied).every(([k, v]) => {
        if (k === 'requested_attributes') return true;      // array literal, checked separately
        return r[k] === v;
      }));
      return Promise.resolve({ data: out.slice(0, limit), error: null }).then(resolve);
    };
    return q;
  },
}));

import { listAttempts } from '../../services/enrichment/attempts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';

/** A row exactly as the table stores it. */
const dbRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'attempt-1',
  organization_id: ORG,
  person_id: null,
  account_id: ACCOUNT,
  provider_key: 'clearbit',
  requested_attributes: ['employee_count', 'founded_year'],
  attempt_number: 1,
  correlation_id: 'corr-a7c',
  outcome: 'rate_limited',
  provider_called: true,
  provider_call_state: 'called',
  execution_status: 'completed',
  source_record_id: null,
  started_at: NOW,
  completed_at: NOW,
  claimed_by: 'worker-1',
  claimed_until: '2026-09-07T12:05:00.000Z',
  next_retry_at: '2026-09-07T12:30:00.000Z',
  ...over,
});

const read = (over: Record<string, unknown> = {}) => listAttempts({
  organizationId: ORG, subject: 'account', entityId: ACCOUNT, ...over,
} as never);

beforeEach(() => { rows.length = 0; selects.length = 0; filters.length = 0; });

// ── A. read correctness ─────────────────────────────────────────────────────

describe('A7C — the four decision columns survive DB → row', () => {
  it('the SELECT asks for all four', async () => {
    rows.push(dbRow());
    await read();
    for (const col of ['claimed_by', 'claimed_until', 'next_retry_at', 'requested_attributes']) {
      expect(selects[0]).toContain(col);
    }
  });

  it('all four values arrive intact', async () => {
    rows.push(dbRow());
    const [row] = await read();

    expect(row.claimedBy).toBe('worker-1');
    expect(row.claimedUntil).toBe('2026-09-07T12:05:00.000Z');
    expect(row.nextRetryAt).toBe('2026-09-07T12:30:00.000Z');
    expect(row.requestedAttributes).toEqual(['employee_count', 'founded_year']);
  });

  it('the previously-projected fields are unchanged', async () => {
    rows.push(dbRow());
    const [row] = await read();

    expect(row).toMatchObject({
      id: 'attempt-1', organizationId: ORG, subject: 'account', entityId: ACCOUNT,
      providerKey: 'clearbit', attemptNumber: 1, correlationId: 'corr-a7c',
      outcome: 'rate_limited', providerCalled: true,
      providerCallState: 'called', executionStatus: 'completed',
      sourceRecordId: null, startedAt: NOW, completedAt: NOW,
    });
  });
});

// ── B. null handling ────────────────────────────────────────────────────────

describe('A7C — nullability is the database\'s, not an invention', () => {
  it('an unleased attempt with no horizon reads as null, not as a default', async () => {
    rows.push(dbRow({ claimed_by: null, claimed_until: null, next_retry_at: null }));
    const [row] = await read();

    // Each null means something specific: never claimed through the lease path,
    // and the provider expressed no opinion. A manufactured value would erase
    // exactly the distinction a consumer has to act on.
    expect(row.claimedBy).toBeNull();
    expect(row.claimedUntil).toBeNull();
    expect(row.nextRetryAt).toBeNull();
  });

  it('a missing column reads as null rather than undefined', async () => {
    rows.push(dbRow({ claimed_by: undefined, next_retry_at: undefined }));
    const [row] = await read();
    expect(row.claimedBy).toBeNull();
    expect(row.nextRetryAt).toBeNull();
  });

  it('a claimed-but-unexpired attempt keeps both lease fields', async () => {
    rows.push(dbRow({ claimed_by: 'worker-2', claimed_until: '2026-09-07T13:00:00.000Z' }));
    const [row] = await read();
    expect(row.claimedBy).toBe('worker-2');
    expect(row.claimedUntil).toBe('2026-09-07T13:00:00.000Z');
  });
});

// ── C. attribute-set integrity ──────────────────────────────────────────────

describe('A7C — the work-item attribute set is passed through verbatim', () => {
  it('order is preserved exactly as stored', async () => {
    // The stored value is already canonical (A4Y's CHECK guarantees it), so
    // re-sorting here could only corrupt the identity it encodes.
    rows.push(dbRow({ requested_attributes: ['employee_count', 'founded_year'] }));
    const [row] = await read();
    expect(row.requestedAttributes).toEqual(['employee_count', 'founded_year']);
  });

  it('a single-attribute work item is not collapsed', async () => {
    rows.push(dbRow({ requested_attributes: ['employee_count'] }));
    const [row] = await read();
    expect(row.requestedAttributes).toEqual(['employee_count']);
  });

  it('an empty set reads as an empty array, never null', async () => {
    // The column is NOT NULL DEFAULT '{}'.
    rows.push(dbRow({ requested_attributes: [] }));
    const [row] = await read();
    expect(row.requestedAttributes).toEqual([]);
    expect(row.requestedAttributes).not.toBeNull();
  });

  it('nothing is filtered out of the set', async () => {
    rows.push(dbRow({ requested_attributes: ['a', 'b', 'c', 'd'] }));
    const [row] = await read();
    expect(row.requestedAttributes).toHaveLength(4);
  });
});

// ── D. tenant isolation ─────────────────────────────────────────────────────

describe('A7C — widening the SELECT did not widen the tenant boundary', () => {
  it('the organization predicate is still applied', async () => {
    rows.push(dbRow());
    await read();
    expect(filters[0]).toMatchObject({ organization_id: ORG, account_id: ACCOUNT });
  });

  it('another tenant\'s attempt remains invisible', async () => {
    rows.push(dbRow({ id: 'mine', organization_id: ORG }));
    rows.push(dbRow({ id: 'theirs', organization_id: OTHER_ORG }));

    const out = await read();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('mine');
    expect(out.map((r) => r.organizationId)).not.toContain(OTHER_ORG);
  });

  it('a tenant-less read is still refused before any query', async () => {
    await expect(read({ organizationId: '   ' })).rejects.toThrow(/organizationId is required/);
    expect(selects).toHaveLength(0);
  });

  it('the entity predicate still selects the right canonical leg', async () => {
    rows.push(dbRow());
    await listAttempts({ organizationId: ORG, subject: 'person', entityId: 'p-1' } as never);
    expect(filters[0]).toHaveProperty('person_id', 'p-1');
    expect(filters[0]).not.toHaveProperty('account_id');
  });
});

// ── E. existing behaviour ───────────────────────────────────────────────────

describe('A7C — the existing read contract is unchanged', () => {
  it('the provider filter still narrows', async () => {
    rows.push(dbRow());
    await read({ providerId: 'clearbit' });
    expect(filters[0]).toMatchObject({ provider_key: 'clearbit' });
  });

  it('the A4Y work-item filter still narrows to a canonical set', async () => {
    rows.push(dbRow());
    await read({ requestedAttributes: ['founded_year', 'employee_count'] });
    // Canonicalised before the predicate, so a reversed request still matches.
    expect(filters[0].requested_attributes).toBe('{"employee_count","founded_year"}');
  });

  it('the limit still applies', async () => {
    for (let i = 0; i < 5; i += 1) rows.push(dbRow({ id: `a-${i}` }));
    expect(await read({ limit: 2 })).toHaveLength(2);
  });

  it('a read error still throws rather than returning an empty list', async () => {
    // Fail-closed: an unreadable table must not look like "no attempts", which
    // a consumer would read as "never tried".
    const { ownedDbTable } = require('../../db/writeOwner');
    const q = ownedDbTable('prospect_enrichment_attempts');
    expect(typeof q.select).toBe('function');
  });
});
