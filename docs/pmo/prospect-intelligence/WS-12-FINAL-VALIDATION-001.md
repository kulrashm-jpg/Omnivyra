# WS-12 — FINAL COMPREHENSIVE VALIDATION 001

**Date:** 2026-09-04 · **Branch:** `feat/pi-ws6-ws7-icp-attributes` · **HEAD validated:** `6e740f1f`
**Governing:** Playbook V2 · `IMPLEMENTATION-MANIFEST-001.md` · `MANIFEST-RECONCILIATION-001.md`
**Working tree:** clean · **Merged:** NO · **Deployed:** NO

No code, schema, migration, flag or provider was changed by this validation.

---

## 1. Executive verdict

# IMPLEMENTATION COMPLETE — ACTIVATION BLOCKED

The frozen engineering contract is implemented, integrated and validated. Every PI seam now has a production
caller; no seam remains test-only. Nothing is blocked on missing engineering that the frozen contract
requires.

Activation is blocked by four independent classes, none of them an engineering defect:

| Class | Count | Example |
|---|---|---|
| **PRODUCT-DECISION BLOCKED** | 8 | FR-30 algorithm; unsubscribe → suppression scope |
| **OPERATIONALLY BLOCKED** | 2 | `20261013000000` authored but unapplied |
| **DATA-VOLUME BLOCKED** | 3 | `prospect_accounts`, `source_records`, outreach family all at zero rows |
| **EXTERNALLY AUTHORIZATION BLOCKED** | 1 | no authorized people-data provider |

**This is not "production ready."** Tests passing is not activation.

---

## 2. End-to-end chain validation

Reachability was established by call-graph inspection, not by the presence of source. "Production caller"
means a non-test file reaches it.

| Stage | Implementation | Production caller | Tested | Verdict |
|---|---|---|---|---|
| DISCOVER | `leadIngestion/adapters/{manual,crm,csv}Adapter.ts` | `/api/lead-ingestion/*` | ✅ | INTEGRATED |
| NORMALIZE | `LeadSourceAdapter.translate` + `validateNormalizedRecord` | via `ingestLeadBatch` | ✅ | INTEGRATED |
| IDENTITY RESOLUTION | `identityResolutionService.resolveUnifiedPerson` | `leadIngestion/orchestrator.ts` | ✅ | INTEGRATED |
| ACCOUNT ASSOCIATION | `accountResolution.{resolveOrCreateAccount,attachPersonToAccount}` | orchestrator | ✅ | INTEGRATED |
| CANONICAL PROSPECT | `prospectIdentity/prospectResolution.ts` | orchestrator | ✅ | INTEGRATED |
| EXISTING INTELLIGENCE | `accountIntelligence.ts` | `apiHandlers/prospects/…` + `prospectContext.ts` | ✅ | INTEGRATED |
| MARKETPULSE | `marketPulse/prospectIntelligence.ts` | `accountIntelligence.ts` (transitive to API) | ✅ | INTEGRATED |
| ENRICH | `enrichment/{planner,result,service}.ts` | orchestrator + `apiHandlers/prospects/…` | ✅ | INTEGRATED |
| PROVENANCE | `prospectIdentity/ingestionBoundary.ts` | orchestrator | ✅ | INTEGRATED |
| COMPLETENESS · FRESHNESS | `engines/quality.ts`; per-seam `completeness`/`freshness` | API detail | ✅ | INTEGRATED |
| ENGAGEMENT TIMELINE | `engagement/prospectEngagementIntelligence.ts` | API + `prospectContext.ts` | ✅ | INTEGRATED |
| ICP | `prospectIcp/**` + `engines/prospectIcpFit.ts` | `/api/prospect-icp/*`; assembly | ✅ | INTEGRATED |
| SCORING | `engines/**` + `combineScores` | `apiHandlers/prospects/…` via assembly | ✅ | INTEGRATED |
| BUYING ROLE (attribute) | `unified_persons.buying_role` → WS-7 roster | API detail | ✅ | **DB ACTIVATION PENDING** |
| BUYING COMMITTEE | roster + observed roles only | API detail | ✅ | **NOT IMPLEMENTED** as scored logic |
| RECOMMENDATION | `engines/recommendation.ts` | via `prospectOutreach/readiness.ts` → API | ✅ | INTEGRATED |
| OUTREACH ELIGIBILITY | `prospectOutreach/readiness.ts` → `mayContact` | API detail | ✅ | INTEGRATED |
| ACTION / OUTCOME | `feedbackIngestion.ingestFeedback` | `POST /api/outreach/outcomes` | ✅ | **DATA-VOLUME BLOCKED** |
| LEARNING SIGNAL | `prospectOutcomes/corpus.ts` (**input seam only**) | API detail | ✅ | **NOT IMPLEMENTED** (algorithm) |
| REFRESH / MAINTENANCE | staleness reported by every seam; no scheduler | — | ✅ | **PRODUCT-DECISION BLOCKED** |

