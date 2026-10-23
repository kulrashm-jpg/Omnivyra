# D22-B4-A — APOLLO DISCOVERY

# B4-A BLOCKED

**Apollo discovery was not implemented, and no credential would have been enough to implement it.** Three independent blockers fired. One is the missing credential the owner decision anticipated; **the other two are architectural and are not resolved by any credential**, which is the finding that matters.

| | |
|---|---|
| **Date** | 2026-10-06 |
| **Files changed** | **NONE.** This gate was read-only. |
| **Migrations** | none added. Census unchanged at **439**. |
| **`ingestionBoundary.ts`** | `4c3237a8fbcb9585` — unchanged |
| **`attributeAuthority.ts`** | `a6d3c35cf36ac3ad` — unchanged |
| **`apollo.ts` (enrichment)** | `5b3da65e617b7590` — unchanged |
| **Apollo API calls made** | **ZERO.** No credential exists to make one with. |
| **Production** | untouched. No DB, no credential read, no provider call, no deploy, no flag, Docker never started. |

> **The blocker is not "Apollo is hard to call."** It is that **discovery has no subject, and every governed execution surface in PI is keyed to one.** The attempt ledger's `prospect_enrichment_attempts_one_subject` CHECK requires exactly one of `person_id`/`account_id`, and `EnrichmentRequest` requires a canonical `entityId`. Discovery, by §4's own definition, originates a prospect that Omnivyra *does not yet possess* — so it has neither. Separately, `LeadSourceAdapter` is **pure by contract** and no fetch-then-ingest stage exists anywhere. §7 mandates a path that currently has no entry point for a provider-originated record, and §18 forbids inventing one here.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Owner decision | recorded |
| 2 | Apollo account type | **UNVERIFIED** — no account was supplied |
| 3 | Credential ownership | **VERIFIED** (architecture) / **BLOCKED** (no credential exists) |
| 4 | Free-account capability | **UNVERIFIED** — documented evidence is self-contradictory |
| 5 | Discovery operation tested | **NOT RUN** — no credential |
| 6 | Request/response characterization | **NOT RUN** |
| 7 | Enrichment vs discovery distinction | **VERIFIED** |
| 8 | Adapter implementation | **BLOCKED** — not written |
| 9 | Canonical ingestion path | **VERIFIED** (exists) / **BLOCKED** (no fetch stage) |
| 10 | Identity resolution | **VERIFIED** (structurally sufficient, with one condition) |
| 11 | Deduplication | **VERIFIED** (structurally) |
| 12 | Provenance / source assertions | **VERIFIED** (structurally ready) |
| 13 | B1b interaction | **VERIFIED** — frozen, untouched, needs no change |
| 14 | Tenant isolation | **NOT RUN** for discovery; existing guarantees unchanged |
| 15 | Credential isolation | **VERIFIED** (structurally, by inspection) |
| 16 | Idempotency | **VERIFIED** (structurally) / **NOT RUN** (live) |
| 17 | Attempt / lease composition | **BLOCKED** — cannot represent a subject-less call |
| 18 | Cost / billing behaviour | **UNVERIFIED** — contradictory documentation |
| 19 | T1 | **NOT RUN** — nothing implemented |
| 20 | T2 | **NOT RUN** — same |
| 21 | Mutation probes | **NOT RUN** — no code changed |
| 22 | Production validation | **NOT PERFORMED** — not authorized, and prerequisite unmet |
| 23 | Files changed + hashes | **VERIFIED** — zero changes |
| 24 | Migrations | **VERIFIED** — none |
| 25 | Production safety | **VERIFIED** |
| 26 | Remaining gaps | 4, each with its exact blocker |
| 27 | Next owner decision | **4, listed in §27** |

Items 5, 6, 19, 20, 21 are **NOT RUN because stop conditions fired**, not because they were skipped. Items 2, 4, 18 are **UNVERIFIED rather than failed** — the distinction is load-bearing: nothing here proves Apollo *cannot* do discovery, only that this gate could not establish that it can.

---

## 1. Owner decision, as recorded

Apollo Discovery selected. Apollo is tenant-owned; every tenant supplies its own credential; **no global or platform Apollo credential**. Certification was to use ONE tenant's **free-account** credential, with no purchase, no upgrade and no paid capability. Free-account discovery capability was to be **proved first**, and production discovery is **not** authorized by the prompt.

