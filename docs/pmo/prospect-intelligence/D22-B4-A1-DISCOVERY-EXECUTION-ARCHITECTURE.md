# D22-B4-A1 — DISCOVERY EXECUTION ARCHITECTURE

# B4-A1 VERIFIED

**The two architectural gaps D22-B4-A found are closed, and no provider was contacted.** Discovery now has a ledger whose subject is the SEARCH, and a governed fetch→ingest seam that feeds the existing canonical spine. The provider stage exists and is tested; **nothing in production calls it**, which is this gate's requirement rather than an omission.

| | |
|---|---|
| **Date** | 2026-10-06 |
| **Files created** | 9. **Existing files modified: NONE.** |
| **Migration** | `20261121000000_pi_prospect_discovery_attempts.sql` — the **21st unapplied**. Census 439 → **440**. |
| **Apollo API calls** | **ZERO.** No Apollo adapter exists; the discovery registry ships empty; `safeFetch` was a tripwire and never fired. |
| **T1** | **65/65** new · 218/218 across the six adjacent frozen suites |
| **T2 (real schema)** | **32/32** new · **114/114** across six PI suites |
| **Mutation probes** | **10/10 KILLED**, every file restored byte-identically |
| **Route-auth gate** | **PASS** — 1351/1351, no allowlist entry needed |
| **Typecheck** | **3/3 projects clean** (`npm run typecheck`, exit 0) |
| **`ingestionBoundary.ts`** | `4c3237a8fbcb9585` — unchanged. 10/10 frozen files, **zero drift** |
| **Production** | untouched. No prod DB, no prod credential, no provider call, no deploy, no flag, no migration applied. |

> **What was missing was a layer, and only a layer.** Identity resolution, deduplication, provenance, B1b arbitration and the canonical write all already existed and are reached here by calling the one orchestrator every other source calls. B4-A1 adds the governed stage in front of them: credential → cost → claim → **provider I/O** → pure translation → existing ingestion. It owns nothing else, and a test asserts it writes no canonical table and imports no HTTP client.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Owner decisions | recorded, all six implemented |
| 2 | Existing enrichment execution anatomy | **VERIFIED** |
| 3 | Existing ingestion anatomy | **VERIFIED** |
| 4 | Discovery execution model | **IMPLEMENTED** |
| 5 | Discovery-attempt schema | **IMPLEMENTED + VERIFIED** (real schema) |
| 6 | Discovery state machine | **IMPLEMENTED + VERIFIED** |
| 7 | Search identity / idempotency | **IMPLEMENTED + VERIFIED** |
| 8 | Tenant isolation | **VERIFIED** (DB-enforced, 5 negative cases) |
| 9 | Credential resolution | **VERIFIED** — reused unchanged, no fallback |
| 10 | Cost-governance integration | **IMPLEMENTED**; cost itself **UNVERIFIED by design** |
| 11 | Lease / concurrency | **IMPLEMENTED + VERIFIED** |
| 12 | Fetch → ingest seam | **IMPLEMENTED + VERIFIED** (synthetic provider) |
| 13 | Network / SSRF governance | **DEFERRED to the adapter**, asserted structurally |
| 14 | Pagination / continuation | **IMPLEMENTED + VERIFIED** |
| 15 | Result ingestion | **VERIFIED** — one call to the existing orchestrator |
| 16 | Uncontactable prospect policy | **IMPLEMENTED** (by changing nothing — see §16) |
| 17 | B1b preservation | **VERIFIED** — untouched, and needed no change |
| 18 | T1 | **65/65 PASS** |
| 19 | T2 | **32/32 PASS** (114/114 across six suites) |
| 20 | Mutation probes | **10/10 KILLED** |
| 21 | Migration | **IMPLEMENTED**, isolated runtime only |
| 22 | Files changed + hashes | **VERIFIED** |
| 23 | Production safety | **VERIFIED** |
| 24 | Remaining gaps | 5, listed |
| 25 | Exact next gate | the Apollo capability test, unchanged |

**Apollo capability remains UNVERIFIED.** Synthetic execution proves orchestration. It is not evidence about any vendor, and this report does not treat it as such.

---

## 1. Owner decisions, as implemented

