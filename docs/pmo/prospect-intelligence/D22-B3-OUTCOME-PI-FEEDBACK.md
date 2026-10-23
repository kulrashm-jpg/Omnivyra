# D22-B3 — OUTCOME → PI FEEDBACK

# B3 VERIFIED

**Isolated runtime verified. Repository verified. Production NOT verified and NOT touched.**

| | |
|---|---|
| **Date** | 2026-10-06 |
| **What was missing** | the PRODUCER. Both ends existed and are ratified; nothing joined them. |
| **Implemented** | `backend/services/prospectLifecycle/outcomeLifecycleProducer.ts` (`9312a072be91df3b`) + one barrel export |
| **Migration** | **none authored.** Census unchanged at 439. |
| **`ingestionBoundary.ts`** | `4c3237a8fbcb9585` — unchanged, as required |
| **Owner decision required** | **None for what was implemented.** One pre-existing undecided mapping (`converted`) is surfaced, not decided. |

> **The finding that shaped this gate.** Every semantic decision B3 needed had *already been taken*. `outcomeInterpreter.ts` is a ratified outcome → lifecycle map; `recordProspectTransition` is the sole writer with its own duplicate suppression; `outreach_outcomes` now has **two live production write paths**. What the D22 audit found was that `recordProspectTransition` had **no caller outside its own module**. B3 is that caller and nothing else — it contains no state name, no outcome type and no mapping of its own, and a test enforces that.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Actual outcome → PI call graph | **VERIFIED** |
| 2 | Authoritative outcome storage | **VERIFIED** |
| 3 | Provider-event correlation | **VERIFIED** (ENG-003's, reused unchanged) |
| 4 | Tenant resolution | **VERIFIED** |
| 5 | Lifecycle writer path | **VERIFIED** |
| 6 | Supported outcome → lifecycle mappings | **IMPLEMENTED + VERIFIED** |
| 7 | Unsupported mappings and why | **VERIFIED** (characterized, none invented) |
| 8 | Idempotency proof | **VERIFIED** |
| 9 | Tenant isolation proof | **VERIFIED** — DB-enforced |
| 10 | Ambiguity / fail-closed proof | **VERIFIED** |
| 11 | T1 results | **VERIFIED** — 34/34 new |
| 12 | T2 results | **VERIFIED** — 19/19 new; 139/139 across 6 suites |
| 13 | Mutation probes | **VERIFIED** — 7/7 killed |
| 14 | Files changed + hashes | **VERIFIED** |
| 15 | Production safety | **VERIFIED** |
| 16 | Remaining gaps | 4 recorded |
| 17 | Owner decisions | **none blocking**; one pre-existing (`converted`) surfaced |

---

## 1. The actual outcome → PI call graph

Traced in code, not inferred from filenames.

```
 ── OUTCOME IN ───────────────────────────────────────────────────────────────
 pages/api/webhooks/ses.ts            (ENG-003) authenticated SNS, topic allow-list
   └─ ingestSesProviderEvent → providerMessageResolver → ingestFeedback
 pages/api/outreach/outcomes.ts       (PI-P1-W09D) authenticated OPERATOR,
   └─ ingestFeedback                   requireTenantAccess
                                         │
                        outreach_outcomes (business axis, 9 types)
                        outreach_delivery_evidence (delivery axis)
 ── B3, THE NEW JOIN ─────────────────────────────────────────────────────────
 produceLifecycleFromOutcome({ organizationId, outcomeId, actorUserId?, now })
   1. outreach_outcomes      → task_id, type, source/provider/provider_event_id, metadata
   2. outreach_tasks         → person_id
   3. canonical_leads        → prospect id      (ALL rows; ≠1 refuses)
   4. readCurrentProspectState
   5. interpretOutcome                          ← the ratified mapping
   6. recordProspectTransition                  ← the sole writer
 ── OUT ──────────────────────────────────────────────────────────────────────
 prospect_lifecycle_transitions (append-only), citing outreach_outcomes.id
```

**Two corrections to the D22 baseline**, both verified:

1. D22 recorded `outreach_outcomes` as effectively unwritable because *"`ingestFeedback` has no caller"*. It now has **two** production callers — the SES webhook (ENG-003) and the operator route (PI-P1-W09D), whose own header records the earlier state: *"WS-3 M7 shipped the ingestion FUNCTION and said so plainly… This is that route."*
2. `recordProspectTransition` genuinely has **no caller outside `prospectLifecycle/`** — that part of the audit holds, and is what B3 fixes.

## 2. Authoritative outcome storage

`outreach_outcomes`, tenant column `company_id` (**uuid** — A3 retyped it; the WS-3 migration source still says `text`, and the live catalog disagrees, which is why this was read from the catalog). Two idempotency keys already on the table:

- `outreach_outcomes_idempotent UNIQUE (company_id, task_id, outcome_type, occurred_at)`
- `outreach_outcomes_type_valid` — exactly the **9 business outcome types**

## 3. Provider-event correlation — ENG-003's, reused unchanged

No second webhook, no second resolver, no change to the uniqueness model. Confirmed against the catalog:

```
uq_outreach_delivery_provider_event  UNIQUE (company_id, provider, provider_event_id)
                                     WHERE provider_event_id IS NOT NULL
uq_outreach_delivery_logical         UNIQUE (company_id, task_id, delivery_status, observed_at)
```

So `provider_event_id` is the idempotency anchor and `provider_message_id` is **not unique** — exactly as the brief states. **B3 never correlates by provider message id**: it keys on `outreach_outcomes.id`, which is already resolved. No `LIMIT 1` exists anywhere in the producer.

## 4. Tenant resolution

Every read names the tenant, and the column types along the chain were verified as **uuid throughout** (`outreach_outcomes.company_id`, `outreach_tasks.company_id`, `canonical_leads.company_id`, `unified_persons.company_id`) — so there is no cross-type join hazard.

Reinforced below the application, which §5 of the brief asks for:

| Constraint | Guarantee |
|---|---|
| `prospect_lifecycle_prospect_fk` | `(prospect_id, organization_id) → canonical_leads(id, company_id)` |
| `prospect_lifecycle_outcome_fk` | `(evidence_outcome_id, organization_id) → outreach_outcomes(id, company_id)` |
| `outreach_tasks` person leg | `(person_id, company_id) → unified_persons(id, company_id)` |

**A transition can therefore not cite another tenant's outcome even by direct SQL**, which is proved rather than asserted (§9).

## 5. Lifecycle writer path

`recordProspectTransition` is used unmodified. It already supplies everything B3 would otherwise have had to invent:

- legal-transition validation, and `seq`/`previous_state`/`is_initial` bookkeeping;
- a `duplicate` verdict for a `sourceEventKey` it has seen;
- DB-enforced shape: `prospect_lifecycle_origin_actor` (human **requires** an actor, derived **forbids** one), `prospect_lifecycle_evidence_typed`, `prospect_lifecycle_event_key_shape` (`^(outcome|evidence|governance|derivation|human):[A-Za-z0-9._-]{1,200}$`), and a guard trigger `trg_prospect_lifecycle_guard` ("the first transition for a prospect must be the initial row").

`ensureProspectLifecycleOpen` is **not** called by the producer: a prospect with no ledger abstains rather than having one opened for it.

## 6. Supported mappings — IMPLEMENTED and VERIFIED

Taken from the ratified map, selected **by origin** rather than by preference:

| Outcome | → | Origin | Producible | Verified |
|---|---|---|---|---|
| `replied` | `engaged` | derived | ✔ automatically | T1 + T2 |
| `unsubscribed` | `closed_disqualified` | derived | ✔ automatically | T1 + T2 |
| `no_response` | `nurture` (conditional) | derived | ✔ when the interpreter's condition holds | T1 + T2 |
| `rejected` | `not_interested` | **human** | ✔ only with an operator | T1 + T2 |

**The operator is read from where the architecture already keeps it.** `outcomeProvenance.ts` states that `outreach_outcomes` has no actor column and that *"the id lives in `metadata.recordedByUserId`, written from the route's authenticated principal"*. The producer reads that, with an explicit `actorUserId` taking precedence. Without an actor a `human` proposal is **refused, never downgraded to `derived`** — laundering an operator judgement into a machine inference is the one thing this seam must not do. A non-string `recordedByUserId` (a number, an object, a blank) is no operator, never a coerced one.

## 7. Unsupported mappings, and why — nothing invented

| Outcome | Disposition | Why |
|---|---|---|
| `opened`, `clicked` | not-lifecycle-bearing | a rendering or interaction event is not a prospect position; also unobservable today |
| `complaint` | not-lifecycle-bearing | ENG-003's ratified reading, unchanged |
| `meeting_booked` | unreachable | `meeting_scheduled` is in `PROSPECT_STATES_UNREACHABLE_TODAY`; no booking integration |
| `converted` | **needs-policy** | *"the prospect vocabulary has no success state; every candidate target is an invention"* — surfaced loudly, **not decided** |
| `delivered`, `bounced`, delivery delay | not business outcomes at all | **structurally unrepresentable**: `outreach_outcomes_type_valid` admits only the 9 business types, so an attempt to store one is refused with `23514` |

That last row is the strongest form of §9's safety rule. "Delivered means engaged" and "a delivery delay moves the lifecycle" are not merely refused by the producer — **the schema cannot express them**, and T2 proves it by attempting all four and getting `23514`, then inserting `replied` and getting `ok` for contrast.

**The producer's shape follows a decision already taken.** `outcomeInterpreter` states: *"ONE OUTCOME AT A TIME … Folding a whole corpus into one conclusion needs a precedence and recency policy that nobody has decided, and inventing one here would hide it."* So the caller names the outcome; B3 is **not** a corpus sweep that picks "the latest", because choosing would have been exactly that invention.

## 8. Idempotency

Nothing new was added. The interpreter mints `outcome:<outreach_outcomes.id>` and the writer suppresses a repeated key.

**Proved at T2, and the layering stated honestly:** a replayed outcome appends nothing — and it is refused by the **interpreter**, not by key suppression, because the first transition moved the prospect to `engaged` and re-reading `replied` from `engaged` proposes nothing. Key-based suppression is the **backstop behind that**, and it is still in place: the test asserts the written row carries `source_event_key = outcome:<id>`, so a producer that stopped using the interpreter's key would be caught (mutation probe 3).

Upstream, both outcome write paths are themselves idempotent on `(company_id, task_id, outcome_type, occurred_at)` and, for provider events, on `(company_id, provider, provider_event_id)`.

## 9. Tenant isolation

- a cross-tenant outcome is **not visible**: `outcome_not_found`, nothing written, zero rows in the requesting tenant;
- each tenant's own outcome produces its own transition, independently;
- **DB-enforced**: a direct insert citing another tenant's outcome is refused `23503`, and so is one naming another tenant's prospect — the same statement citing its *own* tenant's evidence is accepted, so the probe is not vacuous;
- a **fictional operator is refused** — `actor_user_id → users(id)`, so an invented uuid fails and no transition lands. (My first test supplied one and was corrected.)
- no Drishiq Labs case: the producer contains no tenant literal.

## 10. Ambiguity and fail-closed

| Situation | Behaviour |
|---|---|
| outcome not in this tenant | `outcome_not_found` |
| outcome with no task | `outcome_has_no_task` |
| task not in this tenant | `task_not_found` |
| task with no resolved person | `task_has_no_person` — a supported state, not an error |
| person → **0** prospects | `prospect_unresolved` |
| person → **several** prospects | `prospect_ambiguous` — *"refusing to choose one"* |
| no lifecycle ledger | abstains; does not open one |
| `human` proposal, no operator | `human_origin_requires_actor` |
| undecided mapping | `needs_policy`, louder than a no-transition |

The person → prospect step is genuinely ambiguous: **`canonical_leads` carries only a NON-UNIQUE index on `unified_person_id`** (`idx_canonical_leads_unified_person`), so several prospect rows per person are legal. The producer collects **all** of them and refuses on ≠ 1. No `LIMIT 1`, no `.single()`.

## 11. T1 — 34/34 new

Plus the directly affected suites: `piWscProspectLifecycleModel`, `piWscProspectLifecycleWriter`, `eng003SesProviderEvents`, `piWs9OutcomeCorpus`, `ws3Milestone1/2/3/7` — **all pass**. Typecheck `tsc --noEmit --incremental false` → **0 errors**.

**Four pre-existing failures, reported not hidden.** `ws3Milestone4Governance`, `ws3Milestone5aInternalDispatch`, `ws3Milestone5bExternalDispatch`, `ws3Milestone6Observability` fail on WS-3 rate-limiter/dispatch assertions (e.g. *"DEFERS rather than blocks when the lead limit is reached"*). Each contains **zero references** to `prospectLifecycle` or the producer, so none can see this gate's change; M5A/M5B/M6 were already recorded as failing in this worktree before B3.

## 12. T2 — 19/19 new, 139/139 across six suites

Against the isolated PostgreSQL. Every §13 requirement:

| # | Requirement | Result |
|---|---|---|
| 1 | supported outcome → exactly one transition | ✔ one appended row, citing its outcome |
| 2 | duplicate outcome → no duplicate transition | ✔ nothing appended |
| 3 | illegal transition rejected | ✔ the terminal state has no exit; nothing appended |
| 4 | missing prospect handled safely | ✔ `prospect_unresolved`, no write |
| 5 | cross-tenant outcome rejected | ✔ not visible, plus DB-level proof |
| 6 | ambiguous correlation fails closed | ✔ person → several prospects refused |
| 7 | complaint invents no state | ✔ ledger untouched, still `identified` |
| 8 | delivery does not mean engaged | ✔ **structurally unrepresentable** (`23514`) |
| 9 | DeliveryDelay creates no lifecycle state | ✔ same — cannot become an outcome |
| 10 | the writer remains the only writer | ✔ source scan + writer-set `previous_state`/`is_initial`/`seq` ordering |

Regression: `pi_wsc_prospect_lifecycle`, `b1b_arbitration`, `li2_source_records`, `b2_g3_attempt_composition`, `b2_g6_attempt_tenant_fk` **all green** alongside the new suite.

## 13. Mutation probes — 7 of 7 killed

| # | Mutation | Verdict |
|---|---|---|
| 1 | the transition written **directly**, bypassing the writer | **KILLED** |
| 2 | tenant predicate dropped from the outcome read | **KILLED** |
| 3 | the producer mints its own event key instead of the interpreter's | **KILLED** (2 tests) |
| 4 | a delivery signal read as a business outcome | **KILLED** (2 tests) |
| 5 | `complaint` mapped to `closed_disqualified` | **KILLED** (T1 **and** T2) |
| 6 | ambiguous person → prospect settled with `LIMIT 1` | **KILLED** |
| 7 | transition emitted without the outcome evidence that cites its cause | **KILLED** |

Restored byte-identically: `outcomeLifecycleProducer 9312a072be91df3b`, `outcomeInterpreter fc80e03e3b1a975c`.

## 14. Files changed, with hashes

**B3 changed four files. No migration.**

```
9312a072be91df3b  backend/services/prospectLifecycle/outcomeLifecycleProducer.ts   NEW (371 lines)
2095cc509384a63c  backend/services/prospectLifecycle/index.ts                      +1 barrel export
75fd3f8806a5bf4d  backend/tests/unit/b3OutcomeLifecycleProducer.test.ts            NEW (34 tests)
f1ee19deae6e159b  backend/tests/realschema/b3_outcome_lifecycle.test.ts            NEW (19 tests)
```

All LF, 0 control bytes.

**Verified unchanged by content hash — not by `git status`:**

```
4c3237a8fbcb9585  prospectIdentity/ingestionBoundary.ts    ← required value, confirmed
                  full: 4c3237a8fbcb9585c5dd8ef9639daaeb8c3e064d75d71c3246cc2296a744ce43
a6d3c35cf36ac3ad  prospectIdentity/attributeAuthority.ts
5b3da65e617b7590  enrichment/providers/adapters/apollo.ts
af9a772af98adcb2  enrichment/attempts.ts
fb484a41aa6c8d0b  enrichment/recordedExecution.ts
ee4217e213cd28eb  enrichment/providers/execute.ts
1a426f268fb48d43  migrations/20261120000000_pi_attempt_ledger_tenant_fk.sql   (G-6)
2ccef23fc04d8f25  prospectLifecycle/lifecycleWriter.ts
fc80e03e3b1a975c  prospectLifecycle/outcomeInterpreter.ts
ea8c9211621cb2f9  prospectLifecycle/stateModel.ts
c46ed8f4a7a83a70  leadOutreachExecution/feedbackIngestion.ts
```

The ratified mapping, the sole writer, the state model, the feedback boundary, Apollo, the attempt ledger and the G-6 migration are all byte-identical. **Scoring is untouched**: no change to `SCORING_RULES_VERSION`, no recalculation, no weight change.

## 15. Production safety

| Claim | Evidence |
|---|---|
| No production DB | `W6_DB_URL = postgresql://…@127.0.0.1:55432/b1b_closure`; the harness independently refuses managed hosts |
| No production provider events | this path contacts **no provider at all**; no network call anywhere in B3 |
| No migration | none authored; census unchanged at **439** |
| No deployment / Vercel / Railway | none invoked |
| No production credential | no `.env.local` in this worktree — only `.env.test` and two `.example` files |
| Docker | never started; `docker ps` fails at start and end |
| Server stopped | no PID file, 0 processes, 0 listeners on 55432 |
| Nothing committed | four files, uncommitted |

## 16. Remaining gaps

| # | Gap | Status |
|---|---|---|
| **B3-1** | **No inbound-reply path exists.** `pages/api/webhooks/ses.ts` maps only `Delivery`, `Bounce`, `Reject`, `Complaint`; its single "inbound" mention is prose. So `replied` reaches PI **only** through the authenticated operator route today. | **Recorded as a future INPUT, not a prerequisite.** B3 did not need it and no inbound system was built. A future inbound path would feed the same producer unchanged. |
| **B3-2** | `converted` has no lifecycle target — *"the prospect vocabulary has no success state"*. The producer refuses it with `needs_policy`. | **Pre-existing owner decision**, surfaced not decided |
| **B3-3** | `meeting_booked` is unreachable: no booking integration, and PI-ADR-006 settled that an authorised human assertion does not by itself advance the lifecycle. | **DEFERRED** by prior decision |
| **B3-4** | `canonical_leads` has no unique index on `(company_id, unified_person_id)`, so person → prospect can be ambiguous and the producer must refuse. | **Recorded.** Whether a person may legitimately hold several prospect rows is a product question; no index was added. |
| — | `trg_prospect_lifecycle_guard` refuses a raw non-initial insert (`P0001` confirmed directly in psql). A test asserting this reported `23514` through the harness and I could not account for the difference, so **the test was removed rather than shipped** — a probe whose mechanism I cannot explain proves less than nothing. T2 item 10 is covered by the source scan and the writer-set-provenance test. | **Recorded** |
| — | Four WS-3 dispatch/governance suites fail, pre-existing and unrelated (§11) | **Recorded** |

## 17. Owner decisions required

**None for what was implemented.** Every mapping used was already ratified, and the producer adds no semantics — a test asserts it names no lifecycle state, no transition target and no outcome type of its own.

Two decisions exist in the architecture and were **surfaced, not taken**: `converted` (B3-2) and whether a person may hold several prospect rows (B3-4). Neither blocks B3.

---

# B3 VERIFIED

The smallest evidence-backed, tenant-safe, idempotent path from an authoritative outreach outcome to the **existing** PI lifecycle is implemented and verified: 34/34 T1, 19/19 T2, 139/139 across six real-schema suites, 7/7 mutation probes killed, typecheck clean, no migration, no scoring change, and every ratified artefact byte-identical.

**STOP.** No B4, no B10. No scoring-feedback intelligence. No inbound email. Production untouched.
