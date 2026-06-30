/**
 * Phase 6B contract-equivalence: the repository legacy reader must reproduce the
 * OLD GET /api/leads output byte-for-byte (the old impl returned raw `leads` rows),
 * and mirror the exact query (order/limit/filters/tenant). Recording mock for the
 * `leads` table; no DB.
 */
const state: { rows: Array<Record<string, unknown>>; error: { message: string } | null; calls: Array<[string, unknown[]]> } = { rows: [], error: null, calls: [] };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const b: Record<string, unknown> = {};
    const rec = (m: string) => (...args: unknown[]) => { state.calls.push([m, args]); return b; };
    b.select = rec('select');
    b.eq = rec('eq');
    b.order = rec('order');
    b.gte = rec('gte');
    b.limit = rec('limit');
    b.single = () => Promise.resolve({ data: state.rows[0] ?? null, error: state.error ?? (state.rows.length ? null : { message: 'no rows' }) });
    (b as { then: unknown }).then = (resolve: (x: { data: unknown; error: unknown }) => void) => resolve({ data: state.rows, error: state.error });
    return b;
  },
}));

import { getLegacyLeads } from '../../services/leadIntelligence/legacyLeadCompat';

const fullRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'l1', company_id: 'co1', website_id: null, created_by: null, name: 'Jane',
  email: 'jane@b.com', phone: null, source: 'form_embed', integration_id: null, form_id: 'f1',
  metadata: { utm: { x: 1 } }, attribution: { utm_source: 'g' }, visitor_session_id: null,
  consent_state: null, is_test: false, created_at: '2026-01-01T00:00:00Z', unified_person_id: 'up1',
  ...over,
});

beforeEach(() => { state.rows = []; state.error = null; state.calls = []; });

describe('Phase 6B — legacy /api/leads repository cutover (byte-identical)', () => {
  it('reproduces raw rows byte-for-byte (the old contract returned raw `leads` rows)', async () => {
    state.rows = [fullRow(), fullRow({ id: 'l2', source: 'webhook', metadata: null, name: 'Bob' })];
    const out = await getLegacyLeads('co1');
    expect(out).toEqual(state.rows); // deep equality with the original rows
  });

  it('preserves nulls (no silent defaults) and extra columns', async () => {
    state.rows = [fullRow({ metadata: null, attribution: null, phone: null, is_test: false, updated_at: '2026-02-02T00:00:00Z' })];
    const out = await getLegacyLeads('co1');
    expect(out[0].metadata).toBeNull();
    expect(out[0].attribution).toBeNull();
    expect(out[0].phone).toBeNull();
    expect(out[0].is_test).toBe(false);
    expect(out[0].updated_at).toBe('2026-02-02T00:00:00Z'); // extra column preserved
    expect(out).toEqual(state.rows);
  });

  it('mirrors the exact legacy query (tenant + sort + limit, no filters)', async () => {
    await getLegacyLeads('co1');
    expect(state.calls).toContainEqual(['eq', ['company_id', 'co1']]);
    expect(state.calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(state.calls).toContainEqual(['limit', [500]]);
  });

  it('applies the same filters (form_id/integration_id/source/since/is_test); ignores search', async () => {
    await getLegacyLeads('co1', { form_id: 'f1', integration_id: 'i1', source: 'webhook', since: '2026-01-01', is_test: false, search: 'ignored' });
    expect(state.calls).toContainEqual(['eq', ['form_id', 'f1']]);
    expect(state.calls).toContainEqual(['eq', ['integration_id', 'i1']]);
    expect(state.calls).toContainEqual(['eq', ['source', 'webhook']]);
    expect(state.calls).toContainEqual(['gte', ['created_at', '2026-01-01']]);
    expect(state.calls).toContainEqual(['eq', ['is_test', false]]);
    // `search` adds no query call (parity with the old impl, which ignored it)
    expect(state.calls.some(([m, a]) => m === 'eq' && (a as unknown[])[0] === 'search')).toBe(false);
  });

  it('empty result → []', async () => {
    state.rows = [];
    expect(await getLegacyLeads('co1')).toEqual([]);
  });

  it('propagates query errors (same as the old impl)', async () => {
    state.error = { message: 'boom' };
    await expect(getLegacyLeads('co1')).rejects.toThrow('boom');
  });

});
