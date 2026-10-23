# D22-B2 — ONE ENRICHMENT PROVIDER
## VERIFICATION REPORT

| | |
|---|---|
| **Gate** | B2 — one enrichment provider, end to end through the existing harness |
| **Provider selected** | **Apollo** (`apollo`), account firmographics, one attribute: `employee_count` |
| **Verdict** | **VERIFIED.** The vertical slice runs end to end and B1b consumes its evidence correctly. |
| **Date** | 2026-10-06 |
| **Implementation code changed** | **NONE.** Apollo's adapter, the executor, the persistence port and B1b were all already in place. B2 added **two test files and nothing else.** |
| **Production** | **Untouched.** No production provider credential, no provider call, no production DB read or write, no migration, no deploy, no flag change. Docker never started. |

> **The headline, stated plainly.** B2's brief assumes the provider has to be built. **It does not.** The Apollo adapter (A7P-C4), its registration (A3U), the tenant credential port (A3M), the tenant-funded cost port (A3X), the attempt/lease/retry ledger (A4/A6/A7) and the persistence port into LI-2 all already exist, and two production entry points already reach them. What had **never** been verified is the composition with **B1b**, because B1b's arbitration is new. That composition is what this gate proves, and it is where the only new work was needed.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Provider selected and justified | **VERIFIED** |
| 2 | Existing adapter/harness evidence | **IMPLEMENTED** (pre-existing) |
| 3 | Files changed + hashes | **VERIFIED** — two test files, zero implementation change |
| 4 | Provider → PI mapping | **IMPLEMENTED** (pre-existing), **VERIFIED** here |
| 5 | Credential / configuration model | **IMPLEMENTED** (pre-existing), **VERIFIED** here |
| 6 | Outcome model | **IMPLEMENTED** (pre-existing), **VERIFIED** — all 7 required outcomes |
| 7 | Source assertion path | **VERIFIED** — no canonical write bypasses it |
| 8 | B1b integration proof (Cases A–E) | **VERIFIED** at T1 and T2 |
| 9 | Tenant isolation proof | **VERIFIED** — refused by the database |
| 10 | Cost / lease / retry proof | **PARTIAL** — cost, suppression and refusal verified; the **attempt ledger and lease were NOT exercised** (see §10) |
| 11 | T1 results | **VERIFIED** — 2019/2019 across 65 suites |
| 12 | T2 results | **VERIFIED** — 61/61 across 3 suites |
| 13 | Mutation probes | **VERIFIED** — 8/8 killed |
| 14 | Production-safety proof | **VERIFIED** |
| 15 | Remaining gaps | **5 recorded, none fixed** |

No STOP condition was triggered: the provider is exercisable without production credentials, selection needed no new product decision, no canonical surface was widened, and **B1b required no modification.**

---

## 1. Provider selected, and why

**Apollo.** Both candidates have complete adapters; the gate asked for the strongest existing contract on the smallest safe path to a *complete* slice.

| | Apollo | Clearbit |
|---|---|---|
| Attributes claimed | **1** — `employee_count` | 5 — `employee_count`, `employee_band`, `founded_year`, `country_code`, `technologies` |
| Transformation | none — a plain integer | per-field, via `pick` |
| External dependencies | `safeFetch`, `normalizeCompanyDomain` | also `clearbitSpec` + `vendorAdapter` from **companyIntelligence**, a different subsystem |
| Selector | canonical domain only | canonical domain only |
| Canonical surface | already in `ACCOUNT_ATTRIBUTE_COLUMNS` | already in `ACCOUNT_ATTRIBUTE_COLUMNS` |

Apollo wins on three counts. Its single attribute maps with **no transformation at all**, so a mapping bug cannot hide in a conversion. It depends on nothing outside the enrichment module, so the slice under test is the slice. And `employee_count` is **numeric in the spine and text in an assertion**, which exercises precisely the string-form attestation comparison B1b introduced — a better test of the new integration than a text attribute would be.

