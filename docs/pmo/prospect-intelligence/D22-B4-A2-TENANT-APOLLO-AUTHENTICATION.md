# D22-B4-A2 — TENANT APOLLO AUTHENTICATION + EMPIRICAL CAPABILITY GATE

# OUTCOME C — AUTHENTICATION BLOCKED

**No Apollo subscription was authenticated, and no Apollo call was made, because no Apollo credential of any kind exists or was supplied.**

The gate's stated cause for Outcome C is *"the existing tenant credential/authentication path cannot securely authenticate the tenant's Apollo subscription."* **That cause does not apply, and I am correcting it rather than reporting it.** The path is capable, is the only approved one, and was proven correct at runtime in this gate: 264 T1 tests, 124 real-schema tests, and 4/4 credential-boundary mutation probes killed. What is missing is the **secret itself** — an input only the owner can supply, and one the brief rightly forbids passing through a prompt.

| | |
|---|---|
| **Date** | 2026-10-06 |
| **Files created** | 1 (a test). **Source files modified: NONE.** |
| **Migration** | none. Census **440 → 440**, unchanged. |
| **Apollo API calls** | **ZERO** |
| **Apollo credential used** | **NONE.** Every secret in this gate is synthetic and labelled so. |
| **Frozen files** | 18/18 verified by hash, **zero drift** — including the entire B4-A1 architecture |
| **Production** | untouched. No prod DB, no prod credential, no deploy, no flag, no migration, Docker never started. |

> **The blocker is an input, not an architecture.** Zero occurrences of `apollo` across all ten env files; `APOLLO_API_KEY` appears in the repository only as a declaration or as a *negative* test; and the only approved store is per-tenant `integration_credentials`, which is populated by a tenant admin through `PUT /api/prospect-sources/credentials`. **Phase 1 is an operator action by design** — the brief forbids credentials in source, tests, prompts and reports, so a credential cannot reach this gate through me without violating it.

---

## Classification summary

| Phase / Item | Status |
|---|---|
| Phase 0 — preflight, read-only | **VERIFIED** |
| Phase 1 — the authentication PATH (A–G) | **VERIFIED** at runtime, with synthetic secrets |
| Phase 1 — authenticating a real Apollo subscription | **BLOCKED** — no credential exists |
| Phase 2 — tenant isolation (items 1–3, 5, 6) | **VERIFIED** |
| Phase 2 — item 4 (revocation fails closed) | **VERIFIED** (new composition test) |
| Phase 2 — mutation probes | **4/4 KILLED** |
| Phase 3 — one controlled Apollo call | **NOT RUN** — no credential |
| Phase 4 — characterise the real response | **NOT RUN**; all 15 questions **UNVERIFIED** |
| Phase 5 — discovery → canonical compatibility | **UNVERIFIED** — no observed response to check against |
| T1 | **264/264 PASS** (8 suites) |
| T2 real schema | **124/124 PASS** (7 suites) |
| Typecheck | **3/3 projects clean** |
| Route authorization | **PASS** — 1351/1351 |
| Production safety | **VERIFIED** |

**Phases 3–5 are NOT RUN because an input is absent, not because the architecture failed.** Nothing here suggests Apollo cannot do discovery; this gate simply could not establish that it can.

---

## 1. Gate verdict

**OUTCOME C — AUTHENTICATION BLOCKED**, by elimination, with its stated cause corrected.

Outcome A requires a successful controlled discovery call — none was made. Outcome B requires that *"tenant authentication works"* — a real subscription was never authenticated, so claiming B would assert something untested. Outcome C is the remaining answer, and the honest version of it is:

> The tenant credential path is **verified capable and is the only approved path**. Authentication is blocked because **no Apollo credential was available to authenticate with**, in any environment.

## 2. Tenant authentication result