| | Decision | How it landed |
|---|---|---|
| **D-1** | Apollo Discovery selected; tenant-owned; no global, platform, environment or Drishiq credential | The existing A3M port is reused unchanged. It refuses `process.env` by construction, and two mutation probes prove both the tenant scoping and the absence of an environment fallback are load-bearing. |
| **D-2** | A SIBLING ledger; do not widen `prospect_enrichment_attempts` or its one-subject invariant | `prospect_discovery_attempts` is a new table. T2 asserts the enrichment CHECK is byte-for-byte as it was and that the enrichment ledger gained no discovery column. No NULL sentinel, no fake entity id. |
| **D-3** | USER-INITIATED trigger; no scheduler | One authenticated POST route. No cron entry, no queue, no worker, no ICP or MarketPulse trigger. |
| **D-4** | Bounded: pages, results, cost ceiling | Three REQUIRED bounds, enforced by CHECK constraints as well as in the loop. |
| **D-5** | Uncontactable people ARE prospects | Implemented by changing NOTHING — see §16. |
| **D-6** | Apollo person id is source identity, not universal identity | Nothing in this layer touches identity resolution; the `email → phone → external_keys` order is untouched. |

---

## 2. Existing enrichment execution anatomy — what is reusable, and what is not

Traced through the code, not inferred from tests:

```
executePlannedField (execution.ts)
  → executeEnrichmentRecorded (recordedExecution.ts)       attempt + lease
    → claimEnrichmentWork (attempts.ts)                    INSERT arbitrated by a partial unique index
    → resolveCredential (providers/credentials.ts)         A3M, tenant-only
    → authorizeCost (providers/cost.ts)                    tenant-funded, cost.kind = 'unknown'
    → markProviderCallPending (A4V)                        the pre-transport marker
    → adapter.enrich (providers/adapters/*)                the ONE safeFetch
    → persistObservation (providers/persistence.ts)        LI-2 evidence
    → B1b arbitration
```

| Component | Reusable by discovery? | Why |
|---|---|---|
| `credentials.ts` (A3M) | **YES, unchanged** | "Does this tenant have a credential for this provider?" is the identical question. Reused as-is; not modified. |
| `cost.ts` tenant-funded port | **YES, unchanged** | Already reports `cost: { kind: 'unknown' }`, which is exactly the honest value here. |
| `safeDetail` redactor | **YES, imported** | One redactor, not two. T2 proves a credential-shaped detail is redacted before it reaches the row. |
| `PROVIDER_CALL_STATES` (A4Q) | **YES, imported** | Transport has the same three answers. Two spellings would drift on the only question that stops double billing. |
| The A4N claim-by-INSERT pattern | **YES, as a pattern** | Nothing enqueues a search before the attempt, so the claim must BE the insert and the arbiter must be an index. |
| The A4V pre-transport marker | **YES, as a pattern** | The failure it prevents is the expensive one. |
| **`prospect_enrichment_attempts`** | **NO** | `…_one_subject` requires exactly one of `person_id`/`account_id`. Discovery has neither, by definition. |
| **`EnrichmentRequest`** | **NO** | Requires `subject` and a canonical `entityId`. |
| **`requested_attributes` / `pi_canonical_attribute_set`** | **NO** | A search has filters, not canonical PI attributes. The wrong canonicaliser entirely. |
| `persistObservation` | **NO** | Enrichment writes an attribute observation about a known entity. Discovery produces whole records, which is what the ingestion spine is for. |

## 3. Existing ingestion anatomy — reused whole, duplicated nowhere

```
ingestLeadBatch (leadIngestion/orchestrator.ts:530)
  ├─ resolveLeadIngestionGate            tenant gate, ONCE per batch, fails closed
  ├─ getLeadSourceAdapter                unsupported source fails the batch before any write
  └─ per record:
       adapter.translate (PURE)
       → resolveUnifiedPerson            email → phone → external_keys
       → duplicate detection
       → account resolution
       → ingestSourceRecord              LI-2, the single canonical writer
       → source_assertions
       → B1b arbitration
       → canonical_leads
```

Discovery enters at the top of this and adds nothing to it. The orchestrator's own tenant rule still applies: a translated record naming a different tenant is refused rather than written, and B4-A1 passes the VERIFIED tenant so that check can never be the thing that fails.

---

## 4–5. The discovery execution model and its schema

