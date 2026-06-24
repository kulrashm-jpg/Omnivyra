# SUBSCRIPTION_LIFECYCLE_WRITEPATH_AUDIT.md

Audit of the checkout/plan/billing_subscriptions write situation (deliverable 3).

## Checkout completion flow
| Concern | Finding |
|---|---|
| Where a subscription purchase completes | `purchaseService.completePurchase()` settles a `credit_purchases` row + grants credits. It handles **top-up AND plan purchases**, but writes only credits — **not** `billing_subscriptions`. |
| Where plan assignment occurs | `pages/api/super-admin/plans/assign.ts` upserts `organization_plan_assignments` (super-admin), and grants plan credits. **No `billing_subscriptions` write.** |
| Was `billing_subscriptions` ever created? | **No** — before this change, zero code paths wrote it (0 rows in prod). It existed in schema only. |

## Webhook handlers — BEFORE
| Event | Classified as | Behavior |
|---|---|---|
| `checkout.session.completed` | (not handled) | n/a — not in the classifier |
| `invoice.payment_succeeded` / `invoice.paid` / `charge.succeeded` | `complete_purchase` | settle `credit_purchases` + `payment_transactions`; **no subscription write** |
| `invoice.payment_failed` | `fail_purchase` | mark the top-up purchase failed; **no subscription write** |
| `customer.subscription.updated` | `record_subscription` | **record-only** (payment_provider_events); no state |
| `customer.subscription.deleted` | `record_subscription` | **record-only**; no state |

## Webhook handlers — AFTER (this change)
| Event | Behavior now |
|---|---|
| `customer.subscription.created/updated/deleted` | still recorded append-only, **AND** `deps.applySubscriptionEvent` upserts `billing_subscriptions` (status + periods; deleted→canceled). Best-effort — wrapped in try/catch so a ledger failure never fails the webhook. |
| `invoice.payment_*` / `charge.*` | unchanged (top-up purchase settlement). Subscription status changes ride on the `customer.subscription.updated` events Stripe emits alongside. |

## Gaps still open (out of scope, documented)
- `checkout.session.completed` is **not** in the classifier. Subscriptions are populated via the
  `customer.subscription.*` events Stripe fires on creation, which suffices; adding explicit
  checkout-session handling (to capture `metadata.organization_id`/`plan_id` at session level) is
  a future refinement.
- Mapping a Stripe price/plan → our `pricing_plans.id` is not implemented; `plan_id` is set only
  from a uuid in `metadata.plan_id`, else null. State resolution does not depend on `plan_id`.
- Razorpay/Cashfree subscription events are not handled (those providers don't send subscription
  webhooks here today).