| Item | Result |
|---|---|
| Apollo credential found in the environment | **none** — 0 occurrences of `apollo` across all ten env files (`.env`, `.env.beta.example`, `.env.cert`, `.env.cert.example`, `.env.e2e`, `.env.example`, `.env.local`, `.env.local.bak.precredit`, `.env.local.test`, `.env.test`) |
| Apollo credential found in the repository | **none** — a scan for an assigned Apollo key literal returns nothing. `APOLLO_API_KEY` appears only as a descriptor field (`sources.ts:200`, `apollo.ts:141`, `companyIntelligence/.../index.ts:82`) or in tests that exist to prove a platform key is *never used* |
| Apollo credential supplied to this gate | **none** |
| Apollo credential in `integration_credentials` | **unknown and out of scope** — reading production is forbidden by the execution scope, and no non-production tenant holds one |
| Apollo OAuth / connect flow | **does not exist.** A repository-wide search for an Apollo OAuth path returns nothing. Apollo's descriptor requires `['api_key', 'tenant_provider_subscription']`, so the supported mechanism is an API key through the A3P route — which is what Phase 1 says to use, and which was not invented here |

**Why this is an operator action, not an agent action.** The brief forbids placing credentials in source, tests, prompts or reports. A real Apollo key therefore cannot reach this gate through the conversation without breaking that rule. The correct path is unchanged and already built: a tenant admin performs `PUT /api/prospect-sources/credentials?companyId=<non-prod tenant>` with `{ provider: 'apollo', credentials: { api_key } }`.

## 3. Credential architecture used — the existing one, unchanged

Two pre-existing components, and **no second credential mechanism was created**:

**The store — `integrationCredentialService.ts`.** `upsertProviderCredentials` encrypts **before the value ever reaches a row object**, writes `integration_credentials(company_id, provider_key, connection_id=NULL, credential_key, encrypted_value, rotated_at)`, and on `23505` rotates in place through an UPDATE that carries the tenant on every predicate. `getProviderCredentials` reads with `company_id` AND `provider_key`, and a value that fails to decrypt yields `''` — *"a corrupt secret is an absent secret."* `requireProviderScope` refuses a tenant-less or provider-less call before touching the store, so an empty string can never widen a WHERE clause.

**Encryption — `credentialEncryption.ts`.** AES-256-GCM, key from `config.ENCRYPTION_KEY`, strict 64-hex (`requireEncryptionKey` refuses base64, because two modules deriving different bytes from one variable was a real defect SEC91-B12 fixed).

**The resolution port — `enrichment/providers/credentials.ts` (A3M).** Answers only *"does THIS tenant have a credential for THIS provider?"*. Its header states the prohibition: *"This file must never read `process.env` for a credential, and there is a test that fails if a tenant with no credential is rescued by an environment variable."* Absence and non-entitlement both return `null`, deliberately — *"a caller that could distinguish… would learn something about another tenant's configuration from the shape of its own refusal."*

**The control plane — `pages/api/prospect-sources/credentials.ts` (A3P).** `requireTenantAccess` then `requireExternalApiAccess(requireManage: true)`, in that fixed order. Provider ids validated against the closed `ACQUISITION_SOURCES` vocabulary. **Secrets travel one way:** *"A credential enters through PUT and never comes back"* — the handler re-reads from the store rather than echoing the payload, so the plaintext is not in scope when the response is built.

**Apollo is accepted by this path**, and that is proven at runtime rather than asserted: the existing A3P suite contains *"a valid Apollo write returns 200, not 500"*, which passed in this gate.

### Phase 1 A–G — proven, with synthetic secrets

Every item was verified by **executing** existing suites, not by reading them. No new mechanism was written for any of them.

| | Requirement | Evidence (all passing in this gate) |
|---|---|---|
| **A** | credential exists for the selected tenant | real schema: *"stores one row, correctly scoped, on a first write"* |
| **B** | credential can be resolved for that tenant | A3M: *"Tenant A resolves ITS OWN Apollo credential"* |
| **C** | secret is encrypted at rest | real schema: *"never stores the plaintext credential"*; A3M: *"stores encrypted, never plaintext"* |
| **D** | secret is never logged | A3P: *"no console output across a full lifecycle contains the secret"* |
| **E** | secret is never returned in API responses | A3P: *"the configure response carries no plaintext, only a mask"* |
| **F** | credential resolution is tenant-scoped | A3M: *"Tenant A can never reach Tenant B's credential — the tenant IS the predicate"*; PHASE-1A: refusals in both directions, carrying no secret |
| **G** | no environment/global fallback exists | A3M: *"the port never consults the environment"*; new B4-A2: *"a platform APOLLO_API_KEY in the environment does NOT make a tenant ready"* |

**No secret is printed anywhere** in this report, in the new test, or in any output. Every value used is prefixed `synthetic-` and corresponds to no Apollo account.

