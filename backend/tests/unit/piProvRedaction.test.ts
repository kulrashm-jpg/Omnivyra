/**
 * Workstream E — acceptance #10 (unit): privacy redaction on person erasure.
 *
 * Covers `backend/services/prospectProvenance/redaction.ts` and its wiring into
 * `personErasure.erasePerson`:
 *   - the RPC is called with the tenant, the person's lead ids, reason and
 *     requester; the result is surfaced;
 *   - it runs BEFORE the person delete (the lead link is ON DELETE SET NULL);
 *   - FAIL CLOSED: a cross-tenant refusal (42501), any RPC error, or an
 *     undeployed function while contributions exist aborts the erasure with the
 *     person intact;
 *   - the only tolerated "not deployed" cases are provably empty;
 *   - no leads → no RPC, existing erasure behaviour unchanged.
 *
 * The database half (tombstone, hash, no UPDATE/DELETE grant, rollback on
 * refusal) is proven against PostgreSQL in
 * backend/tests/realschema/pi_prov_privacy_marketpulse.test.ts.
 */
type Row = Record<string, unknown>;

const state = {
  leads: [] as Row[],
  persons: [] as Row[],
  contributionsProbe: { data: [] as Row[], error: null as { code?: string; message: string } | null },
  rpcCalls: [] as Array<{ fn: string; args: Row }>,
  rpcResult: { data: null as unknown, error: null as { code?: string; message: string } | null },
  observed: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: async (fn: string, args: Row) => {
    state.rpcCalls.push({ fn, args });
    state.observed.push('redact');
    return state.rpcResult;
  },
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.limit = () => b;
    b.eq = (c: string, v: unknown) => { filters.push([c, v]); return b; };
    b.is = (c: string, v: unknown) => { filters.push([c, v]); return b; };
    b.in = (c: string, vs: unknown[]) => { ins.push([c, vs]); return b; };
    b.not = () => b;
    b.update = () => { const u: Record<string, unknown> = { eq: () => u, not: () => u, is: () => u, select: async () => ({ data: [], error: null }) }; return u; };
    b.delete = () => {
      const df: Array<[string, unknown]> = [];
      const d: Record<string, unknown> = {};
      d.eq = (c: string, v: unknown) => { df.push([c, v]); return d; };
      d.select = async () => {
        state.observed.push('delete_person');
        const by = Object.fromEntries(df) as Row;
        const before = state.persons.length;
        state.persons = state.persons.filter((p) => !(p.id === by.id && p.company_id === by.company_id));
        return { data: before !== state.persons.length ? [{ id: by.id }] : [], error: null };
      };
      return d;
    };
    (b as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (table === 'canonical_leads') {
        const hit = state.leads.filter((r) => filters.every(([c, v]) => r[c] === v));
        return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
      }
      if (table === 'prospect_source_contributions') {
        state.observed.push(`probe:${JSON.stringify(ins)}`);
        return resolve(state.contributionsProbe);
      }
      return resolve({ data: [], error: null });
    };
    return b;
  },
}));

import { redactProspectContributions, redactContributionsForPerson, ProvenanceRedactionError, REDACTION_FUNCTION }
  from '../../services/prospectProvenance/redaction';
import { erasePerson, PersonErasureError } from '../../services/prospectIdentity/personErasure';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const PERSON = 'person-1';
const LEAD_1 = '10000000-0000-4000-8000-000000000001';
const LEAD_2 = '10000000-0000-4000-8000-000000000002';
const LEAD_B = '10000000-0000-4000-8000-0000000000b1';

beforeEach(() => {
  state.leads = [
    { id: LEAD_1, company_id: ORG_A, unified_person_id: PERSON },
    { id: LEAD_2, company_id: ORG_A, unified_person_id: PERSON },
    { id: LEAD_B, company_id: ORG_B, unified_person_id: PERSON },  // same person id, other tenant
  ];
  state.persons = [{ id: PERSON, company_id: ORG_A }];
  state.contributionsProbe = { data: [], error: null };
  state.rpcCalls = [];
  state.rpcResult = { data: { redacted: 2, already_redacted: 0, contribution_ids: ['c1', 'c2'] }, error: null };
  state.observed = [];
});

