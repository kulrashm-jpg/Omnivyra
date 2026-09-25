# PI-CONTRACT-REGISTER

**One authoritative contract per concern.** This is the register every workstream reuses from, and the answer to "is there already a contract for this?"

**Base SHA:** `a07477e4` · **Established:** 2026-09-23 · **Status:** FROZEN for eleven contracts; one is SITED and one is DEFERRED.
**Amended:** 2026-09-25 at `6db34fa0` — contract #13 (Outcome Provenance) added; contract #10 moved SITED → FROZEN, per `PI-ADR-006`.

A contract listed `FROZEN` may not be re-stated, re-spelled or paralleled. Extending one is a change to this register, not a local decision. The Do-Not-Build register in `IMPLEMENTATION-MANIFEST-001.md` §11 remains in force.

---

## 1. The register

| # | Concern | Contract | Authority | Status |
|---|---|---|---|---|
| 1 | **Prospect** | `canonical_leads`; identity `(company_id, external_lead_key)`; lifecycle + qualification columns | manifest C-2; written only by `prospectIdentity/prospectResolution.ts:193` | **FROZEN** |
| 2 | **Person** | `unified_persons`; resolve order email → phone → external key; tenant-scoped uniqueness | `identityResolutionService.resolveUnifiedPerson:332` — the sole resolve-or-create path | **FROZEN** |
| 3 | **Account** | `prospect_accounts`; two keys — `(org, source, source_reference)` then `(org, domain_normalized)`; **never name** | `prospectIdentity/accountResolution.ts:10-23` | **FROZEN** |
| 4 | **Signal** | `lead_signals`, `source_type ∈ {engagement, listening}` | manifest C-5; `canonicalLeadSignalService` is the sole writer | **FROZEN — with a known unbridged gap, §2.1** |
| 5 | **Evidence** | `source_records` + `source_assertions`; value · source · `observed_at` · confidence; RULE A/B/C | `prospectIdentity/ingestionBoundary.ts:27-43`, `:330` | **FROZEN — two gaps, §2.2** |
| 6 | **Enrichment Attribute** | `FIELD_STATES` `['known','missing','stale','conflicting']`; `FIELD_ACTIONS` `['skip','enrich','no_available_source','needs_resolution']`; `ENRICHMENT_OUTCOMES`; `PROVIDER_STATES` `['declared','implemented','operational']`; `CONNECTION_STATES` | `enrichment/planner.ts:60,64`; `providers/contract.ts:28,51`; `providers/sources.ts:78` | **FROZEN** |
| 7 | **Decision (governance)** | `GateDecision` `['allowed','blocked','deferred']`; frozen gate order `kill_switch → suppression → region → approval → rate_limit`; `GOVERNANCE_TYPES` (9, closed) | `leadOutreachExecution/governance.ts:17-46`; `prospectIdentity/contactGovernance.ts:50-61` | **FROZEN** |
| 8 | **Next Best Action** | `nextAction ∈ {personalized_outreach, nurture_sequence, monitor}`; NBA record fields per `prospectOutreach/readiness.ts:82-112` | manifest C-7 — `engines/recommendation.ts` canonical, `leadActions.ts` retained legacy read-side | **FROZEN — thin, §2.3** |
| 9 | **Outreach Outcome** | 8 values `opened, clicked, replied, meeting_booked, rejected, no_response, unsubscribed, converted`; `UNOBSERVABLE_BUSINESS_OUTCOMES`; `DERIVED_BUSINESS_OUTCOMES`; dual idempotency | `leadOutreachExecution/types.ts:80-107`; DB CHECK at `baseline.sql:19980` | **FROZEN** |
| 10 | **Prospect State / Lifecycle Event** | Append-only transition ledger keyed to the prospect; **7 states**, not 17; vocabulary in a DB CHECK; typed evidence citation; explicit `human \| derived` origin; idempotent re-derivation legal | **`PI-ADR-004`**, implemented by `prospectLifecycle/stateModel.ts:79-122` (vocabulary + edges), `lifecycleWriter.ts:70` (debounce), `lifecycleReader.ts:231` (the `outreach-active` projection); DB CHECK at `20261028000000_pi_prospect_lifecycle_state.sql:175-184` | **FROZEN — WS-C decided all three items ADR-004 §5 left open: the edges (DECISION A), the six-hour debounce (DECISION B), and `outreach-active` as a projection rather than a state (Decision C). `meeting_scheduled` remains contract-only, §4** |
| 11 | **Candidate** | New tenant-scoped pre-prospect review queue; anchored to an **identity claim**, not a person; person-optional; policy-gated promotion; audited transitions | **`PI-ADR-003`** | **SITED — shape fixed; state vocabulary and criteria still to be written by WS-C** |
| 12 | **Learning Proposal** | unratified `prospect_icp_versions` draft; cites the outcome rows that suggested it; stated data floor; human ratifies | `PI-ACTIVATION-PLAN-001.md` §4 records the minimum acceptable mechanism | **DEFERRED until outcome data exists** — contract stated, not built |
| 13 | **Outcome Provenance** | `AssertionAuthority` `['authorized_human','provider','webhook','import','system','unauthorized']`, classified over the six `FeedbackSource` values `provider_webhook, provider_poll, manual, import, derived, internal`; pure — no clock, no I/O, no database; **fails closed** — absent, unrecognised or internally inconsistent provenance yields `unauthorized` with a stated reason; **audit/attribution metadata only**: carried through interpretation and never consulted as lifecycle authorization | `prospectLifecycle/outcomeProvenance.ts`; source axis `leadOutreachExecution/types.ts:293`; DB CHECK at `20260915000000_ws3_feedback_ingestion.sql:46-50`; **`PI-ADR-006`** | **FROZEN** |

