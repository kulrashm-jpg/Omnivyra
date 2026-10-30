/**
 * Closure A (privacy) — unit: `eraseProspectProvenance` and its wiring into
 * `personErasure.erasePerson`.
 *
 *   - the complete-erasure RPC is called with tenant, person, leads, reason and
 *     requester; the result (erasure event id, per-table counts) is surfaced;
 *   - it is called for EVERY person (source records / contacts / threads exist
 *     without a canonical prospect), and BEFORE the person delete;
 *   - FAIL CLOSED: cross-tenant refusal, any RPC error, an UNDEPLOYED function
 *     (no fallback to the contribution-only function), or a success without an
 *     erasure event id abort the erasure with the person intact;
 *   - input validation happens before any call.
 *
 * The database half (one transaction, full graph, no residue, idempotency,
 * cross-tenant refusal, no recoverable hash) is proven against PostgreSQL in
 * backend/tests/realschema/pi_prov_erasure_completeness.test.ts.
 */
type Row = Record<string, unknown>;

const state = {
  persons: [] as Row[],
  rpcCalls: [] as Array<{ fn: string; args: Row }>,
  rpcResult: { data: null as unknown, error: null as { code?: string; message: string } | null },
  observed: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: async (fn: string, args: Row) => {
    state.rpcCalls.push({ fn, args });
    state.observed.push(`rpc:${fn}`);
    return state.rpcResult;
  },
  ownedDbTable: (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.limit = () => b;
    b.eq = () => b;
    b.is = () => b;
    b.in = () => b;
    b.not = () => b;
    b.update = () => { const u: Record<string, unknown> = { eq: () => u, not: () => u, is: () => u, select: async () => ({ data: [], error: null }) }; return u; };
    b.delete = () => {
      const df: Array<[string, unknown]> = [];
      const d: Record<string, unknown> = {};
      d.eq = (c: string, v: unknown) => { df.push([c, v]); return d; };
      d.select = async () => {
        state.observed.push(`delete:${table}`);
        const by = Object.fromEntries(df) as Row;
        const before = state.persons.length;
        state.persons = state.persons.filter((p) => !(p.id === by.id && p.company_id === by.company_id));
        return { data: before !== state.persons.length ? [{ id: by.id }] : [], error: null };
      };
      return d;
    };
    (b as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return b;
  },
}));

import {
  eraseProspectProvenance, ERASURE_FUNCTION, ProvenanceRedactionError,
} from '../../services/prospectProvenance/redaction';
import { erasePerson, PersonErasureError } from '../../services/prospectIdentity/personErasure';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const PERSON = '20000000-0000-4000-8000-000000000001';
const LEAD_1 = '10000000-0000-4000-8000-000000000001';

const OK = {
  erasure_id: 'e0000000-0000-4000-8000-000000000001',
  redacted: 2, already_redacted: 1, contribution_ids: ['c1', 'c2'], canonical_lead_ids: [LEAD_1],
  counts: { prospect_source_contributions: 2, source_records: 1, contacts: 1 },
};

beforeEach(() => {
  state.persons = [{ id: PERSON, company_id: ORG_A }];
  state.rpcCalls = [];
  state.rpcResult = { data: OK, error: null };
  state.observed = [];
});

