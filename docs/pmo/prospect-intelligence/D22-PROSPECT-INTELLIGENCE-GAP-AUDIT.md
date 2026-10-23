# D22 — PROSPECT INTELLIGENCE COMPLETE GAP AUDIT

**READ-ONLY AUDIT.** Nothing was implemented, modified, deleted or deployed. No production
read. Scope restricted to Prospect Intelligence — regionalization, Digital Snapshot and
general marketing intelligence were excluded deliberately.

**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`, 437 migrations.

---

## 0. Executive finding

**PI's spine is better built than its ends.** The middle — identity resolution,
canonicalization, tenant isolation, ICP ratification, scoring, scoring persistence — is
mature, single-authority and defended by database constraints. Both ends are open: almost
nothing flows *in* from the approved sources, and nothing at all flows *back* from
outcomes.

Three gaps block completion, and **one of them must be closed before another is even
worth starting**:

1. **No source arbitration.** The canonical writer implements, in its own words, "the
   WEAKEST rule that is still useful, because anything stronger is a precedence policy and
   precedence is a product decision." It fills only empty fields, abstains when sources
   disagree, and **never overwrites**. Consequence: a stale canonical value is permanent.
2. **No enrichment provider is ever called.** The registry states "It performs no I/O and
   contacts no provider." Two adapters exist (apollo, clearbit); neither makes a network
   call.
3. **The feedback loop does not close.** Zero callers of the lifecycle writer exist outside
   its own module, and `feedbackIngestion` references no PI table. PI cannot learn from
   outreach outcomes.

**The ordering constraint that defines the critical path:** implementing enrichment
providers before arbitration would generate assertions that **can never become canonical**,
because RULE C withholds any attribute already set and RULE B abstains on disagreement.
Gap 2 is wasted work until Gap 1 is decided. That single dependency is the most actionable
finding in this audit.

### Methodological note, because it changed my own numbers

My first pass searched for table access by literal string and **undercounted**. The one
writer of `prospect_score_evaluations` reaches it through a `SCORE_EVALUATIONS_TABLE`
constant, so a literal grep reported *zero writers* for a table that has a well-designed
single writer. Every "no writer" claim below was re-checked against the table name
anywhere in the file, not just inside an accessor call.

---

## 1. Spine audit — the §2 chain, step by step

| Step | State | Evidence |
|---|---|---|
| Company Profile → Tenant ICP | **IMPLEMENTED** | `prospect_icps`, `prospect_icp_versions` (`20261012000000_d1_tenant_icp_model`) |
| Ratified ICP | **IMPLEMENTED + ENFORCED** | partial unique index `WHERE status='ratified'`; `ratified_by` required when ratified; default `draft` |
| Prospect discovery / ingestion | **PARTIAL — 3 of the approved families** | adapters: `crmAdapter`, `csvAdapter`, `manualAdapter` only |
| Source records | **IMPLEMENTED** | `source_records`, `source_assertions` (`20261002000000_li2`) |
| Identity resolution | **IMPLEMENTED, single engine** | `identityResolutionService.resolveUnifiedPerson`; "remains the sole resolve-or-create path" |
| Dedup / canonicalization | **IMPLEMENTED** | tenant-scoped unique indexes on email and phone; `person_duplicate_candidates`; `unified_person_merges`; merge-coherence CHECKs |
| Canonical prospect | **IMPLEMENTED** | `canonical_leads` + `unified_person_id`, `FORCE ROW LEVEL SECURITY` |
| Firmographic / contact intelligence | **ARCHITECTURE ONLY** | provider registry performs no I/O (§9) |
| ICP fit | **IMPLEMENTED** | `prospectIcp/evaluate.ts`, `prospect_icp_qualifications` |
| Composite priority | **IMPLEMENTED, FROZEN** | `SCORING_RULES_VERSION = 'pi-score.1'` |
| Prospect lifecycle | **IMPLEMENTED, but has no producer** | `prospect_lifecycle_transitions`, `pi.lifecycle.1`, 7 states |
| Outreach readiness | **NOT FOUND as a PI concept** | no `outreachReady` surface in PI (§14) |
| Common Outreach | **IMPLEMENTED, FROZEN** | reached via the 040 bridge |
| Engagement / outcomes | **IMPLEMENTED in Common Outreach** | `outreach_outcomes`, `outreach_delivery_evidence` |
| **PI feedback / lifecycle update** | **MISSING** | no producer (§15) |

---

## 2. §3 — approved prospect sources

| Source family | Adapter? | Ingestion implemented? | Enters the canonical spine? | Identity resolution? | Verdict |
|---|---|---|---|---|---|
| **CRM** | `crmAdapter` + `crmIngestionService` | **yes** | yes — `canonical_leads` keyed `(company_id, external_lead_key)` | **yes** — `resolveUnifiedPerson` at `crmIngestionService:364`; `unifiedPersonId` is a *required parameter* on every write helper | **IMPLEMENTED.** Memory records the legacy CRM path as dormant in production — reachability in prod is **UNVERIFIED** here |
| **CSV / Excel** | `csvAdapter` | **yes** (translate only) | via the orchestrator | via the shared boundary | **IMPLEMENTED at adapter level**; end-to-end exercise UNVERIFIED |
| **Manual** | `manualAdapter` | yes | yes | yes | **IMPLEMENTED** |
| **MarketPulse** | **none** | **NO prospect ingestion** | no | n/a | **NOT a prospect source.** `market_pulse_findings` etc. exist and are tenant-facing, but in prospect intelligence MarketPulse is a catalogued enrichment source with **`available: false`** (`prospectIntelligenceRead.ts:751-752`) |
| **LinkedIn Sales Navigator** | **none** | **NO** | no | n/a | **NOT an ingestion source.** Appears only as a cost entry (`providers/cost.ts:192`), an extension-bridge scraper surface (`extensionBridge.ts:24,81`) and a catalogue **label** (`dataSourceCatalogue.ts:99`) |
| **Active Leads / social engagement** | **none** | **NO** | no | n/a | present in read/snapshot services; `active_leads` has **zero writers** in current code |

**The registry says this itself**, which is the strongest evidence available:
`leadIngestion/registry.ts:9` — *"No provider is registered here, because no provider
adapter is implemented."* The same file warns that registering a source you cannot read
"is how a platform ends up advertising a source it cannot actually read."

**Can a source create duplicate identities or bypass canonicalization?** No, for the three
implemented families: every canonical write requires a resolved `unified_person_id`, and
dedup is enforced by tenant-scoped unique indexes on email and phone plus
`(company_id, external_lead_key)`.

---

## 3. §4–§5 — source of truth

| Table | Writers (current HEAD) | Status |
|---|---|---|
| `canonical_leads` | **2** — `prospectIdentity/prospectResolution` (INSERT `:229`, UPDATE `:258`), `crmIngestionService` (INSERT `:217`, UPDATE `:210`) | **AUTHORITATIVE prospect representation** |
| `leads` | `leadService` INSERT `:158`, DELETE `:214`; reached via `leadCaptureService` (website capture / inbound webhooks) | **LEGACY, DIFFERENT ENTITY** — web-form/visitor attribution, not a `canonical_leads` duplicate. Still writable |
| `lead_intelligence` | **ZERO writers** by any accessor | **LEGACY, read-only in practice** |
| `active_leads` | **ZERO writers** by any accessor | **LEGACY, read-only in practice** |

**The previous audit's "competing writer families" condition is real in count but is NOT a
divergence risk.** Both `canonical_leads` writers:

- require a resolved `unified_person_id` (one is a function parameter, the other a local
  from `resolveUnifiedPerson`);
- key on `(company_id, external_lead_key)` and check for an existing row first;
- route through `ownedDbTable` with a tenant predicate.

So two writers cannot create divergent *identities*. They can diverge in `lead_metadata`
shape and in `lead_status` handling — `prospectResolution` deliberately leaves
`lead_status` NULL ("stamping one here would be a second journey authority"), which is the
correct posture; whether `crmIngestionService` honours that is **UNVERIFIED**.

**Risk quantification:** low for identity, low-moderate for attribute/metadata consistency.
What should eventually be consolidated is the *write shape*, not the identity logic. Nothing
was fixed.

---

## 4. §6 — tenant isolation

**This is the strongest part of PI.** Composite tenant foreign keys are used systematically
rather than occasionally:

```
canonical_leads_person_tenant_fk        (unified_person_id, company_id)
canonical_leads_user_fk                 (user_id, company_id)
contacts_person_tenant_fk               (unified_person_id, organization_id)
engagement_threads_person_tenant_fk     (unified_person_id, organization_id)
canonical_revenue_events_person_tenant_fk, canonical_users_person_tenant_fk, …
from migrations: (icp_id, organization_id) ×4, (account_id, organization_id),
                 (campaign_id, organization_id) ×5, execution-chain pairs ×3
