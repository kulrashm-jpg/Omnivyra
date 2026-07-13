# Company Bootstrap & Auto-Population (ONBOARD-004)

Immediately after a company is created, the platform **bootstraps the company
profile** so the user never starts from an empty company — everything derivable
already exists. This is one canonical, deterministic, idempotent authority that
consolidates the previously-inline crawl auto-population into a single reusable,
replay-safe unit.

## Authority

`backend/services/companyBootstrapService.ts` is the single company-bootstrap
authority.

- **`deriveBootstrapFields(input)`** — PURE. No AI, no network, no DB. Given the
  discovered website metadata (from the crawl the onboarding path already ran)
  and the current profile, it returns the fill-empty column candidates, the
  discovered-metadata bundle, per-field provenance, and the §4 field
  classification.
- **`bootstrapCompanyProfile(companyId, deps?)`** — idempotent apply. Reads the
  existing profile + already-stored `report_settings.discovered_metadata`,
  MERGE-writes ONLY still-empty canonical columns, ensures the discovered bundle
  exists, records completeness from the canonical authority, and stamps an
  idempotency marker.
- **`classifyProfileFields(profile, bundle?)`** — the §4 read-model
  (Auto-filled / User-required / Optional) for the Company Profile UI.
- **`bootstrapCompleteness(...)`** — reuses the canonical
  `profileCompletionIntelligenceService` (`isComplete` / `profileGaps`); no
  duplicate completeness calculation.

## What it derives (§2/§3)

Fill-empty, deterministic, from data already extracted by the onboarding crawl
(`websiteMetadataExtractor` → `report_settings.discovered_metadata`):

| Canonical column | Source | Notes |
| --- | --- | --- |
| `website_url` | the **verified** website/domain only (§3) | never inferred from crawl HTML — no fabricated primary domain |
| `geography` | `discovered.country` | ISO locale, low confidence |
| `logo_url` | `discovered.logoUrl` (og:image) | reuses the website's own asset (§5) |
| `favicon_url` | `discovered.faviconUrl` | reuses the website's own asset (§5) |
| social `*_url` | the onboarding crawl's social links (§6) | already applied fill-empty by `mergeDiscoveredSocialProfiles`; the bootstrap only classifies them |

Columnless discovered values (`description`, `language`, `brand_color`,
`seo_keywords`, `title`, `site_name`, `open_graph`) are preserved in the
`report_settings.discovered_metadata` bundle (there are no dedicated columns for
them), so the profile UI can surface them without a schema change.

**Nothing is fabricated.** A value that isn't discoverable is left empty (§2).
Social profiles come only from the crawl, never invented (§6).

## Fill-empty & idempotency (§8)

- Only **empty** canonical columns are written. A value already present — set by
  the user, the AI refiner, or a prior run — is never overwritten.
- **User-locked fields** (`user_locked_fields`) are never proposed for update.
- The discovered bundle is backfilled only when **absent** (a richer stored one
  is never clobbered).
- Every run stamps `report_settings.bootstrap` — `{ version, bootstrapped_at,
  source, applied_fields, classification, completeness }`. When the marker is
  present at the current version and there is nothing left to fill or backfill,
  the call **writes nothing** (`already_bootstrapped`).

This makes it safe to call from company creation, a verification replay, a
resume, a page refresh, or a backfill — the same call converges without ever
double-writing.

## Field classification (§4)

`classifyProfileFields` buckets fields so the Company Profile page can highlight
provenance:

- **Auto-filled** — a present derivable column (set by the crawl).
- **User-required** — a still-empty *critical* field (`name`, `website_url`,
  `industry`, mirroring the canonical `isComplete` authority).
- **Optional** — a still-empty non-critical field.

## Completeness (§7)

Completeness is read from the canonical
`profileCompletionIntelligenceService` (`isComplete` + `profileGaps`) mapped
from the raw profile row. The bootstrap does not compute its own score.

## Wiring (§1)

`pages/api/onboarding/setup-company.ts` calls
`bootstrapCompanyProfile(companyId, { supabase, discovered, verifiedWebsite,
now })` immediately after the profile upsert (step 5·bootstrap), passing the
crawl metadata already in hand — **no second crawl, no AI**. It is best-effort
and fully non-fatal: a bootstrap hiccup never fails setup. Because the inline
upsert already sets the columns, the finalizer typically just stamps the marker
+ classification; its value is being the **one** reusable, idempotent,
replay-safe unit and backfilling any company (e.g. verification replay) that
still has empty derivable fields.

## Scope guard

The service **never** creates a company or a profile row (it no-ops when no
profile exists), **never** introduces a new domain model (the verified website
is reused as the primary domain), **never** re-crawls, **never** calls AI, and
**never** touches `field_confidence` (owned by the AI refiner). No API,
endpoint, signup, or lifecycle change (§9).

## Files

- `backend/services/companyBootstrapService.ts` — the authority.
- `pages/api/onboarding/setup-company.ts` — idempotent finalizer wiring.
- `backend/tests/unit/onboard004CompanyBootstrap.test.ts` — derivation
  (deterministic, fill-empty, no-fabrication), classification, completeness
  reuse, apply/idempotency/resume, never-creates-a-company, reuse-existing
  assets/social.
