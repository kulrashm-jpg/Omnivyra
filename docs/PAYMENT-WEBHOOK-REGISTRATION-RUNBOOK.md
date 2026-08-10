# Payment Webhook Registration — Operator Runbook (P1)

Produced by **P1 · Truth & Safety**. The webhook *code* is ready and verified by
tests. Registration in the provider dashboards is an **operator action** that
engineering cannot perform or verify from the repository.

> **Status until an operator completes this: `NOT VERIFIED — OPERATOR ACTION REQUIRED`.**
> P1 is not operationally complete until a test event has been delivered and observed.

Three distinct things are tracked separately and must never be conflated:

| Layer | Meaning | Who confirms |
|---|---|---|
| **Code readiness** | Endpoint exists, verifies signatures, dedupes, fulfills idempotently | Engineering — ✅ done |
| **Dashboard registration** | The URL + secret are configured at the provider | Operator |
| **Event delivery** | A real event has arrived, verified, and fulfilled | Operator + logs |

---

## 0. Prerequisites

- A **public deployment** the provider can reach. Localhost will not work; use the
  deployed host (`NEXT_PUBLIC_APP_URL`) or a tunnel for sandbox testing.
- The environment must have the webhook secret set **for the active mode** (below).
- `PAYMENT_PROVIDER_MODE` stays `test` for P1. Do **not** set `live` — that is P4.

### Secret resolution (important)

`getProviderCredentials()` resolves the webhook secret per mode, with a fallback:

```
webhookSecret = process.env[<MODE>_WEBHOOK_SECRET] ?? process.env[<MODE>_KEY_SECRET]
```

| Mode | Razorpay webhook secret | Cashfree webhook secret |
|---|---|---|
| `test` | `RAZORPAY_WEBHOOK_SECRET` (falls back to `RAZORPAY_TEST_KEY_SECRET`) | `CASHFREE_WEBHOOK_SECRET` (falls back to `CASHFREE_TEST_SECRET_KEY`) |
| `live` | `RAZORPAY_LIVE_WEBHOOK_SECRET` (falls back to `RAZORPAY_LIVE_KEY_SECRET`) | `CASHFREE_PROD_WEBHOOK_SECRET` (falls back to `CASHFREE_PROD_SECRET_KEY`) |

> ⚠️ The fallback means a webhook can appear to "work" while validating against the
> **API secret** instead of a dedicated webhook secret. **Set the explicit
> `*_WEBHOOK_SECRET` variable** and use that exact value in the dashboard. Never
> paste a secret into a ticket, a commit, or this file.

---

## 1. Razorpay

### Endpoint
```
POST https://<NEXT_PUBLIC_APP_URL>/api/webhooks/payments/razorpay
```

### Events required
| Event | Why |
|---|---|
| `payment.captured` | **Required.** The only event that triggers fulfillment (`extractSuccess` matches on it). |
| `payment.failed` | Recommended. Recorded for forensics; does not fulfill. |
| `order.paid` | Optional. Recorded only — fulfillment keys on `payment.captured`. |

Subscribing to more events is harmless: unrecognised events are signature-verified,
recorded in `payment_provider_events`, and ignored.

### Secret configuration
1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL**: the endpoint above.
3. **Secret**: generate a strong random value; paste the *same* value into
   `RAZORPAY_WEBHOOK_SECRET` (test) in the deployment environment.
4. **Active Events**: tick `payment.captured` (+ `payment.failed`).
5. Save.

### Signature verification (already enforced in code)
- Header: `x-razorpay-signature`
- Algorithm: `HMAC-SHA256(rawBody, webhookSecret)`, hex
- Compared with `crypto.timingSafeEqual` after a length check
- Raw body preserved via `export const config = { api: { bodyParser: false } }`
- **Unsigned or mismatched → HTTP 401 before any processing.** No secret configured
  → every webhook is rejected.

### Test event procedure
1. In the dashboard, use **Send Test Webhook** for `payment.captured`, **or** run a
   real sandbox top-up through `/command-center/topup` with a Razorpay test card.
