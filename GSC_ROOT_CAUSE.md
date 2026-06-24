# GSC_ROOT_CAUSE.md

Phase 16E · Phase 7 — root cause of GSC `disconnected` (Unfinished only attempted). Identical
audit to GA.

## Lifecycle classification (CUSTOMER GSC integrations)

| Customer | State | Classification |
|---|---|---|
| Unfinished | GSC row, `status = disconnected` | **REFRESH_FAILED / TOKEN_EXPIRED** (or incomplete connect) |
| Drishiq / Embrosales / Afrost / Infitoo | no row | NEVER_STARTED |

## Mechanism (confirmed)

Same as GA: `connectGoogleSearchConsole` seeds `disconnected` then flips to `connected` on
completion (`ensureAnalyticsIntegration(companyId, 'disconnected', GSC_PROVIDER)`); the OAuth
lifecycle scheduler refreshes within the expiry buffer and records `last_provider_error` on
failure. Only **1 of 5** customers ever attempted GSC.

## Root cause (cause is EXTERNAL)

`disconnected` = OAuth grant not currently valid → **requires customer re-authorization**.
**No server-side fix without forbidden token fabrication / OAuth bypass.** The refresh path
functions; it cannot refresh a grant the customer has not re-given.

## Revises 16D

GSC PRODUCT_FLOW → **external OAuth dependency**. Correction recorded. (4 of 5 never attempted
GSC at all — that portion is NEVER_STARTED / UNKNOWN, not a server failure.)
