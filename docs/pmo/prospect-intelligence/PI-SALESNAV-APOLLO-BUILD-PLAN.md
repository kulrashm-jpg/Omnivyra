# PI build: Sales Navigator saved-lead capture + Apollo person/company enrichment

Owner approval 2026-11-10 (relayed by the coordinator session): P-1..P-6 as recommended.
Branch `feat/pi-salesnav-apollo-20261110` from `origin/main` 50136d58a. Local only.

## 1. Owner decisions in force

| # | Decision |
|---|---|
| P-1 | Build extension capture complete, behind `SALESNAV_EXTENSION_CAPTURE_ENABLED = false` (code constant). Turning it on needs the owner's **written** acceptance of the LinkedIn-terms risk (F-1) and a reviewed code change. R-3 is untouched. The SNAP stub returns `not_connected`. |
| P-2 | Apollo has two credential modes. (A) tenant BYOK, built. (B) platform key, pending owner answers B1-B5 (section 5). |
| P-3 | No email or phone in v1. Capture never sends them, and Apollo person match asks for `reveal_personal_emails: false, reveal_phone_number: false`. |
| P-4 | v1 needs zero migrations. |
| P-5 | Keep O-1: no Sales Navigator attribute-authority declaration is seeded. |
| P-6 | One live person call and one live account call on the owner's tenant before any new attribute is claimed. Only mapped fields are logged. |

## 2. Sales Navigator capture (`backend/services/salesNavCapture/`)

- **Ownership (agreed with Outreach):**
  - Outreach owns the extension and `POST /api/extension/capture/leads`. That covers signature, nonce, version gate, live-command binding, the 25-lead batch cap and rate limits. The route calls `ingestCapturedSavedLeads(ctx, payload)`. Outreach writes no prospect table.
  - PI owns the contract, the providers and the translation.
- **Provider interface:** `SavedLeadsProvider` has two implementations.
  - `linkedin_salesnav_extension`: push, `acceptBatch`.
  - `linkedin_snap`: pull, `fetchSavedLeads`, a stub.
  - Both produce `CapturedSavedLead` and feed ONE `LeadSourceAdapter`, source key `linkedin_sales_navigator`.
- **Gates, in series, all fail closed:**
  1. code constant;
  2. context tenant equals payload tenant;
  3. `resolveLeadIngestionGate`;
  4. tenant flag `salesnav_capture`;
  5. provider availability;
  6. envelope validation.

  Leads then go through `ingestLeadBatch` unchanged. `orchestrator.ts` and `contracts.ts` are not modified.
- **Identity:**
  - `externalId = salesnav:<lead_key>`.
  - `externalKeys = { linkedin_sales_navigator: { external_id } }`. This is NOT `linkedin`, because the encodings differ.
  - A full `fs_salesProfile` URN is refused as a key, because its per-search suffix would split one person into many identities.
  - `lead_key` is **provisional** until owner-provided redacted captures prove it stable across two lists, a search and a second seat.
- **Raw evidence:**
  - Only fields that describe the lead go into raw evidence. LI-2 hashes the raw payload, so capture time, list, page, saved-at, connection degree and the raw URN are excluded; otherwise every re-capture would register as "changed".
  - Capture time travels as `observedAt`.
  - The company's LinkedIn URL is never a website or domain, because W4 would merge every employer on `linkedin.com`.
- **Provenance:** `PI_ADAPTER_PROFILES.linkedin_sales_navigator` = `pi_discovery` / platform `linkedin_sales_navigator`. No new category.
- **What may be stored:** a captured URL is kept verbatim or not at all. Any `/sales/...` URL, which can carry an auth token, a URL with credentials in it, and anything that isn't an absolute http(s) URL are never stored. Every stored evidence key is snake_case, so the boundary redactor can reach it.
- **Read-time normaliser:** a trust boundary, because its output goes to a third party. It checks an anchored host, http(s) only, no credentials, no dot-segments, one `/in/<slug>` segment, and a decoded-slug check. The full case table is in `salesNavCapture.test.ts`.

### Enable checklist (all required before `SALESNAV_EXTENSION_CAPTURE_ENABLED` flips)