## 4. Tenant-isolation proof

| # | Requirement | Status |
|---|---|---|
| 1 | Tenant A resolves Tenant A's Apollo credential | **VERIFIED** |
| 2 | Tenant B cannot resolve Tenant A's | **VERIFIED** (A3M + PHASE-1A, both directions) |
| 3 | Tenant A cannot resolve Tenant B's | **VERIFIED** |
| 4 | Removing A's credential makes A's provider execution fail closed as `credential_missing` | **VERIFIED** — the one genuinely new test in this gate |
| 5 | No fallback to another tenant, a global credential, the environment or a platform credential | **VERIFIED** |
| 6 | No special-case branch for Drishiq Labs | **VERIFIED** — a scan of the credential and discovery paths returns nothing |

**Item 4 is the composition this gate is actually about**, and nothing previously covered it: a credential that is present makes a B4-A1 execution `pending` and `readyForProviderExecution`, and after revocation the next execution of the same search closes `refused_pre_call` / `credential_missing` / `not_called` with `provider_calls_made = 0`. It fails **closed**, and the refusal is recorded as evidence rather than swallowed.

Two further properties worth recording, both newly asserted: **a credential alone does not make a vendor reachable** — with the real registry in place, a tenant *with* a credential is still refused `provider_not_registered`, which is what keeps the next gate's authorization meaningful; and the discovery layer **introduces no second credential store** (it never names `integration_credentials`, `encryptCredential` or `decryptCredential`, and performs no `process.env` read).

## 5–7. The Apollo endpoint, the call, and the result

| | |
|---|---|
| Endpoint that **would** be tested | `POST https://api.apollo.io/api/v1/mixed_people/search` |
| Was the real call made? | **NO** |
| HTTP status | **none — no request was issued** |
| Credits consumed | **none** |

No request was constructed, no host was contacted, and **no fixture appears in this report pretending otherwise.** A recorded "expected response" would be precisely the fabrication the Apollo adapter's own header warns against: *"writing an adapter against a response shape nobody here has ever received would produce normalization code that compiles, passes its own fixtures, and is wrong — and the first evidence of that would be fabricated attributes on real people."*

## 8–13. Observed response, identifiers, contactability, pagination, cost, rate limits

**All fifteen Phase 4 questions are UNVERIFIED. Nothing was observed, so nothing is recorded.**

| Phase 4 question | Answer |
|---|---|
| 1–3 authentication / request accepted / results returned | **NOT RUN** |
| 4 HTTP status | **NOT RUN** |
| 5 available response fields | **UNVERIFIED** |
| 6 stable Apollo person identifier | **UNVERIFIED** |
| 7 stable Apollo organization identifier | **UNVERIFIED** |
| 8 email / contactability fields | **UNVERIFIED** |
| 9 name / title / company fields | **UNVERIFIED** |
| 10 pagination mechanism | **UNVERIFIED** |
| 11 provider request / correlation identifier | **UNVERIFIED** |
| 12 credit / cost information | **UNVERIFIED** |
| 13 rate-limit headers | **UNVERIFIED** |
| 14 does the subscription permit the operation | **UNVERIFIED** |
| 15 tenant-specific subscription restrictions | **UNVERIFIED** |

The documented evidence remains **self-contradictory** and this gate did not resolve it: Apollo's own reference says People API Search costs 0 credits and is free-account reachable with *"additional account eligibility requirements"* and an obfuscated `last_name`, while independent 2026 pricing analyses say *"free and basic users have no API access"*. **Phase 4 forbids inferring from documentation, so neither reading is recorded as a finding.** One authenticated call settles it.

## 14. Discovery architecture compatibility — UNVERIFIED, and deliberately so

Phase 5 asks whether the observed response can be represented by the B4-A1 path. **There is no observed response, so this cannot be answered, and asserting it would be the inference Phase 4 forbids.**

What IS verified is the architecture's readiness, which B4-A1 already proved and this gate re-ran: `DiscoveryPage → translate (pure) → ingestLeadBatch → resolveUnifiedPerson → dedup → account resolution → source_records → source_assertions → B1b → canonical_leads`, exercised end-to-end against the real schema with a synthetic provider.

