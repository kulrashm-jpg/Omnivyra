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
  openResult: { data: null as unknown, error: null as { code?: string; message: string } | null },
  markResult: { data: null as unknown, error: null as { code?: string; message: string } | null },
  observed: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: async (fn: string, args: Row) => {
    state.rpcCalls.push({ fn, args });
    state.observed.push(`rpc:${fn}`);
    // A6-10 ledger calls made by erasePerson; everything else answers rpcResult.
    if (fn === 'pi_person_erasure_open') return state.openResult;
    if (fn === 'pi_person_erasure_mark') return state.markResult;
    if (fn === 'pi_person_erasure_finalize') return state.rpcResult;
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
  state.openResult = { data: { request_id: 'r0000000-0000-4000-8000-000000000001', lease_token: 'l0000000-0000-4000-8000-000000000001', resumed: false }, error: null };
  state.markResult = { data: null, error: null };
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

describe('erasePerson — wired to the complete erasure through the A6-10 ledger', () => {
  const FIN = { deleted: true, provenance: { ...OK, redacted: 0, already_redacted: 0, contribution_ids: [], canonical_lead_ids: [] } };
  const fns = () => state.rpcCalls.map((c) => c.fn);

  it('opens the request, marks steps 3/4/5, then finalizes (steps 6+7 in ONE database call) — never a client-side delete', async () => {
    state.rpcResult = { data: FIN, error: null };
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'subject request', requestedBy: 'admin:u9' });
    expect(fns()).toEqual(['pi_person_erasure_open', 'pi_person_erasure_mark', 'pi_person_erasure_mark', 'pi_person_erasure_mark', 'pi_person_erasure_finalize']);
    expect(state.rpcCalls[0].args).toEqual({ p_organization_id: ORG_A, p_person_id: PERSON, p_reason: 'subject request', p_requested_by: 'admin:u9' });
    expect(state.rpcCalls.slice(1, 4).map((c) => c.args.p_step)).toEqual(['governance_reanchored', 'governance_revoked', 'evidence_links_cleared']);
    expect(state.rpcCalls[4].args).toEqual({ p_organization_id: ORG_A, p_request_id: 'r0000000-0000-4000-8000-000000000001', p_lease_token: 'l0000000-0000-4000-8000-000000000001' });
    expect(state.rpcCalls.slice(1, 4).every((c) => c.args.p_lease_token === 'l0000000-0000-4000-8000-000000000001')).toBe(true);
    expect(fns()).not.toContain(ERASURE_FUNCTION);            // step 6 runs INSIDE finalize
    expect(state.observed).not.toContain('delete:unified_persons'); // step 7 runs INSIDE finalize
    expect(res.deleted).toBe(true);
    expect(res.requestId).toBe('r0000000-0000-4000-8000-000000000001');
    expect(res.provenanceRedaction).toMatchObject({ status: 'erased', erasureId: OK.erasure_id });
  });

  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function' }, 'erasure_ledger_unavailable'],
    [{ code: '23503', message: 'person_erasure:delete_blocked_by unified_persons_merge_tenant_fk (x)' }, 'merge_survivor'],
    [{ code: '23502', message: 'person_erasure:delete_blocked_by leads.unified_person_id (null value)' }, 'delete_blocked'],
    [{ code: '23503', message: 'person_erasure:delete_blocked_by outreach_bridge_handoffs_person_fk (x)' }, 'delete_blocked'],
    [{ code: '55000', message: 'person_erasure:live_person_governance_remains (1)' }, 'governance_changed_retry'],
    [{ code: 'P0001', message: 'injected failure inside the transaction' }, 'P0001'],
  ])('FAIL CLOSED: a finalize error surfaces by NAME and is recorded on the request (%#)', async (error, code) => {
    state.rpcResult = { data: null, error };
    const p = erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    await expect(p).rejects.toBeInstanceOf(PersonErasureError);
    await expect(p).rejects.toMatchObject({ code });
    const failed = state.rpcCalls.filter((c) => c.fn === 'pi_person_erasure_mark' && c.args.p_step === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].args.p_error_code).toBe(code);
    expect(state.persons).toHaveLength(1);
  });

  it('a 23503 from anything but the merge FK is NOT reported as a merge survivor (A6-10)', async () => {
    state.rpcResult = { data: null, error: { code: '23503', message: 'person_erasure:delete_blocked_by outreach_bridge_handoffs_person_fk (x)' } };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' })).rejects.not.toMatchObject({ code: 'merge_survivor' });
  });

  it('FAIL CLOSED on an unconfirmed success (no provenance erasure event)', async () => {
    state.rpcResult = { data: { deleted: true, provenance: {} }, error: null };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' }))
      .rejects.toMatchObject({ code: 'provenance_erasure_unconfirmed' });
  });

  it('a person that no longer exists is "nothing to erase" (P0002 from open): no step runs, deleted=false', async () => {
    state.openResult = { data: null, error: { code: 'P0002', message: 'person_erasure:person_not_found' } };
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    expect(res.deleted).toBe(false);
    expect(res.requestId).toBeNull();
    expect(fns()).toEqual(['pi_person_erasure_open']);
  });

  it.each([
    [{ code: '42501', message: 'other tenant' }, 'cross_tenant'],
    [{ code: '42883', message: 'function does not exist' }, 'erasure_ledger_unavailable'],
  ])('open refusal stops before any write (%#)', async (error, code) => {
    state.openResult = { data: null, error };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' })).rejects.toMatchObject({ code });
    expect(fns()).toEqual(['pi_person_erasure_open']);
  });

  it('a step marker that cannot be written stops the erasure before finalize', async () => {
    state.markResult = { data: null, error: { code: '55000', message: 'person_erasure:request_already_completed' } };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' })).rejects.toBeInstanceOf(PersonErasureError);
    expect(fns()).not.toContain('pi_person_erasure_finalize');
    expect(state.persons).toHaveLength(1);
  });

  it('a resumed request is reported as such', async () => {
    state.openResult = { data: { request_id: 'r0000000-0000-4000-8000-000000000001', lease_token: 'l0000000-0000-4000-8000-000000000001', resumed: true }, error: null };
    state.rpcResult = { data: FIN, error: null };
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    expect(res.resumed).toBe(true);
  });

  it('a concurrent erasure of the same person is refused at open (lease held) — no step runs', async () => {
    state.openResult = { data: null, error: { code: '55P03', message: 'person_erasure:in_progress' } };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' }))
      .rejects.toMatchObject({ code: 'erasure_in_progress' });
    expect(fns()).toEqual(['pi_person_erasure_open']);
  });

  it('a lost lease during a step marker stops before finalize', async () => {
    state.markResult = { data: null, error: { code: '55P03', message: 'person_erasure:lease_lost' } };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' }))
      .rejects.toMatchObject({ code: 'erasure_lease_lost' });
    expect(fns()).not.toContain('pi_person_erasure_finalize');
  });

  it('person deleted outside the ledger is surfaced, never treated as success', async () => {
    state.rpcResult = { data: null, error: { code: '55000', message: 'person_erasure:person_vanished_outside_ledger' } };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' }))
      .rejects.toMatchObject({ code: 'person_vanished_outside_ledger' });
  });

  it('only a CODE reaches the ledger on failure — a message with personal data is never recorded', async () => {
    state.rpcResult = { data: null, error: { code: undefined as unknown as string, message: 'Jane Doe <jane@x.test> failed' } };
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' })).rejects.toBeInstanceOf(PersonErasureError);
    const failed = state.rpcCalls.filter((c) => c.fn === 'pi_person_erasure_mark' && c.args.p_step === 'failed');
    expect(failed).toHaveLength(1);
    expect(String(failed[0].args.p_error_code)).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/);
    expect(JSON.stringify(failed[0].args)).not.toMatch(/jane|Doe/i);
  });

  it('finalize counts (legacy leads detached, score evaluations redacted, policies) are reported', async () => {
    state.rpcResult = { data: { ...FIN, finalize_counts: { legacy_leads_detached: 2, score_evaluations_redacted: 3, legacy_lead_fields: 'retain' } }, error: null };
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    expect(res.finalizeCounts).toEqual({ legacy_leads_detached: 2, score_evaluations_redacted: 3, legacy_lead_fields: 'retain' });
  });
});
