/**
 * ES-101 — approval persistence must never be reported as success when it did not land.
 *
 * THE DEFECT: recordApproval ignored the upsert's `error` and returned { id: null }, and
 * revokeApproval ignored the update's `error` entirely. The route then answered 201 / 200, so an
 * operator saw "approved" for an approval that was never stored (every dispatch then refused), and
 * — worse — "revoked" for an approval that stayed ACTIVE.
 *
 * The approval store is stubbed at the ownedDbTable seam; the service logic runs for real.
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));

import { ownedDbTable } from '../../db/writeOwner';
import {
  recordApproval,
  revokeApproval,
  ApprovalPersistenceError,
} from '../../services/execution/executionApprovalService';

type Result = { data?: unknown; error?: unknown };

/** upsert(row, opts).select('id').maybeSingle() → result (or throws). */
function upsertChain(result: Result | Error) {
  const calls: { table?: string; row?: Record<string, unknown>; opts?: unknown } = {};
  const maybeSingle = jest.fn(async () => { if (result instanceof Error) throw result; return result; });
  const select = jest.fn(() => ({ maybeSingle }));
  const upsert = jest.fn((row: Record<string, unknown>, opts: unknown) => { calls.row = row; calls.opts = opts; return { select }; });
  (ownedDbTable as jest.Mock).mockImplementation((table: string) => { calls.table = table; return { upsert }; });
  return calls;
}

/** update(patch).eq(...)×4 → awaited result (or throws). */
function updateChain(result: Result | Error) {
  const filters: Array<[string, unknown]> = [];
  const builder: any = {
    eq: jest.fn((col: string, val: unknown) => { filters.push([col, val]); return builder; }),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject),
  };
  const update = jest.fn(() => builder);
  (ownedDbTable as jest.Mock).mockImplementation(() => ({ update }));
  return { filters, update };
}

const INPUT = { companyId: 'co-1', campaignId: 'camp-1', version: 'v1', approverId: 'user-1', reason: 'ok', correlationId: 'corr-1' };

beforeEach(() => (ownedDbTable as jest.Mock).mockReset());

describe('recordApproval', () => {
  it('persists the bound approval and returns the stored id', async () => {
    const calls = upsertChain({ data: { id: 'appr-9' }, error: null });
    await expect(recordApproval(INPUT)).resolves.toEqual({ id: 'appr-9' });
    expect(calls.table).toBe('execution_approvals');
    expect(calls.opts).toEqual({ onConflict: 'company_id,campaign_id,version' });
    expect(calls.row).toMatchObject({
      company_id: 'co-1', campaign_id: 'camp-1', version: 'v1', approved_by: 'user-1',
      active: true, revoked_at: null, revoked_by: null, reason: 'ok', correlation_id: 'corr-1',
    });
  });

  it('a database error is surfaced, not reported as success', async () => {
    const dbError = { code: '42P01', message: 'relation "public.execution_approvals" does not exist' };
    upsertChain({ data: null, error: dbError });
    const err = await recordApproval(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalPersistenceError);
    expect(err.code).toBe('approval_persist_failed');
    // The client-facing message is the stable code; the DB detail stays on `cause`.
    expect(err.message).toBe('approval_persist_failed');
    expect(err.message).not.toMatch(/relation|does not exist/);
    expect(err.cause).toBe(dbError);
  });

  it('a thrown client/network error is surfaced as a persistence failure', async () => {
    const boom = new Error('fetch failed');
    upsertChain(boom);
    const err = await recordApproval(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalPersistenceError);
    expect(err.code).toBe('approval_persist_failed');
    expect(err.cause).toBe(boom);
  });

  it('a write that returns no row is unconfirmed, not success', async () => {
    upsertChain({ data: null, error: null });
    const err = await recordApproval(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalPersistenceError);
    expect(err.code).toBe('approval_persist_unconfirmed');
  });
});

describe('revokeApproval', () => {
  it('revokes only the active approval bound to (company, campaign, version)', async () => {
    const { filters, update } = updateChain({ error: null });
    await expect(revokeApproval({ companyId: 'co-1', campaignId: 'camp-1', version: 'v1', actorId: 'user-2', reason: 'stop' })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ active: false, revoked_by: 'user-2', reason: 'stop' }));
    expect(filters).toEqual([['company_id', 'co-1'], ['campaign_id', 'camp-1'], ['version', 'v1'], ['active', true]]);
  });

  it('a database error is surfaced — a failed revoke must not read as done', async () => {
    const dbError = { code: '57014', message: 'canceling statement due to statement timeout' };
    updateChain({ error: dbError });
    const err = await revokeApproval({ companyId: 'co-1', campaignId: 'camp-1', actorId: 'user-2' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalPersistenceError);
    expect(err.code).toBe('approval_revoke_failed');
    expect(err.message).toBe('approval_revoke_failed');
    expect(err.cause).toBe(dbError);
  });

  it('a thrown error is surfaced as a revoke failure', async () => {
    updateChain(new Error('fetch failed'));
    const err = await revokeApproval({ companyId: 'co-1', campaignId: 'camp-1', actorId: 'user-2' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalPersistenceError);
    expect(err.code).toBe('approval_revoke_failed');
  });
});
