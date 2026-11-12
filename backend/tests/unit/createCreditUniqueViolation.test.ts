/**
 * 05/e9 (2026-11-12): createCredit's "already granted" hatch branches on the SQLSTATE
 * (23505) AND the idempotency key being named - never on message text. Postgres's
 * 23505 message is 'duplicate key value violates unique constraint "..."'; PostgREST
 * puts 'Key (idempotency_key)=(...) already exists.' in DETAILS. The old check looked
 * for 'unique_violation' / 'already exists' in the MESSAGE, so it never fired.
 */
export {};
let mockRpcError: Record<string, unknown> | null = null;
jest.mock('../../repositories/creditExecutionRepository', () => ({
  callCreditReservation: async () => ({ data: mockRpcError ? null : { id: 't1' }, error: mockRpcError }),
  callCreditPartialConfirm: jest.fn(),
  findCreditTransaction: jest.fn(),
  loadCreditHoldSplit: jest.fn(),
}));

import { createCredit } from '../../services/creditExecutionServiceRuntimeEntry';

const ORG = '00000000-0000-4000-8000-0000000000bb';
const grant = () => createCredit({
  orgId: ORG, amount: 250, category: 'paid', referenceType: 'credit_purchase', referenceId: '00000000-0000-4000-8000-0000000000cc',
  note: 'test', performedBy: ORG, idempotencyKey: 'k-1',
} as any);

it('a REAL 23505 shape naming the idempotency key (in details) -> already granted, resolves', async () => {
  mockRpcError = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "credit_transactions_idempotency_key_lockdown_unique"',
    details: 'Key (idempotency_key)=(k-1) already exists.',
  };
  await expect(grant()).resolves.toBeUndefined();
});

it('a 23505 on a DIFFERENT constraint is a real failure (throws)', async () => {
  mockRpcError = { code: '23505', message: 'duplicate key value violates unique constraint "some_other_unique"', details: 'Key (reference_id)=(x) already exists.' };
  await expect(grant()).rejects.toThrow(/grant failed/);
});

it("control: message text alone ('already exists' with no 23505) is NOT trusted", async () => {
  mockRpcError = { code: 'P0001', message: 'something already exists idempotency_key' };
  await expect(grant()).rejects.toThrow(/grant failed/);
});

it('control: a clean grant resolves', async () => {
  mockRpcError = null;
  await expect(grant()).resolves.toBeUndefined();
});
