/**
 * BLOCKING money fix (e9 ruling 2026-11-13): the Stripe webhook swallowed every billing_subscriptions ledger failure,
 * marked the event processed and answered 200, so Stripe never retried a dropped cancel/activation.
 *
 * Now (processStripeWebhookEvent, record_subscription branch):
 *  - the ledger result is READ; a terminal outcome marks the event 'processed' (2xx); anything else marks it 'failed'
 *    and THROWS (the route answers 500, Stripe redelivers);
 *  - 'processed' is written only AFTER a terminal apply, never before;
 *  - a redelivery of an event whose earlier attempt failed is REPROCESSED (not short-circuited as a duplicate);
 *  - a terminal outcome is never retried: its redelivery is a duplicate and the ledger is not called again.
 *
 * The event store is a FAITHFUL stateful fake of payment_provider_events: insert-once per provider event id (a repeat
 * returns duplicate + the row's CURRENT processing_status), markEvent updates that status.
 */
import {
  processStripeWebhookEvent,
  isTerminalSubscriptionOutcome,
  SubscriptionLedgerRetryableError,
  type StripeWebhookDeps,
  type StripeEventPayload,
} from '../../services/payments/stripeWebhookService';

type Outcome = { applied: boolean; reason?: string };
let store: Map<string, { id: string; status: string; reason?: string | null }>;
let calls: string[];
let ledger: Array<Outcome | Error>;
let ledgerCalls: number;

function deps(): StripeWebhookDeps {
  return {
    recordEvent: async (input) => {
      const row = store.get(input.providerEventId);
      if (row) return { id: row.id, duplicate: true, processingStatus: row.status };
      const id = `ppe_${store.size + 1}`;
      store.set(input.providerEventId, { id, status: 'recorded' });
      return { id, duplicate: false, processingStatus: 'recorded' };
    },
    findPurchaseByProviderEventId: async () => null,
    completePurchase: async () => ({ success: false, reason: 'unused' }),
    failPurchase: async () => undefined,
    applySubscriptionEvent: async () => {
      ledgerCalls += 1;
      calls.push('apply');
      const next = ledger.length > 1 ? ledger.shift()! : ledger[0];
      if (next instanceof Error) throw next;
      return next;
    },
    markEvent: async (id, status, reason) => {
      calls.push(`mark:${status}`);
      for (const row of store.values()) if (row.id === id) { row.status = status; row.reason = reason ?? null; }
    },
  };
}

const subEvent = (id = 'evt_sub_1'): StripeEventPayload => ({
  id,
  type: 'customer.subscription.updated',
  created: 1781000000,
  data: { object: { id: 'sub_1', metadata: { organization_id: 'org-A' } } },
  livemode: false,
} as unknown as StripeEventPayload);
const statusOf = (id = 'evt_sub_1') => store.get(id)?.status;

beforeEach(() => { store = new Map(); calls = []; ledger = [{ applied: true }]; ledgerCalls = 0; });

describe('ledger outcome → webhook result mapping', () => {
  const TERMINAL: Outcome[] = [
    { applied: true },
    { applied: false, reason: 'stale_event' },
    { applied: false, reason: 'duplicate_event' },
    { applied: false, reason: 'incomplete_event' },
    { applied: false, reason: 'missing_event_ref' },
  ];
  const RETRYABLE: Outcome[] = [
    { applied: false, reason: 'no_org' }, // DATABASE state (05/e9): the webhook can beat our customer->org write
    { applied: false, reason: 'subscription_event_contention' },
    { applied: false, reason: 'db_error:connection reset' },
    { applied: false, reason: 'invalid_event_stamp' },
    { applied: false, reason: 'permission denied for table billing_subscriptions' }, // a raw read/write error message
    { applied: false, reason: 'failed to parse filter (metadata->stripe_last_event->>id)' }, // a PostgREST parse error
    { applied: false }, // no reason at all
  ];

  for (const o of TERMINAL) {
    it(`TERMINAL ${JSON.stringify(o)} → processed (2xx), marked processed AFTER the apply`, async () => {
      ledger = [o];
      const r = await processStripeWebhookEvent(subEvent(), deps());
      expect(r.status).toBe('processed');
      expect(statusOf()).toBe('processed');
      expect(calls).toEqual(['apply', 'mark:processed']);
    });
  }

  for (const o of RETRYABLE) {
    it(`RETRYABLE ${JSON.stringify(o)} → throws (route answers 500), marked failed, NEVER marked processed`, async () => {
      ledger = [o];
      await expect(processStripeWebhookEvent(subEvent(), deps())).rejects.toBeInstanceOf(SubscriptionLedgerRetryableError);
      expect(statusOf()).toBe('failed');
      expect(calls).toEqual(['apply', 'mark:failed']);
      expect(calls).not.toContain('mark:processed');
    });
  }

  it('a ledger that THROWS → throws (500), marked failed, never processed', async () => {
    ledger = [new Error('connection reset')];
    await expect(processStripeWebhookEvent(subEvent(), deps())).rejects.toThrow(/subscription_ledger_threw:connection reset/);
    expect(statusOf()).toBe('failed');
    expect(calls).toEqual(['apply', 'mark:failed']);
  });

  it('isTerminalSubscriptionOutcome: null / undefined is NOT terminal', () => {
    expect(isTerminalSubscriptionOutcome(null)).toBe(false);
    expect(isTerminalSubscriptionOutcome(undefined)).toBe(false);
  });
});