`prospect_discovery_attempts` — one tenant, one provider, one search, one bounded execution. Its subject is the search.

| Group | Columns |
|---|---|
| identity | `id`, `organization_id` → `companies(id)`, `provider_key` |
| the search | `search_criteria` (canonical jsonb), `search_digest` (sha256 hex), `attempt_number`, `correlation_id` |
| bounds (D-4) | `max_pages`, `max_results`, `max_provider_calls` |
| state | `execution_status`, `provider_call_state`, `outcome` |
| lease | `claimed_by`, `claimed_until` |
| pagination | `pages_fetched`, `continuation_state` (opaque) |
| results | `results_observed`, `results_ingested`, `provider_calls_made` |
| provider evidence | `provider_request_id`, `provider_cost_state`, `provider_cost_units`, `detail`, `executor_version` |
| time | `created_at`, `started_at`, `completed_at`, `last_failure_at`, `recovered_at`, `next_retry_at` |

**Three decisions worth stating, because each rejects an easier option:**

- **No FK to `source_records`.** One execution produces many records, so a single FK cannot hold the result. The ledger keeps counts; the source records carry their own provenance. That keeps `source_records` the single authority on what was ingested.
- **The cost ceiling is denominated in PROVIDER CALLS, not credits.** D22-B4-A left the provider's billing behaviour unverified — its own reference documents People Search at 0 credits while independent analyses say the free plan has no API at all. A credit ceiling would need a number nobody has observed; **inventing one is the fabricated zero-cost declaration the gate forbids.** A call count bounds spend under every reading of the pricing.
- **`continuation_state` models no cursor, token or offset.** Assuming any one of them would bake one vendor's pagination into the generic ledger.

### The bounds are enforced by the DATABASE

Not by application courtesy. `pages_fetched <= max_pages`, `results_observed <= max_results`, `provider_calls_made <= max_provider_calls`, `results_ingested <= results_observed`, all CHECKs. T2 proves each refuses with `23514`. An application-only bound is one forgetful caller away from being no bound.

And the invariant that makes **"did we pay for this?"** answerable from the row alone:

```sql
CONSTRAINT prospect_discovery_attempts_results_need_transport CHECK (
  (results_observed = 0 AND provider_calls_made = 0 AND provider_request_id IS NULL)
  OR provider_call_state IN ('called', 'unknown'))
```

Results, a call count or a provider request id cannot exist while the row claims nothing was contacted. `unknown` is admitted because a call that died mid-flight may genuinely have been billed.

## 6. The state machine

```
pending ──claim──► claimed ──mark (A4V)──► provider_running
   │                  │                        │
   │                  │                        ├─► completed   (provider answered)
   │                  │                        └─► failed      (ours, or transport)
   ├─► refused_pre_call  (credential / provider / cost / bounds — nothing contacted)
   └─► cancelled         (operator)
       abandoned         registered, never written
```

**Three dimensions, never collapsed:** `execution_status` (how OUR execution stands) · `provider_call_state` (whether transport happened — the A4Q three-valued truth) · `outcome` (what the PROVIDER said, or the refusal WE made).

Two deliberate deviations from the brief's suggested list, each with its reason:

- **No `ambiguous`.** "We cannot prove what the provider did" is already expressible, and more precisely, as a CLOSED execution whose `provider_call_state` is `unknown`. A fourth name would be a second representation of one fact, and the two would drift.
- **`refused_pre_call` added.** A4T established on the enrichment ledger that "WE declined before transport" and "it failed" have **opposite retry safety**, and nothing in the other two columns separates them. Adopting that distinction is taking a lesson that was already paid for.

`CHECK ((status IN open three) = (completed_at IS NULL))` keeps the status column and the live index from ever disagreeing. T2 proves it refuses in **both** directions.

## 7. Search identity and idempotency — three different mechanisms, deliberately separate

A caller who cannot tell these apart cannot tell "my retry was absorbed" from "someone else is already running this", and only one of those means the search will happen.

