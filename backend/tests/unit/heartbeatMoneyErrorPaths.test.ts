/**
 * MONEY-adjacent unread-error sites (2026-11-12): liveness heartbeats.
 * A heartbeat is best-effort (it must never fail the paid work it reports on),
 * but a SILENT failure makes a live operation look stuck and invites
 * auto-expiry to "recover" it. Every failure is now logged; nothing throws.
 */
export {};
const mockWarn = jest.fn();
let mockReadErr: { message: string } | null = null;
let mockWriteErr: { message: string } | null = null;

jest.mock('../../services/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      let op = 'select';
      const b: any = {};
      b.select = () => b;
      b.update = () => { op = 'update'; return b; };
      b.eq = () => (op === 'update' ? Promise.resolve({ data: null, error: mockWriteErr }) : b);
      b.maybeSingle = async () => ({ data: mockReadErr ? null : { metadata: {} }, error: mockReadErr });
      return b;
    },
  },
}));

beforeEach(() => { jest.resetModules(); mockWarn.mockReset(); mockReadErr = null; mockWriteErr = null; });

async function load() { return import('../../services/billing/idempotency/heartbeatService'); }

it('billing-operation heartbeat: read error is logged, never thrown', async () => {
  mockReadErr = { message: 'down' };
  const { heartbeatBillingOperation } = await load();
  await expect(heartbeatBillingOperation('op-r')).resolves.toBeUndefined();
  expect(mockWarn).toHaveBeenCalledWith('heartbeat_billing_op_failed', expect.objectContaining({ step: 'read' }));
});

it('billing-operation heartbeat: write error is logged, never thrown', async () => {
  mockWriteErr = { message: 'down' };
  const { heartbeatBillingOperation } = await load();
  await expect(heartbeatBillingOperation('op-w')).resolves.toBeUndefined();
  expect(mockWarn).toHaveBeenCalledWith('heartbeat_billing_op_failed', expect.objectContaining({ step: 'write' }));
});

it('job-registry heartbeat: write error is logged, never thrown', async () => {
  mockWriteErr = { message: 'down' };
  const { heartbeatJobRegistry } = await load();
  await expect(heartbeatJobRegistry('hash-1')).resolves.toBeUndefined();
  expect(mockWarn).toHaveBeenCalledWith('heartbeat_job_registry_failed', expect.objectContaining({ executionHash: 'hash-1' }));
});

it('control: clean heartbeats log nothing', async () => {
  const { heartbeatBillingOperation, heartbeatJobRegistry } = await load();
  await heartbeatBillingOperation('op-ok');
  await heartbeatJobRegistry('hash-ok');
  expect(mockWarn).not.toHaveBeenCalled();
});