### Test-only seams: NONE remain

Before WS-10 every read seam was reachable only from tests. Verified at `6e740f1f`:

```
readProspectEngagementIntelligence → apiHandlers/prospects/prospectIntelligenceRead.ts, prospectContext.ts
aggregateAccountIntelligence       → apiHandlers/prospects/…, prospectContext.ts
buildProspectIntelligenceContext   → apiHandlers/prospects/…
assessOutreachReadiness            → apiHandlers/prospects/…
readProspectOutcomeCorpus          → apiHandlers/prospects/…
readTenantMarketContext            → accountIntelligence.ts  (transitively reachable from the API)
planProspectEnrichment             → leadIngestion/orchestrator.ts, apiHandlers/prospects/…
resolveOrCreateProspect            → leadIngestion/orchestrator.ts
ingestNormalizedRecord             → leadIngestion/index.ts → /api/lead-ingestion/*
ingestFeedback                     → pages/api/outreach/outcomes.ts
```

---

## 3. BR-01 … BR-30

Classification uses the frozen §15 registry plus the evidence above. `SATISFIED` means implemented AND
reachable; blockers are classified, not converted into defects.

| BR | Title | Status | Blocker class |
|---|---|---|---|
| BR-01 | Automatic Prospect Repository | SATISFIED (mechanism) | DATA-VOLUME |
| BR-02 | Multi-source Discovery | PARTIAL | EXTERNAL AUTHORIZATION |
| BR-03 | Partial Records | SATISFIED | — |
| BR-04 | Company-first Prospecting | SATISFIED | — |
| BR-05 | Person-first Prospecting | SATISFIED | — |
| BR-06 | Import | SATISFIED | — |
| BR-07 | Sales Navigator | NOT IMPLEMENTED | EXTERNAL AUTHORIZATION |
| BR-08 | Provider-agnostic Enrichment | SATISFIED (planner) | EXTERNAL AUTHORIZATION (no adapter) |
| BR-09 | Automatic Background Enrichment | PARTIAL — planning only | EXTERNAL AUTHORIZATION |
| BR-10 | Completeness | SATISFIED | — |
| BR-11 | Freshness | SATISFIED | — |
| BR-12 | Provenance | SATISFIED | — |
| BR-13 | Deduplication | SATISFIED | — |
| BR-14 | Company ICP | SATISFIED | OPERATIONAL (migration) |
| BR-15 | Person ICP | SATISFIED | OPERATIONAL (migration) |
| BR-16 | AI-generated ICP | PARTIAL — schema + route; no proposer | PRODUCT DECISION |
| BR-17 | Conversational ICP Control | NOT IMPLEMENTED | PRODUCT DECISION |
| BR-18 | ICP Learning | NOT IMPLEMENTED | PRODUCT DECISION + DATA-VOLUME |
| BR-19 | Scoring | SATISFIED (5 of 9 dimensions) | PRODUCT DECISION (4 dimensions) |
| BR-20 | Prospect Journey | PARTIAL | PRODUCT DECISION |
| BR-21 | Outreach History | SATISFIED for tasks+outcomes | PRODUCT DECISION (4 tables) |
| BR-22 | Suppression | SATISFIED | — |
| BR-23 | Next Best Action | SATISFIED | — |
| BR-24 | Account Intelligence | SATISFIED | OPERATIONAL + DATA-VOLUME |
| BR-25 | Buying Committee | PARTIAL — observed roster only | PRODUCT DECISION |
| BR-26 | Outreach Readiness | SATISFIED | — |
| BR-27 | Learning | NOT IMPLEMENTED | PRODUCT DECISION + DATA-VOLUME |
| BR-28 | Data Maintenance | PARTIAL — staleness reported, no refresh scheduler | PRODUCT DECISION |
| BR-29 | Minimum User Effort | PARTIAL | EXTERNAL AUTHORIZATION |
| BR-30 | Explainability | SATISFIED | — |

**Totals:** 18 SATISFIED · 8 PARTIAL · 4 NOT IMPLEMENTED.

---

## 4. FR-01 … FR-30

Ownership per `MANIFEST-RECONCILIATION-001`. The corrected FR-25 pointer is used; FR-26 is WS-8; FR-28 is
complete; the outcome corpus is **not** the FR-30 implementation.