### Cross-cutting vocabularies, also frozen

| Vocabulary | Where | Note |
|---|---|---|
| `SectionState` `['available','empty','not_evaluated','not_implemented','failed']` | `apiHandlers/prospects/prospectIntelligenceRead.ts:82-87` | The API may not collapse these |
| `SCORE_DIMENSIONS` `['intent','icp','urgency','opportunity','priority']` | `leadUnderstanding/types.ts:96` | Test-pinned; the four unimplemented dimensions are **not** members |
| ICP criterion vocabulary — 14 account + 9 person attributes, closed | `prospectIcp/criteria.ts:76-127` | An ICP may only speak about attributes the platform stores |
| `ICP_VERSION_STATUSES` `['draft','proposed','ratified','superseded']` | `prospectIcp/types.ts:69` | Ratification enforced at route, service and DB CHECK |
| `RetryClass`, `ENRICHMENT_DECISIONS` | `enrichment/retryCandidates.ts:44`; `decideEnrichmentAction.ts:43` | |

---

## 2. Known gaps inside frozen contracts

These are recorded so no workstream "fixes" them locally.

**2.1 Signal — the unbridged vocabulary.** `lead_signals.source_type` has 2 values; `BuyingSignalType` has 18. There is **no bridge, deliberately** (`leadUnderstanding/prospectContext.ts:35-40`). Consequence: `ctx.signals` is never populated, so `buyingSignal` abstains on every real prospect and `opportunity` and `urgency` receive no contribution. **Do not invent a mapping** — it would fabricate a trigger event the platform never observed. Closing this is a product decision, not an implementation.

**2.2 Evidence — two gaps.** `source_assertions.superseded_at` is read and never written, so an assertion can never be retired; combined with RULE C, the first canonical value for an attribute is permanent and a disagreement withholds forever (DEFECT-006, work item DL-6). And freshness is not stored — it is a caller-supplied window only (work item DL-5).

**2.3 NBA — thin, and not persisted.** Three actions, computed at read time, never persisted (`lead_understanding_shadow` has a migration and no writer). `objective` and `expiry` are hard-coded `null`. WS-E will need to widen this vocabulary; that is a change to contract #8 and must be recorded here, not made locally.

---

## 3. Contract #11 (Candidate) — SITED by `PI-ADR-003`

**A new entity, justified under `PI-ADR-001` §3.7.** Every existing home was examined and each fails for a different *structural* reason — wrong grain, run-scoped cascade, no tenant column, per-signal keying, `NOT NULL` person, or being the very entity under protection. The full table is in the ADR.

**This is not a second Prospect.** The distinguishing test: `canonical_leads` holds decisions **made**; this holds decisions **pending** — the same category as `person_duplicate_candidates` and `prospect_icp_versions`, both accepted under the same ADR.

Fixed by the ADR, and binding on WS-C:
- anchored to the **identity-claim tuple** `(organization_id, claim_type, platform, normalized_value)`, **not** a person — so B1's refusal to mint a person from a bare handle stands
- `unified_person_id` nullable with `ON DELETE SET NULL`, deliberately not `RESTRICT`
- idempotency by a **partial** unique index → `ON CONFLICT` cannot infer it (`42P10`); INSERT and catch `23505`
- promotion gated by a **ratified, versioned policy row** evaluated by the existing `prospectIcp/evaluate.ts`, so every transition carries `policy_id` + `policy_version`
- the gate **reads** WS-6's and the ICP evaluator's verdicts and never forms its own score
- transitions audited with a stated reason, enforced by a CHECK rather than by convention

Still to be written by WS-C: the state vocabulary, the criteria, and the debounce.