Clearbit would have exercised more attributes, including `technologies` (the O-5 opaque scalar). That breadth is a second-provider question and B2 forbids a second provider.

---

## 2. Existing adapter and harness evidence

Each of these was read in this gate, not assumed:

| Component | File | Evidence |
|---|---|---|
| Adapter | `providers/adapters/apollo.ts` | Full implementation: one `safeFetch`, host-pinned, credential in `x-api-key`, `Retry-After` parsed, no internal retry, refusals before egress |
| Contract | `providers/contract.ts` | `ENRICHMENT_OUTCOMES` (13 members), `classifyEnrichmentError`, `parseRetryAfter`, `NON_CALLING_OUTCOMES` |
| Registration | `providers/adapters/index.ts` + `providers/index.ts:42-43` | `registerPiEnrichmentAdapters()` runs **at module load** — "Importing this barrel is what makes `getProvider('clearbit')` answer" |
| Executor | `providers/execute.ts:203` | `options.adapter ?? getProvider(providerId)` — resolves by **id**, so `isAvailable(): false` does **not** block it |
| Credential | `providers/credentials.ts` | `tenantCredentialPort`, per-tenant, never `process.env` |
| Cost | `providers/cost.ts` | `tenantFundedExecutionPort` (A3X) — the tenant holds the subscription |
| Persistence | `providers/persistence.ts:202-231` | `makePersistObservation` → **`ingestSourceRecord`** → B1b |
| Production ports | `enrichment/productionPorts.ts:113-115` | composes the real credential, suppression and persistence ports |
| Entry points | `pages/api/prospects/[id]/enrich.ts`, `backend/jobs/prospectRetryJob.ts:152` | operator-triggered, and the retry cycle |

**A correction to the D22 audit.** D22 recorded that *"no enrichment provider is ever called"*. The call **path** is complete and operator-reachable; what is absent is a configured **tenant credential**, which is an operational fact rather than a code gap. (My own first grep in this gate returned only test files for `executeEnrichment` and I nearly repeated the error; the production referrers were found by reading an existing test that pins them, and confirmed directly.)

---

## 3. Files changed, with hashes

**Added — tests only:**

```
98647161064bfa7f  backend/tests/unit/b2ApolloProviderSlice.test.ts        (31 tests)
0c43ea7d926a8857  backend/tests/realschema/b2_apollo_slice.test.ts        (8 tests)
```

Both LF, zero control bytes.

**Implementation files — unchanged, and `git status` reports them clean against `HEAD`:**

```
5b3da65e617b7590  providers/adapters/apollo.ts
4c767b405f0b4979  providers/persistence.ts
ee4217e213cd28eb  providers/execute.ts
bfe068f0fa8111fd  providers/contract.ts
ab50ba643f883c60  providers/registry.ts
4c3237a8fbcb9585  prospectIdentity/ingestionBoundary.ts      (identical to B1b closure)
a6d3c35cf36ac3ad  prospectIdentity/attributeAuthority.ts     (identical to B1b closure)
```

`ingestionBoundary.ts` at `4c3237a8fbcb9585` is the **same hash the B1b runtime closure recorded**, which is the evidence that **B1b was not modified to accommodate the provider.**

---

## 4. The provider-to-PI mapping

```
Apollo GET /api/v1/organizations/enrich?domain=…
  payload.organization.estimated_num_employees : integer
        │
        │  mapApolloPayload — integers only; a string, a float, a range like
        │  "11-50", zero or negative all yield NOTHING rather than a coerced number
        ▼
  ProviderField { attribute: 'employee_count', subject: 'account',
                  value: <int>, observedAt: null, confidence: null,
                  providerInferred: true }
        │
        │  toAttributeBags — changes the KEY, never the VALUE
        ▼
  accountAttributes { employeeCount: <int> }
        │
        │  ingestSourceRecord → pendingFromAccount
        ▼
  source_assertions.attribute = 'employee_count'
```

