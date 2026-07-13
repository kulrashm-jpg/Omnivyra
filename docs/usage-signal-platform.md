# Canonical Usage Signal Platform (CSA-001)

The ONE canonical stream of **customer product-usage** signals. Every future
Customer Success capability — Health, Lifecycle, Retention, Risk, Engagement,
Adoption — consumes usage through this platform. There is no second usage
collection path.

This closes audit gaps **G15** (no canonical usage event stream), **G16**
(`/api/track` had no durable app-usage sink), and **G17** (no time-series usage
history). It does **not** implement health scores, reminders, CS automation, or
any analytics/onboarding redesign.

## Scope boundary (what this is / isn't)

Three usage-ish streams now coexist, each with a distinct purpose — this
platform is only the third:

| Stream | Table | Purpose |
| --- | --- | --- |
| Website-visitor analytics | `blog_analytics` (via `POST /api/track`) | tracker.js visitor pageviews — **unchanged** |
| Billing usage | `usage_events` | credit ledger linkage — **unchanged** |
| **Customer product usage (this)** | **`customer_usage_events`** | in-app customer actions for Customer Success |

## Usage Event Model (§1)

`lib/usage/usageEvent.ts` defines the single event shape. Canonical types
(closed set): `login, page_view, feature_used, campaign_created,
campaign_completed, content_generated, content_published, recommendation_viewed,
recommendation_applied, integration_connected, integration_used,
report_generated, workspace_member_added, credit_consumed`.

```
UsageEvent {
  eventId?      // idempotency key; derived deterministically when absent
  companyId     // existing tenant identifier (required)
  userId?       // existing actor identifier
  eventType     // one of the canonical types
  feature?      // fine-grained slug, e.g. 'content_writer'
  capability?   // grouping, e.g. 'publishing'
  occurredAt?   // ISO; defaults to ingestion time
  metadata?     // bounded, non-PII bag (ids/counts/enums)
}
```

`normalizeUsageEvent` validates + normalizes (rejects unknown types / missing
company), and `deriveEventId` produces a stable FNV-1a idempotency key from
`(company, user, type, feature, occurredAt)`.

## Ingestion Authority (§2)

`backend/services/usage/usageIngestionService.ts` — `ingestUsageEvents(events, ctx)`
is the ONE write path. It:

- forces `companyId`/`userId` from the **authenticated** context (a client can
  never attribute an event to another tenant — privacy/tenant safety);
- validates + normalizes each event, tracking rejects and reasons;
- de-duplicates in-batch and (via the DB unique index) across requests;
- persists with `upsert(..., { onConflict: 'company_id,event_id', ignoreDuplicates: true })`
  → `INSERT … ON CONFLICT DO NOTHING`, so retries/replays never double-count;
- emits observability and **never throws** (fail-safe).

`recordUsageEvent(event, ctx)` is a single-event convenience over the same
authority (for backend producers). The authenticated HTTP entry point is
`POST /api/usage/track` (reuses `withOrgAccess` + the request-context userId).

## Time-Series Storage (§3)

`supabase/migrations/20260728_customer_usage_events.sql` creates
`customer_usage_events` — additive, no FK, reversible by `DROP TABLE`. Raw
events **are** the time-series; there is no rollup table and no rollup job.
Indexes support per-company/time, per-user, per-feature, per-capability, and the
pre-computed `event_day` for daily/weekly/monthly bucket scans. `UNIQUE
(company_id, event_id)` is the idempotency anchor.

> Deploy ordering: apply the migration before producers write at volume. Until
> applied, ingestion degrades fail-safe (`ok:false`, failure metric) and never
> breaks callers. Not auto-applied — controlled migration process only.

## Usage Authority (§4)

`backend/services/usage/usageAuthorityService.ts` is the ONE read surface every
CS consumer uses:

- `getUsageSummary(companyId, { from, to, granularity })` → the canonical
  summary (totals, active users, `byType`/`byFeature`/`byCapability`, and a
  `series` of buckets);
- `aggregateUsage(rows, opts)` — **pure**, deterministic bucketing at `daily`
  (UTC day) / `weekly` (UTC Monday) / `monthly` (`YYYY-MM`) granularity;
- `queryUsageEvents(...)` — fail-safe row read (empty on any error).

Read HTTP surface: `GET /api/usage/summary` (authenticated via `withOrgAccess`).

## Privacy (§5)

Only **existing identifiers** are stored (`companyId`, `userId`). `metadata` is
shallow, size-bounded, and reserved-PII keys (`email/name/phone/ip/address/…`)
are dropped at normalization. No email/name/IP columns exist. Events are
attributed only to the authenticated tenant.

## Idempotency (§6)

Replay-, retry-, and duplicate-safe: `eventId` (supplied or derived) + `UNIQUE
(company_id, event_id)` + `ON CONFLICT DO NOTHING`. In-batch and cross-request
duplicates are counted, never persisted twice.

## Observability (§7)

Reuses HARDEN-001 (`recordRawCounter`/`recordRawHistogram`):
`usage.events.received`, `usage.events.persisted`, `usage.events.duplicates`,
`usage.events.rejected`, `usage.ingest.failures`, `usage.ingest.duration_ms`,
`usage.query.failures`, `usage.aggregation.duration_ms`.

## Backward Compatibility (§8)

No onboarding change; no existing API changed; no analytics redesign. `/api/track`
(website analytics) and `usage_events` (billing) are untouched. The migration is
additive and isolated. All new code is fail-safe, so shipping ahead of the
migration cannot break anything.

## Files

- `lib/usage/usageEvent.ts` — canonical event model + validation.
- `backend/services/usage/usageIngestionService.ts` — the ingestion authority.
- `backend/services/usage/usageAuthorityService.ts` — the read/aggregation authority.
- `pages/api/usage/track.ts` — authenticated ingestion endpoint.
- `pages/api/usage/summary.ts` — authenticated read endpoint.
- `supabase/migrations/20260728_customer_usage_events.sql` — the time-series sink.

## Tests

- `backend/tests/unit/csa001UsageSignalPlatform.test.ts` — model/validation,
  privacy (PII-strip + tenant-forcing), ingestion, in-batch + replay dedup,
  derived-id dedup, observability, daily/weekly/monthly aggregation +
  determinism, and fail-safe/backward-compatible behavior.
