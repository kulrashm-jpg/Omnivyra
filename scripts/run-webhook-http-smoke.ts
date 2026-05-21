/**
 * LOCALHOST-ONLY: full HTTP-layer Stripe webhook smoke.
 *
 * Drives /api/stripe/webhook directly via fetch. Signs payloads with
 * STRIPE_WEBHOOK_SECRET=whsec_local_test (the env the dev server was
 * started with). Verifies:
 *   1. Signed event → 200 processed; payment_provider_events + payment_transactions rows present
 *   2. Same event replayed → 200 duplicate; no second rows
 *   3. Bogus signature → 400 invalid_signature
 *   4. Tampered body (signed for X, body=Y) → 400 invalid_signature
 *   5. Expired timestamp → 400 timestamp_out_of_tolerance
 */

import crypto from 'crypto';
import { Client } from 'pg';

const URL = 'http://localhost:3000/api/stripe/webhook';
const SECRET = 'whsec_local_test';
const PG_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function sign(body: string, secret: string, t: number): string {
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${expected}`;
}

async function post(body: string, signature: string): Promise<{ status: number; bodyText: string }> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body,
  });
  return { status: res.status, bodyText: await res.text() };
}

async function query(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const c = new Client({ connectionString: PG_URL });
  await c.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } finally { await c.end(); }
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    id: `evt_http_smoke_${now}`,
    type: 'charge.succeeded',
    created: now,
    data: { object: {
      id: `ch_http_smoke_${now}`,
      amount: 12345, currency: 'usd', payment_intent: `pi_http_smoke_${now}`,
      metadata: { organization_id: '33333333-3333-3333-3333-333333333333' },
    }},
  };
  const body = JSON.stringify(event);

  console.log('=== 1. signed event (fresh) ===');
  const r1 = await post(body, sign(body, SECRET, now));
  console.log(`HTTP ${r1.status}`); console.log(r1.bodyText);

  console.log('\n=== 2. replay same event ===');
  const r2 = await post(body, sign(body, SECRET, now));
  console.log(`HTTP ${r2.status}`); console.log(r2.bodyText);

  console.log('\n=== 3. bogus signature ===');
  const r3 = await post(body, `t=${now},v1=${'00'.repeat(32)}`);
  console.log(`HTTP ${r3.status}`); console.log(r3.bodyText);

  console.log('\n=== 4. tampered body (signed for A, sending B) ===');
  const sigForA = sign(body, SECRET, now);
  const r4 = await post('{"id":"evt_tampered","type":"charge.succeeded"}', sigForA);
  console.log(`HTTP ${r4.status}`); console.log(r4.bodyText);

  console.log('\n=== 5. expired timestamp (>10 min in past) ===');
  const stale = now - 1000;
  const r5 = await post(body, sign(body, SECRET, stale));
  console.log(`HTTP ${r5.status}`); console.log(r5.bodyText);

  console.log('\n=== 6. DB state verification ===');
  const events = await query(
    `SELECT provider, provider_event_id, event_type, organization_id::text, processing_status
       FROM payment_provider_events WHERE provider_event_id = $1`,
    [event.id]
  );
  console.log('payment_provider_events:', JSON.stringify(events, null, 2));
  const txs = await query(
    `SELECT provider, provider_transaction_id, amount::text, fee_amount::text, net_amount::text, status, organization_id::text
       FROM payment_transactions WHERE provider_transaction_id = $1`,
    [event.data.object.id]
  );
  console.log('payment_transactions:', JSON.stringify(txs, null, 2));
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