This gate honoured all of it, including the instruction that mattered most: *"If it does not, STOP and report the exact limitation. Do not fabricate discovery."*

---

## 2–3. Account type and credential ownership

**Account type: UNVERIFIED.** No Apollo account — free or paid — was supplied to this gate, so its type could not be observed. Nothing was assumed in either direction.

**Credential ownership architecture: VERIFIED, and it is already exactly what the decision requires.** Two components, both pre-existing:

- **The port** — `enrichment/providers/credentials.ts` (A3M). It answers one question: does *this tenant* have a credential for *this provider*? Its header states the prohibition itself: *"This file must never read `process.env` for a credential, and there is a test that fails if a tenant with no credential is rescued by an environment variable."* Absence and non-entitlement both return `null`, deliberately, *"because a caller that could distinguish… would learn something about another tenant's configuration from the shape of its own refusal."*
- **The entry surface** — `pages/api/prospect-sources/credentials.ts` (A3P), `PUT` with `{ provider, credentials: { api_key } }`, stored into `integration_credentials(provider_key='apollo', credential_key='api_key')`. `api_key` is already in `SECRET_CONFIG_KEYS`, so it is encrypted at rest with no additions. Two guards in fixed order — `requireTenantAccess` then `requireExternalApiAccess(requireManage: true)` — and **secrets travel one way**: *"A credential enters through PUT and never comes back."*

`sources.ts` already records Apollo's funding model as `tenant_provider_subscription`, with `authorizationRequirements: ['api_key', 'tenant_provider_subscription']` and the note that what remains outstanding is *"the TENANT's: their own Apollo subscription and their own key stored through the Lead Sources API."*

**So the tenant-ownership requirement of §2 needs no work. It was already built, and it is already correct.**

### The blocker: no Apollo credential is reachable

| Where a credential could be | Found |
|---|---|
| Environment files — `.env`, `.env.local`, `.env.cert`, `.env.test`, `.env.example`, `.env.beta.example`, `.env.cert.example`, `.env.e2e`, `.env.local.test`, `.env.local.bak.precredit` | **zero** occurrences of the string `APOLLO`, in any of them — not even a commented placeholder |
| Repository | `APOLLO_API_KEY` appears only as a **declaration or a negative test**: `sources.ts:200`, `apollo.ts:141`, `companyIntelligence/.../index.ts:82`, and three tests whose purpose is to prove a platform key is *never* used (`apolloEnrichmentAdapter.test.ts:338` — *"a platform APOLLO_API_KEY in the environment is NEVER used"*; `piA3mTenantCredentials.test.ts:375` seeds `'synthetic-global-key-that-must-never-be-used'`) |
| `integration_credentials` | the **only** real store. Per-tenant, encrypted, and populated exclusively through the A3P route by a tenant admin |
| Production `integration_credentials` | **out of scope.** Reading it is production DB access, which the execution scope forbids and §14 makes a separate authorization |

And an environment variable would be the wrong answer even if one existed: A3M exists precisely to refuse it, and §2 forbids *"an environment-wide Apollo key used on behalf of tenants"* and *"fallback from tenant credential to platform credential."* **The credential must arrive the way a tenant's credential arrives, or the certification would be certifying the wrong thing.**

Consequently every one of §3's eight verification items is **UNVERIFIED**: authentication, account type, endpoint availability, record suitability, credit requirement, identity sufficiency, rate limits, and plan-gating. Not one was converted into a claim.

---

## 4. Free-account capability — UNVERIFIED, and the documentation disagrees with itself

§3 required actual observed behaviour and warned against converting documentation into "verified". I could not observe behaviour, so I read the documentation — and it does not agree with itself:

| Source | Claim |
|---|---|
| **Apollo's own API reference** (`docs.apollo.io/reference/people-api-search`) | People API Search (`api/v1/mixed_people/search`) **costs 0 credits**; reachable with an API key or master key; requires an account registered with a **work email**; **free-account access is available** though *"additional account eligibility requirements may apply"*; on the free tier **`last_name` values may be obfuscated** |
| **Independent pricing analyses** (several, 2026) | *"free and basic users have no API access"*; the free plan *"does not provide API access, advanced filters, enrichment, sequences, or anything automated"*; the free plan grants **100 credits total, not monthly** |