**Verified:** the canonical name reaches LI-2 and Apollo's own field name never does — a test asserts `estimated_num_employees` appears nowhere in the persisted payload. `unmapped` is empty, so nothing is silently dropped.

**Deliberately unmapped by the adapter**, and left that way: `country` (a name, not an ISO code), `employee_band` (would be inference, not observation), `founded_year` and `technology_names` (representable but unproven against a real response). **No canonical surface was widened**; a test asserts every attribute Apollo claims is already in `ACCOUNT_ATTRIBUTE_COLUMNS`, and that none of the six structurally unwritable attributes is touched.

---

## 5. Credential and configuration model

Per-tenant, resolved immediately before the call, from `integration_credentials(provider_key='apollo', credential_key='api_key')` via `tenantCredentialPort`. **Verified in this gate:**

- `resolveCredential` is called with the **requesting tenant's** id, and with no other;
- a null credential ends the attempt at `credential_missing`, with **no provider call and no cost reservation**;
- the credential never appears in the persisted payload (asserted against the whole serialised write);
- the adapter reads no `process.env` for a credential.

`isAvailable()` returns `false` for both adapters **by design** — the contract asks whether a call could be made from configuration alone, and for a tenant-credential provider that question has no answer without a tenant. The executor resolves by id, so this does not block execution. It does mean `providersFor()` can never return a provider; see gap G-2.

---

## 6. The outcome model

The existing vocabulary was used; no parallel model was invented. All seven required categories verified, each asserting that **only a success reaches the write path**:

| Required | Vocabulary member | Verified |
|---|---|---|
| success | `enriched` | ✔ persists |
| no_match | `no_match` (HTTP 404) | ✔ no write |
| credential_missing | `credential_missing` | ✔ no call, no cost, no write |
| provider_error | `provider_unavailable` (HTTP 500) | ✔ no write |
| timeout | `timeout` | ✔ no write |
| rate_limited | `rate_limited` (HTTP 429) | ✔ no write |
| malformed_response | `malformed_response` | ✔ no write |

Also verified: a matched organization holding no usable count is `field_not_found`, **not** an `enriched` result carrying nothing.

---

## 7. The source-assertion path

Every provider-derived canonical change passes `provider result → source assertion → B1b arbitration → canonical update`. Nothing writes a canonical attribute directly: `ingestionBoundary` remains the single writer, and the pre-existing repository scan enforces it. Mutation probe 1 inserts a direct canonical write into the persistence port and the scan fails.

Preserved end to end, verified against the real schema:

| | Evidence |
|---|---|
| provider | `source_assertions.provider = 'apollo'` |
| confidence | **null** — Apollo states none, and none is manufactured |
| observed_at | **null** — Apollo's payload has no per-field date, and the executor's clock is not substituted |
| recorded_at | present — D-1's ratified fallback supplies recency |
| raw / normalized value | both stored |
| value hash | sha256 |
| provenance | `applied_to_canonical_at` + `applied_reason` |
| supersession | per `(source_record, attribute)`, unchanged |

**D-1's fallback does real work here, not notional work.** Because Apollo supplies no `observed_at`, Case C is decided by its `recorded_at` competing with another source's observation date. The ratified fallback is what lets a provider with no timestamps still correct a stale value — and what stops it from claiming a freshness nobody stated.

---

## 8. B1b integration proof — Cases A–E

At T1 against the decision function, and at T2 through the **real** executor and adapter into **real PostgreSQL**.

