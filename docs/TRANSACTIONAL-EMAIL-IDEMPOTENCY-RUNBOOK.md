# Transactional email idempotency: uncertain sends runbook

Covers `send-transactional-email` and migration `20270217000031_transactional_email_idempotency`.

## What "uncertain" means

A keyed send is **uncertain** when the provider may have the message but we cannot tell. This happens in two cases:

- **The send failed without a definite answer.** The provider gave a 5xx, the request timed out, or the network
  failed. A 4xx or a configuration error is definite: that key is released and a retry sends.
- **A crash mid-send.** A `sending` reservation was still open after the stale bound (15 minutes). The next call
  with the same key marks it uncertain.

An uncertain key is **never resent automatically within its window**. The window is
**max(the email type's TTL, 7 days)**, counted from when the key became uncertain. After the window, the next call
with that key sends again.

Why 7 days: it is long enough for the alert to be seen and acted on. It is short enough that an email that was
really lost (a provider error, not a delivery) is recovered without manual work.

## The alert

Each uncertain send logs one event, `TRANSACTIONAL_EMAIL_UNCERTAIN`, from the Edge function:

| field       | meaning                                                                        |
|-------------|--------------------------------------------------------------------------------|
| `emailType` | the email type (`team_invite`, `credit_alert`, `lead_outreach`, ...)            |
| `reason`    | `send_outcome_unknown` (live failure) or `stale_sending_reservation` (crash)    |
| `key`       | the idempotency key the caller chose (no recipient address; only its SHA-256 is stored) |
| `freesAt`   | when the key frees and the next call sends again (ISO time); `null` only if the store could not be updated, see below |

Related events:

- **`TRANSACTIONAL_EMAIL_MARK_UNCERTAIN_FAILED`.** The database did not record the uncertain state, so `freesAt` is
  `null`. The row stays `sending`. The next call after 15 minutes marks it uncertain and logs a second
  `TRANSACTIONAL_EMAIL_UNCERTAIN` that does carry `freesAt`.
- **`TRANSACTIONAL_EMAIL_CONFIRM_FAILED`.** The email **was sent** but was not recorded. The row turns uncertain at
  the stale bound. Resolve it as `delivered`.

## What to do

1. **Find out whether the recipient got the email.** Check the provider's delivery logs for the key's time, or ask
   the recipient.
2. **Decide**, using `transactional_email_resolve_uncertain(key, resolution, actor)`:
   - `'not_delivered'`: the provider does not have it. **The key is released**, so the next call with the key sends.
     The caller still has to re-trigger the send, for example by re-inviting. Resolving alone sends nothing.
   - `'delivered'`: it arrived. The row becomes `sent`, and every later call within the window is answered as a
     duplicate success.
   - **Do nothing**: the key frees on its own at `freesAt`. Choose this only when a resend after that time is
     acceptable.
3. **The call returns** `true` when it recorded the decision. It returns `false` when the key is not uncertain:
   already resolved, already freed, still `sending`, or `sent`. On `false`, nothing is changed or recorded.

Rules for the call:

- **Who can call it:** only `service_role`. `anon` and `authenticated` cannot execute it.
- **`actor`:** the operator's identity, for example an email address, 1 to 200 characters, trimmed.
- **Invalid arguments** (an unknown resolution, or an empty or too-long actor) are refused with SQLSTATE `22023`.
- **Production:** running the function in production is a **production write**. It needs the owner's authorization,
  like any other production change.

```sql
-- as service_role
SELECT public.transactional_email_resolve_uncertain('<key>', 'not_delivered', '<operator email>')
```

Through PostgREST with the secret key, call `POST /rest/v1/rpc/transactional_email_resolve_uncertain` with this
body:

```json
{ "p_key": "<key>", "p_resolution": "not_delivered", "p_actor": "<operator email>" }
```

## Reading the state

Open uncertain keys and when each frees (read-only):

```sql
SELECT idempotency_key, email_type, uncertain_reason, created_at, updated_at, expires_at AS frees_at
FROM public.transactional_email_sends
WHERE state = 'uncertain'
ORDER BY expires_at
```

**The audit trail.** `public.transactional_email_resolutions` is append-only: `service_role` holds `SELECT` and
`INSERT` only. Each row records who decided what, and when:

```sql
SELECT idempotency_key, resolution, actor, resolved_at
FROM public.transactional_email_resolutions
ORDER BY resolved_at DESC
```

An audit row outlives the ledger row: `'not_delivered'` deletes the ledger row, but the audit row remains.

The Supabase SQL console runs **one statement** at a time. Run each query on its own, with no trailing `;`.
