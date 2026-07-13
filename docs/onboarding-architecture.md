# Onboarding Architecture (ONBOARD-001)

The canonical onboarding authority. **One** orchestration layer over the
existing models — nothing below is replaced or duplicated.

## Canonical authority

`backend/services/onboardingJourneyService.ts` is the single source of truth for
"where is this user in onboarding". It **derives** the answer (pure read) from
the existing authorities; it stores no parallel state except per-stage
user overrides:

| Signal | Authority (unchanged) |
|---|---|
| Email verified | `users.is_email_verified` (AUTH-001 gate) |
| Profile complete | `users.name` |
| Company created | `users.active_company_id` / `user_company_roles` (active) |
| Social connected | `social_accounts.connection_state` (9-state model) |
| CMS connected | `buildActivationReadiness()` (latched `cms` check) |
| GA4 | `buildActivationReadiness()` `analytics` + `analytics_integrations` (provider=GA4) |
| GSC | `analytics_integrations` (provider=GSC) |
| Skip / dismiss | `company_setup_progress.journey_state` (JSONB, added 20260714) |

`buildOnboardingJourney(userId)` returns one answer for **Current Step,
per-stage status (not_started / pending / in_progress / completed / skipped /
dismissed / blocked), and Platform Ready**. Deterministic, retry/refresh/replay
safe — journey recovery is derivation, not session state.

## Journey (§5)

```
Email Verified → Profile → Company → Company Review → Social Accounts
  → Website / CMS → Google Analytics → Google Search Console → [Platform Ready]
```

Each stage carries: `mandatory`, `skippable`, `dismissible`, `dependsOn`,
`href` (the existing surface that fulfils it), and a "why it matters" string.

Rules:
- **Real completion always wins** — a skip/dismiss override can never downgrade
  a stage the underlying authority reports completed.
- **Mandatory** stages (email/profile/company) can't be skipped or dismissed
  and complete only through their own flows.
- A stage whose dependencies aren't resolved and that isn't itself resolved is
  **blocked** (never actionable).

## Platform Ready (§11)

The single decision: `platformReady = every mandatory stage completed AND every
optional stage resolved (completed | skipped | dismissed)`. There is exactly one
place this is computed — `buildOnboardingJourney`.

## API & UI

- `GET /api/onboarding/journey` → the derived journey (works pre-verification).
- `POST /api/onboarding/journey` `{ stage, action: skip|dismiss|complete|reopen }`
  → idempotent override; company derived server-side; verification-gated;
  returns the refreshed journey.
- `pages/onboarding/journey.tsx` renders the server truth (no client-side
  progress math) — resumable across refresh, new login, session expiry.

## Company enrichment (§3/§7)

At company creation `crawlWebsiteSources` performs **one** root-page fetch that
now yields both social links **and** identity/brand/SEO metadata
(`websiteMetadataExtractor.extractWebsiteMetadata`) — **no second crawl**.
Persisted immediately (deterministic, cheap): `logo_url`, `favicon_url`,
`geography` (country), and a `report_settings.discovered_metadata` bundle
(description, language, brand colour, OpenGraph, SEO keywords, title, site name)
— all marked `source: 'system_discovered'`. The existing AI refinement
(`getProfile autoRefine`) still fills the deeper fields and owns
`field_confidence`. User edits are governed by the existing `user_locked_fields`
mechanism (System Discovered → User Editable). Timezone is captured from the
browser (`Intl…timeZone`) and persisted to `company_scheduler_prefs.timezone`.

## Company domain registry (§4)

`company_domains` is the canonical registry. Company creation now dual-writes it
via the governed `saveDomainRecord()` (`created_via: 'system'`, conflict-safe,
idempotent) alongside the legacy `companies.website_domain` /
`admin_email_domain` columns (kept for backward compatibility). Migration
`20260714_onboard001_journey_and_domains.sql` backfills a canonical row for every
pre-existing company (ON CONFLICT DO NOTHING; no data loss; legacy columns
retained).

## Integration status (§8–§10)

Social/CMS/GA/GSC are first-class journey stages, each reading the existing
integration authority (no new tracking). Social maps the 9-state
`connection_state` to `connected | pending | expired | reconnect_required |
failed` (`providerJourneyState`), so the journey surfaces reconnect prompts
without recomputing token state.

## Backward compatibility

Additive only: one JSONB column, one migration (backfill + column), new service
+ endpoint + page. No existing endpoint, table, or model changed shape. The
three legacy status models (feature completion, activation readiness, setup
registry) are untouched — the journey authority composes them.
