/**
 * LI-3D — the person anchor reaching Path B.
 *
 * The LI-3C audit's finding P2-1 was that a person-anchored governance record
 * could never match, because `OutreachTask` carries a `leadId` and nothing
 * resolved it to `unified_persons.id`. These tests are the closure proof: the
 * same record the audit demonstrated was silently ALLOWED must now BLOCK, and
 * it must do so without weakening tenant scoping or the fail-closed posture.
 */

type Row = Record<string, unknown>;

const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

let leadRows: Row[] = [];
let leadError: { message?: string } | null = null;
let governanceRows: Row[] = [];
let governanceError: { message?: string } | null = null;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, filters: [] as Array<[string, unknown]> };
    queries.push(rec);
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = () => chain();
    builder.limit = () => chain();
    builder.eq = (c: string, v: unknown) => { rec.filters.push([c, v]); return chain(); };
    builder.is = (c: string, v: unknown) => { rec.filters.push([c, v]); return chain(); };
    builder.in = (c: string, v: unknown) => { rec.filters.push([c, v]); return chain(); };
    (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (table === 'leads') {
        return resolve(leadError ? { error: leadError } : { data: leadRows, error: null });
      }
      if (table === 'contact_governance_records') {
        if (governanceError) return resolve({ error: governanceError });
        // Emulate the repository's two narrow reads: return only rows matching
        // whichever anchor this particular query filtered on.
        const f = new Map(rec.filters);
        const rows = governanceRows.filter((r) =>
          (f.has('person_id') && r.person_id === f.get('person_id')) ||
          (f.has('target_normalized') && r.target_normalized === f.get('target_normalized')));
        return resolve({ data: rows, error: null });
      }
      return resolve({ data: [], error: null });
    };
    return builder;
  },
}));

import { resolveCanonicalGovernance, resolveLeadPersonId } from '../../services/leadOutreachExecution/governanceService';
import type { OutreachTask } from '../../services/leadOutreachExecution/types';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PERSON = 'person-1';
const LEAD = 'lead-1';
const NOW = '2026-08-14T12:00:00.000Z';
const TARGET = 'x@example.test';

const task = (over: Partial<OutreachTask> = {}): OutreachTask =>
  ({ id: 't1', leadId: LEAD, channel: 'email', ...over } as OutreachTask);

const govRow = (over: Row = {}): Row => ({
  id: 'g1',
  organization_id: ORG_A,
  person_id: PERSON,
  target_normalized: null,
  channel: '*',
  governance_type: 'dnc_permanent',
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_until: null,
  revoked_at: null,
  ...over,
});

beforeEach(() => {
  queries.length = 0;
  leadRows = [{ id: LEAD, unified_person_id: PERSON }];
  leadError = null;
  governanceRows = [];
  governanceError = null;
});

describe('LI-3D — resolveLeadPersonId', () => {
  it('resolves the canonical person from the lead, tenant-scoped', async () => {
    const r = await resolveLeadPersonId(ORG_A, LEAD);
    expect(r).toEqual({ ok: true, personId: PERSON });

    const q = queries.find((x) => x.table === 'leads');
    expect(q!.filters[0][0]).toBe('company_id');       // TENANT FIRST
    expect(q!.filters[0][1]).toBe(ORG_A);
    expect(new Map(q!.filters).get('id')).toBe(LEAD);
  });

  it('a lead with no canonical link is not a failure — target matching remains', async () => {
    leadRows = [{ id: LEAD, unified_person_id: null }];
    expect(await resolveLeadPersonId(ORG_A, LEAD)).toEqual({ ok: true, personId: null });
  });

  it('a lead belonging to another tenant resolves to nothing, not to their person', async () => {
    leadRows = [];                                      // tenant predicate excluded it
    expect(await resolveLeadPersonId(ORG_B, LEAD)).toEqual({ ok: true, personId: null });
  });

  it('an unreadable lead fails closed', async () => {
    leadError = { message: 'connection reset' };
    expect(await resolveLeadPersonId(ORG_A, LEAD)).toEqual({ ok: false, personId: null });
  });

  it('no lead id is simply no anchor', async () => {
    expect(await resolveLeadPersonId(ORG_A, null)).toEqual({ ok: true, personId: null });
  });
});

describe('LI-3D — P2-1 closure: a person-anchored record now blocks Path B', () => {
  it('BLOCKS on a person-only record that LI-3C would have allowed', async () => {
    governanceRows = [govRow()];                        // anchored to the person, no target
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('blocked');
    expect(v!.governanceType).toBe('dnc_permanent');
    expect(v!.matchedBy).toBe('person');
  });

  it('still blocks on a target-only record', async () => {
    governanceRows = [govRow({ person_id: null, target_normalized: TARGET, channel: 'email', governance_type: 'unsubscribe' })];
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('blocked');
    expect(v!.matchedBy).toBe('target');
  });

  it('blocks on a record carrying BOTH anchors', async () => {
    governanceRows = [govRow({ target_normalized: TARGET, channel: '*' })];
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('blocked');
  });

  it('allows when the tenant has no governance at all', async () => {
    governanceRows = [];
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('allowed');
  });

  it('an explicitly supplied personId still wins over lead resolution', async () => {
    leadRows = [{ id: LEAD, unified_person_id: 'someone-else' }];
    governanceRows = [govRow({ person_id: 'explicit-person' })];
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, 'explicit-person', NOW);
    expect(v!.decision).toBe('blocked');
    // The lead was never read, because the caller already knew the person.
    expect(queries.some((q) => q.table === 'leads')).toBe(false);
  });
});

describe('LI-3D — tenant isolation of the person anchor', () => {
  it("Tenant A's person governance does not block Tenant B", async () => {
    governanceRows = [govRow({ organization_id: ORG_A })];
    // Tenant B resolves its own lead; the repository filters by tenant and the
    // evaluator refuses a record belonging to another organisation.
    const v = await resolveCanonicalGovernance(ORG_B, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('allowed');
  });

  it('the governance read is tenant-scoped on its first predicate', async () => {
    governanceRows = [govRow()];
    await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    const g = queries.find((q) => q.table === 'contact_governance_records');
    expect(g!.filters[0][0]).toBe('organization_id');
    expect(g!.filters[0][1]).toBe(ORG_A);
  });
});

describe('LI-3D — fail-closed is preserved', () => {
  it('an unreadable lead blocks rather than degrading to target-only matching', async () => {
    leadError = { message: 'connection reset' };
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('blocked');
    expect(v!.reason).toBe('governance_person_resolution_failed_failclosed');
  });

  it('an unreadable governance table still blocks', async () => {
    governanceError = { message: 'permission denied' };
    const v = await resolveCanonicalGovernance(ORG_A, task(), TARGET, null, NOW);
    expect(v!.decision).toBe('blocked');
    expect(v!.reason).toBe('governance_lookup_failed_failclosed');
  });

  it('no anchor at all yields no canonical verdict, not a false allow', async () => {
    leadRows = [{ id: LEAD, unified_person_id: null }];
    const v = await resolveCanonicalGovernance(ORG_A, task(), null, null, NOW);
    expect(v).toBeNull();
  });
});