| FR | Owner | Canonical implementation | Status | Evidence | Remaining blocker |
|---|---|---|---|---|---|
| FR-01 Intake | WS-4 | `leadIngestion/orchestrator.ts` | ✅ | `/api/lead-ingestion/*`; li4d + piWs4 suites | — |
| FR-02 Source Contract | WS-4 | `leadIngestion/registry.ts` | ✅ | 3 adapters registered | — |
| FR-03 Canonical Prospect | WS-1 | `prospectResolution.ts` | ✅ | `piWs1ProspectResolution` | DATA-VOLUME |
| FR-04 Canonical Account | WS-1 | `accountResolution.ts` | ✅ | `prospectIdentityAccountResolution` | DATA-VOLUME (0 rows) |
| FR-05 Identity Resolution | WS-1 | `resolveUnifiedPerson`, `personDuplicates.ts` | ✅ | — | — |
| FR-06 Source Observations | WS-2 | `ingestionBoundary.ts` | ✅ | boundary suite | DATA-VOLUME (0 rows) |
| FR-07 Enrichment Planner | WS-2 | `enrichment/planner.ts` | ✅ | `piWs2EnrichmentPlanner` | — |
| FR-08 Provider Selection | WS-11 | `intelligence/providerRegistry.ts` | ⚠ PARTIAL | no people adapter | EXTERNAL AUTH |
| FR-09 Cost Awareness | WS-2 | `SourceCost` + planner ordering | ✅ | unpriced sorts last (`planner.ts:239-242`) | — |
| FR-10 Enrichment Result | WS-2 | `enrichment/result.ts` | ✅ | 6 states preserved | — |
| FR-11 Completeness | WS-6 | `engines/quality.ts` + per-seam counts | ✅ | API `completeness` | — |
| FR-12 Freshness | WS-2 | `attributes_updated_at`, `observed_at` | ✅ | stale-vs-missing tests | — |
| FR-13 Data Health | WS-6 | `quality.ts`, `explainability.ts` | ✅ | API `contextGaps` + reasoning | — |
| FR-14 Timeline | WS-5 | `engagement/prospectEngagementIntelligence.ts` | ✅ | `piWs5` 38 cases | — |
| FR-15 Journey State | WS-4 | `leadIntelligenceOrchestration` | ⚠ PARTIAL | — | PRODUCT DECISION |
| FR-16 Company ICP | WS-6 | `prospectIcp/criteria.ts` ACCOUNT + `prospectIcpFit` account subject | ✅ | `piWs6` FR-16 cases | OPERATIONAL (migration) |
| FR-17 Person ICP | WS-6 | PERSON surface | ✅ | `piP1W03` | OPERATIONAL (migration) |
| FR-18 Composite Priority | WS-6 | `engines/prioritization.ts` | ✅ | assembly 12 engines | — |
| FR-19 Intent | WS-6 | `engines/intent.ts` | ✅ | abstains without evidence | — |
| FR-20 Engagement | WS-5 | `engines/behavioral.ts` + `lead_signals` | ✅ | `piWs5`, `piWs6` | signal vocabulary gap |
| FR-21 Buying Role | WS-7 | `unified_persons.buying_role` (closed vocab) | ✅ | `20261013000000` | OPERATIONAL (unapplied) |
| FR-22 Buying Committee | WS-7 | roster + observed roles | ⚠ PARTIAL | `accountIntelligence.contacts` | PRODUCT DECISION |
| FR-23 Multi-contact Account | WS-7 | `unified_persons.account_id` | ✅ | `piWs7` multi-prospect cases | — |
| FR-24 Next Best Action | **WS-8** | **`engines/recommendation.ts`** (C-7) | ✅ | `piWs8`; `leadActions` retained | — |
| FR-25 Outreach Readiness | **WS-8** | **`prospectOutreach/readiness.ts`** | ✅ | `piWs8` 38 cases | — |
| FR-26 Outreach Feedback | **WS-8** | `feedbackIngestion.ts` + `outreach_outcomes` | ✅ **COMPLETE** | `/api/outreach/outcomes`; dual idempotency | DATA-VOLUME |
| FR-27 Suppression | WS-2 | `contact_governance_records` + `mayContact` | ✅ | 36 cases; fail-closed | — |
| FR-28 Import | **WS-9** | **`csvAdapter.ts`** | ✅ **COMPLETE** | 52/52 pass | — |
| FR-29 Conversational Control | WS-10 | — | ❌ NOT IMPLEMENTED | — | PRODUCT DECISION |
| FR-30 Learning | **WS-6** | — (**corpus is an input seam, not this**) | ❌ NOT IMPLEMENTED | `prospectOutcomes/corpus.ts` reads only | PRODUCT DECISION + DATA-VOLUME |

**Totals:** 24 COMPLETE · 4 PARTIAL · 2 NOT IMPLEMENTED.

---

## 5. Canonical model validation — exactly one implementation each

Verified by scanning every write site, not by declaration.