| Case | Setup | Result |
|---|---|---|
| **A** empty canonical | `employee_count` NULL | → **4200**, one assertion, one decision, `single_uncontested_assertion` |
| **B** provider loses | another source observed 5100 later; canonical 5100, attested | canonical **unchanged**; Apollo's 4200 retained **live**, `applied_reason` NULL, **no** decision appended |
| **C** provider corrects | canonical 900 attested by a January CSV observation | → **4200**, `newest_observation`; the CSV claim stays live — a loser is not superseded |
| **D** unattested incumbent | canonical 777, no assertion ever | **not overwritten**, `unattested_incumbent`, no decision; the evidence is still recorded |
| **E** idempotent repeat | identical evidence twice | **one** assertion, **one** decision, one source record with `observation_count > 1` |

Also verified: **no authority is declared for Apollo.** An older Apollo value loses to a newer non-Apollo one, which is what O-1 and O-7 staying deferred must look like at runtime.

---

## 9. Tenant isolation

- **Cross-tenant attach fails closed at the database.** Tenant A enriching tenant B's account is refused with `23503` on `source_records_account_tenant_fk` — on the **evidence insert**, before arbitration is reached. No source record, no assertion, no canonical change, no decision.
- **Two tenants enriching the same domain stay separate:** two independent source records, two different canonical values.
- Credential, cost and write all carry the requesting tenant, and the other tenant's id appears nowhere in the write payload.
- **Drishiq Labs receives no special handling.** Five files on the slice contain no `drishiq` string and no UUID literal at all, so there is nowhere for an exemption to live.

---

## 10. Cost, lease and retry — **PARTIAL**, stated honestly

**Verified:**
- cost is authorised **before** egress (call ordering asserted, not assumed);
- a refused authorisation yields `cost_denied` with **no egress and no write**;
- `credential_missing` reserves nothing — it is in `NON_CALLING_OUTCOMES`, so it is never billable;
- duplicate suppression short-circuits **without contacting the provider**;
- evidence persistence (§7, §8).

**NOT exercised in this gate:** the **attempt ledger** (`prospect_enrichment_attempts`) and the **lease/claim** path. Those live behind `executeEnrichmentRecorded`, whose recorder and lease ports the T2 harness does not compose; the arbitration cases were driven through `executeEnrichment` with the real persistence port instead.

That is a deliberate scope boundary, not an oversight — but the gate's T2 list names "enrichment attempt/result persistence", so it is reported as **PARTIAL** rather than claimed. The existing suites `piA4aEnrichmentAttempts`, `piA4nAttemptLease`, `piA4jDoubleSpendSuppression` and `piA6aRetryHorizon` cover that ledger independently and all pass (within the 2019 below); what is **unverified** is the ledger *composed with the B1b write path in one transaction*.

---

## 11. T1 results — VERIFIED

| Suite set | Result |
|---|---|
| `b2ApolloProviderSlice` (new) | **31/31** |
| b2 / apollo / piA3 / piA4 / piA5 / piA6 / piA7 / piM1 / li2 / li4 / li5 / piWs2 / piWs4 / piWs6 / piWs7 / prospectIdentity / p2a / p2b / p2c / b1bSource / leadIngestion / piWsf / piTenantScoped / piDefect001 — **65 suites** | **2019/2019** |
| `tsc --noEmit --incremental false` | **0 errors** |

No pre-existing suite was modified by B2.

## 12. T2 results — VERIFIED

**61/61** across three suites against the isolated PostgreSQL 17.6: `b2_apollo_slice` (8, new), `b1b_arbitration` (23), `li2_source_records` (30). B1b and LI-2 both still pass unchanged alongside the new provider slice.

---

## 13. Mutation probes — 8 of 8 killed

Anchor matched exactly once, injection changed bytes, suite required to fail, restore in `finally`, hash re-checked.

| # | Probe | Verdict |
|---|---|---|
| 1 | direct canonical write bypassing assertions | **KILLED** (single-writer scan) |
| 2 | missing tenant scope on the canonical read | **KILLED** (after the gap below was closed) |
| 3 | fabricated confidence | **KILLED** |
| 4 | fabricated `observed_at` | **KILLED** |
| 5 | provider error not reported as an error | **KILLED** (3 tests) |
| 6 | duplicate enrichment creating a duplicate assertion | **KILLED** |
| 7 | B1b arbitration bypass | **KILLED** |
| 8 | cross-tenant provider result attachment | **KILLED** (8 tests) |

