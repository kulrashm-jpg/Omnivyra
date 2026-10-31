/**
 * Person erasure application service (personErasureRequests.ts) — unit level.
 *
 * `erasePerson` and the database seams are doubled so every branch of the
 * service (status derivation, error-code reduction, subject validation, retry
 * routing, the owner-decision switch) is exercised deterministically. The real
 * procedure + real ledger + real verification run end to end in
 * backend/tests/realschema/pi_person_erasure_api_wiring.test.ts.
 */
const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
const tableCalls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const rpcResults: Record<string, Array<{ data: unknown; error: unknown }>> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const call = { table, filters: [] as Array<[string, unknown]> };
    tableCalls.push(call);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => { call.filters.push([c, v]); return b; };
    b.in = (c: string, v: unknown) => { call.filters.push([c, v]); return b; };
    b.maybeSingle = () => b;
    b.then = (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => {
      const next = (tables[table] ?? []).shift() ?? { data: null, error: null };
      return Promise.resolve(next).then(r, j);
    };
    return b;
  },
  ownedDbRpc: async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return (rpcResults[fn] ?? []).shift() ?? { data: null, error: null };
  },
}));

const erasePerson = jest.fn();
jest.mock('../../services/prospectIdentity/personErasure', () => {
  class PersonErasureError extends Error {
    constructor(message: string, public readonly code: string) { super(message); }
  }
  return { erasePerson: (...a: unknown[]) => erasePerson(...a), PersonErasureError };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/prospectIdentity/personErasureRequests') as typeof import('../../services/prospectIdentity/personErasureRequests');
const { PersonErasureError } = require('../../services/prospectIdentity/personErasure') as { PersonErasureError: new (m: string, c: string) => Error };

const ORG = '00000000-0000-4000-8000-00000000000a';
const PERSON = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-31T12:00:00Z');

const row = (over: Partial<import('../../services/prospectIdentity/personErasureRequests').LedgerRow> = {}) => ({
  id: REQ, organization_id: ORG, person_id: PERSON, reason: 'data_subject_request', requested_by: 'erasure-api:company_admin',
  status: 'pending' as const, attempts: 1, lease_expires_at: null,
  governance_reanchored_at: null, governance_revoked_at: null, evidence_links_cleared_at: null,
  provenance_erased_at: null, person_deleted_at: null, finalize_counts: null, last_error_code: null,
  last_attempt_at: '2026-10-31T11:59:00Z', created_at: '2026-10-31T11:59:00Z', completed_at: null, ...over,
});
const completed = (over = {}) => row({
  status: 'completed', person_id: null, governance_reanchored_at: 't', governance_revoked_at: 't', evidence_links_cleared_at: 't',
  provenance_erased_at: 't', person_deleted_at: 't', completed_at: 't',
  finalize_counts: { legacy_lead_fields: 'redact', outreach_decision_person_ref: 'null' }, ...over,
});
const verification = (checks: Array<{ check: string; category: string; count: number }>, outcome: 'clean' | 'residual' = 'residual') => ({
  id: 'v-1', request_id: REQ, verified_at: '2026-10-31T12:00:00Z', outcome, checks, policies: null, inventory_purged: outcome === 'clean',
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  tableCalls.length = 0; rpcCalls.length = 0;
  erasePerson.mockReset();
});

describe('deriveErasureStatus — the documented ledger → API mapping', () => {
  const d = (r: ReturnType<typeof row>, v: ReturnType<typeof verification> | null = null, acc = new Set<string>()) =>
    svc.deriveErasureStatus(r, v as never, NOW, acc);

  it('pending, nothing done → REQUESTED', () => expect(d(row())).toBe('REQUESTED'));
  it('pending, lease live → IN_PROGRESS', () => expect(d(row({ lease_expires_at: '2026-10-31T12:05:00Z' }))).toBe('IN_PROGRESS'));
  it('pending, lease expired with markers and no outcome → PARTIALLY_COMPLETED', () =>
    expect(d(row({ lease_expires_at: '2026-10-31T11:00:00Z', governance_reanchored_at: 't' }))).toBe('PARTIALLY_COMPLETED'));
  it('pending, retryable error → RETRY_REQUIRED', () => expect(d(row({ last_error_code: 'reanchor_failed' }))).toBe('RETRY_REQUIRED'));
  it.each(['merge_survivor', 'delete_blocked', 'person_vanished_outside_ledger', 'inventory_missing'])(
    'pending, %s → FAILED_REQUIRES_REVIEW', (code) => expect(d(row({ last_error_code: code }))).toBe('FAILED_REQUIRES_REVIEW'));
  it('pending, person gone outside the ledger → FAILED_REQUIRES_REVIEW', () => expect(d(row({ person_id: null }))).toBe('FAILED_REQUIRES_REVIEW'));
  it('completed, never verified → PARTIALLY_COMPLETED (never COMPLETED on the delete alone)', () =>
    expect(d(completed())).toBe('PARTIALLY_COMPLETED'));
  it('completed + clean verification → COMPLETED', () => expect(d(completed(), verification([], 'clean'))).toBe('COMPLETED'));
  it('completed + residual known gap → FAILED_REQUIRES_REVIEW by default', () =>
    expect(d(completed(), verification([{ check: 'form_conversions.rows', category: 'known_gap', count: 2 }]))).toBe('FAILED_REQUIRES_REVIEW'));
  it('completed + residual known gap that an owner decision accepts → COMPLETED', () =>
    expect(d(completed(), verification([{ check: 'form_conversions.rows', category: 'known_gap', count: 2 }]), new Set(['form_conversions.rows']))).toBe('COMPLETED'));
  it('a violation is never acceptable, even if listed', () =>
    expect(d(completed(), verification([{ check: 'unified_persons.row', category: 'violation', count: 1 }]), new Set(['unified_persons.row']))).toBe('FAILED_REQUIRES_REVIEW'));
  it('info checks never block', () =>
    expect(d(completed(), verification([{ check: 'outreach_tasks.lead_key_prospect', category: 'info', count: 3 }]))).toBe('COMPLETED'));
  it('the shipped switch accepts nothing (no owner decision is signed)', () => expect(svc.ACCEPTED_RESIDUAL_CHECKS.size).toBe(0));
});

describe('input validation helpers', () => {
  it('isUuid / reference pattern refuse addresses, spaces and injection', () => {
    expect(svc.isUuid(PERSON)).toBe(true);
    expect(svc.isUuid("x' OR 1=1")).toBe(false);
    expect(svc.ERASURE_REFERENCE_RE.test('TICKET-123')).toBe(true);
    expect(svc.ERASURE_REFERENCE_RE.test('jane@example.com')).toBe(false);
    expect(svc.ERASURE_REFERENCE_RE.test('Jane Doe')).toBe(false);
    expect(svc.erasureReason('data_subject_request', 'T-1')).toBe('data_subject_request ref=T-1');
  });
});

describe('startPersonErasure', () => {
  const input = { organizationId: ORG, personId: PERSON, reason: 'data_subject_request', requestedBy: 'erasure-api:company_admin', now: () => NOW };

  it('the subject is looked up TENANT-FIRST; absent (unknown or other tenant) → subject_not_found, erasePerson never runs', async () => {
    tables.unified_persons = [{ data: null, error: null }];
    expect(await svc.startPersonErasure(input)).toEqual({ kind: 'subject_not_found' });
    expect(erasePerson).not.toHaveBeenCalled();
    expect(tableCalls[0]).toEqual({ table: 'unified_persons', filters: [['company_id', ORG], ['id', PERSON]] });
  });

  it('malformed ids never reach the database', async () => {
    expect(await svc.startPersonErasure({ ...input, personId: 'nope' })).toEqual({ kind: 'subject_not_found' });
    expect(tableCalls).toHaveLength(0);
  });

  it('success: erasePerson with the capture hook, then verification, then COMPLETED from the ledger', async () => {
    tables.unified_persons = [{ data: { id: PERSON }, error: null }];
    erasePerson.mockImplementation(async (i: { beforeFinalize: (h: unknown) => Promise<void> }) => {
      await i.beforeFinalize({ requestId: REQ, leaseToken: 'lease-1', resumed: false });
      return { requestId: REQ, deleted: true };
    });
    tables.person_erasure_requests = [{ data: completed(), error: null }];
    tables.person_erasure_verifications = [{ data: [verification([], 'clean')], error: null }];
    const out = await svc.startPersonErasure(input);
    expect(out.kind === 'request' && out.view.status).toBe('COMPLETED');
    expect(rpcCalls.map((c) => c.fn)).toEqual(['pi_person_erasure_capture_inventory', 'pi_person_erasure_verify']);
    expect(rpcCalls[0].args).toEqual({ p_organization_id: ORG, p_request_id: REQ, p_lease_token: 'lease-1' });
    expect(erasePerson.mock.calls[0][0]).toMatchObject({ organizationId: ORG, personId: PERSON, requestedBy: 'erasure-api:company_admin' });
  });

  it('a capture failure throws a coded PersonErasureError from the hook (fails the attempt closed)', async () => {
    rpcResults.pi_person_erasure_capture_inventory = [{ data: null, error: { code: '42883', message: 'function does not exist' } }];
    await expect(svc.captureErasureInventory(ORG, { requestId: REQ, leaseToken: 'l' })).rejects.toMatchObject({ code: 'verification_unavailable' });
    rpcResults.pi_person_erasure_capture_inventory = [{ data: null, error: { code: '55P03', message: 'lease_lost' } }];
    await expect(svc.captureErasureInventory(ORG, { requestId: REQ, leaseToken: 'l' })).rejects.toMatchObject({ code: 'erasure_lease_lost' });
  });

  it('concurrent run (erasure_in_progress) → IN_PROGRESS from the ledger; nothing else attempted', async () => {
    tables.unified_persons = [{ data: { id: PERSON }, error: null }];
    erasePerson.mockRejectedValue(new PersonErasureError('another erasure of this person is in progress', 'erasure_in_progress'));
    tables.person_erasure_requests = [{ data: row({ lease_expires_at: '2026-10-31T12:09:00Z', governance_reanchored_at: 't' }), error: null }];
    tables.person_erasure_verifications = [{ data: [], error: null }];
    const out = await svc.startPersonErasure(input);
    expect(out).toMatchObject({ kind: 'request', errorCode: 'erasure_in_progress', view: { status: 'IN_PROGRESS', requestId: REQ } });
    expect(rpcCalls).toHaveLength(0);
  });

  it('an error message that quotes an address never leaves the service — only its code', async () => {
    tables.unified_persons = [{ data: { id: PERSON }, error: null }];
    erasePerson.mockRejectedValue(new PersonErasureError("could not carry governance record g1 forward onto 'jane@example.com'", 'reanchor_failed'));
    tables.person_erasure_requests = [{ data: row({ last_error_code: 'reanchor_failed', governance_reanchored_at: null }), error: null }];
    tables.person_erasure_verifications = [{ data: [], error: null }];
    const out = await svc.startPersonErasure(input);
    expect(out).toMatchObject({ kind: 'request', errorCode: 'reanchor_failed', view: { status: 'RETRY_REQUIRED' } });
    expect(JSON.stringify(out)).not.toMatch(/@|jane/i);
  });

  it('an unexpected (non-erasure) error is reduced to "unexpected"', async () => {
    tables.unified_persons = [{ data: { id: PERSON }, error: null }];
    erasePerson.mockRejectedValue(new Error('socket hang up near jane@example.com'));
    tables.person_erasure_requests = [{ data: null, error: null }];
    const out = await svc.startPersonErasure(input);
    expect(out).toMatchObject({ kind: 'request', errorCode: 'unexpected', view: { status: 'RETRY_REQUIRED', requestId: null } });
    expect(JSON.stringify(out)).not.toMatch(/@/);
  });

  it('undeployed ledger → ledger_unavailable; cross_tenant from the ledger → subject_not_found', async () => {
    tables.unified_persons = [{ data: { id: PERSON }, error: null }, { data: { id: PERSON }, error: null }];
    erasePerson.mockRejectedValueOnce(new PersonErasureError('x', 'erasure_ledger_unavailable'));
    expect(await svc.startPersonErasure(input)).toEqual({ kind: 'ledger_unavailable' });
    erasePerson.mockRejectedValueOnce(new PersonErasureError('x', 'cross_tenant'));
    expect(await svc.startPersonErasure(input)).toEqual({ kind: 'subject_not_found' });
  });

  it('verification failure after a completed delete → PARTIALLY_COMPLETED with the code, never COMPLETED', async () => {
    tables.unified_persons = [{ data: { id: PERSON }, error: null }];
    erasePerson.mockResolvedValue({ requestId: REQ, deleted: true });
    rpcResults.pi_person_erasure_verify = [{ data: null, error: { code: '08006', message: 'connection failure' } }];
    tables.person_erasure_requests = [{ data: completed(), error: null }];
    tables.person_erasure_verifications = [{ data: [], error: null }];
    const out = await svc.startPersonErasure(input);
    expect(out).toMatchObject({ kind: 'request', errorCode: 'verification_failed', view: { status: 'PARTIALLY_COMPLETED' } });
  });
});

describe('retryErasureRequest', () => {
  it('pending request: the PERSON COMES FROM THE LEDGER ROW, with the stored reason', async () => {
    tables.person_erasure_requests = [{ data: row({ last_error_code: 'reanchor_failed' }), error: null }, { data: completed(), error: null }];
    tables.unified_persons = [{ data: { id: PERSON }, error: null }];
    erasePerson.mockResolvedValue({ requestId: REQ, deleted: true });
    tables.person_erasure_verifications = [{ data: [verification([], 'clean')], error: null }];
    const out = await svc.retryErasureRequest(ORG, REQ, 'erasure-api:company_admin', () => NOW);
    expect(out.kind === 'request' && out.view.status).toBe('COMPLETED');
    expect(erasePerson.mock.calls[0][0]).toMatchObject({ personId: PERSON, reason: 'data_subject_request' });
    expect(tableCalls[0].filters).toEqual([['organization_id', ORG], ['id', REQ]]);
  });

  it('unknown / other-tenant request → request_not_found', async () => {
    tables.person_erasure_requests = [{ data: null, error: null }];
    expect(await svc.retryErasureRequest(ORG, REQ, 'x')).toEqual({ kind: 'request_not_found' });
  });

  it('completed but residual → re-runs verification only; erasePerson is not called', async () => {
    tables.person_erasure_requests = [{ data: completed(), error: null }];
    tables.person_erasure_verifications = [
      { data: [verification([{ check: 'form_conversions.rows', category: 'known_gap', count: 1 }])], error: null },
      { data: [verification([], 'clean')], error: null },
    ];
    const out = await svc.retryErasureRequest(ORG, REQ, 'x', () => NOW);
    expect(erasePerson).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.fn)).toEqual(['pi_person_erasure_verify']);
    expect(out.kind === 'request' && out.view.status).toBe('COMPLETED');
  });

  it('completed and clean → nothing re-run', async () => {
    tables.person_erasure_requests = [{ data: completed(), error: null }];
    tables.person_erasure_verifications = [{ data: [verification([], 'clean')], error: null }, { data: [verification([], 'clean')], error: null }];
    await svc.retryErasureRequest(ORG, REQ, 'x', () => NOW);
    expect(rpcCalls).toHaveLength(0);
  });

  it('pending with the person gone outside the ledger → FAILED_REQUIRES_REVIEW + code', async () => {
    tables.person_erasure_requests = [{ data: row({ person_id: null }), error: null }];
    tables.person_erasure_verifications = [{ data: [], error: null }];
    const out = await svc.retryErasureRequest(ORG, REQ, 'x', () => NOW);
    expect(out).toMatchObject({ kind: 'request', errorCode: 'person_vanished_outside_ledger', view: { status: 'FAILED_REQUIRES_REVIEW' } });
  });
});

describe('views never expose a person id after completion', () => {
  it('toView: personId only while pending', () => {
    expect(svc.toView(row(), null, NOW).personId).toBe(PERSON);
    expect(svc.toView(completed(), null, NOW).personId).toBeNull();
  });
});