| Question | Mechanism |
|---|---|
| **Is this the same REQUEST I already sent?** | the caller's `Idempotency-Key`, via the EXISTING `withIdempotency` middleware (`api_idempotency_keys`). Mandatory — the middleware's own contract. Nothing invented, no table added. |
| **Is this search already running?** | `UNIQUE (organization_id, provider_key, search_digest) WHERE completed_at IS NULL`. The database refuses the second with `23505`. |
| **May I run this search AGAIN later?** | **Yes.** The index is PARTIAL, so a closed execution leaves it immediately and the next run is `attempt_number` N+1. |

A permanent unique constraint over the search would have collapsed the last two and locked a tenant out of ever repeating a search. T2 proves all three.

**Canonicalisation comes first, because a digest of unsorted JSON is a hash of the caller's typing habits.** Object keys sorted by UTF-8 bytes; scalar arrays sorted and de-duplicated (a set of permitted values has no order, and the canonical order is what the adapter issues, so request and digest cannot disagree); **arrays of objects keep their order**, because reordering a structured filter would change the search rather than normalise it; null and empty-after-trim dropped, so an absent filter and a null filter are one search; non-finite numbers refused rather than coerced; depth, key-count and size limits **refuse rather than truncate**, because a truncated search would execute against criteria nobody asked for.

**An empty search is refused.** A search with no criteria is a request for "everything" — unbounded by intent even where a page ceiling bounds it by accident.

**The BOUNDS are part of identity**, because they change the provider request: the same filters over 1 page and over 10 pages are two executions with two costs, and treating them as one would let the live index block the larger because the smaller is running. **The tenant is deliberately NOT in the digest** — it is a column and it leads every index, and keeping it out means one search has one identity across tenants, which is what makes the cross-tenant isolation test meaningful.

## 8. Tenant isolation — DB-enforced, five negative cases

`organization_id NOT NULL` → `companies(id)`, leading every index. No other tenant-owned entity is referenced, so there is **no composite FK to get wrong** — the G-6 class of defect is absent by construction rather than by care.

Proven against the real schema:

| Case | Result |
|---|---|
| unknown tenant | refused `23503` |
| two tenants, the SAME search, concurrently | **both permitted** — isolation is the `organization_id` leg, not the digest |
| tenant A reads tenant B's execution by id | `null` — indistinguishable from "does not exist" |
| tenant A closes tenant B's execution | nothing written; row still `pending` |
| tenant A advances tenant B's counters | nothing written; counters still 0 |
| tenant A steals tenant B's expired lease | `null`; `claimed_by` still B's |

Drishiq Labs receives no special handling: there is no tenant-specific branch anywhere in the layer.

## 9. Credential resolution — reused, unchanged, and still fails closed

The A3M port is used as-is. **`credentials.ts` was not modified** (hash `6e2559e6ca6f2b43`, and the probe harness asserts byte-identical restore after the two probes that temporarily mutated it).

The lookup stays `(organization_id, provider)` and returns `null` for both absence and non-entitlement. A missing credential produces a truthful recorded state — `refused_pre_call` / `credential_missing` / `not_called` — which in this gate is the **expected** outcome. The credential value is never returned, logged or persisted: a T1 test asserts a secret-shaped value appears in neither the result nor the row.

## 10. Cost governance — and why the cost stays UNKNOWN

`tenantFundedExecutionPort.authorizeCost` is called **before egress**, and a denial closes the execution `refused_pre_call` / `cost_denied` with the provider never contacted. That port already reports `cost: { kind: 'unknown' }`, which is the honest value.

`provider_cost_state` defaults to `'unknown'` and only moves when a provider actually states something. **Nothing hard-codes Apollo as free or as 0 credits**, and `provider_cost_units` cannot be set while the state is `unknown` (CHECK). One T1 test asserts silence stays `unknown` rather than being optimised into `free`; another asserts a later page **cannot downgrade** a stated `billed` back to `unknown` — a defect I found and fixed while building, because it would have erased the only evidence that an execution cost the tenant money.

## 11. Lease and concurrency

The claim is the INSERT, arbitrated by the partial unique index. No read-then-write check guards it, because a check cannot close the window between the read and the write, and that window costs a double bill. A lost race is recognised by `23505` and turned into a truthful refusal naming the holder.

**An expired lease is stolen IN PLACE**, not closed-and-reopened — a conditional `UPDATE` whose WHERE re-checks expiry, so of two racing reclaimers exactly one gets a row back. The reason is specific to discovery: the row carries `continuation_state`, and opening a fresh row would strand it and restart from page one, **paying the provider again for pages already fetched**. T2 proves the continuation and the spend survive a reclaim, that an unexpired lease is not reclaimable, and that closing releases the lease so history cannot look in-flight.