All three mutated files restored byte-identically: `apollo 5b3da65e617b7590`, `persistence 4c767b405f0b4979`, `boundary 4c3237a8fbcb9585`.

**Probe 2 initially SURVIVED, and it found something real.** Removing the tenant predicate from LI-2's canonical **read** failed nothing. The reason is not a missing guarantee: `source_records_account_tenant_fk` refuses a cross-tenant account on the evidence insert, which happens first, so **no reachable scenario can exercise that predicate**. It is defence in depth — and being unreachable, it was also unprotected, so deleting it was free. Closed with a source-level guard (the house pattern for invariants a runtime test cannot stage) pinning the tenant predicate on both the canonical read and the canonical write, plus a scan that every `source_assertions` read and update carries `organization_id`.

**Two of my own probe errors, corrected rather than reported as results.** One probe inserted only a comment — bytes changed, behaviour did not. That is a no-behaviour mutation and my own protocol forbids counting it; it was removed and replaced by the value-changing variant. A guard I wrote also flagged the assertion INSERT, where the tenant travels in the row rather than in a filter chain; the guard was scoped correctly rather than the invariant weakened.

---

## 14. Production safety

| Claim | Evidence |
|---|---|
| No production provider call | `safeFetch` is mocked in both suites. Every response is a local literal. The adapter's single egress point cannot be reached. |
| No production credential | The only credential in either suite is the string `synthetic-tenant-apollo-key`. This worktree contains **no `.env.local`** — only `.env.test` and two `.example` files — and `setupEnv.ts` refuses to load production. |
| No production DB read or write | `W6_DB_URL` is `postgresql://…@127.0.0.1:55432/b1b_closure`. The harness independently refuses managed hosts. |
| No migration | B2 authored none. The migration census is unchanged at 438. |
| No deploy, no flag change | `vercel`, `railway`, `gh` never invoked; no `.env*` written. |
| Docker never started | `docker ps` fails — daemon down, checked at start and end. |
| Isolated server stopped | No PID file, 0 processes, 0 listeners on 55432. |
| Nothing committed | Two new files, uncommitted. |

---

## 15. Remaining gaps — recorded, not fixed

| # | Gap | Note |
|---|---|---|
| **G-1** | **`providerInferred` does not survive into the assertion.** Apollo's `estimated_num_employees` is explicitly its own **estimate** and the adapter says so, but `toAttributeBags` carries only key and value — so a modelled number becomes indistinguishable from a filed one. | Carrying it needs a new `source_assertions` column. A test pins the loss so it is visible. **Schema change, outside B2.** |
| **G-2** | **`providersFor()` can never return a provider**, because every tenant-credential adapter answers `isAvailable(): false`. Any future caller that selects a provider by capability will find none. The executor resolves by id, so nothing is broken today. | A latent trap for the next caller. |
| **G-3** | **The attempt ledger and lease are unverified in composition with B1b** (§10). | Covered independently by the A4/A6 suites. |
| **G-4** | **No tenant credential is configured anywhere**, so the slice cannot run against the real Apollo in any environment. This — not code — is what makes enrichment inert today. | Operational; needs a separate authorisation to store a tenant key. |
| **G-5** | Apollo claims one attribute. Four more are representable from its payload but deliberately unmapped pending a real response. | By design; a second gate. |

---

## Verdict

**B2 VERIFIED — one provider, end to end, with B1b consuming its evidence correctly.**

The slice was already implemented; B2 selected it, proved the composition, and **changed no implementation code**. Cost/lease is **PARTIAL** and five gaps are recorded.

**STOP.** No second provider was implemented. B3 / B4 / B10 were not begun. Production was not touched.
