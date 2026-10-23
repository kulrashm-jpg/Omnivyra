# D22-B4 — APPROVED PROSPECT SOURCE EXPANSION

# B4 OWNER DECISION REQUIRED

**No source was implemented, and none should have been.** Every candidate for a fourth approved prospect source hits a stop condition the brief itself names. Per §3 — *"If no candidate satisfies this: STOP… Do not invent an adapter merely to make B4 pass."*

| | |
|---|---|
| **Date** | 2026-10-06 |
| **Files changed** | **NONE.** This gate was entirely read-only. |
| **Migration** | none. Census unchanged at 439. |
| **`ingestionBoundary.ts`** | `4c3237a8fbcb9585` — unchanged |
| **Production** | untouched. No DB, no credential, no provider call, no deploy, no flag change, Docker never started. |

> **The useful finding is not "blocked" — it is that the cost of unblocking is small.** The ingestion seam is complete and tenant-safe: `adapter.translate → resolveUnifiedPerson → duplicate detection → account resolution → ingestSourceRecord → B1b → canonical prospect`. A new source adapter is **one interface with one method**. What is missing in every case is not engineering — it is an authorised way to obtain the data. That is a decision, not a build.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Source census | **VERIFIED** |
| 2 | Selected source and justification | **BLOCKED** — no candidate qualifies |
| 3 | Existing adapter evidence | **VERIFIED** — three adapters, three routes, nothing more |
| 4 | Actual call graph | **VERIFIED** |
| 5 | Canonical ingestion path | **VERIFIED** (exists; ready for a fourth source) |
| 6 | Identity resolution | **VERIFIED** (exists, unchanged) |
| 7 | Deduplication | **VERIFIED** (exists, unchanged) |
| 8 | Source assertions | **VERIFIED** (exists, unchanged) |
| 9 | B1b arbitration | **VERIFIED** (frozen, untouched) |
| 10 | Provenance | **VERIFIED** (exists, unchanged) |
| 11 | Idempotency | **NOT RUN** — nothing new to make idempotent |
| 12 | Tenant isolation | **NOT RUN** for a new source; existing guarantees unchanged |
| 13 | T1 results | **NOT RUN** — no implementation was authorized |
| 14 | T2 results | **NOT RUN** — same |
| 15 | Mutation probes | **NOT RUN** — same |
| 16 | Files changed + hashes | **VERIFIED** — zero changes |
| 17 | Production safety | **VERIFIED** |
| 18 | Remaining gaps | 4 candidates, each with its exact blocker |
| 19 | Owner decisions required | **4, listed in §19** |

Items 11–15 are **NOT RUN because a stop condition fired**, not because they were skipped. Running them would have required inventing the adapter the brief forbids.

---

## 1. Source census

Built from the repository, not from catalogue rows. "Real caller" means a callable production path that reaches the canonical source boundary.

| Source | Adapter | Registration | Writer | Real caller | Tenant scoped | Status |
|---|---|---|---|---|---|---|
| **Manual** | `adapters/manualAdapter.ts` | `registerBuiltInLeadSources()` | via `ingestSourceRecord` | `pages/api/lead-ingestion/manual.ts` | yes | **IMPLEMENTED** |
| **CSV / Excel** | `adapters/csvAdapter.ts` | same | via `ingestSourceRecord` | `pages/api/lead-ingestion/csv.ts` | yes | **IMPLEMENTED** |
| **CRM** | `adapters/crmAdapter.ts` | same | via `ingestSourceRecord` | `pages/api/lead-ingestion/crm.ts` | yes | **IMPLEMENTED** |
| **Sales Navigator** | none | none | none | none | n/a | **DECLARED ONLY** — `available: false`, requires `oauth` + `provider_terms_review` |
| **MarketPulse** | none (not a prospect source at all) | n/a | n/a | n/a | tenant-scoped, but about the TENANT'S market | **DEFERRED** — would need an invented prospect interpretation |
| **Active Leads / social** | listening connectors exist | registry exists | **writes `lead_signals` only** | listening jobs | yes | **NOT A PROSPECT SOURCE** — no path reaches the canonical boundary; `active_leads` has **zero writers** |
| *(ZoomInfo, Crunchbase)* | none | none | none | none | n/a | **DECLARED ONLY**, api_key required |
| *(Apollo — as a SOURCE)* | enrichment adapter only | registered for enrichment | enrichment only | B2's path | yes | **ENRICHMENT, NOT DISCOVERY** — `supports: ['employee_count']` on an existing account |