These cannot both be true. One says the discovery endpoint is free-account reachable at zero credit cost; the other says the free plan has no API at all. **I am not resolving that by preference.** §3 is explicit — *"Do not convert documentation claims into 'verified' unless the account/API test actually establishes them"* — and §11 is explicit that a billable or paid-plan-gated discovery operation is a STOP condition. Picking the favourable reading would manufacture exactly the claim this gate exists to test.

**Resolution requires one real free-account key and one call.** That is a five-minute empirical question, and it is the owner's to unblock.

Two consequences are worth stating even though both are UNVERIFIED, because they shape the decision:

- **If API access is genuinely absent on the free plan**, then "obtain a free Apollo account" does not unblock anything, and B4-A terminates until a paid plan is authorised — which the owner decision explicitly withheld.
- **If it is present but obfuscates `last_name` and withholds email**, the capability exists but produces an *uncontactable* prospect. See §10 and §27.

---

## 5–6. Discovery operation and response — NOT RUN

The operation that *would* have been tested is `POST https://api.apollo.io/api/v1/mixed_people/search`, because it is the only Apollo operation that satisfies §4: it accepts search filters and returns person candidates **without requiring an already-known Omnivyra prospect as input**.

No request was issued. No response was characterized. **There is no fixture in this report pretending otherwise** — a recorded "expected response shape" would be a fabrication of exactly the kind `apollo.ts`'s own header warns about: *"writing an adapter against a response shape nobody here has ever received would produce normalization code that compiles, passes its own fixtures, and is wrong — and the first evidence of that would be fabricated attributes on real people."*

Searching the repository for `mixed_people`, `people/search`, `people_search` returns **nothing**. No discovery code exists to inspect.

---

## 7. Enrichment vs discovery — VERIFIED as genuinely different

The existing B2 adapter is enrichment, and the distinction is not cosmetic:

| | B2 enrichment (exists) | Discovery (does not) |
|---|---|---|
| Endpoint | `GET /api/v1/organizations/enrich` | `POST /api/v1/mixed_people/search` |
| Input | a canonical **domain the caller already has** | search **filters** |
| Subject | an existing `prospect_accounts` row | **none — that is the point** |
| Claims | `employee_count`, one attribute | person + account candidates |
| Cost | Apollo bills **1 credit**, and *"its documentation does not state that a miss is refunded, so a `no_match` must be assumed billable"* | documented as 0 credits — **UNVERIFIED** |
| Origination | cannot originate a prospect | must originate one |

`apollo.ts` is deliberately narrow — `supports: ['employee_count']`, and `country`, `founded_year` and `technology_names` are each left unmapped with a stated reason. **It was not touched, and it is not a discovery adapter in disguise.** Its `domainFor()` refuses name, LinkedIn URL and website because *"each is a different match semantic, and 'the account whose name looked closest' is exactly the identity W4 refuses to make."*

---

## 8–9. Adapter and canonical path — the second architectural blocker

### `LeadSourceAdapter` cannot fetch, by contract

`leadIngestion/contracts.ts:170-176` states it as a contract, not a convention:

> **PURE BY CONTRACT:** `translate` receives a provider record and returns data. It performs no I/O of its own — **fetching from a provider is a separate concern** that must pass through the existing cost governor and SSRF seam, **and is not part of this contract**.

The interface is `{ source, label, capabilities, translate(raw, organizationId) }` — and `source` is documented as *"Stable provider key, e.g. `'apollo'`"*, so the contract anticipated this provider. The **translate half of Apollo discovery is genuinely cheap**, and `source_records.provider` is free text *"on purpose: a new provider must never need a migration."*

### But nothing fetches

Every caller of `ingestLeadBatch` is an operator route that receives records **in the request body**: `pages/api/lead-ingestion/{manual,csv,crm}.ts`. There is no scheduled, triggered or queued stage anywhere that calls a provider and feeds the result into ingestion. For manual, CSV and CRM that is correct by design — a human supplies the records. **Apollo discovery has no human supplying records; that is what makes it discovery.**

So §7's mandated path —

```
Apollo adapter → LeadSourceAdapter → orchestrator → resolveUnifiedPerson
  → dedup → account resolution → ingestSourceRecord → assertions → B1b → canonical_leads
```

— is intact from `translate` onward and **has no entry point before it**. Building that entry point means deciding *who triggers a search, with what criteria, how often, under whose cost ceiling, and with what page-size cap*. §18 names this: *"Apollo discovery requires a new unsupported product semantic."* I did not invent it.

---

## 10–12. Identity, deduplication and provenance — structurally ready, with one condition