2. Expect **HTTP 200** with a body of the shape
   `{ ok: true, recorded: true, event_id, event_type, allocated }`.
3. Confirm in logs: `payment_webhook_received` → then either
   `payment_fulfillment_completed` or `payment_webhook_duplicate`.
4. Re-send the **same** event. Expect `payment_webhook_duplicate` and **no second
   credit grant and no second invoice**.

---

## 2. Cashfree

### Endpoint
```
POST https://<NEXT_PUBLIC_APP_URL>/api/webhooks/payments/cashfree
```

### Events required
| Event | Why |
|---|---|
| `PAYMENT_SUCCESS_WEBHOOK` | **Required.** Fulfillment matches any event type containing `SUCCESS`. |
| `PAYMENT_FAILED_WEBHOOK` | Recommended. Recorded only. |
| `PAYMENT_USER_DROPPED_WEBHOOK` | Optional. Recorded only. |

### Environment-specific configuration
Cashfree keeps **separate dashboards** for sandbox and production, and the adapter
switches base URL from the active mode:

| Mode | API base | Dashboard |
|---|---|---|
| `test` | `https://sandbox.cashfree.com/pg` | Sandbox |
| `live` | `https://api.cashfree.com/pg` | Production |

Register the webhook in the **sandbox** dashboard for P1. The production dashboard is
a P4 step. Each dashboard needs its own secret (`CASHFREE_WEBHOOK_SECRET` vs
`CASHFREE_PROD_WEBHOOK_SECRET`).

### Signature requirements (already enforced in code)
- Headers: `x-webhook-signature` **and** `x-webhook-timestamp`
- Algorithm: `base64( HMAC-SHA256( timestamp + rawBody, webhookSecret ) )`
- Constant-time comparison; both headers required
- **Missing timestamp → verification fails → HTTP 401.**

### Test event procedure
1. Cashfree Dashboard → **Developers → Webhooks → Test**, send a
   `PAYMENT_SUCCESS_WEBHOOK`, **or** complete a sandbox order through the top-up UI.
2. Expect HTTP 200 and `payment_webhook_received` in logs.
3. Re-send to confirm dedup (`payment_webhook_duplicate`, no second grant).

---

## 3. Acceptance checklist

Registration is complete only when **all** of these are observed:

- [ ] Razorpay `payment.captured` delivered → HTTP 200
- [ ] Razorpay redelivery of the same event → no second grant, no second invoice
- [ ] Cashfree `PAYMENT_SUCCESS_WEBHOOK` delivered → HTTP 200
- [ ] Cashfree redelivery → no second grant, no second invoice
- [ ] A tampered payload (alter one byte) → **HTTP 401**
- [ ] A row exists in `payment_provider_events` per unique event, and exactly one
      per redelivered event
- [ ] The **browser-closed** scenario: pay, kill the tab before verify → the
      purchase reaches `status='completed'`, `fulfillment_status='completed'`,
      with exactly one grant and one invoice

The last item is the whole point of P1. It can be satisfied by the webhook, or —
if the webhook is delayed or missing — by `/api/cron/billing-checkout-expiry`,
which asks the provider directly and fulfills rather than expiring when the answer
is "paid".

---

## 4. Backstops if a webhook is never delivered

Registration is the primary path, but P1 does not depend on it alone:

| Cron | Cadence | Role |
|---|---|---|
| `/api/cron/billing-commercial-reconcile` | `*/15 * * * *` | Repairs `completed` + `fulfillment_status != completed` (charged, not credited) |
| `/api/cron/billing-checkout-expiry` | `7,22,37,52 * * * *` | For each stale `pending`, asks the provider: **paid → fulfil**, unpaid → close, unreachable → retry later |

Both are idempotent and safe to run repeatedly. Manual trigger (super-admin or
`CRON_SECRET` bearer):

```
POST /api/cron/billing-commercial-reconcile?dryRun=1     # read-only inspection
POST /api/cron/billing-checkout-expiry?ttlMinutes=30
```

`PAYMENT_CHECKOUT_TTL_MINUTES` (default `30`) controls how long a checkout may stay
pending before the sweeper evaluates it.
