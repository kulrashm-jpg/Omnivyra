# PI-P1-W02 — First Real Source Adapter: selection and specification

**Parent:** [`PHASE-1-DERIVED-PLAN.md`](./PHASE-1-DERIVED-PLAN.md) · **Architecture:** [`../PI-ADR-001.md`](../PI-ADR-001.md)
**Verdict:** `READY WITH PREREQUISITE` · **Selected source:** `csv` (CSV / Excel import)
**Audited:** 2026-09-02 against `origin/main` `583df39e` and production `klkiseupptzbecbxwrky`

---

## 1. Baseline

| | |
|---|---|
| `origin/main` | `583df39e73677fc0e9d8cc49f174ff4586247e7c` |
| Railway | `583df39e` — SUCCESS |
| Vercel | `583df39e` — READY |
| W01 (`ENABLE_LEAD_INGESTION`) | **`"true"` on Railway (49 vars) and present on Vercel (96 vars)** |
| Live gate probe | `POST /api/lead-ingestion/manual` → **400** (gate open; was 404 `LEAD_INGESTION_DISABLED`) |

Production data, read-only, unchanged by this audit: `companies` 40 · `unified_persons` 23 · `identity_claims` 42 · `contacts` 10 · `leads` 18 · `engagement_threads` 126 · `engagement_messages` 125 · `lead_signals` 10 · `lead_intelligence` 18 · `canonical_leads` 18 · `prospect_accounts` 0 · `source_records` 0 · `source_assertions` 0 · `contact_governance_records` 0 · `person_duplicate_candidates` 0.

---

## 2. The ingestion contract an adapter must satisfy

Traced from the live routes. The adapter surface is far smaller than it first appears.

```
POST /api/lead-ingestion/<source>?company_id=<uuid>
  ├─ method guard                         405
  ├─ isLeadIngestionEnabled()             404 LEAD_INGESTION_DISABLED   (orchestrator.ts:63)
  ├─ company_id from QUERY STRING only    400  (body tenant keys REFUSED, manual.ts:53)
  ├─ enforceCompanyAccess                 400/401/403 — active user_company_roles
  ├─ requireCapability(PROSPECT_INGEST)   401/403 — audited allow and deny
  └─ ingestLeadBatch({ organizationId, source, records })
       ├─ batch size guard                MAX_BATCH_SIZE = 1_000
       ├─ resolveAdapter(source)          UnsupportedSourceError if unregistered
       ├─ adapter.translate(raw, orgId)   ◄── THE ONLY ADAPTER SURFACE (synchronous)
       ├─ tenant re-check                 adapter output naming another tenant is refused
       ├─ source re-check                 normalized.source must equal adapter.source
       └─ ingestNormalizedRecord
            ├─ resolveUnifiedPerson       conservative: email → phone → external key → create
            ├─ resolveOrCreateAccount     provider ref or domain, never name
            ├─ attachPersonToAccount
            ├─ ingestSourceRecord         LI-2 provenance: source_records + source_assertions
            ├─ detectAndParkDuplicates    LI-4C parking, never force-merge
            └─ governance                 existing mayContact path, fails closed
```

**`LeadSourceAdapter` (`contracts.ts:177`) is the entire contract:**

```ts
interface LeadSourceAdapter {
  readonly source: string;                        // becomes source_records.provider
  readonly label: string;
  readonly capabilities: readonly SourceCapability[];
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult;
}
```

`translate` is **synchronous by contract** — it cannot perform I/O even if asked. Identity resolution, account resolution, provenance, deduplication and governance are all orchestrator-owned and are **not** the adapter's concern. A new adapter is a pure, testable translation function.

---

## 3. Candidate matrix

The repository maintains its own authoritative catalogue at `backend/services/integrations/dataSourceCatalogue.ts`, deliberately written to record facts rather than aspirations ("there is deliberately no way to set a status here"). Its verdicts, verified against code:

