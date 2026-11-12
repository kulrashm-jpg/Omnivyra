/**
 * MONEY guard (2026-11-12): the idempotency lookups behind every credit
 * primitive. A failed read used to answer "not held / not confirmed / not
 * released", so a retried request whose work was already confirmed re-ran the
 * paid work; a failed hold-split read became a "corrupted hold, start fresh with
 * a zero split". Both now throw - the caller fails closed and NO reservation
 * RPC is issued on an unread answer.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockRead: () => Res = () => ({ data: null, error: null });
const mockRpc: string[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const b: any = {};
      for (const m of ['select', 'eq']) b[m] = () => b;
      b.maybeSingle = async () => mockRead();
      return b;
    },
    rpc: async (fn: string) => { mockRpc.push(fn); return { data: { id: 'tx' }, error: null }; },
  },
}));

import { findCreditTransaction, loadCreditHoldSplit } from '../../repositories/creditExecutionRepository';

const DOWN = () => ({ data: null, error: { message: 'connection reset' } });
beforeEach(() => { mockRead = () => ({ data: null, error: null }); mockRpc.length = 0; });

it('findCreditTransaction: read error THROWS - never "not already confirmed"', async () => {
  mockRead = DOWN;
  await expect(findCreditTransaction('job-1:confirm')).rejects.toThrow(/idempotency lookup failed for job-1:confirm/);
});

it('findCreditTransaction control: a clean miss is null, a hit is returned', async () => {
  await expect(findCreditTransaction('k')).resolves.toBeNull();
  mockRead = () => ({ data: { id: 't1', execution_phase: 'confirm' }, error: null });
  await expect(findCreditTransaction('k')).resolves.toEqual({ id: 't1', execution_phase: 'confirm' });
});

it('loadCreditHoldSplit: read error THROWS - never a "corrupted hold" restarted with a zero split', async () => {
  mockRead = DOWN;
  await expect(loadCreditHoldSplit('hold-1')).rejects.toThrow(/hold split read failed/);
});

it('loadCreditHoldSplit control: a clean row returns the absolute split', async () => {
  mockRead = () => ({ data: { free_delta: -5, paid_delta: -2, incentive_delta: 0 }, error: null });
  await expect(loadCreditHoldSplit('hold-1')).resolves.toEqual({ free: 5, incentive: 0, paid: 2 });
});

it('no reservation RPC is issued by the lookups themselves', async () => {
  mockRead = DOWN;
  await findCreditTransaction('k').catch(() => undefined);
  await loadCreditHoldSplit('h').catch(() => undefined);
  expect(mockRpc).toEqual([]);
});
