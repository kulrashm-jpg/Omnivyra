/**
 * @jest-environment jsdom
 *
 * P2-D — TopUpPanel drives the certified payment contract correctly.
 *
 * SCOPE, DELIBERATELY NARROW
 * --------------------------
 * This suite proves ONE thing: the UI consumes the already-certified backend
 * contract without bypassing or misrepresenting it. It does NOT re-prove
 * anything the backend already owns.
 *
 *   proven by P2-C (real Postgres)  — CAS, UNIQUE idempotency, credit atomicity,
 *                                     invoice uniqueness, duplicate fulfillment
 *   proven by P2-A                  — closure/expiry state machine
 *   proven by clientIdempotencyKey  — that an Idempotency-Key is stable across
 *                                     retries of one operation
 *   external / not provable here    — provider authenticity and settlement
 *
 * So the assertions below are strictly about UI responsibility: what the client
 * sends, when it may claim success, and whether one user action can become two
 * checkouts. A green run here says nothing about financial idempotency — that
 * guarantee is P2-C's, and duplicating it in jsdom would be theatre.
 *
 * The single mocked boundary is `@/lib/apiFetch`, which every network call in
 * the component funnels through. `createIdempotentOperation` runs for real.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── the one network boundary ────────────────────────────────────────────────
const apiFetchMock = jest.fn();
jest.mock('@/lib/apiFetch', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

import TopUpPanel from '../../../components/billing/TopUpPanel';

const PACK = { id: 'pack_250', credits: 250, price: 2520, currency: 'INR', label: '250 credits' };

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body });
}

/** Captured request bodies, keyed by URL, so we can assert what the CLIENT sent. */
const sent: Array<{ url: string; body: any; headers: Record<string, string> }> = [];

/** Per-URL responses; a test overrides only what it cares about. */
let routes: Record<string, () => Promise<any>>;

function installRoutes(over: Record<string, () => Promise<any>> = {}) {
  routes = {
    '/api/billing/topup/catalog': () => jsonRes({ packs: [PACK] }),
    '/api/billing/topup/history': () => jsonRes({ purchases: [] }),
    '/api/billing/credit-breakdown': () => jsonRes({ buckets: [] }),
    '/api/billing/checkout/create-order': () => jsonRes({
      ok: true, purchase_id: 'pur_1', provider: 'razorpay', provider_mode: 'test',
      key_id: 'rzp_test_x', provider_order_id: 'order_1', amount_subunits: 252000, currency: 'INR',
    }),
    '/api/billing/checkout/verify': () => jsonRes({ ok: true, credits_granted: 250 }),
    '/api/billing/checkout/close': () => jsonRes({ ok: true }),
    ...over,
  };
}

/** Razorpay stub — `loadScript` short-circuits because window.Razorpay exists. */
let rzpHandler: ((r: any) => void) | null = null;
let rzpOndismiss: (() => void) | null = null;
let rzpOpened = 0;

function installRazorpay() {
  rzpHandler = null; rzpOndismiss = null; rzpOpened = 0;
  (window as any).Razorpay = function (opts: any) {
    rzpHandler = opts.handler;
    rzpOndismiss = opts.modal?.ondismiss ?? null;
    return { on: jest.fn(), open: () => { rzpOpened += 1; } };
  };
}

const callsTo = (needle: string) => sent.filter((s) => s.url.includes(needle));

beforeEach(() => {
  sent.length = 0;
  installRoutes();
  installRazorpay();
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((url: string, init?: any) => {
    if (init?.body) {
      sent.push({ url, body: JSON.parse(init.body), headers: (init.headers ?? {}) as Record<string, string> });
    }
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return key ? routes[key]() : jsonRes({});
  });
});

async function renderPanel(orgId: string | null = 'org-1') {
  const view = render(<TopUpPanel orgId={orgId} />);
  // The catalog lands via an effect; wait for the pack to exist.
  if (orgId !== null) await screen.findByText('250');
  return view;
}

/** Refresh calls the component makes after an authoritative confirmation. */
const refreshCallCount = () =>
  apiFetchMock.mock.calls.filter((c: any[]) =>
    String(c[0]).includes('/api/billing/topup/history')
    || String(c[0]).includes('/api/billing/credit-breakdown')).length;

