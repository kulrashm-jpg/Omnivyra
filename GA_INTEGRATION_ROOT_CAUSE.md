# GA_INTEGRATION_ROOT_CAUSE.md

Phase 16E · Phase 5 — root cause of GA `disconnected` (Drishiq, Unfinished). Evidence from
`analyticsIntegrationService.ts` + `integrations/oauthLifecycleScheduler.ts`.

## Lifecycle classification (CUSTOMER GA integrations)

| Customer | State | Classification |
|---|---|---|
| Drishiq | GA4 row, `status = disconnected` | **REFRESH_FAILED / TOKEN_EXPIRED** (or incomplete connect) |
| Unfinished | GA4 row, `status = disconnected` | same |
| Embrosales / Afrost / Infitoo | no row | NEVER_STARTED |

## Mechanism (confirmed)

1. `connectGoogleAnalytics` writes the integration as `disconnected` first, then flips it to
   `connected` only when the OAuth + property selection completes. An **abandoned/incomplete
   connect** leaves it `disconnected`.
2. `oauthLifecycleScheduler` refreshes tokens within `REFRESH_BUFFER_MS` of expiry; on refresh
   failure it records `last_provider_error` and the integration is **not** connected. A
   Google **refresh token that is expired/revoked** cannot be refreshed server-side.

## Root cause (cause is EXTERNAL)

`disconnected` means the OAuth grant is **not currently valid** — either the connect flow was
never completed, or the refresh token expired/was revoked at Google. **Re-establishing it
requires the customer to re-authorize** (a new OAuth consent). There is **no server-side fix**:
the only "fixes" would be **fabricating a token or bypassing OAuth — both explicitly
forbidden**.

## Revises 16D

16D classified GA as PRODUCT_FLOW ("connected then lost"). The disconnect is real, but the
remedy is **customer re-authorization (external OAuth dependency)**, not a server code bug.
The refresh path itself (`oauthLifecycleScheduler` + `tokenRefresh`) functions; it cannot
refresh a grant the customer has not (re)given. Correction recorded.