These are the parts that genuinely work, and the condition on identity is the one the documentation makes material.

**Identity (`identityResolutionService.ts:155-177`).** The deterministic sequence is `email → phone → external_keys`, extracted into one function *"so the create path's conflict recovery re-runs THE SAME order rather than a second copy of it."* For a discovered person:

- email — likely **absent** on a free-tier search (per §4; UNVERIFIED)
- phone — likely absent
- `external_keys` — Apollo's own person `id`, which **is** a deterministic key

**Verified safe:** `findPersonByExternalKeys` returns `null` immediately when the key map is empty (line 128-130), so an identity-less record cannot match an arbitrary person. But it also means that **without an Apollo person id, every replay would mint a new all-null person** — unbounded duplicates. So the condition is precise: **Apollo discovery is replay-safe if and only if the response carries a stable per-person Apollo id, and the adapter maps it into `external_keys`.** Apollo's documented search response does carry `id`. That remains UNVERIFIED here, and it is a hard prerequisite, not a detail.

**Deduplication / idempotency (structurally VERIFIED).** Source identity is `(organization_id, provider, source_entity_type, source_record_id)`, non-partial, with `source_entity_type IN ('person','account')` — so a discovered person is representable and a replay collides on insert rather than duplicating. `person_id` and `account_id` on `source_records` are both nullable *"a source record may arrive before identity is resolved, and parking it unresolved is a supported state."* **No second idempotency layer would be needed** (§9).

**Provenance (structurally ready).** `source_assertions` would hold Apollo's per-field evidence with `value_hash`, provider, and `observed_at`/`recorded_at`. One constraint the adapter would have to respect: Apollo's search payload carries **no per-field observation date**, so `observed_at` must be preserved as **null** and B1b's ratified `COALESCE(observed_at, recorded_at)` does the rest. Substituting fetch time would be the fabrication the standing instruction forbids.

---

## 13. B1b — frozen, untouched, and correctly indifferent

`ingestionBoundary.ts` is `4c3237a8fbcb9585` and `attributeAuthority.ts` is `a6d3c35cf36ac3ad` — both unchanged, verified by content hash.

**No B1b change would have been needed.** Apollo would be one more evidence source: no provider-name precedence, no Apollo-specific authority, no modification to the ratified recency/confidence/attestation rules. `attributeAuthority` still returns an empty declaration for every tenant (O-1 and O-7 ratified as deferred), so **a discovered Apollo value would compete on timestamp and attestation like any other** and would not be authoritative merely because it is Apollo. That is the correct outcome and it required no work.

---

## 14–15. Tenant and credential isolation

**Credential isolation — VERIFIED STRUCTURALLY** (the vocabulary §5 asked me to keep separate from LIVE VERIFIED). By inspection of `credentials.ts`: the lookup is `read(tenant, provider)` with a tenant-less or provider-less lookup refused **before** it reaches the store *"so an empty string can never widen a WHERE clause into a scan"*; a store failure returns `null` because *"a store failure is NOT a reason to look elsewhere"*; and there is no code path from a missing tenant credential to any other tenant's credential or to the environment. Tenant A therefore cannot resolve Tenant B's key. Existing tests already pin the environment-fallback prohibition.

**Nothing was LIVE VERIFIED**, because a live credential-isolation test requires at least one real credential, and there are none.

**Tenant isolation for discovery — NOT RUN.** The existing guarantees are unchanged and were verified by earlier gates: composite tenant FKs on `source_records`, `source_assertions`, `canonical_attribute_decisions`, and — since G-6 — `prospect_enrichment_attempts`.

---

## 17. Attempt / lease composition — **the primary architectural blocker**

§12 anticipated this exactly: *"If the existing attempt model is enrichment-specific and cannot safely represent discovery, STOP and characterize the exact gap instead of forcing it."* **It is, it cannot, and here is the gap.**

**At the schema level** — `20261015000000_pi_enrichment_attempt_record.sql`:

```sql
  person_id   uuid REFERENCES public.unified_persons(id)   ON DELETE CASCADE,
  account_id  uuid REFERENCES public.prospect_accounts(id) ON DELETE CASCADE,

  -- Exactly one subject. A row about neither, or about both, is meaningless.
  CONSTRAINT prospect_enrichment_attempts_one_subject CHECK (
    (person_id IS NOT NULL AND account_id IS NULL)
 OR (person_id IS NULL     AND account_id IS NOT NULL)
  ),
```