## 12–13. The fetch → ingest seam, and where egress lives

Two interfaces, and the split IS the architecture:

```ts
discover(request, credential) -> DiscoveryPage      // I/O, governed      (new)
translate(raw, organizationId) -> AdapterResult     // PURE, unchanged    (existing)
```

`LeadSourceAdapter.translate` was **not touched**. Its own header says why: *"fetching from a provider is a separate concern that must pass through the existing cost governor and SSRF seam, and is not part of this contract."* Adding network I/O there would put un-governed egress inside the translation step that every source runs, including file uploads.

**The executor performs no egress at all.** Tests assert it imports no `safeFetch`, no `fetch`, no axios and no `http.request`, writes no table of its own, and names no canonical table. All egress belongs to a `DiscoveryProviderAdapter`, which must use `safeFetch` with an explicit host allowlist.

**§13 is DEFERRED to the adapter, honestly labelled.** No real adapter exists, so no actual egress was governed in this gate — what is verified is that the executor cannot perform any, and that the registry ships empty so no un-reviewed adapter is reachable. In T2, `safeFetch` is a tripwire and its call count is asserted to be **zero**.

## 14. Pagination

Bounded, resumable, provider-neutral. The loop checks all three ceilings before every call; the adapter is told `remaining` so it can size its own request; a page larger than the remaining budget is consumed only up to it. The run stops on provider exhaustion (`continuation === null`), any ceiling, a transport failure, or a marker failure.

## 15. Result ingestion

**One call per page to `ingestLeadBatch`**, with the VERIFIED tenant and `source = provider_key`. Records are passed **verbatim** (a T1 test asserts a nested raw record arrives unchanged) — LI-2 redacts and hashes, so pre-stripping here would destroy evidence.

No `ApolloProspect`, `ApolloLead` or `ApolloPerson` model exists. No direct canonical write exists; a mutation probe that adds one is killed.

## 16. The uncontactable prospect policy — implemented by changing nothing

D-5 required that a discovered person with a stable provider id may become a canonical prospect even with no email or phone. **That is already true, and the correct implementation was to add nothing.**

`resolveUnifiedPerson` resolves `email → phone → external_keys` and creates a person when none matches; `unified_persons.primary_email` is nullable; `canonical_leads` requires no address. Contactability is not part of canonical identity, and B4-A1 did not make it one. Common Outreach, suppression and `mayContact` are untouched — **prospect existence ≠ outreach eligibility**, and those remain different questions answered by different code.

**The one real prerequisite, stated as a condition rather than a feature:** `findPersonByExternalKeys` returns null on an empty key map, so a record with no email, no phone and **no stable provider id** would mint a new all-null person on every replay — unbounded duplicates. A discovery adapter must therefore map a stable provider person id into `external_keys`, or replay is not safe. Nothing here pretends otherwise.

## 17. B1b preservation

`ingestionBoundary.ts` = `4c3237a8fbcb9585` and `attributeAuthority.ts` = `a6d3c35cf36ac3ad`, both verified by content hash. **No change was needed.** Discovery feeds ordinary source evidence in: no provider-name authority, no source-priority insertion, no new arbitration weight, no timestamp reinterpretation, no TTL, no confidence normalisation outside B1b. A test asserts the layer never names `ownedDbTable('prospect_enrichment_attempts')` either.

## 18. T1 — 65/65 PASS

Covering: canonicalisation and digest stability (11) · vocabularies, including that the transport truth is the enrichment ledger's own (4) · the empty registry and its refusals (4) · refusal ORDER, including that a malformed search and a disabled tenant write **nothing** (8) · duplicate execution, replay, cross-tenant non-interference and lease reclaim (5) · the credential port's tenant scoping and absence of environment fallback (2) · the fetch→ingest seam, verbatim records, marker ordering, transport-failure classification, cancellation (10) · the three bounds and cost governance (5) · cost evidence never fabricated (2) · no canonical write and no egress (7) · the route's guards, ordering and inability to reach the provider stage (6).

