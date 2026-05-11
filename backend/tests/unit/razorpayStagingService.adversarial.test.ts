import crypto from 'crypto';

const mockOwnedDbTable = jest.fn();
const mockCompletePurchase = jest.fn();
const mockFailPurchase = jest.fn();
const mockRecordPaymentProviderEvent = jest.fn();

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (...args: any[]) => mockOwnedDbTable(...args),
}));

jest.mock('../../services/purchaseService', () => ({
  completePurchase: (...args: any[]) => mockCompletePurchase(...args),
  failPurchase: (...args: any[]) => mockFailPurchase(...args),
  recordPaymentProviderEvent: (...args: any[]) => mockRecordPaymentProviderEvent(...args),
}));

const purchase = {
  id: 'purchase-1',
  organization_id: 'org-1',
  credits: 100,
  amount_paid: 499,
  amount_subunits: 49900,
  currency: 'INR',
  status: 'pending',
  fulfillment_status: 'pending',
  provider_order_id: 'order_test_1',
  provider_mode: 'test',
};

function signWebhook(rawBody: string): string {
  return crypto.createHmac('sha256', process.env.RAZORPAY_TEST_WEBHOOK_SECRET!).update(rawBody).digest('hex');
}

function signPayment(orderId = 'order_test_1', paymentId = 'pay_test_1'): string {
  return crypto.createHmac('sha256', process.env.RAZORPAY_TEST_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');
}

function capturedWebhook(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_test_1',
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: 'pay_test_1',
          order_id: 'order_test_1',
          amount: 49900,
          currency: 'INR',
          status: 'captured',
          ...overrides,
        },
      },
    },
  });
}

function tableChain(table: string) {
  const selectRow = table === 'credit_purchases'
    ? purchase
    : table === 'credit_packages'
      ? { id: 'pkg-1', credits: 100, price: 499, is_active: true }
      : null;
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    update: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: selectRow, error: null })),
    single: jest.fn(async () => ({ data: { id: 'inserted' }, error: null })),
  };
  chain.then = undefined;
  return chain;
}