## 4. Contract #10 (Prospect State) — constraints, and what WS-C decided

**WS-C wrote this contract; it is no longer pending with WS-E.** The four constraints below were fixed in advance and all four are honoured by the implementation. What `PI-ADR-004` §5 left open, WS-C then decided: the transition edges (DECISION A, `prospectLifecycle/stateModel.ts:13-25`), the reassessment debounce at six hours and overridable per call (DECISION B, `lifecycleWriter.ts:54-70`), and `outreach-active` as a read-time projection over `outreach_tasks` rather than a stored state (Decision C, `stateModel.ts:89-100`, implemented as `projectOutreachActivity` in `lifecycleReader.ts:231`) — which is why there are six resting states plus the initial one, and why reactivation is `nurture → qualified`.

One item in the cluster remains deliberately unbuilt: `meeting_scheduled` is in the vocabulary, the graph and the DB CHECK but stays in `PROSPECT_STATES_UNREACHABLE_TODAY`. `PI-ADR-004` §5 is affirmed conditionally on a future booking integration, and `PI-ADR-006` records that manual admission of its only cause, `meeting_booked`, has been removed.

The four pre-fixed constraints, recorded so the contract was not drafted against a blank page:

1. It is a **prospect** concept. It must not be conflated with, or stored in, any of: `outreach_tasks.status` (17 states, per-task), `operational_states` (manual, PI-disconnected), `journeyState` (website telemetry), `FunnelStage` (a recomputed label), `active_leads.bucket`, or `prospect_accounts.status` (identity, not sales).
2. It may not silently adopt `canonical_leads.lead_status`, which `crmIngestionService` mirrors from arbitrary customer CRM values (`:133, :210, :451`).
3. Every transition must **cite the evidence that caused it** — the existing explainability discipline.
4. Reassessment must be **bounded**. Re-deriving on every outcome for a high-volume tenant is a cost and a stampede risk; the debounce is part of this contract, per `PI-ADR-002` §4.

---

## 5. How to use this register

- **Before writing any new type, enum, status or table:** check here. If the concern is listed, reuse it.
- **If a frozen contract genuinely cannot carry the requirement:** that is a change to this register with a stated reason — not a parallel implementation.
- **If a workstream believes it has found a conflict:** raise it here rather than resolving it locally. Two workstreams resolving the same conflict differently is how the platform got four suppression stores and three lead tables.

---

## 6. GAP-A resolution — recorded here because it sets a precedent

**Verdict: ADD-BLOCKING, and the scope is four tables, not one.**

The framing "should another domain's table be in *PI's* gate" was the wrong question. `scripts/verify-schema-parity.js` is the **single repo-wide deploy gate**, and its pre-existing 21 tables belong to six domains, none of them PI — BOLT, queue infrastructure, the scheduler, Active Leads, Writer, and integrations. Cross-domain coverage is not an exception; it is everything the gate did before PI existed. Its own maintenance rule is dependency-shaped, not ownership-shaped: append a write path's columns *"with a severity reflecting real operational impact"*. It asks what breaks, not who owns.

**Ownership, for the record:** `engagement_threads` is an Engagement-domain table, created by the **ungoverned** `database/engagement_unified_model.sql` and written by ~20 Engagement modules. PI is a pure reader of it and owns only the `unified_person_id` edge and its tenant-composite FK.

**What decides it** is the failure shape, verified directly:

`readProspectEngagementIntelligence` is **the one seam in the prospect read deliberately not wrapped** — `prospectIntelligenceRead.ts:279-280` awaits it with no `try`/`catch` and no `attempt()`, because its `null` is the 404 that answers "does this prospect exist in this tenant". Every other seam is wrapped and degrades to a `failed` section. So a throw here is not a degraded panel — `pages/api/prospects/[id].ts:73` turns it into **HTTP 503 for the entire prospect detail response**.

And that seam reads **five** tables with an explicit column list and `if (error) throw`: `canonical_leads` (already covered by WS-A1), plus `engagement_threads`, `engagement_messages`, `contacts` and `lead_signals` — **none of which is in the gate**. Covering only `engagement_threads` would make the gate's coverage of one code path arbitrary.

This table has also already done the damage once: migration `20260917000000` records a production `42703` on every tenant because an ungoverned `database/` file was only partially applied — the exact failure class the gate exists for.

**Real-schema CI is not a substitute.** It rebuilds a disposable database from the baseline plus replayed migrations, so it proves the migrations are internally consistent. It is structurally incapable of detecting that *production* is missing a column, which is the entire ledger-desync premise.

**Sequencing note:** this change edits the same file as GAP-B/C, which is in flight. It is serialised behind it rather than merged in parallel.