**A discovery attempt has neither subject, so the CHECK refuses the row.** The comment is not an accident — for enrichment, a subject-less attempt genuinely *is* meaningless. For discovery it is the normal case.

**At the contract level** — `providers/contract.ts:59-64`:

```ts
export interface EnrichmentRequest {
  readonly organizationId: string;
  readonly subject: EnrichmentSubject;
  /** Canonical entity id — `unified_persons.id` or `prospect_accounts.id`. */
  readonly entityId: string;
  readonly attributes: readonly string[];
```

Both `subject` and `entityId` are required and `entityId` is documented as a canonical id. There is no discovery-shaped request.

**And there is no alternative ledger.** A repository-wide search for `prospect_discovery_attempts`, `discovery_attempts` and `search_attempts` returns nothing; the four migrations matching `discovery` belong to unrelated features (community discovery opportunities, billing catalog, curated industry sources, creator assets).

**What this costs.** Everything the owner would want for a paid external call is bound to that subject key and therefore unavailable to discovery:

| Facility | Where it lives | Keyed by |
|---|---|---|
| paid-call ledger (`provider_called`) | `prospect_enrichment_attempts` | subject |
| live lease / one-active-execution | partial unique index, **one per entity leg** | subject |
| retry horizon (`next_retry_at`) | same table | subject |
| attribute-set identity | `pi_canonical_attribute_set(requested_attributes)` | attribute set — **a discovery search has no attribute set** |
| G-6 tenant FKs | composite `(entity, organization_id)` | subject |

`requested_attributes` is additionally constrained to its canonical form; a discovery search requests *filters*, not canonical attributes, so even that column means something different.

**I did not force it.** Widening the CHECK, nulling the subject or smuggling a sentinel entity id would each take a G-6-hardened table and weaken the invariant G-6 was built to establish — and §16's own probe list treats "provider success without valid tenant attribution" as a mutation that **must fail**. The right move is a ratified decision, which is §27.

---

## 18. Cost / billing — UNVERIFIED, and deliberately not declared

Apollo's reference documents People API Search at **0 credits**; independent analyses say the free plan has no API at all and grants 100 credits total. **I did not declare discovery zero-cost.** §11 forbids *"fabricated zero-cost declaration if Apollo reports a billable operation"*, and the honest position is that **nobody here has seen Apollo's own response to a discovery call**, which is the only thing that settles it.

Noted for whoever implements it: `apollo.ts` already takes the conservative line for enrichment — *"Apollo's documentation does NOT say a credit is refunded on a miss, so a `no_match` must be assumed billable"* — and a discovery adapter should inherit that posture rather than trusting a published 0.

No paid credits were consumed, because no call was made.

---

## 19–21. T1, T2, mutation probes — NOT RUN

No implementation, therefore nothing to test and nothing to mutate. **Writing tests for an adapter the gate forbids inventing would be worse than writing none**: it would make a fabricated capability look certified.

The existing suites were left exactly as B3/G-6 recorded them and **could not have changed, because this gate changed no file**. Mutation probes are vacuous here by definition — a probe requires a byte to change, and no byte did.

## 22. Production validation — NOT PERFORMED

Not authorized by the execution scope, and its prerequisite — a proven non-production tenant-scoped path — is unmet. No production credential was read, no production tenant was named, no Apollo record was requested, no Omnivyra prospect was created, and no Apollo credits were consumed.

## 23–24. Files changed and migrations — none

Verified by content hash, not by `git status`:

```
4c3237a8fbcb9585  prospectIdentity/ingestionBoundary.ts        ← frozen B1b, confirmed
a6d3c35cf36ac3ad  prospectIdentity/attributeAuthority.ts       ← frozen B1b, confirmed
5b3da65e617b7590  enrichment/providers/adapters/apollo.ts      ← B2 enrichment, untouched
60cdf48467b3a185  leadIngestion/orchestrator.ts
d69499ce30761fc1  leadIngestion/contracts.ts
63ae5877e726a633  leadIngestion/registry.ts
```

No migration added, altered or removed. Census **439**. No formatting-only change, no opportunistic cleanup, no unrelated fix.

## 25. Production safety

No database of any kind was contacted — not production, and not the isolated PostgreSQL from earlier gates, which stayed stopped. No credential was read. **No Apollo API call was made.** No deploy, no Vercel, no Railway, no migration applied, no feature flag touched, Docker never started, nothing committed.