describe('redelivery', () => {
  it('after a 500 (failed), the SAME event is REPROCESSED and then marked processed', async () => {
    ledger = [{ applied: false, reason: 'subscription_event_contention' }, { applied: true }];
    await expect(processStripeWebhookEvent(subEvent(), deps())).rejects.toBeInstanceOf(SubscriptionLedgerRetryableError);
    expect(statusOf()).toBe('failed');
    const r = await processStripeWebhookEvent(subEvent(), deps()); // Stripe's redelivery
    expect(r.status).toBe('processed');
    expect(ledgerCalls).toBe(2);
    expect(statusOf()).toBe('processed');
  });

  it('no_org (the webhook beat our customer->org write) answers 500; the redelivery AFTER the mapping exists APPLIES', async () => {
    // Faithful: the org comes from the purchase lookup, which only finds the row once our own write has committed;
    // the ledger answers no_org exactly when it is given no organization.
    let mappingCommitted = false;
    const d: StripeWebhookDeps = {
      ...deps(),
      findPurchaseByProviderEventId: async (id: string) =>
        mappingCommitted && id === 'sub_1' ? { id: 'cp_1', organization_id: 'org-A', status: 'pending', fulfillment_status: null } : null,
      applySubscriptionEvent: async (_t, _o, organizationId) => {
        ledgerCalls += 1;
        return organizationId ? { applied: true } : { applied: false, reason: 'no_org' };
      },
    };
    const noMeta = { ...subEvent(), data: { object: { id: 'sub_1' } } } as unknown as StripeEventPayload;
    await expect(processStripeWebhookEvent(noMeta, d)).rejects.toThrow(/subscription_ledger_failed:no_org/);
    expect(statusOf()).toBe('failed');
    mappingCommitted = true;
    const r = await processStripeWebhookEvent(noMeta, d); // Stripe's redelivery
    expect(r).toMatchObject({ status: 'processed', organizationId: 'org-A' });
    expect(ledgerCalls).toBe(2);
    expect(statusOf()).toBe('processed');
  });

  it('a row still "recorded" (a crash before any mark) is reprocessed too', async () => {
    store.set('evt_sub_1', { id: 'ppe_x', status: 'recorded' });
    const r = await processStripeWebhookEvent(subEvent(), deps());
    expect(r.status).toBe('processed');
    expect(ledgerCalls).toBe(1);
  });

  it('a TERMINAL outcome is never retried: its redelivery is a duplicate and the ledger is NOT called again', async () => {
    ledger = [{ applied: false, reason: 'incomplete_event' }];
    expect((await processStripeWebhookEvent(subEvent(), deps())).status).toBe('processed');
    for (let i = 0; i < 3; i++) {
      expect((await processStripeWebhookEvent(subEvent(), deps())).status).toBe('duplicate');
    }
    expect(ledgerCalls).toBe(1);
  });

  it('an APPLIED event redelivered is a duplicate (no second apply)', async () => {
    await processStripeWebhookEvent(subEvent(), deps());
    expect((await processStripeWebhookEvent(subEvent(), deps())).status).toBe('duplicate');
    expect(ledgerCalls).toBe(1);
  });

  // PROD-FAITHFUL (e1, 2026-11-13; migration 20260663:88-91): payment_provider_events has a BEFORE UPDATE trigger that
  // raises on EVERY update, and the route's markEvent ignores the error, so on main no state mark ever persists: every
  // row stays 'recorded'. The retry contract must hold anyway: the 500/2xx answer does not depend on the mark, and a
  // 'recorded' redelivery is reprocessed (idempotently).
  it('PROD-FAITHFUL (state marks never persist): a failure still answers 500 and the redelivery still applies', async () => {
    ledger = [{ applied: false, reason: 'subscription_event_contention' }, { applied: true }];
    const d = { ...deps(), markEvent: async () => undefined }; // the UPDATE is rejected and the error ignored
    await expect(processStripeWebhookEvent(subEvent(), d)).rejects.toBeInstanceOf(SubscriptionLedgerRetryableError);
    expect(statusOf()).toBe('recorded');
    expect((await processStripeWebhookEvent(subEvent(), d)).status).toBe('processed');
    expect(ledgerCalls).toBe(2);
  });

  it('PROD-FAITHFUL: a terminal event redelivered while its row is stuck at "recorded" is reprocessed idempotently (2xx again, same outcome)', async () => {
    ledger = [{ applied: false, reason: 'duplicate_event' }];
    const d = { ...deps(), markEvent: async () => undefined };
    expect((await processStripeWebhookEvent(subEvent(), d)).status).toBe('processed');
    expect((await processStripeWebhookEvent(subEvent(), d)).status).toBe('processed');
    expect(statusOf()).toBe('recorded');
  });

  it('scope: a NON-subscription event marked failed keeps the plain duplicate short-circuit (other branches unchanged)', async () => {
    store.set('evt_charge_1', { id: 'ppe_c', status: 'failed' });
    const charge = { ...subEvent('evt_charge_1'), type: 'charge.refunded' } as StripeEventPayload;
    expect((await processStripeWebhookEvent(charge, deps())).status).toBe('duplicate');
  });
});