1. The owner's written acceptance of the LinkedIn-terms risk (F-1).
2. `lead_key` stability confirmed on owner-provided redacted captures: two lists, a search and a second seat.
3. ZERO `source_records` rows with provider `linkedin_sales_navigator`. Any row from the earlier normalise-before-store code would report one false `changed`. If any exist, stop and decide; never backfill.
4. A reviewed code change flipping the constant.

## 3. Apollo enrichment, mode (A): tenant BYOK

- **Adapter:** the existing `enrichment/providers/adapters/apollo.ts` is extended under the same id `apollo`. The credential, billing policy and capability model are unchanged.
  - `subject: 'person'` uses `POST /api/v1/people/match`, matched on the person's own Apollo id (from `external_keys`) and otherwise their email. A name alone is never sent, and an employer's domain is never borrowed.
  - `subject: 'account'` keeps `organizations/enrich?domain=`.
  - The HTTP and refusal handling is shared by both subjects (`send`).
- **Claims:** unchanged (`employee_count`). The mappings for person `job_title / seniority / city / region` and account `industry / founded_year / technologies` are implemented and tested, but listed in `APOLLO_PENDING_VERIFICATION`. They move into `APOLLO_SUPPORTED_ATTRIBUTES` and the `sources.ts` descriptor only after the P-6 live calls.
- **Selectors:** `canonicalSelectors(person)` adds `apollo_id`, read verbatim from the person's own `external_keys.apollo.external_id`.
- **One call per subject:**
  - `executePlannedField` accepts `alsoFields`: companion fields of the same subject and source, sent as one attribute set. A mismatched companion refuses the whole set, at no cost.
  - `executeProspectEnrichmentBatch` runs up to 25 prospects with one named source and a required call budget, hard-capped at 50. It counts `providerCalled`, reports leftover work as `skipped_budget`, and returns error names only.
- **Tenant key entry:** `/integrations/enrichment` (Enrichment Providers, then the Apollo card), or `PUT /api/prospect-sources/credentials?companyId=…` with `{ provider: 'apollo', credentials: { api_key } }`.

## 3a. D7(i): the LinkedIn locator. Built; PI review PASS

- **Locator, not identity.** The person's own Sales Navigator evidence (`public_profile_url`, as captured) is normalised and classified at READ time (`lib/linkedin/profileUrl.ts`, shared with Outreach, with a shared fixture table). It becomes Apollo's `linkedin_url` match key only when no Apollo id or email is held. No claim, no `external_keys`, no merge.
- **Guard:** Apollo's returned `linkedin_url` must normalise to the same key, and an absent one refuses. The name must also agree (`lib/names/personName.ts`).
- **Stated costs and residuals** (silent refusals that fall on specific populations):
  - **Mononyms.** The name rule needs two tokens on both sides, so a person with a single legal name (common in parts of Indonesia and South India) never passes the guard and is never enriched through the locator.
  - **Suffixes.** "Jane Doe Jr" makes "jr" the last token, so it refuses against "Jane Doe".
  - **Nicknames and maiden names** (Bob/Robert) refuse.
  - **Obfuscated surnames** ("D.") never match.
  - **Opaque ids compared case-insensitively.** An opaque `/in/ACoAA…` key keeps its case, but the URL check compares case-insensitively, because vanity slugs are folded. A returned opaque id that differs only in case therefore passes the URL check. It still has to pass the name guard, so nothing is accepted on the URL check alone.
  - **Vanity share is a floor.** An all-lower-case id-shaped slug classifies as `vanity`, so yield figures under-count opaque keys.
- **Value unproven.** Sales Navigator list cards likely expose only `/sales/lead/…` URLs, which are never stored. The owner-provided redacted captures will record which URL forms are visible, as a classification enum only, never the URL. D7(iii), human-confirmed name + company candidates, follows R3.

## 4. Decision D7 (taken: (i) now, (iii) after R3). Background: captured leads cannot yet be Apollo-matched