describe('redactProspectContributions', () => {
  it('calls the SECURITY DEFINER function with tenant, leads, reason and requester', async () => {
    const out = await redactProspectContributions({
      organizationId: ORG_A, canonicalLeadIds: [LEAD_1, LEAD_1, LEAD_2], reason: ' gdpr art.17 ', requestedBy: 'admin:u1',
    });
    expect(state.rpcCalls).toEqual([{ fn: REDACTION_FUNCTION, args: {
      p_organization_id: ORG_A, p_canonical_lead_ids: [LEAD_1, LEAD_2], p_reason: 'gdpr art.17', p_requested_by: 'admin:u1',
    } }]);
    expect(out).toEqual({ status: 'redacted', redacted: 2, alreadyRedacted: 0, contributionIds: ['c1', 'c2'] });
  });

  it('no leads → no call', async () => {
    expect(await redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [], reason: 'r', requestedBy: 'x' }))
      .toEqual({ status: 'nothing_to_redact', reason: 'no_leads' });
    expect(state.rpcCalls).toEqual([]);
  });

  it.each([
    [{ organizationId: '', canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' }, 'tenant_required'],
    [{ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: ' ', requestedBy: 'x' }, 'reason_required'],
    [{ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: '' }, 'requested_by_required'],
    [{ organizationId: ORG_A, canonicalLeadIds: ['not-a-uuid'], reason: 'r', requestedBy: 'x' }, 'invalid_lead_id'],
  ])('rejects bad input before any call (%#)', async (input, code) => {
    await expect(redactProspectContributions(input)).rejects.toMatchObject({ code });
    expect(state.rpcCalls).toEqual([]);
  });

  it('cross-tenant refusal (42501) is a ProvenanceRedactionError cross_tenant', async () => {
    state.rpcResult = { data: null, error: { code: '42501', message: 'a requested lead belongs to another tenant' } };
    const p = redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [LEAD_B], reason: 'r', requestedBy: 'x' });
    await expect(p).rejects.toBeInstanceOf(ProvenanceRedactionError);
    await expect(p).rejects.toMatchObject({ code: 'cross_tenant' });
  });

  it('any other RPC error throws with its code', async () => {
    state.rpcResult = { data: null, error: { code: '57014', message: 'canceling statement' } };
    await expect(redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' }))
      .rejects.toMatchObject({ code: '57014' });
  });

  describe('function not deployed (PGRST202 / 42883)', () => {
    beforeEach(() => { state.rpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; });

    it('ledger absent too → nothing to redact', async () => {
      state.contributionsProbe = { data: [], error: { code: 'PGRST205', message: 'relation missing' } };
      expect(await redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' }))
        .toEqual({ status: 'nothing_to_redact', reason: 'ledger_absent' });
    });

    it('ledger present, no contributions for these leads → nothing to redact (probe is tenant + lead scoped)', async () => {
      expect(await redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' }))
        .toEqual({ status: 'nothing_to_redact', reason: 'no_contributions' });
      expect(state.observed).toContain(`probe:${JSON.stringify([['canonical_lead_id', [LEAD_1]]])}`);
    });

    it('contributions exist → FAIL CLOSED (personal data would survive)', async () => {
      state.contributionsProbe = { data: [{ id: 'c1' }], error: null };
      await expect(redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' }))
        .rejects.toMatchObject({ code: 'redaction_unavailable' });
    });

    it('probe fails for another reason → FAIL CLOSED', async () => {
      state.contributionsProbe = { data: [], error: { code: '57014', message: 'timeout' } };
      await expect(redactProspectContributions({ organizationId: ORG_A, canonicalLeadIds: [LEAD_1], reason: 'r', requestedBy: 'x' }))
        .rejects.toMatchObject({ code: 'redaction_unavailable' });
    });
  });
});

describe('redactContributionsForPerson', () => {
  it('collects only THIS tenant\'s leads for the person', async () => {
    const out = await redactContributionsForPerson({ organizationId: ORG_A, personId: PERSON, reason: 'r', requestedBy: 'x' });
    expect(out.canonicalLeadIds.sort()).toEqual([LEAD_1, LEAD_2]);
    expect(state.rpcCalls[0].args.p_canonical_lead_ids).toEqual(expect.not.arrayContaining([LEAD_B]));
  });
});

describe('erasePerson — acceptance #10 wiring', () => {
  it('redacts the person\'s prospects\' contributions BEFORE deleting the person, and reports it', async () => {
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'subject request', requestedBy: 'admin:u9' });
    expect(state.observed.indexOf('redact')).toBeGreaterThan(-1);
    expect(state.observed.indexOf('redact')).toBeLessThan(state.observed.indexOf('delete_person'));
    expect(state.rpcCalls[0].args).toMatchObject({
      p_organization_id: ORG_A, p_reason: 'person erased: subject request', p_requested_by: 'admin:u9',
    });
    expect(res.deleted).toBe(true);
    expect(res.provenanceRedaction).toMatchObject({ status: 'redacted', redacted: 2 });
  });

  it('requester defaults to person_erasure', async () => {
    await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    expect(state.rpcCalls[0].args.p_requested_by).toBe('person_erasure');
  });

  it('a person with no prospects: no RPC, erasure proceeds exactly as before', async () => {
    state.leads = [];
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    expect(state.rpcCalls).toEqual([]);
    expect(res.deleted).toBe(true);
    expect(res.provenanceRedaction).toEqual({ status: 'nothing_to_redact', reason: 'no_leads', canonicalLeadIds: [] });
  });

  it.each([
    [{ code: '42501', message: 'other tenant' }, 'provenance_cross_tenant'],
    [{ code: '57014', message: 'timeout' }, 'provenance_57014'],
  ])('FAIL CLOSED: a redaction failure aborts the erasure with the person intact (%#)', async (error, code) => {
    state.rpcResult = { data: null, error };
    const p = erasePerson({ organizationId: ORG_A, personId: PERSON, reason: 'r' });
    await expect(p).rejects.toBeInstanceOf(PersonErasureError);
    await expect(p).rejects.toMatchObject({ code });
    expect(state.observed).not.toContain('delete_person');
    expect(state.persons).toHaveLength(1);
  });
});