**The authoritative declared set.** `dataSourceCatalogue.ts` group `prospect_discovery` contains exactly: `manual`, `csv`, `linkedin_sales_navigator`, `apollo`, `zoominfo`, `crunchbase`. CRM sits in its own group `crm_import`, `available: true`, noted as *"Operator-supplied CRM records. A namespace, not a CRM connection — no provider is contacted."* **MarketPulse and Active Leads are not in the prospect group at all** — which is itself evidence that neither is a declared prospect source.

**Census method.** None of the following was accepted as an implementation: a provider-registry entry, a cost-catalogue row, a type, an interface, an extension label, a flag, or a catalogue row. Each claim above was traced to a callable path or its absence.

---

## 2. Why no candidate qualifies

### Sales Navigator — excluded by §4

`dataSourceCatalogue.ts:98-104`: `available: false`, `requires: ['oauth', 'provider_terms_review']`, note *"Declared only. Existing LinkedIn support covers publishing and engagement, not prospect discovery."* `PI-P1-W02-SOURCE-ADAPTER-SPEC.md:73` records it as *"deferred — legal/terms gate"*.

There is **no authorized connector in the repository**. The only LinkedIn artefact is `scripts/audit-linkedin-listening-feasibility.ts`, which states its own nature plainly: *"one-shot research artifact… Numbers are estimates anchored in public knowledge… They are NOT measurements of production traffic"*, and models `oauth_required` and `partnership_or_review_required` as inputs. A feasibility estimate is not a connector.

§4 is explicit: *"If an authorized connector is not actually available in the repository, Sales Navigator is NOT a valid B4 implementation candidate."* Implementing it would require browser scraping or Chrome automation, both forbidden. **Recorded; moved on.**

### MarketPulse — excluded by §5

`market_pulse_*` is intelligence about the **tenant's own market**, not about external companies. `accountIntelligence.ts:53-58` states it and enforces it: *"WS-3 established that `market_pulse_*` is intelligence about the TENANT'S market, never about an external company… a test pins that no account attribute can be sourced from MarketPulse."*

So MarketPulse holds no prospect-shaped records. Turning it into a prospect source would be precisely the *"new semantic bridge"* §5 forbids, and it would also break a test that exists to prevent it. **Deferred.**

### Active Leads / social — excluded by §6

Two separate findings, both verified:

1. **`active_leads` has zero writers.** A repository-wide search for `insert`/`upsert`/`update` against it returns **nothing**; it is read once, by the Report-1 snapshot handler (`snapshotRouteHandler.ts:110`). §6: *"If it is zero-writer legacy infrastructure, do not make it authoritative."*
2. **The live social/listening stack does not produce prospects.** Listening connectors exist (`connectors/hackerNewsListeningConnector.ts`, `listeningConnectorRegistry.ts`) and `leadJobProcessor.ts` runs them — but it writes **only `lead_signals`**. No listening module calls `ingestSourceRecord`, `resolveUnifiedPerson` or `ingestLeadBatch`. `prospectEngagementIntelligence.ts` only **reads** `canonical_leads` to join it to engagement threads.

A listening signal is not a prospect, and making one into a prospect is a semantic bridge nobody has authorised. **Not a valid candidate.**

### Apollo as a source, ZoomInfo, Crunchbase — blocked by §17

