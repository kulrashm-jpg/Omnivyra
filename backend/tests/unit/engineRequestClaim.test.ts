/**
 * Follow-up D-2 — the engine-request claim wrapper (orchestration/engineRequestClaim.ts) and the
 * adapters' default claim route. The database function itself (lock, history, gap, claim) is
 * proven on PostgreSQL: d2_frequency_claim_concurrency_real.test.ts (independent connections)
 * and orch_engines_real.test.ts. Here: the exact call, every answer, and failing closed.
 */
const mockRpc = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
  ownedDbTable: () => { throw new Error('no table access in this suite'); },
}));

import { claimEngineRequest, claimRefusal, ENGINE_REQUEST_CLAIM_RPC, type ClaimOptions } from '../../services/orchestration/engineRequestClaim';
import { NON_CONTACT_CHANNELS } from '../../services/orchestration/journeyPolicy';
import { defaultWhatsAppDeps } from '../../services/orchestration/whatsappEngineAdapter';
import { defaultCommunityDeps } from '../../services/orchestration/communityEngineAdapter';

const ORG = '0e000000-0000-4000-8000-000000000001';
const TASK = '0e000000-0000-4000-8000-000000000002';
const NOW = '2026-11-09T12:00:00.000Z';
const answer = (row: Record<string, unknown>) => mockRpc.mockResolvedValueOnce({ data: [row], error: null });

beforeEach(() => mockRpc.mockReset());

describe('D-2: the claim call', () => {
  it('calls the database function once, tenant and task first, with the gap, the sweep clock and the non-contact channels', async () => {
    answer({ outcome: 'claimed', last_contact_at: null, basis: null });
    expect(await claimEngineRequest(ORG, TASK, { gapHours: 24, now: NOW, externalRef: 'act-1' })).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(ENGINE_REQUEST_CLAIM_RPC, {
      p_organization_id: ORG, p_execution_task_id: TASK, p_external_ref: 'act-1',
      p_min_gap_hours: 24, p_now: NOW, p_non_contact_channels: [...NON_CONTACT_CHANNELS],
    });
  });

  it.each([[undefined], [null], [0], [-3]])('no gap (%p) still goes through the function (the person lock), with p_min_gap_hours null', async (gapHours) => {
    answer({ outcome: 'claimed' });
    await claimEngineRequest(ORG, TASK, { gapHours: gapHours as number | null | undefined, now: NOW });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_min_gap_hours: null });
  });
});

describe('D-2: every answer', () => {
  it('not_claimed: false, no verdict (another caller holds it)', async () => {
    answer({ outcome: 'not_claimed' });
    const o: ClaimOptions = {};
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toBeUndefined();
  });

  it.each(['completed', 'possible_contact'])('deferred (%s): false, with the last contact and its basis', async (basis) => {
    answer({ outcome: 'deferred', last_contact_at: '2026-11-09T10:00:00.000Z', basis });
    const o: ClaimOptions = { gapHours: 24, now: NOW };
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toEqual({ outcome: 'deferred', lastContactAt: '2026-11-09T10:00:00.000Z', basis });
  });

  it.each(['invalid_history', 'task_not_found'])('%s: false, reported', async (outcome) => {
    answer({ outcome });
    const o: ClaimOptions = {};
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toEqual({ outcome });
  });
});

describe('D-2: fails closed — nothing is claimed, never an unguarded fallback', () => {
  it('a lock timeout (55P03) is unavailable', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '55P03', message: 'canceling statement due to lock timeout' } });
    const o: ClaimOptions = {};
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toEqual({ outcome: 'unavailable', code: '55P03' });
  });

  it('a missing function (the migration not applied) is unavailable', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const o: ClaimOptions = {};
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toEqual({ outcome: 'unavailable', code: 'PGRST202' });
  });

  it('a thrown error is unavailable', async () => {
    mockRpc.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    const o: ClaimOptions = {};
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toEqual({ outcome: 'unavailable', code: 'ECONNRESET' });
  });

  it.each([
    ['an empty answer', { data: [], error: null }],
    ['two rows', { data: [{ outcome: 'claimed' }, { outcome: 'claimed' }], error: null }],
    ['an unknown outcome', { data: [{ outcome: 'maybe' }], error: null }],
    ['a deferral without a readable time', { data: [{ outcome: 'deferred', last_contact_at: 'garbled', basis: 'completed' }], error: null }],
    ['a deferral with an unknown basis', { data: [{ outcome: 'deferred', last_contact_at: NOW, basis: 'guess' }], error: null }],
  ])('%s is unavailable, never a claim', async (_label, res) => {
    mockRpc.mockResolvedValueOnce(res);
    const o: ClaimOptions = {};
    expect(await claimEngineRequest(ORG, TASK, o)).toBe(false);
    expect(o.verdict).toEqual({ outcome: 'unavailable', code: 'claim_answer_unreadable' });
  });
});

describe('D-2: how an adapter reports it', () => {
  it('another caller: null (the existing "another sweep claimed" answer)', () => {
    expect(claimRefusal(undefined, 24, NOW)).toBeNull();
  });
  it('possible contact is described as possible, never as sent or delivered', () => {
    const r = claimRefusal({ outcome: 'deferred', lastContactAt: '2026-11-09T10:00:00.000Z', basis: 'possible_contact' }, 24, NOW)!;
    expect(r.outcome).toBe('frequency_deferred');
    expect(r.reason).toMatch(/queued or unconfirmed \(possible contact, not a confirmed send\) 2\.0h ago; policy requires 24h/);
    expect(r.reason).not.toMatch(/\bwas sent\b|\bdelivered\b/);
  });
  it('a completed contact is described as a contact', () => {
    expect(claimRefusal({ outcome: 'deferred', lastContactAt: '2026-11-09T11:00:00.000Z', basis: 'completed' }, 24, NOW)!.reason)
      .toMatch(/^the person was contacted 1\.0h ago/);
  });
  it.each([
    [{ outcome: 'invalid_history' as const }, 'frequency_history_invalid'],
    [{ outcome: 'task_not_found' as const }, 'request_unavailable'],
    [{ outcome: 'unavailable' as const, code: '55P03' }, 'claim_unavailable'],
  ])('%p → %s', (verdict, outcome) => {
    expect(claimRefusal(verdict, 24, NOW)!.outcome).toBe(outcome);
  });
});

describe('D-2: both adapters claim ONLY through the function', () => {
  it.each([
    ['whatsapp', defaultWhatsAppDeps.transitionRequest],
    ['community', defaultCommunityDeps.transitionRequest],
  ])('%s: requested -> submitting calls the claim function with the gap, never a bare update', async (_engine, transition) => {
    answer({ outcome: 'deferred', last_contact_at: '2026-11-09T10:00:00.000Z', basis: 'possible_contact' });
    const claim: ClaimOptions = { gapHours: 24, now: NOW };
    expect(await transition(ORG, TASK, 'requested', { state: 'submitting', external_ref: 'act-9' }, claim)).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith(ENGINE_REQUEST_CLAIM_RPC, expect.objectContaining({ p_min_gap_hours: 24, p_external_ref: 'act-9' }));
    expect(claim.verdict).toMatchObject({ outcome: 'deferred' });
  });

  it.each([
    ['whatsapp', defaultWhatsAppDeps.transitionRequest],
    ['community', defaultCommunityDeps.transitionRequest],
  ])('%s: any other transition is not a claim (no function call)', async (_engine, transition) => {
    await expect(transition(ORG, TASK, 'submitting', { state: 'submitted', external_ref: 'x' })).rejects.toThrow('no table access');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