| Candidate | Available | Requires | Adapter exists | Credential | Real-data path | Verdict |
|---|---|---|---|---|---|---|
| `manual` | **YES** | — | **YES** — `manualAdapter` (306 lines), registered, tested | none | operator push | **already done** — not a gap |
| `crm` | **YES** | — | **YES** — `crmAdapter` (135 lines), registered, tested | none | operator push | **already done** — a namespace, not a CRM connection |
| **`csv`** | no | `file_upload` | **NO** — *"Declared only. No ingestion adapter exists yet."* | **none** | tenant-owned export | **SELECTED** |
| `linkedin_sales_navigator` | no | `oauth`, `provider_terms_review` | NO | oauth | — | deferred — legal/terms gate |
| `apollo` · `zoominfo` · `crunchbase` · `rapidapi` | no | `api_key` | NO — *"No adapter and no credential configuration exist"* | api_key | — | deferred — commercial decision |
| `apollo_enrichment` · `zoominfo_enrichment` | no | `api_key` | NO — *"Enrichment is a later phase"* | api_key | — | deferred by architecture |

### Candidates that are **not** source adapters

Per PI-ADR-001 §5 the distinction matters, and two look attractive until traced:

- **Social / engagement (126 threads, 10 contacts, 10 lead_signals).** Real data exists, but its producer is `canonicalLeadSignalService`, and `socialContactResolution.ts:21` states the rule plainly: *"It NEVER creates a `unified_persons` row. A social handle is a bare provider identifier."* Social is an **identity-claim** path, already wired, and by contract §3.1.5 it cannot populate the person spine. Building a "social source adapter" would contradict the frozen architecture.
- **`crmIngestionService` (471 lines) / `unifiedIngestionService` (348 lines).** A separate, older ingestion system on a different `SourceAdapter` interface (`canHandle`/`transform`/`load`). It writes **none** of `source_records`, `unified_persons`, `identity_claims`, `prospect_accounts`. `index.ts:73-77` is explicit: *"`crm` is a NAMESPACE, not an integration, and is unrelated to `crmIngestionService`."* Wiring it in would duplicate systems, contrary to §3.7.
- **`csvSourceAdapter.ts` (35 lines).** Despite the name, it implements the **older** interface and is a pass-through that logs and returns records unchanged. It is **not** a `LeadSourceAdapter` and must not be mistaken for one. W02 does not extend it.

---

## 4. Why `csv` wins

1. **It is the only unavailable source whose blocker is not a credential.** `requires: ['file_upload']` — not `api_key`, not `oauth + provider_terms_review`. Every other gap needs a commercial or legal decision that engineering cannot make.
2. **It produces legitimate, non-synthetic data.** A tenant exporting its own contact list is real, owned, consented data — which is what the sparse spine actually needs, and the opposite of fabricating people.
3. **Minimal new surface.** No schema, no migration, no credential, no external dependency, no capability change (`PROSPECT_INGEST` already exists in `capabilityRegistry.ts:57`).
4. **It establishes the reusable pattern.** A CSV row is the same shape problem every future provider has: arbitrary columns → `NormalizedPerson`/`NormalizedAccount`. Solving it against the frozen boundary is exactly the template Apollo/ZoomInfo will later copy.
5. **`manual` and `crm` are not the gap.** They are complete, registered and tested — they are the *pattern*, not the work.

---

## 5. The prerequisite

**No CSV parsing capability exists** — `package.json` contains no `papaparse`, `xlsx`, or equivalent, and the catalogue records `requires: ['file_upload']`.

One bounded decision is required before implementation:

- **(A) Parse client-side, post `records[]`** — the browser parses the file and posts the existing JSON array shape. **Zero new backend surface, zero new dependency, zero upload storage.** Recommended.
- **(B) Upload the file, parse server-side** — needs a file-upload surface, a parser dependency, and storage handling. Materially larger, and touches media/storage paths unrelated to Prospect Intelligence.

**Recommendation: (A).** It keeps W02 to an adapter plus a thin route and honours §3.7. This document specifies (A); choosing (B) would require re-scoping.

---

## 6. Implementation specification