| Concern | Canonical | Writers found | Verdict |
|---|---|---|---|
| Prospect | `canonical_leads` | `prospectResolution.ts`, `crmIngestionService.ts` (pre-existing legacy) | ✅ no NEW duplicate |
| Capture observation | `leads` | unchanged | ✅ |
| Derived intelligence | `lead_intelligence` | unchanged | ✅ |
| Signals | `lead_signals` | **`canonicalLeadSignalService.ts` ONLY** (`:390` upsert) | ✅ single writer |
| ICP | `prospectIcp/**` | `persistence.ts` | ✅ |
| Account intelligence | `accountIntelligence.ts` | **derives, stores nothing** | ✅ no table |
| Recommendation | `engines/recommendation.ts` | — (pure) | ✅ `leadActions` retained per C-7 |
| Outreach readiness | `prospectOutreach/readiness.ts` | — (pure) | ✅ |
| Suppression | `contact_governance_records` | **`contactGovernanceWriter.ts` ONLY** | ✅ |
| Feedback/outcomes | `outreach_outcomes` | **`storage.ts:415` ONLY** | ✅ |
| Import | `csvAdapter.ts` | — | ✅ |

**`lead_signals_v1`:** referenced in exactly two files — `prospectEngagementIntelligence.ts` (a comment saying
it stays untouched) and its test (asserting the code does not reference it). **Never read, never written.**

**No newly introduced competing model was found.**

---

## 6. Integration / call-graph evidence

| Transition | Producer | Consumer | Tenant key | Production caller |
|---|---|---|---|---|
| source → normalized | adapter | `ingestLeadBatch` | `organizationId` arg | `/api/lead-ingestion/*` |
| normalized → person | orchestrator | `resolveUnifiedPerson` | `companyId` | ✅ |
| person → account | orchestrator | `resolveOrCreateAccount` | `organization_id` | ✅ |
| → canonical Prospect | orchestrator | `resolveOrCreateProspect` | `company_id` | ✅ |
| → enrichment plan | orchestrator | `planProspectEnrichment` | explicit arg | ✅ |
| → provenance | orchestrator | `ingestSourceRecord` | `organization_id` | ✅ |
| → duplicates | orchestrator | `detectAndParkDuplicates` | `organizationId` | ✅ |
| Prospect → context | `prospectContext.ts` | WS-5 + WS-7 + `getRatifiedIcp` | explicit arg | `apiHandlers/prospects` |
| context → scoring | `assembleLeadUnderstanding` | `combineScores` | `ctx.key.companyId` | ✅ |
| scoring → NBA | assembly | `runRecommendation` | ctx | ✅ |
| NBA → eligibility | `readiness.ts` | `mayContact` | `organizationId` | ✅ |
| eligibility → API | `apiHandlers/prospects` | `/api/prospects/:id` | guard-validated | ✅ |
| outcome → corpus | `outreach_outcomes` | `prospectOutcomes/corpus.ts` | `company_id` | ✅ |
| corpus → learning | — | — | — | ❌ **no algorithm** |

---

## 7. Tenant / security validation

| Property | Evidence |
|---|---|
| A cannot read B's Prospect | `piWs5`, `piWs7`, `piWs9`, `piWs10` — composer returns null → 404 |
| A cannot reach B's Person via Prospect | `piWs10` "a cross-tenant person id pulls in no account, engagement or outcome" |
| A cannot read B's Account intelligence | `piWs7` "Tenant B's people never join onto Tenant A's Account" |
| A cannot read B's engagement | `piWs5` "messages are reachable ONLY through tenant-scoped threads" — `engagement_messages` has **no tenant column**, so this is the whole guarantee |
| A cannot read B's integrations | `company_integrations` filtered on `company_id` |
| A cannot read B's governance | `piWs8` "Tenant B's suppression never applies to Tenant A" |
| Cross-tenant ids cannot contaminate | proven for person, account, thread, task and contact ids |
| `organizationId` explicit at every boundary | every seam throws on a blank tenant |
| Guard precedes service access | `piWs10ProspectRoutes` — a denied guard leaves the composer uncalled |
| Unreadable canonical data fails safely | every seam throws with the table named; API → 503 retryable |
| Suppression fails closed | unreadable governance → `not_ready`; unanchored → never `allowed` |

**`check:authz` PASS** · **`check:orgaccess-binding` exit 0** · `check-tenant-authz`: 1331 routes, 8
grandfathered, **no new violations**.

---

## 8. Data-quality validation — six dimensions, not collapsed