describe('eraseProspectProvenance', () => {
  it('calls pi_erase_prospect_provenance with tenant, person, deduped leads, trimmed reason and requester', async () => {
    const out = await eraseProspectProvenance({
      organizationId: ORG_A, personId: PERSON, canonicalLeadIds: [LEAD_1, LEAD_1], reason: ' gdpr art.17 ', requestedBy: 'admin:u1',
    });
    expect(ERASURE_FUNCTION).toBe('pi_erase_prospect_provenance');
    expect(state.rpcCalls).toEqual([{ fn: ERASURE_FUNCTION, args: {
      p_organization_id: ORG_A, p_person_id: PERSON, p_canonical_lead_ids: [LEAD_1],
      p_reason: 'gdpr art.17', p_requested_by: 'admin:u1',
    } }]);
    expect(out).toEqual({
      status: 'erased', erasureId: OK.erasure_id, redacted: 2, alreadyRedacted: 1,
      contributionIds: ['c1', 'c2'], canonicalLeadIds: [LEAD_1],
      counts: { prospect_source_contributions: 2, source_records: 1, contacts: 1 },
    });
  });

  it('a prospect-only erasure passes a NULL person', async () => {
    await eraseProspectProvenance({ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' });
    expect(state.rpcCalls[0].args.p_person_id).toBeNull();
  });

  it.each([
    [{ organizationId: '', personId: PERSON, reason: 'r', requestedBy: 'x' }, 'tenant_required'],
    [{ organizationId: ORG_A, personId: PERSON, reason: ' ', requestedBy: 'x' }, 'reason_required'],
    [{ organizationId: ORG_A, personId: PERSON, reason: 'r', requestedBy: '' }, 'requested_by_required'],
    [{ organizationId: ORG_A, canonicalLeadIds: ['nope'], reason: 'r', requestedBy: 'x' }, 'invalid_subject_id'],
    [{ organizationId: ORG_A, reason: 'r', requestedBy: 'x' }, 'subject_required'],
  ])('rejects bad input before any call (%#)', async (input, code) => {
    await expect(eraseProspectProvenance(input)).rejects.toMatchObject({ code });
    expect(state.rpcCalls).toEqual([]);
  });

  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function' }, 'erasure_unavailable'],
    [{ code: '42883', message: 'function does not exist' }, 'erasure_unavailable'],
    [{ code: '42501', message: 'other tenant' }, 'cross_tenant'],
    [{ code: 'P0001', message: 'injected' }, 'P0001'],
    [{ code: '22P02', message: 'invalid input syntax for type uuid' }, '22P02'],
    [{ message: 'no code' }, 'erasure_failed'],
  ])('every RPC error throws — an undeployed function is NOT tolerated (%#)', async (error, code) => {
    state.rpcResult = { data: null, error };
    const p = eraseProspectProvenance({ organizationId: ORG_A, personId: PERSON, reason: 'r', requestedBy: 'x' });
    await expect(p).rejects.toBeInstanceOf(ProvenanceRedactionError);
    await expect(p).rejects.toMatchObject({ code });
    // Never a fallback to the contribution-only function.
    expect(state.rpcCalls.map((c) => c.fn)).toEqual([ERASURE_FUNCTION]);
  });

  it('a "success" without an erasure event id is unconfirmed and throws', async () => {
    state.rpcResult = { data: { redacted: 0 }, error: null };
    await expect(eraseProspectProvenance({ organizationId: ORG_A, personId: PERSON, reason: 'r', requestedBy: 'x' }))
      .rejects.toMatchObject({ code: 'erasure_unconfirmed' });
  });
});

describe('erasePerson — wired to the complete erasure', () => {
  it('erases the provenance graph BEFORE the person delete, for a person with no prospects too', async () => {
    state.rpcResult = { data: { ...OK, redacted: 0, already_redacted: 0, contribution_ids: [], canonical_lead_ids: [] }, error: null };
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'subject request', requestedBy: 'admin:u9' });
    const rpcAt = state.observed.indexOf(`rpc:${ERASURE_FUNCTION}`);
    expect(rpcAt).toBeGreaterThan(-1);
    expect(rpcAt).toBeLessThan(state.observed.indexOf('delete:unified_persons'));
    expect(state.rpcCalls[0].args).toEqual({
      p_organization_id: ORG_A, p_person_id: PERSON, p_canonical_lead_ids: [],
      p_reason: 'person erased: subject request', p_requested_by: 'admin:u9',
    });
    expect(res.deleted).toBe(true);
    expect(res.provenanceRedaction).toMatchObject({ status: 'erased', erasureId: OK.erasure_id });
  });

  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function' }, 'provenance_erasure_unavailable'],
    [{ code: '42501', message: 'other tenant' }, 'provenance_cross_tenant'],
    [{ code: 'P0001', message: 'injected failure inside the transaction' }, 'provenance_P0001'],
  ])('FAIL CLOSED: the person is NOT deleted and the error surfaces (%#)', async (error, code) => {
    state.rpcResult = { data: null, error };
    const p = erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    await expect(p).rejects.toBeInstanceOf(PersonErasureError);
    await expect(p).rejects.toMatchObject({ code });
    expect(state.observed).not.toContain('delete:unified_persons');
    expect(state.persons).toHaveLength(1);
  });

  it('FAIL CLOSED on an unconfirmed success (no erasure event)', async () => {
    state.rpcResult = { data: {}, error: null };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' }))
      .rejects.toMatchObject({ code: 'provenance_erasure_unconfirmed' });
    expect(state.persons).toHaveLength(1);
  });
});
