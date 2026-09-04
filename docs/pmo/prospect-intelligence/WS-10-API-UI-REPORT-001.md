# WS-10 — API / UI INTEGRATION REPORT 001

**Date:** 2026-09-04 · **Branch:** `feat/pi-ws6-ws7-icp-attributes` · **HEAD before WS-10:** `fc7616bf`

---

## 1. Verdict

**PARTIAL.**

The Prospect Intelligence **read surface** — the capability that had no consumer at all — is delivered end to
end: API, composition and UI. Four capability groups were **already exposed by existing routes** and were
deliberately not duplicated. Two are blocked on open product decisions and are surfaced as explicit states
rather than implemented.

---

## 2. Scope executed

**Built (the genuinely missing surface).** Before this change, `readProspectEngagementIntelligence`,
`aggregateAccountIntelligence`, `buildProspectIntelligenceContext`, `assessOutreachReadiness` and
`readProspectOutcomeCorpus` were reachable **only from tests**. Every PI capability existed and none was
usable.

| Capability group | Delivered |
|---|---|
| **A. Prospect Repository** | `GET /api/prospects` (list) · `GET /api/prospects/:id` (detail) · `/prospects/[id]` UI |
| **D. Account Intelligence** | in detail — identity, roster, observed buying roles, provenance, freshness, contested/unattested attributes |
| **E. Scoring / ICP** | in detail — the five implemented dimensions with value/confidence/contributors; the four unimplemented ones as `not_implemented` |
| **F. NBA** | in detail — action, channel, timing, confidence, evidence ids, unknowns; abstention preserved |
| **G. Outreach Readiness** | in detail — readiness, governance channel, suppression verdict, required missing fields, constraints |
| **H. Outreach Outcomes (read)** | in detail — per-type counts with `observable`, so a zero is never a negative |
| **C. Enrichment** | in detail — the WS-2 plan with `known / missing / stale / conflicting / no_available_source` preserved |

**Not built, because a route already exists** (§10 forbids a second implementation):

| Group | Existing route |
|---|---|
| **B. Prospect Intake** | `pages/api/lead-ingestion/{manual,crm,csv}.ts` |
| **I. Import** | `pages/api/lead-ingestion/csv.ts` → `csvAdapter.ts` |
| **H. Outcome write** | `pages/api/outreach/outcomes.ts` → `ingestFeedback` |
| **ICP propose/ratify** | `pages/api/prospect-icp/{propose,ratify}.ts` |

---

## 3. Files changed

| File | Kind |
|---|---|
| `backend/apiHandlers/prospects/prospectIntelligenceRead.ts` | NEW — composer (480 lines) |
| `pages/api/prospects/index.ts` | NEW — list route |
| `pages/api/prospects/[id].ts` | NEW — detail route |
| `components/prospects/ProspectIntelligencePanel.tsx` | NEW — UI panel |
| `pages/prospects/[id].tsx` | NEW — page shell |
| `backend/tests/unit/piWs10ProspectApi.test.ts` | NEW — 30 cases |
| `backend/tests/unit/piWs10ProspectRoutes.test.ts` | NEW — 14 cases |

**No existing file was modified.** No schema, no migration, no flag.

---

## 4. Canonical service consumption

| Surface | Service consumed | Owner |
|---|---|---|
| list | tenant-scoped page over `canonical_leads` | WS-1 entity |
| detail → engagement/timeline | `readProspectEngagementIntelligence` | WS-5 |
| detail → account/roster/buying role | `aggregateAccountIntelligence` | WS-7 |
| detail → context | `buildProspectIntelligenceContext` | WS-6 |
| detail → scoring | `assembleLeadUnderstanding` + `SCORE_DIMENSIONS` | WS-6 |
| detail → NBA | `assessOutreachReadiness().nextBestAction` (which reshapes `engines/recommendation.ts`) | WS-8 |
| detail → readiness/suppression | `assessOutreachReadiness` → `mayContact` | WS-8 / WS-2 |
| detail → enrichment | `planProspectEnrichment` + `ingestionEnrichmentCoverage` | WS-2 / WS-4 |
| detail → outcomes | `readProspectOutcomeCorpus` | outcome corpus |
| integration state | `company_integrations`, read exactly as `/api/integrations/data-sources` reads it | existing |

A test asserts the composer contains **no** `combineScores(`, `combineDimension(`, `mayContact(`,
`evaluateIcpFit(`, `runRecommendation(`, `buildLeadActionPlan` or action vocabulary; the routes additionally
contain no `ownedDbTable`.

---

## 5. New contracts

1. **`Section<T>` = `{ state, reason, data }`** with `SectionState ∈ {available, empty, not_evaluated,
   not_implemented, failed}`. Derived from the states the services already distinguish; it exists so the API
   cannot collapse them into an empty 200.
2. **`DimensionView`** — one score dimension plus its state. Mirrors `DimensionScore` and adds `not_implemented`.
3. **`ProspectListRow`** — includes `scored: boolean` because `canonical_leads.qualification_score` defaults
   to `0` and WS-1 never writes it; without that flag a UI would read the default as a verdict.

No other contract was invented; every other field is a service result passed through.

---

## 6. Security evidence

- **`requireTenantAccess`** — the canonical guard for new code, on both routes. `enforceCompanyAccess` (the
  legacy shim used by `/api/lead-intelligence/*`) was deliberately not reused.
- **The tenant is named, never inferred.** `companyId` is a query parameter validated against live membership.
- **Authorization runs before anything else is read** — proven: a denied guard leaves the composer uncalled.
- **404 ≠ empty.** A prospect in another tenant returns `null` from the composer's own tenant-scoped read →
  404; a readable prospect with nothing known returns 200 with `empty` sections. The authenticated-403-vs-404
  oracle is avoided because the guard answers first.