```

| Attack | Prevented by |
|---|---|
| tenant A reads B's prospect | `FORCE ROW LEVEL SECURITY` on `canonical_leads`; tenant predicate on every accessor |
| tenant A writes against B's prospect | composite FKs + `ownedDbTable` tenant predicates |
| tenant A attaches a source record belonging to B | `source_records`/`source_assertions` carry `organization_id`; assertion reads are tenant-scoped |
| tenant A scores B's prospect | `prospect_score_evaluations` keyed on `organization_id`; evaluation conflict target includes it |
| tenant A enriches B's prospect | enrichment is tenant-scoped — and makes no provider call at all |
| tenant A alters B's lifecycle | lifecycle ledger is tenant-scoped and append-only |
| **tenant A merges identities across tenants** | composite FK `(id, company_id)` on the `unified_persons` merge path — structurally impossible |
| **tenant A uses another tenant's ICP** | **`FOREIGN KEY (icp_id, organization_id)`** — structurally impossible |

**No Drishiq Labs special case exists anywhere in the PI spine.** I looked specifically and
found none; none may be introduced.

Static evidence only; no tenant-crossing attempt was executed against any live database in
this audit.

---

## 5. §7 — the ICP chain

**The AI-proposes / human-ratifies rule is enforced in code, not merely convention.**

`prospectIcp/evaluate.ts:206-209`:
> "RULE 1. No ratified ICP ⇒ no contribution at all. A draft or a proposal … an
> unratified version cannot be passed in without a deliberate cast."
> `if (!ratified) return abstain(subject, 'no_ratified_icp', null);`

| Question | Answer |
|---|---|
| enforced in code? | **YES** — the evaluator abstains without a ratified version |
| versions immutable? | status-gated: `default 'draft'`, exactly one `ratified` per tenant via a **partial** unique index, `ratified_by` required when ratified |
| can an old ICP affect current scoring? | **No** — one ratified version per tenant; evaluations key on `icp_version` so historical scores stay attributable to the version that produced them |
| can an unratified ICP be used for scoring? | **No** — RULE 1 |
| can tenants use another tenant's ICP? | **No** — `FOREIGN KEY (icp_id, organization_id)` |

**Trap recorded in the migration itself** (worth carrying forward): *"A PARTIAL UNIQUE INDEX
CANNOT BE INFERRED BY `ON CONFLICT`"* — PostgREST upserts against the ratified-version index
will not behave as expected.

---

## 6. §8 — Sales Navigator authority (PI-ADR-009)

**NOT IMPLEMENTED.** No `ADR-009` reference exists in PI code (the only "ADR-009" hit is an
unrelated content-learning ADR). There is **no source precedence, no recency arbitration and
no confidence arbitration** anywhere in the canonical write path.

The canonical writer `decideCanonicalUpdates` (`ingestionBoundary.ts:330`) takes only
`(canonicalRow, liveAssertions, allowedColumns)`. Its assertion query selects
`id, attribute, normalized_value` — it **does not even read** `confidence` or `observed_at`,
though both columns exist. The three rules are:

```
allowed-column filter   never write outside LI-1's attribute surface
RULE C                  never overwrite a value that is already canonical
RULE B                  sources disagree (>1 distinct value) → retain evidence, write nothing
otherwise               fill the empty field
```

And the module states the reason outright: *"LI-2 deliberately implements the WEAKEST rule
that is still useful, because anything stronger is a precedence policy and precedence is a
product decision."*

**Is there a field where a less-authoritative source can overwrite a Sales
Navigator-authoritative field?** **No — but only because nothing can overwrite anything.**
The §8 risk as posed cannot occur today. The rule is unimplemented rather than violated.

**The real exposure is the mirror image, and it is worse:** the *first* writer of any
attribute wins **permanently**. A wrong or stale title, captured once, cannot be corrected
by a fresher, more confident, more authoritative source. PI-ADR-009 must exist **before**
overwrite is ever enabled, and enabling overwrite without it would be the dangerous move.

---

## 7. §9 — enrichment

| Provider | Declared | Available | Implemented | **Called** | Tested | Production-ready |
|---|---|---|---|---|---|---|
| Apollo | yes (`adapters/apollo.ts`) | catalogue entry | adapter shape only | **NO** | shape-level | **no** |
| Clearbit | yes (`adapters/clearbit.ts`) | catalogue entry | adapter shape only | **NO** — `clearbit.ts:14` notes calling `fetch()` would require a tenant key | shape-level | **no** |
| LinkedIn / Sales Navigator | catalogue **label** + cost entry + extension bridge | n/a | **no adapter** | **NO** | — | **no** |
| any other | — | — | — | — | — | — |

**Zero outbound provider calls exist in `backend/services/enrichment/`** — no `fetch`, no
`axios`, no `https.request`. The registry states it plainly
(`providers/registry.ts:5`): *"It performs no I/O and contacts no provider."*

What *is* built, and is genuinely substantial: the attempt/lease/retry machinery
(`attempts.ts`, `retryCandidates.ts`, `retryConsumer.ts`, `provider_call_states`), cost
governance (`cost.ts`, `spendCeiling.ts`), credential handling (`credentials.ts`), an
observation writer into `source_assertions` (`observations.ts`), a planner with no I/O and
an injected clock, and a typed outcome vocabulary that already includes `not_implemented`
and `credential_missing`.

So enrichment is **a complete harness with no engine**. The previous audit's finding stands
unchanged at HEAD.

---

## 8. §10–§11 — scoring and evaluation storage

**Scoring: IMPLEMENTED and FROZEN. Not modified.** `SCORING_RULES_VERSION = 'pi-score.1'`
(`intelligence/canonical/scoring.ts:44`). Weights per the brief — Intent 35 / Opportunity 30
/ Urgency 20 / ICP 15. I confirmed `BUYING_WEIGHT = 0.35` and that prioritization weights
live in the prioritization module; **I did not read all four weights in one place, so the set
is UNVERIFIED as a set.** A separate `METHOD_WEIGHT = {deterministic 1.0, probabilistic 0.8,
ai_reasoned 0.7}` governs evidence agreement and is a different axis.

**Evaluation storage is well-designed, and the §11 requirement holds:**

| Requirement | Finding |
|---|---|
| single writer / reader | **yes** — `leadUnderstanding/scoreEvaluationStore.ts` declares itself "The ONE writer and the ONE reader" |
| append-only | yes |
| tenant ownership | `organization_id` in the conflict target |
| idempotency digest | `evaluationInputDigest` — sha256 over the evaluation's material |
| conflict target | `(organization_id, prospect_id, icp_id, icp_version, rules_version, input_digest)` |
| score version | `rules_version` participates in identity |
| duplicate behaviour | returns `{written: false, duplicate: true}` — not an error |
| reproducibility | `asOf` is **deliberately excluded** from the digest, "because it moves on every tick" — otherwise every cron tick would forge a new row |
| **GET must not create evaluations** | **SATISFIED.** `prospectIntelligenceRead.ts:69` imports only `latestScoreEvaluationForIcp`, a read. No write, no persist call on the read path |

**Operational state:** the job is wired into cron (`cron.ts:1484`) but is **opt-in
flag-gated** — `prospectScoreEvaluationJob` documents that "absent the flag this returns
immediately having read nothing." So scoring persistence is implemented and inert.

---

## 9. §12 — lifecycle

**States (`prospectLifecycle/stateModel.ts`, `PROSPECT_LIFECYCLE_VERSION = 'pi.lifecycle.1'`):**
`identified → qualified → engaged → nurture → meeting_scheduled → not_interested → closed_disqualified`.

`PROSPECT_STATES_NOT_MODELLED` explicitly excludes `outreach_active`, `outreach_ready`,
`no_response`, `suppressed`, `candidate` — execution status is deliberately **not** lifecycle.
Several states the brief lists (`discovered`, `ingested`, `canonicalized`, `enriched`,
`evaluated`, `contacted`, `customer`, `archived`) **do not exist**, and per the brief I have
not invented them.

| Aspect | Finding |
|---|---|
| owner | `prospect_lifecycle_transitions`, an append-only ledger (PI-ADR-004) |
| transition authority | `lifecycleWriter`; typed evidence citation required by CHECK |
| audit trail | yes — append-only, with `is_initial`, `previous_state`, event key |
| illegal transitions | refused by the state graph + DB CHECKs |
| **initial-state guard** | **GAP CLOSED.** The migration records that the pre-existing trigger returned early for `is_initial`, so `state='meeting_scheduled', is_initial=true` **was ACCEPTED**. `20261029000000` adds a CHECK rejecting `is_initial AND state <> 'identified'`. Implemented as a CHECK, not a trigger, because it "is evaluated before the append-only and chain triggers" |
| automatic vs human | the vocabulary distinguishes them; `outcomeInterpreter` classifies dispositions as transition / conditional / needs-policy / not-lifecycle-bearing |
| suppression interaction | **deliberately separate** — see §10 |
| outreach / engagement interaction | **none today** — no producer (§11) |

---

## 10. §13 — archive / delete / DNC / suppression

**The three concepts are preserved as distinct, and the "multiple competing suppression
models" condition resolves more favourably than the previous audit implied.**

Two models exist, and they are **layered, not competing**:

| Model | Role |
|---|---|
| `contact_governance_records` + `prospectIdentity/contactGovernance.mayContact` | **CANONICAL and AUTHORITATIVE.** `execution/suppressionService.ts:44`: "Every governance RULE lives in `prospectIdentity/contactGovernance.mayContact`". The evaluator is **pure** — "performs no I/O … reads no database"; the caller loads records |
| `outreach_suppressions` | **LEGACY, additive-only, transitional.** `governance.ts:185`: it "remains readable until Path A's removal conditions are met. They cannot override a canonical block; they can only add one" |

Fail-closed posture is explicit: *"A read FAILURE is reported by the loader as a canonical
block, never as an absent verdict."*

**Archive vs delete vs DNC:** archive is an operational lifecycle concern, deletion has its
own path (`personErasure.ts`, `erasurePlan.ts`), and DNC/suppression is contact governance.
No service conflates them in what I examined. **"AI may recommend archival, AI must not
autonomously archive"** — consistent with `outcomeInterpreter`'s needs-policy disposition
and the ledger's human-ratification posture, though I found **no explicit code guard naming
archival authority** — classified **UNVERIFIED**.

---

## 11. §14–§15 — the outreach boundary, both directions

### Outbound (§14) — works, but PI has no readiness gate

| Question | Finding |
|---|---|
| what makes a prospect outreach-ready? | **NOT a PI concept.** No `outreachReady` surface exists in PI. Readiness is effectively "a campaign selected it" — `campaignSelectionService` → `prospect_campaign_targets` → Execution Instance → 040 bridge |
| suppression checked? | **yes** — Common Outreach gate 2, canonical verdict authoritative |
| eligibility checked? | **yes** — gate 4; ratified decision 020: zero-evidence prospects **are** eligible |
| approval policy respected? | yes — additive composition, `execution_mode` + `requires_approval` |
| canonical person resolved? | **yes** — `personAnchor.resolveSubjectPersonId`; the 040 bridge requires `person_id` and refuses on unresolved |
| execution uses the canonical prospect? | yes — `subject_id` + `person_id`, and `subject_kind` is never inferred |
| idempotent handoff? | **yes** — `outreach_bridge_handoffs UNIQUE (organization_id, execution_task_id)` |
| tenant ownership survives? | yes — every hop carries the tenant, with composite FKs |
| provenance retained? | partially — the handoff carries campaign, workflow, version, instance, plan, step, subject, person, mode and policy source. Attribute-level provenance does not travel with it |

### Inbound (§15) — **the loop does not close**

| Probe | Result |
|---|---|
| importers of `prospectLifecycle/*` outside the module | **zero** |
| callers of `recordTransition` / `lifecycleWriter` | **zero** outside the module |
| does `feedbackIngestion` reference any PI table? | **no** |

So: outcomes are recorded in Common Outreach's own tables (`outreach_outcomes`,
`outreach_delivery_evidence`) and **stop there**. PI cannot learn from delivery, bounce,
reply, qualification or conversion. The chain
`Engagement → outcome → prospect → lifecycle → intelligence` **does not exist**.

Two compounding facts from adjacent audits: `ingestFeedback` only acquired a producer in
ENG-003 (the SES provider-event route, not yet runtime-verified against a live provider),
and `opened`/`clicked`/`meeting_booked` are declared unobservable. So even once a producer
exists, the learnable signal set is narrow.

---

## 12. §16–§17 — provenance and freshness

**Provenance: the model is excellent and it is genuinely written.**
`source_assertions` carries `provider`, `confidence`, `observed_at`, `recorded_at`,
`value_hash`, `superseded_at`, `applied_to_canonical_at`, `applied_reason`, with a coherence
CHECK tying the last two together. `ingestionBoundary.ts:442` sets
`applied_to_canonical_at` + `applied_reason` for exactly the assertion that became canonical
— step 7 of a documented 7-step pipeline.

So *"Why does Omnivyra believe this prospect has this attribute?"* **is answerable** for any
attribute that arrived through the LI-2 ingestion boundary: you can name the provider, the
source record, the raw and normalized value, when it was observed, and why it was applied.

**Where provenance is lost:**
- attributes written by paths that bypass the boundary — `canonical_leads.lead_metadata`
  shapes written directly by the two canonical writers;
- `unified_persons.external_keys` (a jsonb with no provenance, no confidence, no
  verification state) versus `identity_claims` (which has all three). A dual-write and a
  shadow module (`externalIdentityDualWrite.ts`, `externalIdentityShadow.ts`) indicate a
  migration in flight;
- anything crossing the 040 handoff: attribute provenance does not travel to execution.

**Freshness: recorded, never used.** `observed_at` and `confidence` exist on every
assertion and are **not read** by the canonical decision. Combined with RULE C, the
behaviour is:

> A stale value cannot be *outranked* by a fresh one — it simply cannot be replaced at all.

That is safer than bad arbitration and worse than good arbitration. There is no stale-data
detection, no refresh requirement and no overwrite rule, because there is no overwrite.

---

## 13. §18 — identity resolution

| Aspect | Finding |
|---|---|
| match keys | **deterministic sequence: email → phone → `external_keys`** (`identityResolutionService:148`) |
| tenant safety | every lookup carries `.eq('company_id', companyId)`; a `23503` is "CLASSIFIED and logged rather than swallowed — a tenant-FK bug" |
| probabilistic matching | **none.** Deterministic only |
| match confidence | **not scored** on the resolution itself (`matchedBy` records *how*, not *how certain*) |
| ambiguous matches | first-match-wins by key precedence; no ambiguity queue on this path |
| duplicate candidates | `person_duplicate_candidates` references candidates and "never copies a payload, so there is exactly one" authoritative record |
| merge authority | `unified_person_merges`; `status ∈ {active, merged, suppressed, archived}`, `merged_into_id`, merge-coherence CHECK, no-self-merge CHECK |
| cross-tenant merge | **impossible** — composite FK `(id, company_id)` |
| source provenance survives merge | by reference, since duplicates do not copy payloads |
| reversible / auditable | merge table exists; **reversibility UNVERIFIED** |

**Can duplicates bypass identity resolution?** Not on the three implemented ingestion paths
— all require a resolved person. The live risk is the `external_keys` / `identity_claims`
duality: a channel identity written into the unconstrained jsonb rather than the CHECKed
claims table would be a second identity store.

Previous evidence cited "24 persons / 43 claims, 19 canonical leads exercised." I did
**not** re-verify those counts — no database with PI data was available to this audit and no
production read is authorized. **UNVERIFIED.**

---

## 14. §19 — evidence matrix

Tiers: **Code** = implemented · **Unit** = unit-tested · **Integration** = real-schema
(PostgreSQL) suite · **Runtime** = executed against a live engine/service in this programme ·
**E2E** = whole-chain exercise · **Production** = verified in production.

| Capability | Code | Unit | Integration | Runtime | E2E | Production |
|---|---|---|---|---|---|---|
| Identity resolution | ✅ | ✅ | ✅ (`b1_social_contact_identity`, `li5b_external_identity_shadow`) | — | ❌ | ❌ |
| Canonicalization / ingestion boundary | ✅ | ✅ | ✅ (`a4y_attribute_set_identity`) | — | ❌ | ❌ |
| Dedup / merges | ✅ | ✅ | partial | — | ❌ | ❌ |
| Source records / assertions | ✅ | ✅ | ✅ | — | ❌ | ❌ |
| Tenant isolation (composite FKs) | ✅ | ✅ | ✅ | ✅ (ENG-004 proved this pattern on PG 17.6) | ❌ | ❌ |
| ICP model + ratification | ✅ | ✅ | ✅ (`pi_offerings_009`) | — | ❌ | ❌ |
| ICP fit evaluation | ✅ | ✅ | partial | — | ❌ | ❌ |
| Composite scoring (`pi-score.1`) | ✅ | ✅ | partial | — | ❌ | ❌ |
| Score evaluation persistence | ✅ | ✅ | ✅ | — | ❌ | ❌ (job flag OFF) |
| Lifecycle ledger + guards | ✅ | ✅ | ✅ | — | ❌ | ❌ |
| Contact governance / `mayContact` | ✅ | ✅ | ✅ | — | ❌ | ❌ |
| Campaign targets / selection | ✅ | ✅ | ✅ (`pi_campaign_targets_029`, `pi_campaign_selection_030`) | — | ❌ | ❌ |
| Execution chain (instance→plan→task) | ✅ | ✅ | ✅ (`033`, `034`, `036`, `037`) | — | ❌ | ❌ |
| 040 outreach bridge | ✅ | ✅ | ✅ | — | ❌ | ❌ |
| Email send path | ✅ | ✅ | ✅ (`pi_email_send_path_041a`) | ❌ | ❌ | ❌ (flag OFF, function undeployed) |
| **Enrichment providers** | harness only | shape | — | **❌ never called** | ❌ | ❌ |
| **Source arbitration / PI-ADR-009** | **❌ absent** | — | — | — | ❌ | ❌ |
| **Outcome → lifecycle feedback** | **❌ absent** | — | — | — | ❌ | ❌ |
| MarketPulse / Sales Navigator / Active Leads ingestion | **❌ absent** | — | — | — | ❌ | ❌ |

Coverage is substantial where code exists: **154 PI-ish unit suites** and **48 real-schema
suites**, at least 12 of them PI. **No suite exercises the whole spine** — there is no
end-to-end PI test, which is the §22 answer.

---

## 15. §20 — dead / orphaned capabilities

Nothing was deleted. Each item below is characterized, not condemned.

| Item | Assessment |
|---|---|
| `lead_intelligence` | **zero writers.** Read-only legacy. Likely genuinely dead as a write target; readers may still exist |
| `active_leads` | **zero writers.** Same |
| `leads` + `leadService` | **NOT dead** — reachable via `leadCaptureService` (website capture, inbound webhooks). A *different entity*, not a duplicate |
| `enrichment/providers/adapters/{apollo,clearbit}` | **not dead, not alive** — shapes awaiting an engine |
| `prospectScoreEvaluationJob` | wired to cron, **inert by flag**. Not orphaned |
| `externalIdentityShadow` / `externalIdentityDualWrite` / `shadowResolver` | migration-in-flight scaffolding, deliberate |
| MarketPulse as a prospect enrichment source | declared `available: false` — an honest declaration, not an orphan |

---

## 16. §21 — bypass matrix

| Bypass | Possible? | Evidence |
|---|---|---|
| create a prospect without canonicalization | **NO** | both `canonical_leads` writers require a resolved `unified_person_id` |
| update a canonical prospect without provenance | **YES, partially** | the two canonical writers write `lead_metadata` directly, outside the LI-2 assertion/provenance pipeline |
| enrich without tenant context | **NO** | enrichment is tenant-scoped — and makes no call at all |
| score without canonical identity | **NO** | evaluations key on `prospect_id` + `organization_id` |
| score without a ratified ICP | **NO** | evaluator abstains (`no_ratified_icp`) |
| bypass suppression | **NO** | canonical verdict authoritative; read failure = block; legacy booleans can only add a block |
| bypass lifecycle authority | **NO writer exists to bypass** — and that is the §15 gap, not a safeguard |
| bypass identity resolution | **NO** on implemented paths; **RISK** via `external_keys` jsonb instead of `identity_claims` |
| **bypass source arbitration** | **N/A — there is no arbitration to bypass** (§6) |
| bypass tenant isolation | **NO** | composite FKs + RLS + tenant predicates |
| write directly to legacy lead tables | **YES, by design** | `leadService` writes `leads` for web capture; a different entity, documented |

---

## 17. §22 — is the complete flow executable?

**No.** Three breaks, in order of position along the chain:

```
Source ──────────────── ✅ for CRM / CSV / manual;  ❌ for MarketPulse, Sales Navigator, Active Leads
Ingestion ───────────── ✅
Source Record ───────── ✅
Identity Resolution ─── ✅
Canonical Prospect ──── ✅
Account/Person link ─── ✅
Enrichment ──────────── ❌  BREAK 1 — harness exists, no provider is ever called
                            (and arbitration would withhold the result anyway)
ICP Fit ─────────────── ✅
Composite Score ─────── ✅  (persistence implemented, job flag OFF)
Lifecycle ───────────── ✅ as a ledger; ❌ no producer drives it
Outreach Readiness ──── ❌  BREAK 2 — not a modelled PI concept; readiness == campaign selection
Common Outreach ─────── ✅  (email transport flag OFF, Edge Function undeployed)
Outcome ─────────────── ✅ recorded in Common Outreach
Lifecycle / PI feedback ❌ BREAK 3 — no path back into PI at all
```

A prospect can be ingested, canonicalized, scored against a ratified ICP, selected into a
campaign, executed through Common Outreach and have its outcome recorded. It **cannot** be
enriched, cannot be declared outreach-ready by PI, and its outcome **cannot** inform its
lifecycle or its next score.

---

## 18. What prevents PI from being considered complete

| # | Blocker | Severity | Nature |
|---|---|---|---|
| **B1** | **No source arbitration** — fill-only-if-empty, never overwrite; `confidence`/`observed_at` recorded but unread. PI-ADR-009 unimplemented | **CRITICAL** | **product decision first**, then implementation |
| **B2** | **No enrichment provider is ever called** | **CRITICAL** | implementation (blocked by B1 for value) |
| **B3** | **No outcome → PI feedback** | **CRITICAL** | implementation |
| B4 | Only 3 of the approved source families ingest | HIGH | implementation |
| B5 | No PI outreach-readiness concept | HIGH | product decision |
| B6 | Scoring job inert (flag off) + only `icp_key='default'` is scored (per prior audit; **UNVERIFIED** here) | MEDIUM | activation + verification |
| B7 | `external_keys` vs `identity_claims` duality | MEDIUM | consolidation |
| B8 | Provenance does not survive the two direct canonical writers, nor the 040 handoff | MEDIUM | consolidation |
| B9 | Legacy suppression dual-read still live | LOW | documented transition with a stated removal condition |
| B10 | No end-to-end PI suite | MEDIUM | test |

---

## 19. Critical path

**The sequencing constraint that matters:** B2 before B1 is wasted work. Providers would
write assertions that RULE C withholds (the attribute is already set) or RULE B abstains on
(sources disagree). **Decide arbitration first.**

### Sequential — must be in this order

1. **B1a — ratify the arbitration policy** (product decision, no code). Define PI-ADR-009
   concretely: Sales Navigator authoritative for title and company; everything else recency
   then confidence; and what happens when a source disagrees with a canonical value. This is
   the single decision that unblocks the most work.
2. **B1b — implement arbitration** at the ingestion boundary: read `confidence` and
   `observed_at` (already present), add source precedence, replace RULE C's absolute
   withhold with a policy-governed overwrite that records `superseded_at`.
3. **B2 — implement one enrichment provider end to end** behind the existing harness, flag-
   gated. The harness (attempts, leases, retries, cost ceiling, credentials, observations) is
   already built, so this is an adapter plus a credential path, not a subsystem.
4. **B6 — activate scoring** on a pilot tenant and verify evaluations land once per genuine
   input change (the digest should make cron ticks free).

### Parallel — independent of the above

- **B3 — outcome → lifecycle producer.** Deterministic transitions only; `replied → engaged`
  is the obvious first edge. Independent of arbitration. *Depends on ENG-003's provider-event
  producer being runtime-verified first, otherwise there are no outcomes to consume.*
- **B4 — ingestion adapters** for the missing source families, through the existing registry
  and boundary. Each is a `translate()` implementation; the registry already refuses
  unregistered sources loudly.
- **B10 — an end-to-end PI suite** on the real-schema harness, which now has a proven
  non-Docker PostgreSQL route.
- **B7 — `external_keys` → `identity_claims` consolidation**, continuing the existing
  dual-write/shadow migration.

### Can be done immediately, cheaply

- **B5** — write down what outreach-readiness means (a definition, not code).
- **B9** — record the removal condition for the legacy suppression read as a tracked item.
- **B8** — route the two direct canonical writers' attribute writes through the LI-2 boundary
  so provenance stops being lost.

### Minimum critical path to "complete D22"

```
B1a (decision)  →  B1b (arbitration)  →  B2 (one provider)  →  B6 (activate scoring)
        ∥ B3 (feedback)      ∥ B4 (adapters)      ∥ B10 (E2E suite)
```

**Four sequential steps, three parallel tracks.** The gating item is a decision, not code —
which is the most useful thing this audit can tell you, because it is also the cheapest to
act on.

---

## 20. Statuses and limits of this audit

**VERIFIED by repository evidence:** the spine inventory; writer sets for the four lead
tables; the three implemented adapters and the registry's own statement that no provider
adapter exists; zero outbound provider calls in enrichment; ICP ratification enforcement;
the exact canonical-update rules; score-evaluation idempotency and the absence of GET side
effects; the lifecycle state set and the closed initial-state guard; the layered suppression
authority; composite tenant FKs; identity resolution's deterministic tenant-scoped sequence;
zero producers into lifecycle; test-tier counts.

**UNVERIFIED:** the four scoring weights as a set (I read two sources, not one place);
`icp_key='default'`-only scoring; the earlier "24 persons / 43 claims / 19 canonical leads"
counts; whether `crmIngestionService` honours `prospectResolution`'s NULL-`lead_status`
posture; merge reversibility; production reachability of the legacy `leads` capture path; any
explicit code guard on archival authority; whether CSV ingestion has ever been exercised end
to end.

**NOT DONE:** no implementation, no migration, no schema change, no deletion, no deployment,
no production read, no tenant-crossing attempt against a live database, no scoring-engine
change, no Docker start. Regionalization and Digital Snapshot were excluded as instructed.

---

**Production status: UNTOUCHED.** Repository status: **READ-ONLY — this report is the only
file added.** HEAD `7febdb28`, 437 migrations, nothing committed.