describe('razorpayStagingService adversarial safety', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.RAZORPAY_STAGING_ENABLED = 'true';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'test_secret';
    process.env.RAZORPAY_TEST_WEBHOOK_SECRET = 'webhook_secret';
    delete process.env.RAZORPAY_WEBHOOK_MAX_EVENT_AGE_SECONDS;
    mockOwnedDbTable.mockImplementation((table: string) => tableChain(table));
    mockRecordPaymentProviderEvent.mockResolvedValue({ id: 'provider-event-1', duplicate: false, processingStatus: 'recorded' });
    mockCompletePurchase.mockResolvedValue({ success: true, purchaseId: 'purchase-1', creditsGranted: 100 });
    mockFailPurchase.mockResolvedValue(undefined);
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pay_test_1', order_id: 'order_test_1', amount: 49900, currency: 'INR', status: 'captured' }),
    })) as any;
  });

  it('processes a valid captured webhook exactly once through canonical purchase fulfillment', async () => {
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');
    const rawBody = capturedWebhook();

    const result = await handleRazorpayStagingWebhook({ rawBody, signature: signWebhook(rawBody) });

    expect(result).toMatchObject({ status: 'processed', purchaseId: 'purchase-1', paymentId: 'pay_test_1' });
    expect(mockRecordPaymentProviderEvent).toHaveBeenCalledTimes(1);
    expect(mockCompletePurchase).toHaveBeenCalledTimes(1);
    expect(mockCompletePurchase).toHaveBeenCalledWith('purchase-1', 'pay_test_1');
    expect(mockFailPurchase).not.toHaveBeenCalled();
  });

  it('treats processed duplicate webhooks as no-op and does not re-fulfill', async () => {
    mockRecordPaymentProviderEvent.mockResolvedValue({ id: 'provider-event-1', duplicate: true, processingStatus: 'processed' });
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');
    const rawBody = capturedWebhook();

    const result = await handleRazorpayStagingWebhook({ rawBody, signature: signWebhook(rawBody) });

    expect(result).toEqual({ status: 'duplicate', eventId: 'evt_test_1' });
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('retries recorded duplicate webhooks to close crash-after-event-before-fulfillment windows', async () => {
    mockRecordPaymentProviderEvent.mockResolvedValue({ id: 'provider-event-1', duplicate: true, processingStatus: 'recorded' });
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');
    const rawBody = capturedWebhook();

    const result = await handleRazorpayStagingWebhook({ rawBody, signature: signWebhook(rawBody) });

    expect(result).toMatchObject({ status: 'processed', purchaseId: 'purchase-1' });
    expect(mockCompletePurchase).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid webhook signatures, records a rejected provider event, and does not fulfill', async () => {
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');
    const rawBody = capturedWebhook();

    const result = await handleRazorpayStagingWebhook({ rawBody, signature: 'bad-signature' });

    expect(result).toEqual({ status: 'failed', reason: 'invalid_signature' });
    expect(mockRecordPaymentProviderEvent).toHaveBeenCalledWith(expect.objectContaining({
      providerEventId: expect.stringContaining('rejected:invalid_signature:'),
    }));
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('rejects modified payloads because the original signature no longer matches', async () => {
    const original = capturedWebhook();
    const modified = capturedWebhook({ amount: 1 });
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');

    const result = await handleRazorpayStagingWebhook({ rawBody: modified, signature: signWebhook(original) });

    expect(result.status).toBe('failed');
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('fails amount mismatch without granting credits', async () => {
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');
    const rawBody = capturedWebhook({ amount: 100 });

    const result = await handleRazorpayStagingWebhook({ rawBody, signature: signWebhook(rawBody) });

    expect(result).toMatchObject({ status: 'failed', reason: 'amount_or_currency_mismatch', purchaseId: 'purchase-1' });
    expect(mockFailPurchase).toHaveBeenCalledWith('purchase-1', 'pay_test_1');
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('fails currency mismatch without granting credits', async () => {
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');
    const rawBody = capturedWebhook({ currency: 'USD' });

    const result = await handleRazorpayStagingWebhook({ rawBody, signature: signWebhook(rawBody) });

    expect(result).toMatchObject({ status: 'failed', reason: 'amount_or_currency_mismatch' });
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('rejects stale signed webhook payloads when max age is configured', async () => {
    process.env.RAZORPAY_WEBHOOK_MAX_EVENT_AGE_SECONDS = '30';
    const oldPayload = JSON.stringify({
      id: 'evt_old',
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000) - 3600,
      payload: { payment: { entity: { id: 'pay_old', order_id: 'order_test_1', amount: 49900, currency: 'INR', status: 'captured' } } },
    });
    const { handleRazorpayStagingWebhook } = await import('../../services/payments/razorpayStagingService');

    const result = await handleRazorpayStagingWebhook({ rawBody: oldPayload, signature: signWebhook(oldPayload) });

    expect(result).toEqual({ status: 'failed', reason: 'stale_event' });
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('rejects duplicate verify endpoint calls only economically through idempotent completePurchase', async () => {
    mockRecordPaymentProviderEvent
      .mockResolvedValueOnce({ id: 'checkout-event-1', duplicate: false, processingStatus: 'recorded' })
      .mockResolvedValueOnce({ id: 'checkout-event-1', duplicate: true, processingStatus: 'processed' });
    mockCompletePurchase
      .mockResolvedValueOnce({ success: true, purchaseId: 'purchase-1', creditsGranted: 100 })
      .mockResolvedValueOnce({ success: true, purchaseId: 'purchase-1', creditsGranted: 100 });

    const { verifyAndFulfillRazorpayStagingPayment } = await import('../../services/payments/razorpayStagingService');
    const first = await verifyAndFulfillRazorpayStagingPayment({
      orderId: 'order_test_1',
      paymentId: 'pay_test_1',
      signature: signPayment(),
      expectedOrganizationId: 'org-1',
    });
    const second = await verifyAndFulfillRazorpayStagingPayment({
      orderId: 'order_test_1',
      paymentId: 'pay_test_1',
      signature: signPayment(),
      expectedOrganizationId: 'org-1',
    });

    expect(first).toMatchObject({ status: 'processed', duplicateEvent: false });
    expect(second).toMatchObject({ status: 'processed', duplicateEvent: true });
    expect(mockCompletePurchase).toHaveBeenCalledTimes(2);
    expect(mockCompletePurchase).toHaveBeenNthCalledWith(1, 'purchase-1', 'pay_test_1');
    expect(mockCompletePurchase).toHaveBeenNthCalledWith(2, 'purchase-1', 'pay_test_1');
  });

  it('rejects verify calls with mismatched organization ownership before fulfillment', async () => {
    const { verifyAndFulfillRazorpayStagingPayment } = await import('../../services/payments/razorpayStagingService');

    const result = await verifyAndFulfillRazorpayStagingPayment({
      orderId: 'order_test_1',
      paymentId: 'pay_test_1',
      signature: signPayment(),
      expectedOrganizationId: 'other-org',
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'organization_mismatch' });
    expect(mockRecordPaymentProviderEvent).not.toHaveBeenCalled();
    expect(mockCompletePurchase).not.toHaveBeenCalled();
  });

  it('rejects live keys in the staging order path', async () => {
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_live_bad';
    const { createRazorpayStagingCreditOrder } = await import('../../services/payments/razorpayStagingService');

    await expect(createRazorpayStagingCreditOrder({
      organizationId: 'org-1',
      packageId: 'pkg-1',
      requestedBy: 'admin-1',
    })).rejects.toThrow('Live Razorpay key is not allowed');
  });
});