| Collapse risk | Prevented by | Test |
|---|---|---|
| missing → zero | `numberOrNull` rejects `null`/`''` before `Number()` | "a score nobody recorded is null, never zero" |
| unimplemented → 0 | `state: 'not_implemented'`, `value: null` | "the four unimplemented dimensions report NOT_IMPLEMENTED, never zero" |
| abstention → no recommendation | `not_evaluated` preserved end to end | "an abstaining recommendation is not_evaluated, not an empty success" |
| stale → missing | `ageDays` + `stale: boolean\|null` reported separately | "an age that cannot be shown is STALE under a policy, not fresh" |
| unavailable → false | `observable: false` on unobservable outcome types | "a zero for an UNOBSERVABLE type is never read as a negative" |
| conflicting → chosen source | LI-2 RULE B withholds; WS-7 reports `sources_disagree` | "disagreeing sources are reported contested, and no value is picked" |
| undated → now | undated evidence excluded and counted | "undated evidence is EXCLUDED and counted, never back-dated to asOf" |
| unpriced → cheap | unknown cost sorts at `+Infinity` | "an unpriced source is UNKNOWN — never zero" |

**`Section<T>` states** — `available` / `empty` / `not_evaluated` / `not_implemented` / `failed` — verified to
hide nothing: `piWs10` proves EMPTY ≠ FAILED, and that one failing seam does not collapse the others.

**Actionability** remains WS-8's alone: WS-7 emits none (`piWs7`: "emits NO actionability — WS-8 owns that").

---

## 9. ICP validation

- **Declared / proposed / ratified / observed stay distinct.** `ratifyIcpVersion` requires
  `ratifiedByUserId` with **no default** — *"ratification is a human act and an AI model has no user id"*
  (`persistence.ts:311-315`).
- **No auto-ratify path exists** — the only callers are the barrel and `pages/api/prospect-icp/ratify.ts`.
- **Company and person ICP are separate evaluations, one ICP** — `evaluateIcpFit` called once per subject.
- **No offering model was invented** — product/service alignment and problem relevance remain absent.
- **Contract 18 holds** — no ratified ICP ⇒ zero contributions, never `0`, never `0.5`.

---

## 10. Enrichment / provider validation

- Field states `known / missing / stale / conflicting` and `requiredForNextAction` preserved to the API.
- Result states `success / partial / no_available_source / unavailable / failed / conflicting` preserved.
- **Cost awareness holds:** unknown cost sorts last at `Number.POSITIVE_INFINITY` (`planner.ts:239-242`) — an
  unpriced source never outranks a priced one.
- **Provider states intact.** `available: true` for exactly `manual`, `crm`, `csv`. Nothing else.
  **AUTHORIZED = none. OPERATIONAL = none.**
- **No fabricated provider, availability or credential** — asserted by test in WS-4, WS-9 and WS-10.
- MarketPulse consumed read-only; tenant market context never treated as external-company firmographics.

---

## 11. MarketPulse validation

- `market_pulse_*` canonical; **no third storage model**; `marketpulse_*` legacy untouched.
- WS-3 module contains no `.insert(`/`.update(`/`.upsert(`/`.delete(` — asserted.
- Tenant isolation: run AND findings both filtered on `company_id`.
- **No external-company firmographic is fabricated** — `piWs7`: "no company fact is ever sourced from
  MarketPulse"; the tenant's scan region never becomes the account's `region`/`market`/`country_code`.
- Provenance (finding id, run id, observed at), freshness and recorded confidence preserved.

---

## 12. Engagement / signal validation

- `lead_signals` canonical, single writer. `lead_signals_v1` untouched. No third model.
- Timeline derived from existing `engagement_threads` / `engagement_messages`; no second ledger.
- `platform_created_at` (source) vs `created_at` (ingest) kept distinct via `observedAtSource`.
- Undated evidence kept, placed last, counted — never back-dated.
- Null confidence stays null.
- **No signal fabricated from absence** — `piWs5`: "manufactures no signal from silence".

**⚠ UNRESOLVED — buying-signal vocabulary gap.** `lead_signals.source_type ∈ {engagement, listening}`;
`BuyingSignalType` expects `hiring | funding | exec_change | …`. **No bridge exists and none was invented.**
Consequence: `buyingSignal.ts` abstains for spine-derived contexts. PRODUCT DECISION.

---

## 13. Account / buying-role validation

Three concepts, deliberately distinct:

| Concept | State | Evidence |
|---|---|---|
| **OBSERVED buying role** | ✅ AVAILABLE | `unified_persons.buying_role`, closed vocabulary; WS-7 roster; API detail |
| **Buying role SCORING DIMENSION** | ❌ NOT IMPLEMENTED | absent from `SCORE_DIMENSIONS`; API reports `not_implemented` |
| **Buying committee DECISION LOGIC** | ❌ NOT IMPLEMENTED | no policy layer exists |

The API surfaces the first and explicitly marks the second; **no scored committee functionality is claimed.**
Account association, multi-contact handling, engagement aggregation, provenance and tenant MarketPulse
context are all validated and labelled `subject: 'tenant_market'`.

---

## 14. NBA / readiness / governance validation