```text
Package:         PI-P1-W02
Source:          csv  (CSV / Excel import)
Objective:       A tenant's own exported contact list can be ingested through the
                 existing LI-4D chain, producing canonical persons, accounts and
                 full provenance, with no new credential and no schema change.

Existing implementation to reuse:
                 backend/services/leadIngestion/orchestrator.ts   (whole chain)
                 backend/services/leadIngestion/contracts.ts      (LeadSourceAdapter)
                 backend/services/leadIngestion/registry.ts       (registration)
                 backend/services/leadIngestion/adapters/manualAdapter.ts (reference shape)
                 backend/services/prospectIdentity/**             (identity, provenance,
                                                                   dedup, governance)
                 pages/api/lead-ingestion/crm.ts                  (route precedent)
                 shared/contracts/security PROSPECT_INGEST        (capability, exists)

Adapter/interface:
                 LeadSourceAdapter — source 'csv', capabilities
                 ['person_discovery','account_discovery']; synchronous translate.

Input contract:  { records: Array<Record<string, unknown>> } — one object per CSV row,
                 header-keyed. Tenant from QUERY STRING only; body tenant keys REFUSED.

Normalization:   reuse prospectIdentity/normalization.ts. Map row columns onto
                 NormalizedPerson / NormalizedAccount. Unmapped columns are dropped,
                 never invented. A row that yields no identifier is a per-record
                 normalization failure and must not abort the batch.

Identity resolution:  ORCHESTRATOR-OWNED — do not re-implement. Conservative order
                 email → phone → external key → create. Names are never identity keys.
Account resolution:   ORCHESTRATOR-OWNED — provider ref or domain, never name.
Provenance:      ORCHESTRATOR-OWNED — ingestSourceRecord writes source_records
                 (provider 'csv') + source_assertions.
Governance:      ORCHESTRATOR-OWNED — existing mayContact path, fails closed.
Deduplication:   ORCHESTRATOR-OWNED — detectAndParkDuplicates parks, never merges.
Persistence:     no direct writes from the adapter. Zero.

Downstream effects:  first non-zero source_records / source_assertions; possible new
                 unified_persons / prospect_accounts / person_duplicate_candidates rows,
                 strictly as the conservative resolver permits.

Schema scope:    NONE
API scope:       ONE new route, pages/api/lead-ingestion/csv.ts, a thin copy of the crm
                 route. Precedent is explicit (crm.ts:26-33): a second source gets its
                 own file rather than editing a live write path.
Credential scope: NONE
Files/modules expected to change:
                 NEW  backend/services/leadIngestion/adapters/csvAdapter.ts
                 NEW  pages/api/lead-ingestion/csv.ts
                 EDIT backend/services/leadIngestion/index.ts   (register csvAdapter)
                 EDIT backend/services/integrations/dataSourceCatalogue.ts (csv -> available)
                 EDIT backend/tests/unit/prospectIdentityIngestionBoundary.test.ts
                      ONLY if the closed ALLOWED list (line 162) rejects the new files
                 NEW  tests (below)

Tests expected:  unit adapter tests mirroring li4eManualAdapter.test.ts and
                 li5e4CrmAdapter.test.ts; route tests mirroring li5e2ManualIngestionRoute
                 and li5e4CrmIngestionRoute; MUST include a row with no identifier
                 (rejected, batch survives) and a row naming another tenant (refused).

Deployment requirement: YES — Railway + Vercel, from origin/main
Migration required:     NO

Production verification: see §8. No synthetic identity may be fabricated.

Rollback:        unregister csvAdapter (the route then returns UnsupportedSourceError),
                 or unset ENABLE_LEAD_INGESTION to close the whole gate. No data written
                 by a completed ingestion is rolled back by either — that is a data
                 decision, not a deploy decision.

Non-goals:       file upload / server-side parsing; any external provider; enrichment;
                 touching crmIngestionService or unifiedIngestionService; extending
                 csvSourceAdapter.ts (wrong interface); changing identity, governance,
                 dedup or ICP logic.

Dependencies:    W01 (done — gate live). Independent of W03/W04.
Parallelisation: SERIAL — see §7.
```