- **Every read carries its tenant column** — asserted for `canonical_leads`, `unified_persons`,
  `prospect_accounts`, `engagement_threads`, `company_integrations`, `outreach_tasks`.
- **Cross-tenant person id yields nothing** — no account, no engagement, no outcome.
- **Fail-closed preserved** — suppression is `assessOutreachReadiness`'s verdict, untouched; an unreadable
  repository is `503 retryable`, never an empty `200`; an unreadable integrations table reports *no*
  connections so the planner answers `no_available_source` rather than selecting an unverifiable provider.
- **`check-tenant-authz` PASS** — 1331 routes scanned, 8 grandfathered, **no new violations**.

---

## 7. Tests

| Check | Command | Result |
|---|---|---|
| WS-10 composer | `jest piWs10ProspectApi` | **30/30 pass** |
| WS-10 routes | `jest piWs10ProspectRoutes` | **14/14 pass** |
| PI regression (36 suites) | `jest piWs piP1 leadIngestion li4d li5e prospectIdentity p2a p2b d1Prospect` | **1143/1143 pass** |
| API/UI adjacent (19 suites) | `jest leadIntelligence contactGovernance outcomes dataSources integrations` | 268 pass / **2 fail (pre-existing)** |
| Typecheck | `npm run typecheck:ci` | **3/3 projects clean, at baseline** |
| Certification | `npm run typecheck:certification` | **PASS · net-new 0** |
| Lint | `eslint` on all five new files | **clean** |
| Tenant authz guard | `node scripts/check-tenant-authz.js` | **PASS** |
| DB conventions guard | `node scripts/check-db-conventions.js` | **exit 0** |
| File lengths guard | `node scripts/check-file-lengths.js` | exit 1 **pre-existing** — no WS-10 file appears; all under 500 |

The certification gate caught two test casts jest could not see (`DimensionView`); they were fixed, not
baselined.

---

## 8. Pre-existing failures (NOT caused by WS-10)

Both verified by stashing every WS-10 file and re-running — identical results.

1. **`phase1aDataSources.test.ts` — 2 failures.** The catalogue now marks `csv` available (shipped by the PI
   CSV workstream); the suite still expects only `crm` and `manual`. A stale assertion predating CSV.
   Not fixed — §9 forbids repairing unrelated failures.
2. **`check-file-lengths.js` exits 1** — files over the threshold exist across the repository; none is a
   WS-10 file.

---

## 9. Unsupported capabilities (deliberately not implemented)

| Capability | Why |
|---|---|
| Problem Fit · Account Potential · Buying Role (dimension) · Relationship Strength | no representation or weight defined — surfaced as `not_implemented` with the reason, never as `0` |
| FR-30 learning | open product decision |
| buying-signal vocabulary bridge | no mapping exists; inventing one would fabricate a buying signal |
| offering model (product/service alignment, problem relevance) | requires an entity that does not exist |
| unsubscribe → suppression | open compliance decision (MANIFEST-RECONCILIATION-001 §5 E) |
| Outreach History contact-frequency | no policy defined; 4 of 6 tables remain unread |
| provider activation | no authorized people-data provider; the composer names none |
| outreach execution | Outreach Automation's, not PI's |

**Buying Role is shown twice, deliberately:** as an **observed attribute** in the account roster (available),
and as a **score dimension** (`not_implemented`). They are different things and the UI does not conflate them.

---

## 10. Operational prerequisites for production activation

1. **`20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` is authored and UNAPPLIED.** The API reads
   `market`, `business_model`, `growth_stage`, `authority`, `influence`, `buying_role` through WS-7's
   aggregation. Until it is applied those columns do not exist and will read as absent — which the API
   reports honestly as missing rather than failing. **Not applied by this work; no compensating migration created.**
2. **`LEAD_UNDERSTANDING_ENABLED` is OFF.** The API consumes the engines directly through the assembly, which
   is pure and flag-independent, so scoring and NBA are exposed without activating anything. The flag gates
   the SHADOW/authoritative *runtime*, not this read.
3. **Empty tables.** `prospect_accounts`, `source_records` and all nine outreach tables held zero rows in
   production (A3 migration check, 2026-09-01). Every endpoint will return well-formed empty states until
   intake runs.
4. **No authorized people-data provider** — enrichment plans will report `no_available_source`.

---

## 11. Architecture compliance

- **No duplicate Prospect model** — reads `canonical_leads`; creates no entity.
- **No duplicate Account Intelligence model** — consumes `aggregateAccountIntelligence`; no table.
- **No duplicate recommendation engine** — consumes WS-8, which reshapes `engines/recommendation.ts` (C-7).
  `leadActions.buildLeadActionPlan` untouched and still live.
- **No duplicate readiness engine** — consumes `prospectOutreach/readiness.ts`.
- **No duplicate outcome store** — read-only over `outreach_outcomes`; the write path is unchanged.
- **No duplicate import pipeline** — `csvAdapter.ts` and its route untouched.
- **No new provider fabrication** — asserted absent: `apollo`, `zoominfo`, `rapidapi`,
  `linkedin_sales_navigator`.
- **No architecture changes** — no existing file modified.
- **No product-policy invention** — every open decision is surfaced as an explicit state.

---

## 12. Commit

- **Branch:** `feat/pi-ws6-ws7-icp-attributes`
- **Working tree:** clean · **pushed**
- **Merge status:** NOT merged · **Deploy status:** NOT deployed · **WS-12:** not run