**Disclosed explicitly:** this gate read **public Apollo documentation and public pricing analyses over the web**. That involved no credential, no Apollo API endpoint and no tenant data, and every claim drawn from it is labelled **DOCUMENTED / UNVERIFIED** in §4 and §18 rather than VERIFIED.

## 26. Remaining gaps

| # | Gap | Exact blocker | What would unblock it |
|---|---|---|---|
| **B4A-1** | No Apollo credential exists in reach | Zero `APOLLO` occurrences across all ten env files; the only store is per-tenant `integration_credentials`; production is out of scope | One free-account key for ONE tenant, stored through `PUT /api/prospect-sources/credentials` — **not** an env var |
| **B4A-2** | Free-plan API access is genuinely unclear | Apollo's own reference and independent pricing analyses **contradict each other** | One authenticated call with that key. Empirical, not analytical |
| **B4A-3** | The attempt ledger cannot represent a discovery call | `prospect_enrichment_attempts_one_subject` requires exactly one subject; `EnrichmentRequest` requires `entityId`; no discovery ledger exists | A **ratified** decision: nullable subject with a discovery-shaped CHECK, or a sibling ledger. A schema change to a G-6-hardened table |
| **B4A-4** | No fetch-then-ingest stage exists | `LeadSourceAdapter` is pure by contract; all three live routes take records from an operator's request body | A product decision on who triggers a search, with what criteria, cadence, page cap and cost ceiling |

**B4A-3 and B4A-4 are not unblocked by any credential.** They would still be open on the day the key arrives.

**Unrelated observation — recorded, not fixed** (per the standing instruction): `findPersonByExternalKeys` uses `.order('created_at').limit(1).maybeSingle()`, an oldest-wins tiebreak inside W1's resolver. It is pre-existing, it is deterministic rather than arbitrary, and it is outside this gate. **Not touched.** G-1, G-2, G-4, G-5, B3's `converted` mapping and B3's person→prospect ambiguity all stand exactly as recorded.

## 27. Exact next owner decisions

1. **Supply ONE tenant's free-account Apollo key** through the A3P route (`PUT /api/prospect-sources/credentials`), on a non-production tenant. This settles B4A-1 and B4A-2 together and costs one call. **Until it exists, nothing else in B4-A can be certified** — and if the free plan truly has no API, B4-A terminates here rather than proceeding to a paid plan, which you explicitly withheld.
2. **Ratify how a discovery attempt is recorded** (B4A-3). Two options, and this is a schema decision on a table G-6 hardened, so it needs your ratification rather than my judgement:
   - **(a)** make `person_id`/`account_id` nullable and replace the CHECK with one admitting a third, subject-less *discovery* shape — smallest diff, but it weakens an invariant that currently says a subject-less attempt is meaningless;
   - **(b)** a sibling discovery-attempt ledger with its own identity and its own composite tenant FKs — no existing invariant weakened, one more table.
   My read: **(b)** is the safer of the two, because a discovery attempt's identity is a *search*, not an entity, and `requested_attributes`/`pi_canonical_attribute_set` genuinely do not apply to it — (a) would leave two unrelated meanings in one table.
3. **Decide the discovery trigger** (B4A-4): who initiates a search, on what criteria, how often, with what page-size cap, and under which cost ceiling. The adapter is cheap; **this is the actual design.**
4. **Decide whether an uncontactable person is a prospect.** If free-tier search obfuscates `last_name` and withholds email, discovery yields a person identified only by an Apollo key — ingestible and replay-safe, but **not contactable**, and with no decided policy for merging the real email in later. This is a product definition, and it is the one semantic question the architecture cannot answer for you.

---

# B4-A BLOCKED

The tenant-ownership architecture the decision demanded **already exists and is already correct** — A3M's port and A3P's route, with no environment fallback and a test enforcing it. B1b needs no change, identity and deduplication are structurally ready, and `translate` is cheap.

**What stops B4-A is not Apollo. It is that discovery has no subject and no trigger**, and PI's governed execution spine is keyed to a subject while its ingestion spine waits for an operator to hand it records. Add the missing credential and both of those remain open.

No adapter was invented. No fixture was fabricated. No zero-cost claim was declared. No credential was substituted. No file was changed.

**STOP.** No B10. No second provider. No scoring feedback. No inbound email. No deploy. No migration applied. Production untouched.
