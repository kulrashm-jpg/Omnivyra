/**
 * 20270217000003 readers: overlayPaymentEventState puts each ledger row's REAL state
 * and attributes (side tables) over its inline columns - the inline
 * processing_status is permanently 'recorded' and provider_order_id was never set.
 * The fake applies .in() over stored rows.
 */
export {};
const mockTables: Record<string, Array<Record<string, unknown>>> = {};
const mockFail: Record<string, boolean> = {};
jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: jest.fn(),
  ownedDbTable: (t: string) => {
    let rows = [...(mockTables[t] ?? [])];
    const b: any = {
      select: () => b,
      in: (c: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[c])); return b; },
      then: (ok: any, ko: any) => Promise.resolve(mockFail[t] ? { data: null, error: { message: 'down' } } : { data: rows, error: null }).then(ok, ko),
    };
    return b;
  },
}));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { overlayPaymentEventState } from '../../services/payments/paymentEventState';

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  for (const k of Object.keys(mockFail)) delete mockFail[k];
});

const ledger = [
  { id: 'e1', processing_status: 'recorded', error_message: null, processed_at: null, provider_order_id: null, provider_payment_id: null },
  { id: 'e2', processing_status: 'recorded', error_message: null, processed_at: null, provider_order_id: 'inline_o2', provider_payment_id: null },
];

it('the side-table STATE and ATTRIBUTES win over the stale inline columns', async () => {
  mockTables.payment_provider_event_state = [{ provider_event_pk: 'e1', processing_status: 'failed', error_message: 'fulfillment_error', processed_at: null }];
  mockTables.payment_provider_event_attributes = [{ provider_event_pk: 'e1', provider_order_id: 'order_1', provider_payment_id: 'pay_1' }];
  const [r1] = await overlayPaymentEventState(ledger);
  expect(r1).toMatchObject({ processing_status: 'failed', error_message: 'fulfillment_error', provider_order_id: 'order_1', provider_payment_id: 'pay_1' });
});

it('TRANSITIONAL fallback: a row with no side-table rows keeps its inline values', async () => {
  const [, r2] = await overlayPaymentEventState(ledger);
  expect(r2).toMatchObject({ processing_status: 'recorded', provider_order_id: 'inline_o2' });
});

it('a read error THROWS (a reader must not report a stale state as current)', async () => {
  mockFail.payment_provider_event_state = true;
  await expect(overlayPaymentEventState(ledger)).rejects.toThrow(/state overlay read failed/);
});

it('control: an empty input makes no reads and returns []', async () => {
  mockFail.payment_provider_event_state = true; // would throw if read
  await expect(overlayPaymentEventState([])).resolves.toEqual([]);
});