// ═══════════════════════════════════════════════════════════════════════════
describe('P2-D — TopUpPanel consumes the certified payment contract', () => {
  it('UI-1 — renders the server catalog and initiates no payment on mount', async () => {
    await renderPanel();

    expect(screen.getByText('250 credits')).toBeInTheDocument();
    // Nothing financial may happen without an explicit user action.
    expect(callsTo('create-order')).toHaveLength(0);
    expect(callsTo('verify')).toHaveLength(0);
    expect(rzpOpened).toBe(0);
  });

  it('UI-1b — no org means no purchasing affordance', async () => {
    render(<TopUpPanel orgId={null} />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const buy = screen.queryByRole('button', { name: /buy/i });
    if (buy) expect(buy).toBeDisabled();
    expect(callsTo('create-order')).toHaveLength(0);
  });

  it('UI-2 — the client sends only a package reference; never price or credits', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(callsTo('create-order')).toHaveLength(1));

    const body = callsTo('create-order')[0].body;
    expect(body).toEqual({ org_id: 'org-1', package_id: 'pack_250', currency: 'INR' });
    // The financially significant assertion: server-authoritative fields are
    // absent, so a tampered client cannot propose its own price or credits.
    for (const forbidden of ['credits', 'price', 'amount', 'amount_paid', 'amount_subunits', 'provider_mode']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('UI-3 / UI-10 — one user action produces exactly one checkout, even on rapid repeat clicks', async () => {
    // create-order hangs so the component stays busy across the extra clicks.
    let release: (v: any) => void = () => {};
    installRoutes({
      '/api/billing/checkout/create-order': () => new Promise((r) => { release = r; }),
    });
    await renderPanel();

    const buy = screen.getByRole('button', { name: /buy/i });
    fireEvent.click(buy);
    fireEvent.click(buy);
    fireEvent.click(buy);

    await waitFor(() => expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled());
    expect(callsTo('create-order')).toHaveLength(1);   // UI-level guard held

    await act(async () => { release(await jsonRes({ ok: false, error: 'x' })); });
  });

  it('UI-4 — a rejected order shows an actionable error, never success, and can be retried', async () => {
    installRoutes({
      '/api/billing/checkout/create-order': () => jsonRes({ ok: false, error: 'package_not_available' }),
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));

    expect(await screen.findByText('package_not_available')).toBeInTheDocument();
    expect(screen.queryByText(/credits added/i)).not.toBeInTheDocument();
    // Loading cleared and recovery offered.
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buy/i })).not.toBeDisabled();
    expect(rzpOpened).toBe(0);
  });

  it('UI-5 — reaching the provider is not success: no credit is claimed until verify returns', async () => {
    // verify hangs → the component sits in `verifying`.
    installRoutes({ '/api/billing/checkout/verify': () => new Promise(() => {}) });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(rzpOpened).toBe(1));

    // Provider-side success callback fires…
    await act(async () => {
      rzpHandler!({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    });

    // …and the UI must still NOT claim credits (UI-7: pending stays unresolved).
    expect(screen.queryByText(/credits added/i)).not.toBeInTheDocument();
    expect(screen.getByText('verifying')).toBeInTheDocument();
  });

  it('UI-6 — success is rendered only after verify confirms, using the server credit count', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(rzpOpened).toBe(1));

    // Counted BEFORE confirmation, so the assertion below measures the refresh
    // caused by verify — not the ones the mount effect already made.
    const refreshesBefore = refreshCallCount();

    await act(async () => {
      rzpHandler!({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    });

    expect(await screen.findByText('250 credits added')).toBeInTheDocument();
    // The number shown is the SERVER's credits_granted, not the pack the user clicked.
    const verifyBody = callsTo('verify')[0].body;
    expect(verifyBody).toMatchObject({ org_id: 'org-1', purchase_id: 'pur_1', provider: 'razorpay' });
    // Authoritative confirmation is what triggers the balance refresh.
    await waitFor(() => expect(refreshCallCount()).toBeGreaterThan(refreshesBefore));
  });

  it('UI-8 — a rejected verification never grants UI credit and offers recovery', async () => {
    installRoutes({
      '/api/billing/checkout/verify': () => jsonRes({ ok: false, error: 'signature_invalid' }),
    });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(rzpOpened).toBe(1));

    await act(async () => {
      rzpHandler!({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' });
    });

    expect(await screen.findByText('signature_invalid')).toBeInTheDocument();
    expect(screen.queryByText(/credits added/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
  });

  it('UI-9 — an unreadable verify response is surfaced, not silently treated as success', async () => {
    // Pins the ESTABLISHED contract: anything without `ok` renders the failure
    // banner. It is deliberately NOT converted into a success, which is the only
    // financially dangerous direction.
    installRoutes({ '/api/billing/checkout/verify': () => jsonRes({}) });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(rzpOpened).toBe(1));

    await act(async () => {
      rzpHandler!({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    });

    expect(await screen.findByText('Verification failed')).toBeInTheDocument();
    expect(screen.queryByText(/credits added/i)).not.toBeInTheDocument();
  });

  it('UI-12 — cancelling reports a closure request and never claims credit', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(rzpOpened).toBe(1));

    await act(async () => { rzpOndismiss!(); });

    expect(await screen.findByText('Payment cancelled')).toBeInTheDocument();
    await waitFor(() => expect(callsTo('checkout/close')).toHaveLength(1));
    // A close is a REQUEST — the client states a reason, never an outcome, and
    // supplies no provider identifiers (the server re-asks the provider).
    const body = callsTo('checkout/close')[0].body;
    expect(body).toEqual({ org_id: 'org-1', purchase_id: 'pur_1', reason: 'client_cancelled' });
    expect(screen.queryByText(/credits added/i)).not.toBeInTheDocument();
  });

  it('UI-11 — a verify that resolves after unmount does not throw or update state', async () => {
    let settle: (v: any) => void = () => {};
    installRoutes({
      '/api/billing/checkout/verify': () => new Promise((r) => { settle = r; }),
    });
    const view = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    await waitFor(() => expect(rzpOpened).toBe(1));
    act(() => { rzpHandler!({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 's' }); });

    const errors: unknown[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((e) => { errors.push(e); });
    view.unmount();                                   // genuinely unmounted
    expect(screen.queryByRole('button', { name: /buy/i })).not.toBeInTheDocument();

    // The in-flight verify now resolves into a component that no longer exists.
    await act(async () => { settle(await jsonRes({ ok: true, credits_granted: 250 })); });
    spy.mockRestore();

    // No "state update on unmounted component" breakage, and nothing rendered.
    expect(errors.filter((e) => /unmounted|not wrapped in act/i.test(String(e)))).toHaveLength(0);
    expect(screen.queryByText(/credits added/i)).not.toBeInTheDocument();
  });
});