---

## 7. Collision analysis

| Surface | Collision | Risk | Handling |
|---|---|---|---|
| `supabase/migrations/**` | **NO** | — | no migration |
| `config/env.schema.ts` | **NO** | — | no new variable |
| `backend/db/supabaseKeys.ts`, `lib/supabase/publishableKey.ts` | **NO** | — | untouched |
| `backend/security/capabilityRegistry.ts`, `shared/contracts/security/SecurityCapabilities.ts` | **NO** | — | `PROSPECT_INGEST` already exists |
| `backend/services/prospectIdentity/**` | **read-only** | low | reused, never modified |
| `backend/services/prospectIcp/**` | **NO** | — | untouched |
| `prospectIdentityIngestionBoundary.test.ts` | **LIKELY** | **medium** | closed `ALLOWED` list at line 162; D1 already had to extend it once. Extend by precedent, with a negative control. |
| `supabaseApiKeyMigration.test.ts` | **NO** expected | low | closed allow-list over all runtime files; new files must name no legacy key variable — they won't |
| `backend/services/leadIngestion/index.ts` | **YES** | **medium** | single registration site — any second adapter collides here |
| `backend/services/integrations/dataSourceCatalogue.ts` | **YES** | low | single catalogue file |

**Classification: SERIAL.** Not because it lacks a migration — it does lack one, and that is irrelevant. It is serial because it edits the **single adapter-registration site** (`index.ts`) and the **single source catalogue**, and will probably edit a **closed allow-list test** that has already produced one post-merge failure in this programme. Two adapter packages running concurrently would collide on all three.

---

## 8. Certification plan — proving it without fabricating identity

Runtime execution is **not** part of this audit and was not performed.

The implementation is proven in this order, and only this order:

1. **Unit** — adapter translation, including a row with no identifier (rejected, batch survives) and a row naming a foreign tenant (refused).
2. **Route** — gate, method, tenant-from-query-only, body-override refusal, capability enforcement.
3. **Real-schema** — full chain against a disposable Postgres, asserting `source_records` + `source_assertions` written with provider `csv`, provenance hash stable on re-ingest (`outcome: 'unchanged'`), duplicates parked not merged, tenant-safe FKs hold.
4. **Merged-result** — merge locally, run the affected suites plus `typecheck:ci` and `typecheck:certification` on the merged tree. A green branch is not evidence.
5. **Production** — **only** with an authenticated operator holding `PROSPECT_INGEST` and a **real, tenant-owned, consented** export. Evidence: before/after counts on all seven spine tables; every new row traceable to a supplied CSV row; no cross-tenant row; governance record present where suppression applies.

**No synthetic person may be created to make counts non-zero.** If no real dataset is available, production verification stays open and is reported as such — exactly as W01 reported runtime as NOT PROVEN.

---

## 9. Implementation-agent brief

```text
PI-P1-W02
Objective:  Ingest a tenant's own CSV/Excel export through the existing LI-4D chain,
            producing canonical persons, accounts and provenance — no new credential,
            no schema change.
Source:     csv
Schema:     NONE
Files/modules:
            NEW  backend/services/leadIngestion/adapters/csvAdapter.ts
            NEW  pages/api/lead-ingestion/csv.ts
            EDIT backend/services/leadIngestion/index.ts
            EDIT backend/services/integrations/dataSourceCatalogue.ts
            EDIT backend/tests/unit/prospectIdentityIngestionBoundary.test.ts (only if required)
            NEW  adapter + route tests
Depends on: PI-P1-W01 (done). Prerequisite decision: client-side parse (option A).
Parallelisation: SERIAL
Migration:  NO
Deployment: YES (Railway + Vercel, from origin/main)
Acceptance evidence:
            unit + route + real-schema green; merged-result typecheck at baseline;
            catalogue csv -> available; production verification ONLY with a real
            tenant-owned consented export, or explicitly reported as NOT PROVEN.
```