**One hard prerequisite, restated because it is the thing most likely to be assumed:** `findPersonByExternalKeys` returns null on an empty key map, so a discovered person with no email, no phone and **no stable provider id** would mint a new all-null person on every replay — unbounded duplicates. Apollo's person id must participate through the **existing** `external_keys` mechanism as SOURCE identity (D-6). No second identity system, no Apollo canonical table, no direct canonical write, and no B1b change is contemplated or present.

## 15. Files changed and hashes

**Created (1):**

```
bafa50eb4e7f27e4  backend/tests/unit/b4a2TenantApolloAuthentication.test.ts   (LF, 0 CRLF)
```

**Source files modified: NONE.** Verified by content hash, not by `git status` — 18/18 frozen, **zero drift**:

```
4c3237a8fbcb9585  prospectIdentity/ingestionBoundary.ts            ← B1b
a6d3c35cf36ac3ad  prospectIdentity/attributeAuthority.ts           ← B1b
5b3da65e617b7590  enrichment/providers/adapters/apollo.ts          ← B2 enrichment
af9a772af98adcb2  enrichment/attempts.ts
6e2559e6ca6f2b43  enrichment/providers/credentials.ts              ← probe-touched ×2, restored
60cdf48467b3a185  leadIngestion/orchestrator.ts
d69499ce30761fc1  leadIngestion/contracts.ts
63ae5877e726a633  leadIngestion/registry.ts
9312a072be91df3b  prospectLifecycle/outcomeLifecycleProducer.ts    ← B3
f6d7c298a16b0c22  prospectDiscovery/contract.ts                    ← B4-A1, frozen
0a49191583df7701  prospectDiscovery/discoveryAttemptStore.ts       ← B4-A1, frozen
60f9fcd154b89b10  prospectDiscovery/providerRegistry.ts            ← B4-A1, frozen
33cf8099ab79bae4  prospectDiscovery/discoveryExecutor.ts           ← B4-A1, frozen
0353b2a9b091eada  prospectDiscovery/index.ts                       ← B4-A1, frozen
9b0eb88ee527ae37  pages/api/prospect-sources/discovery.ts          ← B4-A1, frozen
e8b9d614449121f9  migrations/20261119000000_…decisions.sql
1a426f268fb48d43  migrations/20261120000000_…tenant_fk.sql         ← G-6
10cc467128fd7693  migrations/20261121000000_…discovery_attempts.sql ← B4-A1
8f1444c617376ee1  integrationCredentialService.ts                  ← probe-touched ×1, restored
```

`credentials.ts` and `integrationCredentialService.ts` were temporarily mutated by the Phase 2 probes and restored; the harness asserts byte-identical restoration after each probe and would have aborted otherwise. No opportunistic fix, no cleanup, no unrelated refactor, no formatting change. **No jest configuration was modified** — a `@/` mapper for the real-schema project was considered and rejected, because the existing `integration_credentials` suite already proves the storage layer against real PostgreSQL by issuing the service's own SQL, and widening shared test infrastructure for one gate would change behaviour for every real-schema suite.

## 16. Migration census

**440 before, 440 after.** No migration was added, altered or removed. Nothing was applied to production.

## 17. T1 — 264/264 PASS (8 suites)

`piA3mTenantCredentials` · `piA3pLeadSourceCredentialApi` · `phase1aCredentialTenantIsolation` · `apolloEnrichmentAdapter` · `b4a1DiscoveryExecution` (65) · **`b4a2TenantApolloAuthentication` (13, new)** · `piA3tClearbitSourceReadiness` · `piA3xTenantFundedEconomics`.

Plus **typecheck 3/3 projects clean** and **route authorization PASS (1351/1351)**, with no allowlist entry added.

## 18. T2 — 124/124 PASS (7 real-schema suites)

`integration_credentials` (the real table, real SQL, `apollo` explicitly, tenant isolation, never plaintext) · `b4a1_discovery_execution` (32) · `b1b_arbitration` · `b2_apollo_slice` · `b2_g3_attempt_composition` · `b2_g6_attempt_tenant_fk` · `b3_outcome_lifecycle`. Isolated PostgreSQL 17.6 in the session scratchpad; started for this gate and stopped afterwards.

## 19. Mutation probes — 4/4 KILLED

