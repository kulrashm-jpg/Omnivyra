/**
 * MONEY (e9 ruling 2026-11-12, 20270217000003): webhook semantics.
 *  - a failure of the MONEY action (crediting / failing the purchase) -> the
 *    service throws RetryableWebhookError (the route answers non-2xx) and the
 *    event is recorded 'failed'; the provider's REDELIVERY is reprocessed;
 *  - a BOOKKEEPING failure (a state write) never fails the webhook;
 *  - a terminal event redelivered stays a duplicate (no double-processing);
 *  - 'ignored' is recorded as processed + reason.
 * The real processStripeWebhookEvent runs over faked I/O.
 */
import {
  processStripeWebhookEvent,
  RetryableWebhookError,
  type StripeEventPayload,
  type StripeWebhookDeps,
} from '../../services/payments/stripeWebhookService';

type Mark = { id: string; status: string; reason?: string };

function world(opts: { complete?: Array<{ success: boolean; reason?: string }>; state?: string; duplicate?: boolean; failPurchaseThrows?: boolean; markFails?: boolean } = {}) {
  const marks: Mark[] = [];
  const completeCalls: string[] = [];
  const completeQueue = [...(opts.complete ?? [{ success: true }])];
  const deps: StripeWebhookDeps = {
    recordEvent: async () => ({ id: 'ev-1', duplicate: opts.duplicate ?? false }),
    findPurchaseByProviderEventId: async () => ({ id: 'pur-1', organization_id: 'org-1', status: 'pending', fulfillment_status: null }),
    completePurchase: async (pid) => {
      completeCalls.push(pid);
      const r = completeQueue.shift() ?? { success: true };
      return r.success ? { success: true, purchaseId: pid, creditsGranted: 100 } : { success: false, reason: r.reason };
    },
    failPurchase: async () => { if (opts.failPurchaseThrows) throw new Error('db down'); },
    markEvent: async (id, status, reason) => {
      marks.push({ id, status, reason });
      if (opts.markFails) return { applied: false, current: null }; // bookkeeping failure: logged by the impl, resolves
      return { applied: true, current: status };
    },
    getEventState: async () => opts.state ?? 'recorded',
  };
  return { deps, marks, completeCalls };
}

const evt = (type: string): StripeEventPayload =>
  ({ id: 'evt_1', type, created: 1_700_000_000, data: { object: { id: 'pi_1', payment_intent: 'pi_1', amount_received: 1000, currency: 'usd' } } }) as unknown as StripeEventPayload;

it('MONEY: completePurchase reason=error -> RetryableWebhookError (non-2xx) and the event is recorded FAILED', async () => {
  const w = world({ complete: [{ success: false, reason: 'error' }] });
  await expect(processStripeWebhookEvent(evt('payment_intent.succeeded'), w.deps)).rejects.toBeInstanceOf(RetryableWebhookError);
  expect(w.marks).toEqual([{ id: 'ev-1', status: 'failed', reason: 'complete_purchase_error' }]);
});

it.each(['not_found', 'already_failed', 'already_completed'])('a DETERMINISTIC completePurchase outcome (%s) does NOT throw - a retry cannot change it', async (reason) => {
  const w = world({ complete: [{ success: false, reason }] });
  await expect(processStripeWebhookEvent(evt('payment_intent.succeeded'), w.deps)).resolves.toMatchObject({ status: 'processed' });
});

it('REDELIVERY of a FAILED event is REPROCESSED: requeued, the money action runs again, then processed', async () => {
  const w = world({ duplicate: true, state: 'failed', complete: [{ success: true }] });
  const out = await processStripeWebhookEvent(evt('payment_intent.succeeded'), w.deps);
  expect(out).toMatchObject({ status: 'processed', creditsGranted: 100 });
  expect(w.completeCalls).toEqual(['pur-1']);
  expect(w.marks.map((m) => m.status)).toEqual(['requeued', 'processed']);
});

it('REDELIVERY of an event whose processing never finished (crash: state recorded) is reprocessed', async () => {
  const w = world({ duplicate: true, state: 'recorded' });
  await expect(processStripeWebhookEvent(evt('payment_intent.succeeded'), w.deps)).resolves.toMatchObject({ status: 'processed' });
  expect(w.completeCalls).toEqual(['pur-1']);
});

it.each(['processed', 'duplicate'])('REDELIVERY of a TERMINAL (%s) event stays a duplicate - no second money action', async (state) => {
  const w = world({ duplicate: true, state });
  await expect(processStripeWebhookEvent(evt('payment_intent.succeeded'), w.deps)).resolves.toMatchObject({ status: 'duplicate' });
  expect(w.completeCalls).toEqual([]);
  expect(w.marks).toEqual([]);
});

it('BOOKKEEPING failure (the state write does not apply) never fails the webhook', async () => {
  const w = world({ markFails: true });
  await expect(processStripeWebhookEvent(evt('payment_intent.succeeded'), w.deps)).resolves.toMatchObject({ status: 'processed' });
});

it('MONEY: failPurchase throwing -> RetryableWebhookError, recorded failed', async () => {
  const w = world({ failPurchaseThrows: true });
  await expect(processStripeWebhookEvent(evt('payment_intent.payment_failed'), w.deps)).rejects.toBeInstanceOf(RetryableWebhookError);
  expect(w.marks[0]).toMatchObject({ status: 'failed' });
  expect(String(w.marks[0].reason)).toMatch(/^fail_purchase_error:/);
});

it("an unsupported event type is recorded 'processed' with reason 'ignored:...' (no 'ignored' status - e9)", async () => {
  const w = world();
  await expect(processStripeWebhookEvent(evt('customer.created'), w.deps)).resolves.toMatchObject({ status: 'ignored' });
  expect(w.marks).toEqual([{ id: 'ev-1', status: 'processed', reason: 'ignored:unsupported_event_type:customer.created' }]);
});