A captured lead has no email and no Apollo id, and its account has no domain. The profile URL, which Apollo matches on, is not a canonical selector, because `external_profile` claims are deferred (LI-5C Q-3).

- **(a) Recommended:** un-defer LI-5C Q-3 for this source. Emit the normalised profile URL as an `external_profile` claim, then add a `linkedin_url` selector. The employer domain would then come from Apollo's own answer. Needs identity review.
- **(b)** Name plus company fuzzy match. Not recommended.
- **(c)** Leave captured leads unenriched in v1.

## 5. Mode (B), central Apollo access: BUILT (owner decisions B2, B3-dropped, 2026-11-10)

**Who pays.** Own key first: the tenant's stored Apollo key always wins; the vendor bills the tenant and no Omnivyra credits are charged. Otherwise, central access is used ONLY when the tenant has opted in (`feature_flags` `central_vendor_access`, set by a tenant admin who manages external APIs) AND a Super Admin has stored the managed `apollo_platform` key (no env fallback). Otherwise Apollo is unavailable.

**Price.** Vendor cost x 1.5 through the existing pricing engine (`resolveVendorUnitCost`: `llm_model_pricing` kind `unit` + `action_pricing_config` `prospect_enrichment`, source_type `vendor_unit`), converted at each organisation's own `credit_rate_usd`, rounded by the one shared `creditsForPriceUsd`. Credits are reserved before the call, confirmed when the vendor answered (enriched, no_match, field_not_found) and released otherwise. The tenant's credit balance is the limit (no quota).

**Who may trigger it.** Central (paid) access happens only on a USER-CONFIRMED action (the preview shows "~X Apollo credits = Y Omnivyra credits"). Automated retries use the tenant's own key only and never spend credits (e9, 2026-11-10).

**Platform daily ceiling** (`platformCeiling.ts`): global rows in `billing_policy_config`, `central_vendor_daily_ceiling` = `{"apollo": N}` (calls per UTC day) and `central_vendor_tenant_share` = `{"enabled": false, "max_fraction": 0.25}` (per-tenant share, default OFF). Counted from credit HOLDS created since 00:00 UTC, so in-flight calls count.

> **INVARIANT (GOV-SECURITY, recommended by virality-83; policy owned by owner/e9): central (platform-funded) access stays REFUSED until a Super Admin has written the ceiling row.** No ceiling row, a malformed one, or an unreadable count = refused (`central_ceiling_not_configured` / `central_ceiling_unreadable`). Pinned by `modeBPlatformCeiling.test.ts` "FAILS CLOSED: no ceiling configured" (input: no `central_vendor_daily_ceiling` row). A tenant's own key is never affected.

**Usage.** Every attempt records `funding`, `provider_cost_units` and `credits_charged` (written after the close, best-effort); discovery adds screening counts; Sales Navigator captures land in `prospect_capture_runs`. "Data sources & usage" (`/api/prospect-sources/usage`, panel on `/integrations/enrichment`) reports per source, user, day and run.

### Enable checklist for central access (all required; each is a Super Admin or 83 action)
1. Migrations 20270206000000, 20270208000000, 20270209000000 applied by virality-83 on owner instruction.
2. `billing_policy_config` confirmed present in production (83's catalogue query).
3. Super Admin enters the Apollo unit cost (Super Admin > Pricing > vendor unit costs; provider `apollo`, unit `credit`). No cost = paid runs refused.
4. Super Admin writes the platform daily ceiling row. No ceiling = central access refused (the invariant above).
5. Super Admin stores the managed `apollo_platform` key.
6. Each tenant opts in on the enrichment page; the conversion line appears on the public pricing page once 3 is set.

## 6. Testing (owner #27 tiers)

Unit suites for the changed files pass:

- new: `salesNavCapture`, `apolloPersonEnrichment`, `piEnrichmentAttributeSetBatch`;
- existing, re-run: Apollo adapter and slice, plan execution, the lead-ingestion suites, the provenance profile matrix, and every suite importing `execution.ts`, `prospectIntelligenceRead.ts` or the Apollo adapter.

No migration changed, so there is no real-schema replay. Typecheck runs once the other sessions grant a heavy-job turn.