| # | Mutation | Verdict |
|---|---|---|
| 1 | the **organization predicate** is removed from the credential read | **KILLED** (7 tests failed) |
| 2 | the resolver **ignores the organization** it was asked about | **KILLED** (5 failed) |
| 3 | an **environment credential** rescues a tenant that configured none | **KILLED** (3 failed) |
| 4 | **another tenant's credential** is substituted when this tenant has none | **KILLED** (1 failed) |

Every file restored byte-identically; `credentials.ts` came back to `6e2559e6ca6f2b43`, which matches the value B4-A1 recorded — an independent cross-check that the restore is exact.

## 20. Runtime results

All runtime work happened against the isolated local PostgreSQL. The credential path was exercised with **synthetic** secrets only. **One controlled Apollo call: NOT MADE** — there was no credential to make it with. `safeFetch` is mocked as a tripwire in the discovery real-schema suite and its call count is asserted to be **zero**.

## 21. Production-safety confirmation

No production database was contacted. No production credential was read — in particular, **`ENCRYPTION_KEY` was not taken from `.env.local`** (which is production) or from `.env.cert`; the encryption path was exercised only through suites that already provide their own test environment. No production Apollo discovery, no bulk search, no credential replacement, no deploy, no feature flag, no production data mutation, no production migration. **Docker never started.** Nothing committed.

## 22. Exact blockers

| # | Blocker | What unblocks it |
|---|---|---|
| **B4A2-1** | **No Apollo credential exists in any environment.** Zero in all ten env files; none supplied; the only store is per-tenant `integration_credentials` | A tenant admin enters one real Apollo API key via `PUT /api/prospect-sources/credentials` for a **controlled non-production tenant**. It must not pass through a prompt, a test, or this report |
| **B4A2-2** | **No controlled non-production tenant is designated** for the test. The local isolated PostgreSQL holds the schema but is not a deployed environment with an operator UI | Name the non-production tenant and confirm its environment can reach `api.apollo.io`. Whether the existing remote non-prod project carries `companies` and `integration_credentials` was **not probed** — out of scope, and it does not change blocker 1 |
| **B4A2-3** | **Apollo free-plan API access remains genuinely unclear** — the vendor's own reference and independent analyses contradict each other | The single authenticated call in Phase 3, once blocker 1 clears |
| **B4A2-4** | **Phase 4/5 cannot be answered** without blocker 1 | the same call |

**Nothing in this list is an architectural gap**, and none of it requires changing anything B4-A1 built or anything the credential layer already does.

## 23. Exact next authorized gate

Unchanged in substance, now with a precise precondition:

1. **Owner/operator action first:** designate a controlled non-production tenant and store ONE real Apollo API key for it through the existing A3P route. Confirm *to this gate* only that it is stored — never the value.
2. Then re-enter **B4-A2 Phase 3**: exactly one `POST /api/v1/mixed_people/search` under that tenant's context, through the B4-A1 executor, bounded, ledgered, host-pinned, with no bulk run and no deliberate credit spend.
3. Then **Phase 4**: characterise the real response — fields, stable person and organization ids, contactability, pagination, provider request id, credit information, rate limits.
4. Only then the adapter gate: implement the Apollo `DiscoveryProviderAdapter` and its `LeadSourceAdapter` translator against the frozen B4-A1 architecture.

**Step 4 still requires no change to anything B4-A1 built**, which was the point of building it provider-free.

---

# OUTCOME C — AUTHENTICATION BLOCKED

The tenant credential architecture is **ready, correct, and the only approved path** — tenant-scoped on every predicate, encrypted before the value reaches a row, masked on the way out, never logged, with no environment or cross-tenant fallback, and now proven to make a B4-A1 discovery execution fail **closed** the moment a credential is revoked. Four deliberate attacks on that boundary were all refused.

**What is absent is the secret.** No Apollo credential exists in any environment reachable from here, and by the gate's own rules it cannot arrive through a prompt. That is one operator action, not an engineering problem — and until it happens, Apollo's capability stays **UNVERIFIED** rather than assumed in either direction.

No Apollo call was made. No credential was fabricated, substituted or printed. No response was invented. No source file was modified, and the B4-A1 architecture is byte-for-byte intact.

**STOP.** No adapter implementation. No bulk discovery. No B10. No scoring feedback. No inbound email. No scheduler. No deploy. No production migration. Production untouched.