**Adjacent frozen suites: 218/218** — the LI-2 single-writer scan, B1b arbitration, the B2 Apollo slice, the B3 producer, the Apollo adapter and the A3M credential suite.

## 19. T2 — 32/32 PASS, 114/114 across six suites

Real PostgreSQL 17.6, isolated, in the session scratchpad. Covering: the table's shape and the **absence** of `person_id`/`account_id`/`requested_attributes` · G-6's enrichment invariant unchanged · both indexes, with the live one proven PARTIAL · ten CHECK refusals (`23514`/`23503`) · five tenant-isolation negatives · the real `23505` claim race and its truthful refusal · attempt-number identity in history · reclaim preserving the continuation · detail redaction · and the executor end-to-end against the real ledger with a synthetic provider.

Pre-existing suites unchanged: b1b_arbitration, b2_apollo_slice, b2_g3, b2_g6, b3_outcome_lifecycle — **82 + 32 = 114, all passing.**

## 20. Mutation probes — 10/10 KILLED

Each changed real behaviour, made a suite fail, was restored in `finally`, and the file was re-hashed to prove byte-identical restoration.

| # | Mutation | Verdict |
|---|---|---|
| 1 | the tenant predicate is dropped from the execution read | **KILLED** (T2) |
| 2 | the credential lookup ignores the tenant it was asked about | **KILLED** (T1) |
| 3 | a missing tenant credential falls back to `process.env.APOLLO_API_KEY` | **KILLED** (T1) |
| 4 | a lost claim race is no longer recognised as one | **KILLED** (T2) |
| 5 | an empty (unbounded) search is accepted | **KILLED** (T1, 2 tests) |
| 6 | results are handed to ingestion without a tenant | **KILLED** (T1 **and** T2) |
| 7 | the executor writes `canonical_leads` directly, bypassing the spine | **KILLED** (T1, 2 tests) |
| 8 | a provider run proceeds without a valid discovery execution | **KILLED** (T1) |
| 9 | the page ceiling no longer stops the loop | **KILLED** (T1 **and** T2) |
| 10 | the cost ceiling no longer stops the loop | **KILLED** (T1) |

Probes 2 and 3 temporarily mutated `enrichment/providers/credentials.ts`, which this gate does not otherwise touch, because those two items are *about that file's guarantees* and cannot be probed anywhere else. Its hash was asserted before and after each.

## 21. Migration

`supabase/migrations/20261121000000_pi_prospect_discovery_attempts.sql` (`10cc467128fd7693`). One new table, four indexes, no modification to any existing table, constraint, index or row. **G-6's enrichment invariant is untouched** and T2 proves it. Census 439 → **440**; the **21st unapplied**. Applied ONLY to the isolated PostgreSQL in the session scratchpad, which was started for this gate and stopped afterwards.

## 22. Files changed + hashes

**Created (9). Existing files modified: NONE.**

```
f6d7c298a16b0c22  backend/services/prospectDiscovery/contract.ts
0a49191583df7701  backend/services/prospectDiscovery/discoveryAttemptStore.ts
60f9fcd154b89b10  backend/services/prospectDiscovery/providerRegistry.ts
33cf8099ab79bae4  backend/services/prospectDiscovery/discoveryExecutor.ts
0353b2a9b091eada  backend/services/prospectDiscovery/index.ts
9b0eb88ee527ae37  pages/api/prospect-sources/discovery.ts
10cc467128fd7693  supabase/migrations/20261121000000_pi_prospect_discovery_attempts.sql
d776e680f489eab0  backend/tests/unit/b4a1DiscoveryExecution.test.ts
45ebd02325328f8c  backend/tests/realschema/b4a1_discovery_execution.test.ts
```

**Frozen, verified by content hash — zero drift:**

```
4c3237a8fbcb9585  prospectIdentity/ingestionBoundary.ts          ← B1b, required value
a6d3c35cf36ac3ad  prospectIdentity/attributeAuthority.ts         ← B1b
5b3da65e617b7590  enrichment/providers/adapters/apollo.ts        ← B2 enrichment
af9a772af98adcb2  enrichment/attempts.ts
60cdf48467b3a185  leadIngestion/orchestrator.ts
d69499ce30761fc1  leadIngestion/contracts.ts                     ← translate() still PURE
63ae5877e726a633  leadIngestion/registry.ts
9312a072be91df3b  prospectLifecycle/outcomeLifecycleProducer.ts  ← B3
e8b9d614449121f9  migrations/20261119000000_…decisions.sql
1a426f268fb48d43  migrations/20261120000000_…tenant_fk.sql       ← G-6
6e2559e6ca6f2b43  enrichment/providers/credentials.ts            ← probe-touched, restored
0aa5647ac1912248  enrichment/providers/cost.ts
```