Apollo has an adapter, but it is an **enrichment** adapter: `supports: ['employee_count']`, `GET /organizations/enrich`, keyed on a domain the caller already has. It performs no person or account **discovery**, so it cannot originate a prospect. Giving it discovery would mean a new Apollo endpoint **and a real tenant credential** — and G-4 already records that no tenant credential exists anywhere. ZoomInfo and Crunchbase are declared only and need api keys.

§17: *"If the selected source requires a real external credential that is not available in a controlled non-production environment: STOP. Do not substitute production credentials."*

---

## 3–10. What already exists, and is ready

Stated because it is the actionable half of this report: when a source is authorised, almost nothing has to be built.

**The adapter contract is one interface with one method** (`contracts.ts:177-189`):

```ts
interface LeadSourceAdapter {
  readonly source: string;                        // becomes source_records.provider
  readonly label: string;
  readonly capabilities: readonly SourceCapability[];
  translate(raw, organizationId): AdapterResult;  // ONE provider record
}
```

**Everything downstream is already built and already verified**, and a new adapter inherits all of it without adding a line (`orchestrator.ts:6-11, 310, 325, 402, 449`):

```
adapter.translate
  → identity            resolveUnifiedPerson        (W1, the single matcher)
  → duplicate detection
  → account resolution
  → provenance          ingestSourceRecord          (LI-2, the single canonical writer)
  → arbitration         B1b                          (frozen; recency, confidence,
                                                       attestation, supersession,
                                                       canonical decision log)
  → canonical prospect  canonical_leads
```

- **Identity resolution** — `resolveUnifiedPerson`, deterministic email → phone → `external_keys`, every lookup tenant-filtered. No second matcher, no probabilistic matching.
- **Deduplication / idempotency** — `source_records` identity is `(organization_id, provider, source_entity_type, source_record_id)`, non-partial so `ON CONFLICT` can infer it; assertions dedupe on `(organization_id, source_record_id, attribute, value_hash)`.
- **Source assertions and provenance** — raw and normalized value, `value_hash`, provider, `observed_at`/`recorded_at`, `applied_to_canonical_at` + `applied_reason`, supersession, plus B1b's append-only `canonical_attribute_decisions`.
- **B1b arbitration** — frozen and untouched (`4c3237a8fbcb9585`). A new source would feed evidence into it and would **not** be authoritative: no owner decision authorises any source's authority, and `attributeAuthority` returns an empty declaration for every tenant (O-1 and O-7 ratified as deferred).
- **Tenant isolation** — composite tenant FKs on `source_records`, `source_assertions`, `canonical_attribute_decisions` and (since G-6) `prospect_enrichment_attempts`.
- **Timestamps** — B1b's ratified `COALESCE(observed_at, recorded_at)`; a new adapter must preserve an absent `observed_at` rather than substituting ingestion time.

**Also recorded:** the three live ingestion routes are gated by `ENABLE_LEAD_INGESTION` (`orchestrator.ts:67`, `isLeadIngestionEnabled`), described in code as *"the outer kill switch… checked FIRST"*. A fourth source inherits that gate; no flag was changed here.

---

## 11–15. Testing — NOT RUN, and why

No adapter was written, so there is nothing to test. Writing tests for an adapter the brief forbids inventing would be worse than writing none: it would make a fabricated capability look verified.

The existing three-source path and every frozen dependency were left untouched, and their suites were green as of B3 (T1 34/34 new plus the affected lifecycle, feedback, provider-event and outcome suites; T2 139/139 across six real-schema suites). **Nothing in this gate could have changed them, because this gate changed no file.**

## 16. Files changed — none

B4 is read-only. Verified by content hash, not by `git status`:

```
4c3237a8fbcb9585  prospectIdentity/ingestionBoundary.ts      ← required value, confirmed
a6d3c35cf36ac3ad  prospectIdentity/attributeAuthority.ts
5b3da65e617b7590  enrichment/providers/adapters/apollo.ts
af9a772af98adcb2  enrichment/attempts.ts
1a426f268fb48d43  migrations/20261120000000_pi_attempt_ledger_tenant_fk.sql   (G-6)
2ccef23fc04d8f25  prospectLifecycle/lifecycleWriter.ts
fc80e03e3b1a975c  prospectLifecycle/outcomeInterpreter.ts
9312a072be91df3b  prospectLifecycle/outcomeLifecycleProducer.ts               (B3)
60cdf48467b3a185  leadIngestion/orchestrator.ts
63ae5877e726a633  leadIngestion/registry.ts
d69499ce30761fc1  leadIngestion/contracts.ts
```

Every value matches the one recorded by the gate that produced it. Scoring, Common Outreach and lifecycle semantics are untouched. Migration census **439**, unchanged.

## 17. Production safety

No database of any kind was contacted — this gate read source files only. No connector credential, no external provider call, no deployment, no Vercel, no Railway, no migration, no flag change, and Docker was never started (the isolated PostgreSQL from earlier gates remained stopped throughout). Nothing committed.

## 18. Remaining gaps — one per candidate

| # | Candidate | Exact blocker | What would unblock it |
|---|---|---|---|
| **B4-1** | **Sales Navigator** | No authorized connector exists. `available: false`, `oauth` + `provider_terms_review`. The only artefact is a feasibility estimate. | A LinkedIn partnership/API review outcome, then an OAuth connector. **Not an engineering decision.** Scraping and Chrome automation remain forbidden. |
| **B4-2** | **MarketPulse** | Holds tenant-market intelligence, not external-company records. A test pins that no account attribute may be sourced from it. | A product decision that some MarketPulse record genuinely denotes a prospect — i.e. a new semantic bridge, which B4 forbids inventing. |
| **B4-3** | **Active Leads / social** | `active_leads` has **zero writers**; the live listening stack writes only `lead_signals` and never reaches the canonical boundary. | A decision that a listening signal may originate a canonical prospect, and on what evidence. Reviving `active_leads` is explicitly not the answer. |
| **B4-4** | **Apollo-as-source / ZoomInfo / Crunchbase** | Discovery is unimplemented and needs a real tenant credential (G-4). Apollo's adapter is enrichment-only. | The same authorisation G-4 already waits on: a real key, a tenant to attribute it to, and acceptance of billable misses. |

**Unrelated discoveries — recorded, not fixed** (per §14): nothing new. G-1, G-2, G-4, G-5, B3's `converted` mapping and B3's person→prospect ambiguity all stand exactly as recorded.

## 19. Owner decisions required

1. **Which fourth source do you actually want?** Each has a different kind of cost, and none is engineering-led:
   - *Sales Navigator* — a legal/partnership outcome you do not currently hold;
   - *MarketPulse* — a product definition of when market intelligence denotes a prospect;
   - *Social/listening* — a product definition of when a signal denotes a prospect;
   - *Apollo discovery / ZoomInfo / Crunchbase* — a paid credential and a tenant to bill.
2. **If Apollo discovery:** authorise the credential (this is G-4, unchanged) and accept that a miss is billable.
3. **If social:** decide whether a listening signal may originate a prospect and on what evidence — and note that `active_leads` is not the vehicle.
4. **If MarketPulse:** decide whether any MarketPulse record is about an external company rather than the tenant's market; today the architecture says it is not, and a test enforces that.

The cheapest genuine expansion is **Apollo discovery**, because its adapter, registry, cost port, credential port and attempt ledger already exist and are verified — the only missing input is the credential. The others need a decision before any code could be written at all.

---

# B4 OWNER DECISION REQUIRED

The ingestion spine is ready for a fourth source and was proven so by inspection: a `LeadSourceAdapter` is one method, and identity, deduplication, provenance, B1b arbitration and tenant isolation are all already in place and already verified. **What is absent in every case is an authorised way to obtain the data** — a partnership, a product definition, or a credential.

No adapter was invented, no catalogue row was relabelled, no zero-writer table was revived, and no file was changed.

**STOP.** No B10. No scoring-feedback intelligence. No inbound email. No additional provider. Production untouched.