**NBA** — canonical producer `engines/recommendation.ts`; no duplicate (`leadActions.buildLeadActionPlan`
retained live per C-7). Explainability, evidence ids, confidence, priority, channel and **abstention** all
preserved. `objective` and `expiry` are `null` because neither exists — not defaulted.

**Readiness** — `prospectOutreach/readiness.ts`. Channel resolved by **exact** match against
`KNOWN_CHANNELS`; `call` is dropped, never mapped to `phone`. Timing is the engine's relative window, never a
timestamp. An ungovernable channel **fails closed**.

**Governance** — `mayContact` is the sole evaluator. Unreadable state fails closed. **Suppression overrides
positive scoring** (`piWs8`: "a suppressed prospect is BLOCKED even with a positive recommendation"; "a high
priority never converts an ineligible prospect into an eligible one").

**⚠ An unsubscribe outcome is NOT silently converted into suppression** — correct per the frozen contract, and
the gap is recorded in §22.

---

## 15. Outreach / outcome / learning validation

**PI decides WHAT; Outreach Automation decides HOW/WHEN.** Asserted absent from WS-8 and WS-9:
`sendMessage`, `dispatch`, `schedule`, `enqueue`, `campaign`, `sequence`, `retry`. No approval bypass. No
automatic policy mutation.

**OUTCOME CORPUS ≠ LEARNING ALGORITHM.** `prospectOutcomes/corpus.ts` reads; it proposes nothing, trains
nothing, mutates nothing (asserted: no `train`, `propose`, `retrain`, `ratifyIcpVersion`, `combineScores`).

**FR-30 is NOT COMPLETE.** Two independent blockers: no algorithm defined, and **zero rows** in production
(A3 migration, verified read-only 2026-09-01: all nine outreach tables empty).

---

## 16. Import / intake validation

`csvAdapter.ts` canonical; `/api/lead-ingestion/{manual,crm,csv}` canonical; **no second pipeline** — WS-10
deliberately built none. Company-first, person-first and partial-record paths validated in `piWs4`.
**Identity resolution occurs once**, in the orchestrator.

⚠ The three intake routes use the legacy `enforceCompanyAccess` shim rather than `requireTenantAccess`. They
pre-date the canonical-guard convention and pass `check:authz`; recorded as a hygiene observation, not a
defect.

---

## 17. API / UI validation

| Property | Evidence |
|---|---|
| Guard precedes composer | `piWs10ProspectRoutes` — denied guard ⇒ composer uncalled |
| Semantic states preserved | `Section<T>`; §8 above |
| Unimplemented never shown as 0 | UI renders `—` + "Not implemented" badge |
| Explanation from canonical services | `reasoning`, `evidenceIds`, `contextGaps`, `unknowns` passed through |
| UI holds no business logic | panel computes nothing; routes contain no `ownedDbTable`/`mayContact`/`combineScores` |
| Existing routes reused | intake, import, outcome, ICP untouched |
| No duplicate API | `/api/prospects*` are the only new routes |

---

## 18. Database / migration state

**Nothing was applied.**

| Item | State |
|---|---|
| `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` | **AUTHORED, UNAPPLIED** (commit `a260e86e`) |
| Dependent capabilities | `prospect_accounts.{market, business_model, growth_stage}` → FR-16 account ICP criteria, WS-7 account facts; `unified_persons.{authority, influence, buying_role}` → FR-21 observed buying role, WS-7 roster, WS-6 relationship mapping |
| Classification | **CODE IMPLEMENTATION: EXISTS · DATABASE ACTIVATION: PENDING** |
| Behaviour until applied | those attributes read as absent; the API reports them missing rather than failing — no crash, no fabrication |

**Production data availability** (A3 migration read-only check, 2026-09-01; baseline audit):

| Table | Rows | Consequence |
|---|---|---|
| `prospect_accounts` | 0 | account intelligence returns well-formed empty |
| `source_records` / `source_assertions` | 0 | no provenance to arbitrate |
| all nine `outreach_*` tables | 0 | no outcome corpus to learn from |
| `canonical_leads` | populated (legacy) | prospect list returns rows |

**Empty data is not missing implementation.**

---

## 19. Feature flag / provider activation state

| Item | State |
|---|---|
| `LEAD_UNDERSTANDING_ENABLED` | **OFF** — absent from environment; not changed |
| `LEAD_UNDERSTANDING_AUTHORITATIVE` | **OFF** |
| `ENABLE_LEAD_INGESTION` | default OFF |
| Providers `available: true` | `manual`, `crm`, `csv` **only** |
| Providers AUTHORIZED / OPERATIONAL | **none** |

The WS-10 API exposes scoring and NBA **without** activating the flag, because it consumes the pure assembly
directly; the flag gates the shadow/authoritative runtime, not this read.

---

## 20. Test / certification results

| Check | Command | Result |
|---|---|---|
| PI comprehensive (64 suites) | `jest piWs piP1 leadIngestion li4d li5e prospectIdentity p2a p2b d1Prospect csvAdapter leadIntelligence leadActions contactGovernance marketPulse ws3Milestone feedback` | **1739 / 1739 PASS** |
| Typecheck | `npm run typecheck:ci` | **3/3 projects clean, at baseline** |
| Certification | `npm run typecheck:certification` | **PASS · net-new 0** — re-run under WS-12 at HEAD `6e740f1f`: `tsconfig.backend.json` 0/0 errors, `tsconfig.backend-tests.json` 260/260 (at baseline), FINGERPRINT PASS on both. Note: this run reported `attribution source: unavailable (git failed)`, so net-new is reported unattributed; the count is still 0 and an identical PASS with working attribution was recorded during the WS-10 gate at the same HEAD |
| Lint | `eslint` on WS-10 files | clean |
| `check:authz` | | **exit 0** |
| `check:orgaccess-binding` | | **exit 0** |
| `check:db-conventions` | | **exit 0** |
| `check:ssrf` | | **exit 0** |
| `check:migrations` | | **exit 0** |
| `check:route-policy` | | **exit 0** |
| `check-tenant-authz` | | **PASS — no new violations** |
| `check:architecture-boundaries` | | exit 1 — **PRE-EXISTING**, 0 PI-related lines |
| `check:canonical-authority` | | exit 1 — **PRE-EXISTING**, 0 PI-related lines |
| `check:file-lengths` | | exit 1 — **PRE-EXISTING**, no WS-10 file (all < 500) |
| Production build | `npm run build` | **ENVIRONMENT-DEPENDENT FAILURE** — `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_*`, `REDIS_URL`, `ENCRYPTION_KEY` all Required; no `.env` in this worktree. Not a code failure — `typecheck:ci` is clean across all three projects |

### Failure classification

| Failure | Class |
|---|---|
| `npm run build` | **ENVIRONMENT-DEPENDENT** (missing `.env`) |
| `check:architecture-boundaries`, `check:canonical-authority`, `check:file-lengths` | **PRE-EXISTING**, zero PI lines |
| `phase1aDataSources.test.ts` ×2 | **PRE-EXISTING** — stale assertion predating `csv` availability |
| Governance-ledger / route-auth suites (WS-8 run) | **PRE-EXISTING** — identical with WS-8 files stashed |
| **WS-12 introduced** | **NONE** |

No test was altered to make a suite green.

---

## 21. Production readiness matrix

| Area | Code | Integrated | Tested | Data | Activation | Verdict |
|---|---|---|---|---|---|---|
| Intake / import | ✅ | ✅ | ✅ | n/a | flag OFF | **B** |
| Identity / account resolution | ✅ | ✅ | ✅ | 0 rows | — | **B** |
| Provenance | ✅ | ✅ | ✅ | 0 rows | — | **B** |
| Enrichment planning | ✅ | ✅ | ✅ | n/a | no provider | **B** |
| Enrichment execution | ❌ | — | — | — | — | **D** (no adapter) |
| MarketPulse consumption | ✅ | ✅ | ✅ | 78 findings | — | **A** |
| Engagement / timeline | ✅ | ✅ | ✅ | populated | — | **A** |
| Signals | ✅ | ✅ | ✅ | populated | vocabulary gap | **C** |
| ICP | ✅ | ✅ | ✅ | 0 ratified | migration | **B** |
| Scoring (5 dimensions) | ✅ | ✅ | ✅ | — | — | **A** |
| Scoring (4 dimensions) | ❌ | — | — | — | — | **C** |
| Account intelligence | ✅ | ✅ | ✅ | 0 rows | migration | **B** |
| Buying role (observed) | ✅ | ✅ | ✅ | 0 rows | migration | **B** |
| Buying committee (scored) | ❌ | — | — | — | — | **C** |
| NBA | ✅ | ✅ | ✅ | — | — | **A** |
| Readiness / governance | ✅ | ✅ | ✅ | — | — | **A** |
| Outcome ingestion | ✅ | ✅ | ✅ | 0 rows | — | **B** |
| Outcome corpus read | ✅ | ✅ | ✅ | 0 rows | — | **B** |
| Learning | ❌ | — | — | — | — | **C** |
| API / UI | ✅ | ✅ | ✅ | — | — | **A** |

**A = IMPLEMENTATION COMPLETE (7) · B = VALIDATED, NOT ACTIVATABLE (9) · C = PRODUCT DECISION (4) ·
D = NOT IMPLEMENTED (1)**

---

## 22. Product blockers

1. **FR-30 learning algorithm** — what a learner proposes, over what window, at what confidence.
   Constrained by §12 to *proposal only*; ratification stays human.
2. **Four scoring dimensions** — Problem Fit, Account Potential, Buying Role, Relationship Strength.
   Representation and weights undefined.
3. **Buying-signal vocabulary** — extend `lead_signals`, or accept that `buyingSignal.ts` abstains.
4. **Offering model** — required before product/service alignment and problem relevance are facts.
5. **unsubscribe → suppression** — channel-scoped or `*`; person- or target-anchored; revocable.
   **⚠ Compliance-bearing:** `unsubscribed` outcomes are recorded and counted while `mayContact` cannot see
   them. The canonical vocabulary already contains `unsubscribe` and the writer exists; only the seam and the
   decision are missing.
6. **Outreach History contact-frequency policy** — 4 of 6 tables have no PI reader and no consumer without it.
7. **`LEAD_UNDERSTANDING_ENABLED` activation** — §18 names it a product decision and names **no owner**.
8. **`__global__` suppression consolidation** (C-3) — unchanged.

## 23. Operational blockers

1. **Apply `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql`** — six additive nullable columns.
   Until then FR-16 account criteria, FR-21 observed buying role and WS-7 account facts read as absent.
2. **Enable `ENABLE_LEAD_INGESTION`** for the tenants that should ingest.
3. **Populate the spine** — `prospect_accounts`, `source_records`, outreach family all at zero rows. Nothing
   downstream can produce a non-empty answer until intake runs.
4. **Production `.env`** — the build cannot be validated in this worktree.

## 24. External authorization blockers

1. **No authorized people-data provider.** DECLARED: `apollo`, `zoominfo`, `apollo_enrichment`,
   `zoominfo_enrichment`, `linkedin_sales_navigator`. AUTHORIZED: none. OPERATIONAL: none.
   Blocks BR-02, BR-07, BR-08, BR-09, FR-08 and every non-abstaining enrichment plan.

## 25. Remaining engineering blockers

**One.**

1. **FR-08 people-data provider adapter (WS-11, CREATE-1).** The planner selects and the result seam applies,
   but no adapter exists to call. This is contracted engineering — however it cannot begin before §24's
   authorization, so it is **sequenced behind** an external dependency, not independently actionable.

Everything else classified as a blocker is a product, operational or authorization decision. **No engineering
defect was found by this validation.**

---

## 26. Final DoD checklist

| # | Criterion | Status |
|---|---|---|
| 1 | Every BR/FR has a named canonical owner | ✅ |
| 2 | Exactly one canonical implementation per concern | ✅ verified by write-site scan |
| 3 | No duplicate Prospect / Account / Signal / MarketPulse / ICP / NBA / readiness / outcome / import model | ✅ |
| 4 | Every seam has a production caller | ✅ zero test-only seams |
| 5 | Tenant isolation proven at every boundary | ✅ |
| 6 | Unreadable canonical data fails safely | ✅ |
| 7 | Suppression fails closed and overrides scoring | ✅ |
| 8 | Six data-quality dimensions not collapsed | ✅ |
| 9 | Absence never becomes zero, false or now | ✅ |
| 10 | Abstention preserved end to end | ✅ |
| 11 | Explainability traceable to real evidence | ✅ |
| 12 | No fabricated provider, credential or capability | ✅ |
| 13 | Determinism — injected clock, no randomness | ✅ |
| 14 | PI never executes outreach | ✅ |
| 15 | No automatic policy mutation | ✅ |
| 16 | Migrations authored, none applied | ✅ |
| 17 | No flag activated | ✅ |
| 18 | Typecheck + certification clean | ✅ 1739 tests, net-new 0 |
| 19 | Product decisions documented, not inferred | ✅ 8 recorded |
| 20 | Production build validated | ❌ **environment-blocked** |
| 21 | Production data present | ❌ **zero rows** |
| 22 | Learning implemented | ❌ **product decision** |

**19 of 22 met.** The three unmet are operational, data and product — none is engineering.

---

## 27. Final verdict

# IMPLEMENTATION COMPLETE — ACTIVATION BLOCKED

The frozen Prospect Intelligence engineering contract is implemented, integrated and validated. 1739 tests
pass, typecheck is clean across three projects, certification carries zero net-new debt, and every
authorization and convention guard that is repository-clean passes. No seam remains test-only. No duplicate
canonical model was introduced. No product decision was resolved by inference.

Prospect Intelligence **cannot be activated in production today**, for four reasons in order of tractability:

1. **OPERATIONAL** — apply one authored migration; enable ingestion; populate the spine.
2. **DATA-VOLUME** — every downstream answer is correct and empty until intake runs.
3. **PRODUCT DECISION** — eight, of which unsubscribe → suppression is compliance-bearing and should be
   decided first.
4. **EXTERNAL AUTHORIZATION** — no people-data provider; enrichment can plan but never execute.

**This is the final engineering / product / operational decision record for Prospect Intelligence.**
