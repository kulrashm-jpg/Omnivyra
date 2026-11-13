/**
 * B6 (financial-writes contract; e9 BLOCKING, e1 approved: typed error) - purchase status writes are READ.
 *   - failPurchase: an update ERROR throws PurchaseStateWriteError { code: 'PURCHASE_FAIL_UNRECORDED', retryable: true }
 *     (it used to leave a failed payment's purchase 'pending' silently); 0 rows is fine (the pending guard).
 *   - completePurchase: when the credit grant fails AND the fulfillment_status='failed' write fails too, it is
 *     logged (the purchase would otherwise look fine with no credits).
 *   - the super-admin 'fail' action maps PurchaseStateWriteError to a retryable 503, not a 500.
 */
type Row = Record<string, any>;
const mockDb: { purchase: Row; failUpdate: Record<string, { message: string } | null>; zeroRows: boolean; updates: Row[] } = {
  purchase: {}, failUpdate: {}, zeroRows: false, updates: [],
};

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/monetizationOpsService', () => ({ recordMonetizationOperationalEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: jest.fn(async () => { throw new Error('ledger unavailable'); }),
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const b: any = {};
    let patch: Row | null = null;
    const outcome = () => {
      const kind = patch?.status === 'failed' ? 'fail' : patch?.fulfillment_status === 'failed' ? 'mark' : 'other';
      mockDb.updates.push({ kind, patch });
      const err = mockDb.failUpdate[kind] ?? null;
      if (!err && patch) Object.assign(mockDb.purchase, patch);
      return { err, kind };
    };
    b.select = () => {
      if (!patch) return b;
      const { err } = outcome();
      const r: any = Promise.resolve(err ? { data: null, error: err } : { data: mockDb.zeroRows ? [] : [{ id: mockDb.purchase.id }], error: null });
      r.maybeSingle = async () => (err ? { data: null, error: err } : { data: { id: mockDb.purchase.id }, error: null });
      return r;
    };
    b.eq = () => b;
    b.maybeSingle = async () => ({ data: { ...mockDb.purchase }, error: null });
    b.update = (p: Row) => { patch = p; return b; };
    b.then = (res: any, rej: any) => {
      if (!patch) return Promise.resolve({ data: null, error: null }).then(res, rej);
      const { err } = outcome();
      return Promise.resolve({ data: null, error: err }).then(res, rej);
    };
    return b;
  },
}));

import { failPurchase, completePurchase, PurchaseStateWriteError } from '../../services/purchaseService';
import { logger } from '../../services/logger';
import { recordMonetizationOperationalEvent } from '../../services/monetizationOpsService';

const PENDING = { id: 'pur-1', organization_id: 'org-1', credits: 100, status: 'pending', amount_paid: 5, currency: 'USD', fulfillment_status: 'pending' };
beforeEach(() => { mockDb.purchase = { ...PENDING }; mockDb.failUpdate = {}; mockDb.zeroRows = false; mockDb.updates = []; (logger.error as jest.Mock).mockClear(); (recordMonetizationOperationalEvent as jest.Mock).mockClear(); });

describe('failPurchase', () => {
  it('CONTROL: a recorded failure resolves and the purchase is failed', async () => {
    await expect(failPurchase('pur-1', 'pay_1')).resolves.toBeUndefined();
    expect(mockDb.purchase.status).toBe('failed');
  });
  it('0 rows (no longer pending) resolves - the existing guard, not an error', async () => {
    mockDb.zeroRows = true;
    await expect(failPurchase('pur-1')).resolves.toBeUndefined();
  });
  it('an update ERROR throws a TYPED, retryable PurchaseStateWriteError (it used to vanish)', async () => {
    mockDb.failUpdate.fail = { message: 'connection reset' };
    const err = await failPurchase('pur-1').catch((e) => e);
    expect(err).toBeInstanceOf(PurchaseStateWriteError);
    expect(err).toMatchObject({ code: 'PURCHASE_FAIL_UNRECORDED', retryable: true });
    expect(String(err.message)).toContain('connection reset');
  });
});

describe('completePurchase - a failed grant whose failure is not recorded', () => {
  it('CONTROL: grant fails, failure recorded -> success:false, no unrecorded-failure log', async () => {
    const r = await completePurchase('pur-1');
    expect(r).toMatchObject({ success: false, reason: 'error' });
    expect((logger.error as jest.Mock).mock.calls.map((c: any[]) => c[0])).not.toContain('purchase_fulfillment_failure_unrecorded');
    expect(recordMonetizationOperationalEvent).not.toHaveBeenCalled();
  });
  it('grant fails AND the fulfillment_status write fails -> logged (never silent)', async () => {
    mockDb.failUpdate.mark = { message: 'timeout' };
    const r = await completePurchase('pur-1');
    expect(r).toMatchObject({ success: false, reason: 'error' });
    expect(logger.error).toHaveBeenCalledWith('purchase_fulfillment_failure_unrecorded', expect.objectContaining({ purchaseId: 'pur-1', creditError: 'ledger unavailable', message: 'timeout' }));
    // e1 F5: and an alert-ready CRITICAL operational event (money integrity: paid, no credits, no trace)
    expect(recordMonetizationOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'monetization.purchase_fulfillment_failure_unrecorded', severity: 'CRITICAL', purchaseId: 'pur-1',
      organizationId: 'org-1', alertKey: 'purchase_fulfillment_failure_unrecorded',
    }));
  });
});

describe('super-admin purchases/complete maps the typed error', () => {
  const mapsToRetryable503 = (src: string) =>
    /await failPurchase\([^)]*\);\s*\}\s*catch\s*\((\w+)\)\s*\{[\s\S]{0,200}?\1 instanceof PurchaseStateWriteError[\s\S]{0,120}?status\(503\)/.test(src);
  it('the fail action returns a retryable 503 for PurchaseStateWriteError (not a 500)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../../pages/api/super-admin/purchases/complete.ts'), 'utf8');
    expect(mapsToRetryable503(src)).toBe(true);
    // POSITIVE CONTROL: the old unguarded call does not pass
    expect(mapsToRetryable503("    await failPurchase(purchase_id, reference_id);\n    return res.status(200).json({ success: true });")).toBe(false);
  });
});