All new files are LF (0 CRLF), matching `.gitattributes`. No opportunistic fix, no cleanup, no unrelated refactor, no formatting-only change. Scoring, lifecycle, Common Outreach, the identity resolver and inbound email were not touched.

## 23. Production safety

No production database was contacted. No production credential was read. **No Apollo call was made, and no network request of any kind** — `safeFetch` was mocked as a tripwire in T2 and its call count asserted zero. No deploy, no Vercel, no Railway, no production migration, no feature-flag change, **Docker never started**. Nothing committed. The isolated PostgreSQL was started for T2 and stopped afterwards.

The gate's own kill switch is inherited rather than bypassed: the route answers 404 `LEAD_INGESTION_DISABLED` when `ENABLE_LEAD_INGESTION` is off, checked before any membership lookup.

## 24. Remaining gaps

| # | Gap | Status |
|---|---|---|
| **B4A1-1** | **Apollo capability is still UNVERIFIED.** No credential, and the published evidence contradicts itself. | the NEXT gate; unchanged from B4-A |
| **B4A1-2** | No discovery provider adapter exists, so the provider stage is unreachable in production. | **intended**; arming it is the next gate's decision |
| **B4A1-3** | An adapter's SSRF discipline is asserted structurally, not exercised | no real adapter exists to exercise |
| **B4A1-4** | No read surface: an operator cannot list or inspect their discovery executions | out of scope (§8 asked for the minimum entry point); needed once runs actually happen |
| **B4A1-5** | No reclaimer runs. An abandoned lease is recoverable but nothing sweeps for one | same position the enrichment ledger is in; `abandoned` stays an unwritten value |

**Two defects I found in my own work and fixed, rather than shipping:** a failed transport never persisted its provider-call count, so a possibly-billed call would have closed the row reporting zero — the exact question the ledger exists to answer; and the bounds-exhausted check read the row's lifetime total instead of this invocation's, so a reclaimed execution would have closed claiming `completed` without contacting anyone. Both are now covered by tests.

**Recorded, not fixed** (per §23): `findPersonByExternalKeys` uses `.order('created_at').limit(1).maybeSingle()`, a pre-existing deterministic oldest-wins tiebreak inside W1. Outside this gate. **Not touched.** G-1, G-2, G-4, G-5, B3's `converted` mapping and B3's person→prospect ambiguity all stand as recorded.

## 25. Exact next gate

Unchanged by this gate, and now genuinely unblocked on the engineering side:

1. supply **ONE tenant's real Apollo FREE-ACCOUNT credential** through the existing A3P route, on a non-production tenant;
2. perform **ONE** empirical Apollo API capability test — the operation is `POST /api/v1/mixed_people/search`;
3. establish whether free-account discovery actually exists, and characterise the real request, response, credits and rate limits;
4. if supported, implement the Apollo `DiscoveryProviderAdapter` (egress via `safeFetch`, host-pinned) **and** its `LeadSourceAdapter` translator, register both, and wire the provider stage.

**Nothing in step 4 requires changing anything B4-A1 built**, which was the point of building it provider-free.

---

# B4-A1 VERIFIED

The missing layer exists: a ledger whose subject is the search, three separated idempotency mechanisms, DB-enforced bounds and tenant isolation, a lease that preserves paid-for progress, and a fetch→ingest seam that feeds the existing canonical spine without duplicating one line of it.

**Enrichment, discovery and ingestion are now three things, not one.** The enrichment ledger keeps its one-subject invariant; `LeadSourceAdapter.translate` keeps its purity; B1b keeps its authority and needed no change.

No Apollo adapter was written. No Apollo call was made. No cost was fabricated. No credential was substituted. No existing file was modified.

**STOP.** No B10. No second provider. No scoring feedback. No inbound email. No scheduler. No deploy. No production migration. Production untouched.
