# D22-B1a — PROSPECT INTELLIGENCE SOURCE ARBITRATION
## OWNER DECISION GATE — READ-ONLY

| | |
|---|---|
| **Gate type** | Owner decision / architecture gate. Read-only. |
| **Date** | 2026-10-05 |
| **Code inspected** | `C:/tmp/pi-consol` @ `7febdb28`, 437 migrations. The same tree and commit the D22 audit used. |
| **Baseline audit** | `D22-PROSPECT-INTELLIGENCE-GAP-AUDIT.md` (this repository). **Naming note:** the brief refers to `D22-PI-COMPLETE-GAP-AUDIT.md`; no file of that name exists. The audit delivered for D22 is the file named above, and it is the baseline used here. |
| **Mutations performed** | **None.** No source, test, migration, schema, fixture, config or data was changed. No database was contacted. No provider was called. Docker was not started. |
| **Scope** | B1a only: the arbitration **policy** decision. No implementation. |
| **Line numbers** | Working-tree line numbers. This worktree carries **uncommitted work from prior PI gates**, so it is `7febdb28` plus local modifications. Of the 13 files cited by line, **12 are byte-identical to `HEAD`**; `backend/services/crmIngestionService.ts` differs from `HEAD` (a legacy-lead path was removed at lines 13 / 97-143 / 434), but the block cited here is **identical to `HEAD` over a 50-line window** and sits at `HEAD` line 330. No file was changed by this gate — see Appendix C. |

> **Status vocabulary.** **RATIFIABLE** = supported by repository evidence, ready for the owner to accept. **OWNER DECISION REQUIRED** = genuinely cannot be resolved from existing architecture or evidence. **NOT RATIFIABLE** = the brief proposes it, and repository evidence does not support it as an operative rule today. **OUT OF SCOPE — separate D22 gate** = per brief §14.

---

## Contents

1. Decision Summary
2. Existing Evidence
3. Attribute Authority Matrix
4. Arbitration Algorithm
5. Timestamp Semantics
6. Confidence Semantics
7. Conflict Semantics
8. Supersession Semantics
9. Provenance Requirements
10. Safety Properties
11. B1b Implementation Contract
12. Open Owner Decisions
13. Dependency Impact

Appendix A — Scope corrections to the brief
Appendix B — Defects discovered during this gate (recorded, NOT fixed)
Appendix C — Files inspected, with content hashes

---

## 1. Decision Summary

### 1.1 The proposed policy in one paragraph

**Canonical attribute values become a DERIVED projection of the live assertion set, not a value latched by whoever wrote first.** Arbitration runs per `(tenant, entity, attribute)` over live `source_assertions`, and resolves in a fixed order: **identical values collapse → declared source authority → recency → confidence as a tie-break only → otherwise no winner**. A winner replaces a differing canonical value **only when the current canonical value is itself attested by a live assertion**; an unattested incumbent (a value that predates or came from outside the evidence layer) is never overwritten. Nothing is ever deleted: the losing assertions stay live, the superseded canonical decision is recorded, and every canonical value can name the assertion that produced it and the rule that chose it.

### 1.2 The five decisions, compactly

| # | Decision | Status |
|---|---|---|
| **D-1** | **Arbitration timestamp = `COALESCE(source_assertions.observed_at, source_assertions.recorded_at)`.** Never `ingested_at`, `first_seen_at`, `last_seen_at` or `created_at`. | **RATIFIABLE** — the repository already ratified exactly this fallback in `observations.ts` (§5) |
| **D-2** | **Recency is primary; confidence is a tie-break only, and only when every tied candidate states one.** A missing confidence is never treated as low. No magnitude threshold, no cross-provider normalization, no confidence override of recency. | **RATIFIABLE** — forced by the evidence in §6: confidence is record-level, provider-stated, and demonstrably not comparable across providers |
| **D-3** | **Source authority is declared as DATA (tenant-scoped, per attribute), evaluated before recency, and passed into a pure arbitration function.** No provider name may appear in arbitration code. | **RATIFIABLE** — required by `source_records.provider` being deliberately free text, and by an existing frozen test that bans provider names in the boundary (§2.6) |
| **D-4** | **RULE C ("never overwrite") is replaced by re-arbitration, with one guard: an `unattested_incumbent` canonical value is never overwritten.** A winner may replace an attested canonical value; the replaced decision is recorded, never erased. | **RATIFIABLE as a recommendation**; the owner must accept the change of behaviour, because today's RULE C is deliberate and frozen |
| **D-5** | **No source loses authority, and no assertion stops being live, merely by becoming old.** Staleness is reported (WS-7 freshness), never arbitrated. Supersession is caused only by the same source record later asserting a different value. | **RATIFIABLE as a recommendation**; a staleness/TTL policy would be a silent precedence rule, so if the owner wants one it must be declared explicitly (§12 O-4) |

### 1.3 The Sales Navigator rule: NOT RATIFIABLE as an operative rule

The brief states the existing intended rule as *"Sales Navigator is authoritative only for title + company."* Repository evidence does not support ratifying that as an operative rule, for three independent reasons:

1. **No Sales Navigator source exists.** `dataSourceCatalogue.ts:98-104` records `linkedin_sales_navigator` as `available: false`, `requires: ['oauth','provider_terms_review']`, note: *"Declared only. Existing LinkedIn support covers publishing and engagement, not prospect discovery."* `PI-P1-W02-SOURCE-ADAPTER-SPEC.md:73` records it as *"deferred — legal/terms gate"*. No adapter exists and no writer anywhere sets `source_records.provider` to a Sales Navigator key.
2. **`company` is not an attribute.** A person's employer is `account_id`, a resolved relationship owned by identity/account resolution — not a column on the arbitrable attribute surface. Giving a source authority over it would be an identity-resolution change, which brief §14 places **OUT OF SCOPE — separate D22 gate**.
3. **A provider-named rule cannot live in the arbitration code.** `source_records.provider` is free text on purpose (*"a new provider must never need a migration"*), and `prospectIdentityIngestionBoundary.test.ts:239-244` actively fails the build if `ingestionBoundary.ts` contains `PROVIDER_PRIORITY`, `providerRank`, a quoted provider name, or `precedence =`.

**What can be ratified instead:** the *mechanism* (D-3) plus a **pre-declaration** — when and if a Sales Navigator adapter is authorised, its authority declaration is seeded as authoritative for **`job_title` only**, and for nothing else. That declaration is **vacuous until the adapter exists**, which is the honest status today. The six questions in brief §4 are answered against that declaration in §3.3.

### 1.4 The one thing this gate changes about the audit's picture

The audit established that *the first writer of any attribute wins permanently.* This gate adds a second, compounding finding the audit did not record:

> **`source_assertions.superseded_at` has zero writers.** It is read in four places and written in none (§2.5). So "live evidence" today means *every assertion ever recorded*, and RULE B's disagreement is **monotonic and permanent**: once two sources have ever disagreed about an attribute, that attribute can never be filled by any later evidence — including the case where one source subsequently corrects itself to agree.

Supersession is therefore not an optional refinement for B1b. Without it, arbitration has no way to retire a withdrawn claim, and adding authority or recency rules on top of a never-shrinking candidate set would produce a winner chosen partly from claims the source no longer makes.

---

## 2. Existing Evidence

Every claim below was read in the tree at `7febdb28`. Hashes in Appendix C.

### 2.1 The evidence layer (schema)

`supabase/migrations/20261002000000_li2_source_records.sql` creates the two-tier model and states its own purpose:

> *"The moment two providers disagree about a job title, one of them has to be discarded — and with nowhere to put the loser, the evidence is destroyed. This migration creates the layer that retains it."*

```
SOURCE -> source_records     (what a provider sent)
       -> source_assertions  (what it claimed, field by field)
       -> unified_persons / prospect_accounts (what we believe)
```

`source_assertions` columns relevant to arbitration:

| Column | Type / constraint | Arbitration relevance |
|---|---|---|
| `organization_id` | `uuid NOT NULL REFERENCES companies` | the tenant. Three composite tenant FKs. |
| `attribute` | `text NOT NULL`, not blank | arbitration is **already field-level** |
| `raw_value` / `normalized_value` | `text` nullable, at least one required | arbitration compares `normalized_value` |
| `value_hash` | `text NOT NULL`, sha256 shape | dedupe key: `(organization_id, source_record_id, attribute, value_hash)` UNIQUE |
| `provider` | `text NOT NULL`, free text | authority must be declared against this, as data |
| `confidence` | `numeric` **nullable**, `CHECK (confidence IS NULL OR (0 <= confidence <= 1))` | scale is pinned 0..1; nullable is legal |
| `observed_at` | `timestamptz` **nullable** | *"When the SOURCE says it observed this, which is not when we ingested it"* |
| `recorded_at` | `timestamptz NOT NULL DEFAULT now()` | always present — so the D-1 fallback has no null hole |
| `applied_to_canonical_at`, `applied_reason` | `timestamptz` / `text`, `CHECK ((applied_to_canonical_at IS NULL) = (applied_reason IS NULL))` | *"Together they answer 'which value is canonical, and why'"* |
| `superseded_at` | `timestamptz` nullable | *"Superseded, never deleted."* — **no writer exists** (§2.5) |

The migration is explicit about what it withheld: *"No source-ranking or precedence policy. LI-2 builds the mechanism that makes precedence expressible and stops there."*

### 2.2 The current decision function

`backend/services/prospectIdentity/ingestionBoundary.ts` — *"THIS IS THE ONLY PLACE CANONICAL ATTRIBUTES MAY BE WRITTEN FROM SOURCE DATA."* Header, verbatim:

> *"LI-2 deliberately implements the WEAKEST rule that is still useful, because anything stronger is a precedence policy and precedence is a product decision this phase is forbidden to make"*
>
> *A. canonical value is NULL, and exactly ONE distinct live value is asserted across all sources → apply it. reason: `single_uncontested_assertion`*
> *B. canonical value is NULL, and sources DISAGREE → apply nothing.*
> *C. canonical value is already set → never overwrite. Re-arbitration belongs to LI-6.*
>
> *"There is no provider ranking, no recency preference, no confidence weighting and no 'Apollo beats CRM'."*

`decideCanonicalUpdates` (`:330-368`) takes exactly three arguments and reads **only** `{ id, attribute, normalized_value }` from each assertion. `confidence`, `observed_at`, `recorded_at`, `provider` and `superseded_at` are **not passed in at all** — `superseded_at` is applied as a filter by the caller at `:418` (`.is('superseded_at', null)`), and the other three never reach the function. The audit's statement that the decision does not read confidence or observed_at is confirmed, and is stronger than stated: the function cannot read them, because they are not in its input type.

`LI-6` is named twice as the home of re-arbitration (`:39`, `:375`) and **does not exist anywhere in the repository** — the only other hit is a test comment.

### 2.3 Where arbitration is reached from

Four live call sites feed `ingestSourceRecord`:

| Writer | `provider` value | `observedAt` | `confidence` |
|---|---|---|---|
| `leadIngestion/orchestrator.ts:402, 449` | `record.source` (the ingestion source) | `record.observedAt` | `record.confidence` |
| `crmIngestionService.ts:314` | the CRM provider | `params.observedAt` | **not supplied → null** |
| `enrichment/providers/persistence.ts:202-231` (`makePersistObservation`) | `input.providerId` | `input.observedAt` | **first field that happens to state one** (§6.2) |
| `enrichment/providers/extensionBridge.ts:348-364` | `EXTENSION_SOURCE_ID` | `normalized.observedAt` | **explicitly `null`** — *"The extension states no confidence, so none is invented."* |

`enrichment/service.ts:229` sets the record-level `observedAt` to `result.provenance[0]?.observedAt ?? null` — **the first attribute's** timestamp, applied to every assertion in the record.

### 2.4 The second consumer of `decideCanonicalUpdates`

`backend/services/prospectIdentity/accountIntelligence.ts:428` (WS-7) calls the same pure function with a **deliberately empty canonical row**, and explains why:

> *"The canonical row passed in is EMPTY on purpose. With the real row, RULE C ('never overwrite a value already set') fires first and reports `canonical_value_already_set`, hiding whether the sources actually agree. An empty row disables RULE C, leaving RULE B as the only reason anything is withheld — which is exactly the disagreement question WS-7 is asking."*

It then filters on the **exact literal** `reason === 'sources_disagree'`. `enrichment/result.ts:224` (`markConflicting`) does the same, and `piWs2EnrichmentPlanner.test.ts:378-387` pins both the `sources_disagree` and `canonical_value_already_set` strings.

**Consequence for B1b:** `sources_disagree` and `canonical_value_already_set` are a published vocabulary with external consumers and tests. New reasons may be **added**; those two may not be renamed or repurposed, and the empty-canonical-row calling convention must keep working.

### 2.5 `superseded_at` has no writer

```
read:    enrichment/providers/observations.ts:136   .is('superseded_at', null)
         prospectIdentity/accountIntelligence.ts:365 .is('superseded_at', null)
         prospectIdentity/ingestionBoundary.ts:418   .is('superseded_at', null)
         realschema/li2_source_records.test.ts:238   WHERE ... superseded_at IS NULL
write:   (none)
```
Every other `superseded_at` hit in the repository belongs to a different table (`prospect_icp_versions`, `governance_policy`). The migration's promise — *"A value that later changes at the same source inserts a new row and the previous one is marked superseded, never deleted"* — is **half implemented**: the new row is inserted, the old one is never marked.

### 2.6 The frozen no-precedence guard

`backend/tests/unit/prospectIdentityIngestionBoundary.test.ts:239-244`:

```ts
it('the boundary invents no provider precedence', () => {
  const src = readFileSync(join(ROOT, 'services/prospectIdentity/ingestionBoundary.ts'), 'utf8');
  for (const forbidden of [/PROVIDER_PRIORITY/, /providerRank/i, /['"]apollo['"]\s*[:>]/i, /precedence\s*=/i]) {
    expect(src).not.toMatch(forbidden);
  }
});
```

Three more pinned behaviours in the same file that B1b must consciously revisit rather than trip over:
- `:100-106` — *"does not silently pick the first, the newest, or a preferred provider"*: three disagreeing values must yield zero applications. **Introducing recency makes this test false by design.** It must be rewritten deliberately, as a decision, not deleted as a nuisance.
- `:124-128` — *"treats an empty string as set — re-arbitration is LI-6, not here"*: `canonical.city === ''` currently blocks a write.
- `:132-139` — identity columns (`primary_email`, `company_id`) can never be written through the boundary.

### 2.7 Existing timestamp precedent

`backend/services/enrichment/providers/observations.ts:92-96`, verbatim:

> *"Newest usable evidence per attribute. `observed_at` is the provider's own timestamp and is preferred; `recorded_at` is when WE received it and is the fallback, because a provider that supplies no timestamp still gave us evidence at a knowable moment."*

implemented as `const stamp = row.observed_at ?? row.recorded_at;` with a newest-per-attribute reduction. This is already in production use for the enrichment re-observation window. **D-1 ratifies an existing repository rule rather than inventing one.**

### 2.8 Existing confidence precedent

`accountIntelligence.ts:456-458`, verbatim:

> *"The attribute's confidence is the strongest any source stated. A source that stated none contributes nothing rather than a zero."*

This is the repository's established treatment of a missing confidence, and D-2 adopts it.

### 2.9 The unattested-incumbent concept already exists

`accountIntelligence.ts` computes `missing` (no canonical value) and **`unattested`** (a canonical value with no assertion evidence behind it) as separate reported states. D-4's guard reuses that existing concept rather than introducing a new one.

### 2.10 What the architecture does and does not say about authority

`docs/database/canonical-identity-guarantees.md:110-120` (R1 — Multi-source ingestion), verbatim:

> *"Sources will eventually include Omnivyra-native capture, Apollo, LinkedIn / Sales Navigator where permitted, RapidAPI-backed providers, other API providers, CRM, Excel / CSV, and manual entry.*
>
> ***No provider may become the canonical identity system.*** *Every provider is evidence, recorded as a claim with its own `source` and `source_reference`. The canonical person and account remain Omnivyra's, tenant-scoped, so that losing or replacing a provider never destroys identity."*

This is the only architectural statement about provider standing, and it is a **constraint on authority, not a grant of it**: a source may be declared authoritative for an attribute, and it may never become the identity system. No document in the repository names any source as authoritative for any prospect attribute. A full-text search for an authority statement over `job_title`, `title` or `company` returns nothing in `docs/pmo/prospect-intelligence/`, `docs/database/`, `backend/services/prospectIdentity/` or `backend/services/enrichment/`.

Also present and dormant: `unified_persons.source_of_truth` and `unified_persons.source_priority JSONB` (migration `20260506000001`). `source_priority` has **zero readers and zero writers** anywhere in `backend/` or `pages/`. `source_of_truth` is read only by the email path (`emailExecutionContext.ts:165`, `emailSendPath.ts:165`) as a logged provenance label, never as a precedence input. **`source_priority` is a pre-existing, unused, entity-level column; it is the wrong shape for attribute-level authority and B1b must not quietly repurpose it** (see O-3).

---

## 3. Attribute Authority Matrix

### 3.1 The arbitrable surface, exactly

Arbitration can only concern attributes that (a) are in the allowed column list and (b) have an assertion path. Both lists are in code.

**Person** — `attributes.ts:362-368` (`PERSON_ATTRIBUTE_COLUMNS`), assertion path `ingestionBoundary.ts:251-263` (`pendingFromPerson`):

| Attribute | Authoritative source | Primary rule | Secondary rule | Conflict rule | Owner decision? |
|---|---|---|---|---|---|
| `full_name` | **none declared** | recency (D-1) | confidence tie-break (D-2) | unresolved; canonical untouched | — |
| `first_name` | **none declared** | recency | confidence tie-break | unresolved | — |
| `last_name` | **none declared** | recency | confidence tie-break | unresolved | — |
| `job_title` | **none declared today.** Pre-declared to Sales Navigator **if and when** an SN adapter is authorised (§1.3, §3.3) | declared authority, then recency | confidence tie-break | unresolved | **YES — O-1** (accept the pre-declaration) |
| `department` | **none declared** | recency | confidence tie-break | unresolved | — |
| `seniority` | **none declared** | recency | confidence tie-break | unresolved | — |
| `country_code` | **none declared** | recency | confidence tie-break | unresolved | — |
| `region` | **none declared** | recency | confidence tie-break | unresolved | — |
| `city` | **none declared** | recency | confidence tie-break | unresolved | — |
| `timezone` | **none declared** | recency | confidence tie-break | unresolved | — |

**Account** — `attributes.ts:370-381` (`ACCOUNT_ATTRIBUTE_COLUMNS`), assertion path `ingestionBoundary.ts:266-281` (`pendingFromAccount`):

| Attribute | Authoritative source | Primary rule | Secondary rule | Conflict rule | Owner decision? |
|---|---|---|---|---|---|
| `industry` | **none declared** | recency | confidence tie-break | unresolved | — |
| `employee_count` | **none declared** | recency | confidence tie-break | unresolved | — |
| `employee_band` | **none declared** | recency | confidence tie-break | unresolved | — |
| `country_code` | **none declared** | recency | confidence tie-break | unresolved | — |
| `region` | **none declared** | recency | confidence tie-break | unresolved | — |
| `city` | **none declared** | recency | confidence tie-break | unresolved | — |
| `description` | **none declared** | recency | confidence tie-break | unresolved | — |
| `annual_revenue` | **none declared** | recency | confidence tie-break | unresolved | — |
| `revenue_band` | **none declared** | recency | confidence tie-break | unresolved | — |
| `founded_year` | **none declared** | recency | confidence tie-break | unresolved | — |
| `technologies` | **none declared** | recency | confidence tie-break | unresolved | **YES — O-5** (it is a serialised JSON set, not a scalar; set-valued arbitration is a different question) |
| `funding_stage` | **none declared** | recency | confidence tie-break | unresolved | — |
| `last_funding_at` | **none declared** | recency | confidence tie-break | unresolved | — |

**Not arbitrable — no assertion path exists.** These six are in the allowed write surface and are normalised by `toPersonAttributes`/`toAccountAttributes`, but `pendingFromPerson`/`pendingFromAccount` do not map them, so no assertion can ever be created for them and `decideCanonicalUpdates` can never see them. The boundary is the only permitted writer, so they are **structurally unwritable today**:

| Attribute | Entity | Status |
|---|---|---|
| `authority`, `influence`, `buying_role` | person | in `PERSON_ATTRIBUTE_COLUMNS`, normalised, **no assertion path** — see Appendix B, defect 1 |
| `market`, `business_model`, `growth_stage` | account | in `ACCOUNT_ATTRIBUTE_COLUMNS`, normalised, **no assertion path** — see Appendix B, defect 1 |

**Not attributes — arbitration must never touch them.**

| Field | Why excluded | Reference |
|---|---|---|
| `attributes_source`, `attributes_updated_at` | provenance, not facts. Written by the boundary itself; WS-7 excludes them from the fact surface via `PROVENANCE_COLUMNS` | `accountIntelligence.ts:77` |
| `primary_email`, phone | **identity**, resolved by `identityResolutionService` (email → phone → `external_keys`). A test asserts the boundary cannot write `primary_email` | `prospectIdentityIngestionBoundary.test.ts:132-139` |
| the person's employer / "company" | `account_id`, a resolved relationship owned by account resolution (WS-1) | §1.3 reason 2 |
| `company_id` / `organization_id` | tenancy. Never arbitrable, under any declaration | `prospectIdentityIngestionBoundary.test.ts:132-139` |

**OUT OF SCOPE — separate D22 gate**, per brief §14: changing any of the four rows above would be an identity-resolution or tenant-isolation redesign.

### 3.2 Reading the matrix

Today, **every arbitrable attribute is source-neutral.** No source in the repository has established authority over any of them. That is the honest answer to brief §3.A, and it is not an evasion: it follows from there being exactly three live ingestion families (CRM, file/manual, extension) plus an enrichment executor with no registered provider, and no architectural document granting any of them precedence.

The matrix is therefore uniform by design, and the **mechanism** (D-3) is what the owner is being asked to ratify — so that the first authority declaration is a configuration change rather than a code change.

### 3.3 The six Sales Navigator questions

Answered against the **pre-declaration** in §1.3 (SN authoritative for `job_title` only), which is **vacuous until an SN adapter exists**. These answers bind the declaration mechanism, not today's runtime.

| # | Question | Answer |
|---|---|---|
| 1 | Can another source ever overwrite a Sales Navigator value? | **Only when SN has no live assertion for that attribute.** Authority restricts the candidate set before recency is consulted, so a non-SN value can win `job_title` only if SN has never asserted it, or its assertion has been superseded by SN itself. |
| 2 | Can a newer non-SN value supersede it? | **No.** Authority (step 4a) precedes recency (step 4b). Recency operates only *within* the authoritative candidate set. |
| 3 | What happens if Sales Navigator later changes? | SN's new claim is a new assertion; SN's own previous claim for that attribute is marked **superseded** (§8, rule S-1); SN remains authoritative; the canonical value follows SN. Both assertions survive. |
| 4 | What happens if Sales Navigator data becomes stale? | **Authority does not expire.** The last live SN assertion keeps winning. Staleness is *reported* through WS-7's existing freshness dimension, never arbitrated. A TTL would be a silent precedence rule — see **O-4** if the owner wants one. |
| 5 | What happens if SN and another source disagree? | SN wins by authority. The losing assertion stays live and is reported as `contested_under_authority` so the disagreement remains visible, but it does not block the write. **A disagreement under authority is not an unresolved conflict.** |
| 6 | What happens if SN stops supplying the field? | Supersession is caused only by the same source asserting a different value (§8), so SN's last claim stays live and SN keeps winning indefinitely. If the owner wants silence-to-cede-authority behaviour, that is **O-4**; the default is deterministic persistence. |

---

## 4. Arbitration Algorithm

Deterministic plain language, precise enough to implement without a further product interpretation. It runs **per `(organization_id, entity, attribute)`** and touches no other tenant, entity or attribute.

```
INPUTS
  tenant        organization_id                             (REQUIRED, never defaulted)
  entity        (entity_type, entity_id)                    person -> unified_persons
                                                            account -> prospect_accounts
  attribute     one column name
  candidates    the LIVE assertions for exactly this (tenant, entity, attribute):
                  superseded_at IS NULL
                  normalized_value IS NOT NULL
                  attribute IS IN the allowed column surface for entity_type
  canonical     the current value of that column on the canonical row,
                read under the tenant predicate
  attested      TRUE when at least one live assertion's normalized_value
                equals canonical
  authority     the tenant's authority declaration: for this
                (entity_type, attribute), the set of provider keys declared
                authoritative. Passed IN as data. MAY BE EMPTY.

STEP 0 — SCOPE
  If tenant is absent or blank -> REFUSE. (today's requireTenant, unchanged)
  Candidates from another tenant, entity or attribute are never considered.

STEP 1 — EMPTY EVIDENCE
  If candidates is empty -> NO DECISION. Canonical is untouched.
  This is not a conflict and is not reported as one.

STEP 2 — COLLAPSE BY VALUE
  Group candidates by normalized_value. Agreement between sources is value
  identity, exactly as today; the provider is irrelevant to the grouping.
  If exactly ONE distinct value remains:
      WINNER = that value
      REASON = 'single_uncontested_assertion'          (unchanged literal)
      -> STEP 5
  (This is brief §5 Case 6: identical values are never a conflict.)

STEP 3 — CONTESTED. Two or more distinct values.

STEP 4a — DECLARED AUTHORITY
  If authority is non-empty:
      restricted = candidates whose provider is in authority
      If restricted is empty:
          No authoritative source has spoken. Continue to STEP 4b over the
          FULL candidate set. Record note 'no_authoritative_assertion'.
      Else if restricted yields exactly ONE distinct value:
          WINNER = that value
          REASON = 'authoritative_source'
          Every non-winning live candidate is noted
          'contested_under_authority'.
          -> STEP 5
      Else:
          The authoritative source disagrees with ITSELF.
          Continue to STEP 4b over `restricted` ONLY.
          Authority narrows the field; it never widens it.
  If authority is empty: continue to STEP 4b over the full candidate set.

STEP 4b — RECENCY  (PRIMARY, D-1)
  arbitrationTime(a) = COALESCE(a.observed_at, a.recorded_at)
                       recorded_at is NOT NULL, so this is never null.
  For each distinct value, take the MAXIMUM arbitrationTime across the
  assertions carrying it.
  Let T = the maximum of those per-value maxima.
  If exactly ONE distinct value attains T:
      WINNER = that value
      REASON = 'newest_observation'
      -> STEP 5
  Else: two or more distinct values tie at T -> STEP 4c, over the tied
        values ONLY.

STEP 4c — CONFIDENCE  (TIE-BREAK ONLY, D-2)
  Operates only on the values tied at T, and only on the assertions that
  attain T.
  If ANY of those assertions has confidence IS NULL:
      NO WINNER -> STEP 4d.
      (A missing confidence is never treated as low. accountIntelligence.ts:
       "A source that stated none contributes nothing rather than a zero.")
  For each tied value, C(value) = the MAXIMUM stated confidence among its
  assertions at T.
  If exactly ONE tied value attains max C:
      WINNER = that value
      REASON = 'newest_then_highest_confidence'
      -> STEP 5
  Else:
      NO WINNER -> STEP 4d.
  There is NO magnitude threshold. A confidence difference of 0.9 vs 0.1 at
  the same timestamp decides; a difference of ANY size at DIFFERENT
  timestamps does not, because recency already decided at STEP 4b.

STEP 4d — NO WINNER
  Canonical is untouched.
  WITHHOLD with REASON = 'sources_disagree'              (unchanged literal)
  The conflict is reported, never resolved by picking. See §7.

STEP 5 — APPLY OR WITHHOLD
  5a  canonical IS NULL or absent:
        WRITE the winner. Stamp provenance (§9).
  5b  canonical EQUALS the winning value:
        NO WRITE. The decision is already in force.
        Idempotent: repeating arbitration changes nothing, including
        provenance stamps.
  5c  canonical DIFFERS from the winner:
        5c-i   attested is FALSE:
                 WITHHOLD, REASON = 'unattested_incumbent'.
                 NEVER overwrite a canonical value that no live assertion
                 supports. Its provenance predates or sits outside the
                 evidence layer and cannot be re-derived if lost.  (D-4)
        5c-ii  attested is TRUE:
                 WRITE the winner. (D-4 — this is the re-arbitration that
                 replaces today's RULE C.)
                 The previously-canonical assertion's canonical decision is
                 recorded as superseded (§8 rule S-2). Its ASSERTION row
                 stays live and is not superseded.

EMPTY STRING
  `canonical === ''` is treated as SET today (test :124-128) and therefore
  blocks a write under RULE C. Under D-4 an empty string is a value like any
  other: it is a differing canonical value, and 5c applies. An empty string
  is never a winner, because STEP 0's candidate filter already requires
  normalized_value IS NOT NULL and the normalisers emit null, not ''.
  An empty canonical string will almost always be `unattested_incumbent`
  (5c-i) and thus protected. B1b MUST assert this explicitly; it is the
  single most likely place for an accidental behaviour change.
```

### 4.1 Brief §5: all seven cases, explicitly

Two sources A and B disagree about one non-authoritative attribute. `T(x)` = `COALESCE(observed_at, recorded_at)`, `C(x)` = stated confidence.

| Case | Condition | Outcome | Reason | Rule |
|---|---|---|---|---|
| **1** | A newer **and** more confident | **A wins** | `newest_observation` | 4b. Confidence is never consulted; recency already decided. |
| **2** | A newer but **less** confident | **A wins** | `newest_observation` | 4b. Recency is primary. Confidence does not override it. |
| **3** | A older but **substantially** more confident | **B wins** (the newer) | `newest_observation` | 4b. "Substantially" is **not expressible** — see §6.3. No magnitude threshold is defined, and inventing one would be a normalization formula the brief forbids. |
| **4** | `T(A) = T(B)`, `C(A) ≠ C(B)` | **higher confidence wins, only if BOTH state one**; if either is null → **no winner** | `newest_then_highest_confidence` / `sources_disagree` | 4c |
| **5** | `T(A) = T(B)`, `C(A) = C(B)` (incl. both null) | **no winner** | `sources_disagree` | 4c → 4d |
| **6** | values **identical** | **one winner**, not a conflict | `single_uncontested_assertion` | 2. Collapsed by `normalized_value` before any conflict is considered. |
| **7** | values conflict, neither wins | **no winner**; canonical untouched; conflict recorded | `sources_disagree` | 4d |

Generalisation beyond two sources: the rules are stated over sets, not pairs. The strictly-newest distinct value wins; any tie at the maximum falls to 4c; any tie there falls to 4d. **No step ever picks arbitrarily**, and no step depends on row order — which is what makes the function deterministic for identical inputs regardless of query ordering.

> **Note on today's behaviour at step 4b.** `decideCanonicalUpdates` currently takes `candidates[0].id` as the applied assertion id in the uncontested case. With more than one assertion carrying the winning value, "which assertion gets the provenance stamp" becomes order-dependent. B1b must make that selection deterministic — see the B1b contract, item 9.

---

## 5. Timestamp Semantics

**D-1 — RATIFIABLE.**

> **The authoritative arbitration timestamp is `COALESCE(source_assertions.observed_at, source_assertions.recorded_at)`.**

| Candidate | Verdict | Why |
|---|---|---|
| `source_assertions.observed_at` | **primary** | *"When the SOURCE says it observed this, which is not when we ingested it"* (migration). This is the only column that can carry a genuine observation time. |
| `source_assertions.recorded_at` | **fallback only** | `NOT NULL DEFAULT now()`. *"a provider that supplies no timestamp still gave us evidence at a knowable moment"* (`observations.ts:92-96`). Guarantees the arbitration timestamp is never null, so there is no null-handling branch and no unreachable code. |
| `source_records.observed_at` | **not used** | A per-record copy. `source_assertions` carries its own `observed_at`, and arbitration is attribute-level; reaching to the record would reintroduce record-level coupling. |
| `source_records.ingested_at` / `first_seen_at` / `last_seen_at` / `created_at` | **never** | These are ingestion times. The brief's own objective — *"avoid a late-arriving stale record defeating a genuinely newer observation"* — is precisely the failure these columns cause. |
| `source_assertions.created_at` | **never** | Insert time. Same objection. |
| `source_records.ingestion_run_id` | **never** | Not a timestamp. Free text by ratified decision (`A7P-C9`); carries operator batch labels and LinkedIn URNs. |

**This ratifies an existing repository rule, not a new one.** `pickRecentObservation` already computes exactly `row.observed_at ?? row.recorded_at` with a newest-per-attribute reduction, and it is live in the enrichment re-observation window. B1b reuses that semantic; whether it reuses the *function* is an engineering choice (its reduction answers a different question — oldest-of-newest for a freshness floor).

### 5.1 The known weakness D-1 does not fix

`observed_at` is populated **per record**, not per attribute, and two live writers derive it loosely:
- `enrichment/service.ts:229` — `result.provenance[0]?.observedAt` — the **first attribute's** timestamp, stamped onto every attribute in the record, even though `EnrichmentResult.provenance` carries a correct per-attribute `observedAt`.
- `crmIngestionService.ts` supplies the CRM row's timestamp for the one attribute it asserts, which is correct by coincidence of there being one attribute.

So a provider that observed a title in January and a city in June will have both assertions stamped January (or June, whichever attribute sorts first in its field list). **Recency arbitration is only as good as this value**, and today it is approximate.

This is a **defect in the producers, not in D-1** (Appendix B, defect 2). D-1 is still the right rule — it is the best available timestamp and the only one with observation semantics — and B1b should not try to compensate for a mis-stamped `observed_at` inside arbitration, because compensation would be a heuristic. Fixing the producers is the correct remedy, and it is **OUT OF SCOPE — separate D22 gate** (it is a change to the enrichment path, not to arbitration). It is listed as **O-6** because the owner should know arbitration inherits this imprecision on day one.

---

## 6. Confidence Semantics

**D-2 — RATIFIABLE.**

> **Confidence participates ONLY as a tie-break among candidates that tie at the maximum arbitration timestamp, and only when every tied candidate states a confidence. It never overrides recency. A missing confidence is never treated as low.**

### 6.1 How confidence is represented today

| Property | Finding | Evidence |
|---|---|---|
| **Scale** | `numeric`, **pinned 0..1** by CHECK | `source_assertions_confidence_range` |
| **Nullable** | **Yes**, and null is normal | same CHECK; `extensionBridge.ts:363-364` sets it to null deliberately |
| **Meaning** | *"Provider-stated confidence for this record's claims"* — whatever the provider meant by it | `ingestionBoundary.ts` `ProviderSourceRecord.confidence` |
| **Granularity** | **RECORD-level, not attribute-level.** `ProviderSourceRecord` has one `confidence`, copied onto every assertion the record produces (`recordAssertions`, `:313`) | `ingestionBoundary.ts:301-315` |
| **Normalized across providers?** | **No.** No normalization, calibration or mapping exists anywhere. | `confidenceOf` (`result.ts:127-128`) only range-checks |
| **Invented when absent?** | **No, deliberately.** *"Provider-stated confidence only. Never a number we invented to fill it."* | `persistence.ts:222-223` |

### 6.2 The finding that decides D-2

`enrichment/providers/persistence.ts:223`:

```ts
confidence: input.fields.find((f) => typeof f.confidence === 'number')?.confidence ?? null,
```

The record-level confidence is **the first field that happens to state one**, and it is then stamped onto every assertion in that record. Meanwhile `EnrichmentResult.provenance` (`result.ts:111-120`) does carry a correct **per-attribute** confidence — and it is discarded at the boundary, because `ProviderSourceRecord` has nowhere to put it.

So today, `source_assertions.confidence` for `city` may be a number the provider stated about `job_title`.

**Therefore an attribute-level arbitration cannot responsibly let confidence decide anything that recency can decide.** Making confidence primary, or letting a large confidence gap override recency, would be arbitrating on a value that is attribute-level in name only. This is not a preference; it is what the evidence permits.

### 6.3 What is explicitly refused

| Refused | Why |
|---|---|
| A cross-provider normalization formula | No provider states a calibration, and no mapping exists. Brief §7: *"If the current implementation does not establish cross-provider comparability, DO NOT invent a normalization formula."* |
| A "substantially more confident" threshold (brief §5 Case 3) | Requires a magnitude comparison across providers, which §6.1 shows is meaningless. No number is defensible, so none is defined. |
| Treating `NULL` confidence as 0 | Would penalise an honest provider (the extension) in favour of one that states a self-serving number. The repository already refuses this: *"A source that stated none contributes nothing rather than a zero"* (`accountIntelligence.ts:456-458`). |
| Confidence as primary, with recency as tie-break | Inverts D-2 and relies on the weakest column as the strongest signal. |

### 6.4 What remains an owner decision

**O-2 — cross-provider comparability.** If the owner later wants confidence to carry real weight, two things must happen first, in this order: (1) `ProviderSourceRecord` gains per-attribute confidence so `source_assertions.confidence` means what its name says; (2) an explicit, declared comparability statement per provider. **Neither is decided here, and B1b must not pre-empt either.** Until then, D-2 stands.

---

## 7. Conflict Semantics

**RATIFIABLE.**

> **When no candidate wins, the canonical value is left exactly as it is, every assertion stays live, and the attribute is reported as contested. The system never manufactures a winner.**

| Outcome | Decision |
|---|---|
| Retain the current canonical value (or leave it NULL) | **YES.** Step 4d touches nothing. |
| Retain all assertions | **YES.** Losing arbitration is **never** a cause of supersession (§8, rule S-3). |
| Create an unresolved-conflict record | **DERIVED, not stored** — see below. |
| Defer the canonical update | **YES**, implicitly: the next assertion re-runs arbitration, and a later arrival can break the tie without any retry mechanism. |
| Pick a winner by any fallback | **NEVER.** No "first", no "most recent insert", no provider default, no coin-flip. |

### 7.1 Where the conflict record lives

**Derived on read, not stored.** The repository has an established precedent and an established consumer:

- WS-7 (`accountIntelligence.ts:425-436`) already derives the contested set by calling `decideCanonicalUpdates` with an empty canonical row and filtering `reason === 'sources_disagree'`. It needs no table.
- Its own header gives the reasoning: *"A stored aggregate would be a second, unarbitrated copy of facts LI-2 already arbitrates, and it would go stale the moment any input changed. Deriving on read also makes idempotency structural."*

So B1b adds **no conflict table and no migration**. The conflict is a function of the live assertion set, and the live assertion set is already durable, append-only and tenant-safe.

**Consequence the owner should see:** a conflict is therefore not *assignable* — there is no row to own, review or resolve. A human-resolution workflow (a review queue) would need somewhere to record the human's decision, and the natural place is **a manual assertion through the existing boundary**, which arbitration then consumes like any other evidence. That keeps one writer and one evidence layer. The review-queue product itself is **OUT OF SCOPE — separate D22 gate**.

### 7.2 Vocabulary

`sources_disagree` and `canonical_value_already_set` are a **published vocabulary with external consumers and pinned tests** (§2.4). Rules:

- `sources_disagree` — **unchanged literal, unchanged meaning.** Emitted at step 4d. WS-7's contested set and `markConflicting`'s `conflicting` status keep working with no change.
- `canonical_value_already_set` — **retained in the vocabulary** but no longer emitted by the default path, because D-4 replaces RULE C. `markConflicting` already treats it as *not* a conflict (`piWs2EnrichmentPlanner.test.ts:386`), so ceasing to emit it is safe. **B1b must confirm no consumer depends on receiving it**, not merely on recognising it.
- New reasons may be **added**: `authoritative_source`, `newest_observation`, `newest_then_highest_confidence`, `unattested_incumbent`, and the notes `no_authoritative_assertion`, `contested_under_authority`.
- The empty-canonical-row calling convention (§2.4) must continue to disable the incumbent-protection branch, so WS-7 keeps measuring *"do the sources disagree?"* rather than *"may we write?"*.

---

## 8. Supersession Semantics

**RATIFIABLE.** This section exists because the mechanism is currently **unimplemented** (§2.5).

Two distinct things are being superseded, and conflating them would destroy the conflict record. They are kept separate.

### 8.1 Supersession of an ASSERTION — "the source no longer claims this"

| Rule | Statement |
|---|---|
| **S-1** | An assertion is superseded when **the same `source_record_id`** later asserts a **different** `value_hash` for **the same `attribute`**. `superseded_at` is set on the older row at that moment. This is the migration's own stated intent: *"A value that later changes at the same source inserts a new row and the previous one is marked superseded, never deleted."* |
| **S-2** | Supersession is **per `(source_record_id, attribute)`** — never per provider, never per entity, never per tenant. One source changing its mind about `job_title` says nothing about its `city` claim, and nothing about any other source's claims. |
| **S-3** | **Losing arbitration is NOT supersession.** A live assertion that lost to a newer or authoritative value stays live, with `superseded_at` NULL. Marking losers superseded would erase the disagreement, break WS-7's contested set, and make `markConflicting` silently stop firing. |
| **S-4** | Supersession is **never reversed**, and a superseded row is **never deleted**. A source that re-asserts a previously superseded value creates a **new** assertion row (the dedupe index is on `(organization_id, source_record_id, attribute, value_hash)`, and the old row still occupies that key — so B1b must handle this: see the B1b contract, item 6). |
| **S-5** | Supersession is tenant-scoped by construction: `source_record_id` is reachable only through the composite tenant FK `(source_record_id, organization_id)`. The UPDATE must still carry `organization_id` in its predicate, in line with every other PI writer. |

**Why S-1 is the only safe trigger.** `source_records` already distinguishes `outcome: 'unchanged' | 'changed'` by payload hash, and on `changed` it replaces the current payload while *"the OLD claims survive as assertions, which is where history actually lives."* S-1 is the missing half of that sentence.

**What S-1 fixes.** Without it, a source that corrects a wrong title leaves both the wrong and the right claim live forever, so the attribute is permanently contested and can never be filled — and no later evidence from any source can repair it. With it, a corrected source stops contesting, and arbitration can proceed.

### 8.2 Supersession of a CANONICAL DECISION — "we used to believe this"

| Rule | Statement |
|---|---|
| **S-6** | `applied_to_canonical_at` + `applied_reason` are **never cleared.** The CHECK ties them together, so clearing one clears both and destroys the record that the assertion was ever canonical. That is evidence loss and is forbidden. |
| **S-7** | A canonical decision history is therefore the **set of stamped assertions for that attribute, ordered by `applied_to_canonical_at`.** The latest stamp identifies the current winner; earlier stamps are the superseded decisions. No column is cleared and no row is deleted. |
| **S-8** | **Constraint B1b must resolve:** if an assertion wins, then loses, then wins again, re-stamping its single `applied_to_canonical_at` **overwrites its earlier stamp** and loses one step of history. B1b must prevent that loss. Two shapes satisfy S-6/S-7 — an additive append-only canonical-decision log, or additive columns on `source_assertions` — and choosing between them is a B1b **engineering** decision bounded by this invariant, not a further product decision. **What is ratified here is the invariant: no canonical-decision record is ever overwritten or cleared.** |
| **S-9** | `unified_persons.attributes_source` / `attributes_updated_at` remain a **convenience label** for the most recent write, as today. They are not the decision history and must not be relied on as one — they are per-row, not per-attribute, so one write stamps them for every attribute in that patch. |

---

## 9. Provenance Requirements

The evidence that must survive arbitration, for every canonical attribute value:

| # | Requirement | Where it lives today | B1b obligation |
|---|---|---|---|
| **P-1** | **Which assertion produced the canonical value** | `applied_to_canonical_at` on exactly that assertion | Stamp deterministically (contract item 9), never the arbitrary first row |
| **P-2** | **Which rule chose it** | `applied_reason` | Must be one of the ratified reason literals (§7.2), never free text |
| **P-3** | **What the losing sources claimed** | the losing assertion rows, `superseded_at IS NULL` | Never superseded for losing (S-3), never deleted |
| **P-4** | **What the provider literally said, before normalisation** | `raw_value` alongside `normalized_value` | Untouched. *"Discarding the raw form would make a normalisation bug unauditable."* |
| **P-5** | **Who said it** | `source_assertions.provider`, `source_records` | Untouched |
| **P-6** | **When it was observed, and when we received it** | `observed_at`, `recorded_at` | Untouched; read by arbitration (D-1) |
| **P-7** | **The full payload behind the claim** | `source_records.raw_payload` (credential-redacted) | Untouched |
| **P-8** | **The history of canonical decisions for the attribute** | partially — see S-8 | **New.** The one genuinely missing provenance surface |
| **P-9** | **That a source withdrew a claim** | `superseded_at` | **New** (S-1). Currently never written |

**The question the system must be able to answer** — *"Why does Omnivyra believe this prospect has this value?"* — resolves to: P-1 names the assertion; P-2 names the rule; P-5/P-6 name the source and the time; P-4 shows the raw claim; P-3 shows what was rejected; P-8 shows what we believed before. All of it tenant-scoped.

**The layering is preserved and must not collapse** (brief §12):

```
source assertion   (append-only evidence, every claim, every provider)
       |
   arbitration     (pure, deterministic, declaration-driven, writes nothing itself)
       |
canonical attribute  (a DERIVED projection — a cache of the decision, not a fact of its own)
```

D-4's `unattested_incumbent` guard is what keeps that last line honest in the presence of history: a canonical value with no assertion behind it is a value the layering cannot explain, so arbitration refuses to overwrite it rather than pretending to own it.

---

## 10. Safety Properties

Guarantees the ratified policy asserts. Each is stated so B1b can test it.

| # | Property | Statement |
|---|---|---|
| **SP-1** | **Tenant isolation** | Every read, every arbitration input and every write carries `organization_id` in its predicate. Candidates from another tenant are never in scope. The composite FKs `(person_id, organization_id)`, `(account_id, organization_id)` and `(source_record_id, organization_id)` already make a cross-tenant assertion unstorable. |
| **SP-2** | **No cross-tenant arbitration** | Tenant A's assertions can never contribute to, contest, or win tenant B's canonical value. The same provider record id legitimately exists in two tenants and resolves independently (`uq_source_records_tenant_identity`). |
| **SP-3** | **No owner/company special case** | Drishiq Labs is the legal owner of the application, **not a privileged tenant.** No authority declaration, default, bypass or exemption may be keyed to any specific tenant identity. The authority declaration is per-tenant **configuration**, which every tenant can hold on identical terms. |
| **SP-4** | **No destructive evidence loss** | No assertion is deleted. No `superseded_at` is reversed. No `applied_to_canonical_at` or `applied_reason` is cleared (S-6). No `raw_value` is discarded. Arbitration can only *add* rows and *set* stamps. |
| **SP-5** | **Deterministic arbitration** | Identical inputs produce identical outputs, independent of row order, query plan, wall-clock time and the order in which sources arrived. Every tie falls through to an explicit no-winner; no step picks arbitrarily. |
| **SP-6** | **Auditable winner selection** | Every canonical value names the assertion that produced it and the rule that chose it (P-1, P-2), from a closed vocabulary of reasons. |
| **SP-7** | **No silent source precedence** | No provider name appears in arbitration code. Authority exists only as an explicit, inspectable declaration passed in as data. An empty declaration means *source-neutral*, and that is the default. |
| **SP-8** | **Idempotence** | Re-running arbitration over an unchanged assertion set performs no write and changes no provenance stamp (step 5b). Re-ingesting an identical payload remains a no-op by database constraint. |
| **SP-9** | **Fail closed on scope** | A missing tenant refuses. An attribute outside the allowed surface is ignored, not written. Unresolved identity parks the evidence without touching canonical. All three are today's behaviour and are preserved. |
| **SP-10** | **Monotonic auditability** | The answer to *"why did we believe X at time T?"* never degrades. Adding evidence may change the current belief; it never erases the record of a previous one. |
| **SP-11** | **One writer** | `ingestionBoundary` remains the only module that may write a canonical attribute column, and the existing enforcement test that scans for outside writers stays in force. |
| **SP-12** | **Arbitration performs no I/O** | The decision function stays pure: candidates, canonical row and authority declaration in; a decision out. No provider call, no network, no clock. (`now` is already passed in throughout PI.) |

---

## 11. B1b Implementation Contract

**B1b MUST:**

1. **Arbitrate at the ATTRIBUTE level**, per `(organization_id, entity, attribute)`. Never per prospect, per source record or per provider. No rule of the form "source X wins for the whole prospect" may exist.
2. **Respect explicit source authority, supplied as DATA** — a tenant-scoped, per-`(entity_type, attribute)` declaration passed into the decision function. **No provider name, provider-keyed constant, priority table or rank map may appear in arbitration code.** The existing guard test (`:239-244`) stays in force and must still pass unchanged.
3. **Use the ratified timestamp rule (D-1):** `COALESCE(observed_at, recorded_at)` from `source_assertions`. Never an ingestion, insert or last-seen timestamp. Never `source_records.observed_at`.
4. **Use the ratified confidence rule (D-2):** tie-break only, within the tied-newest group only, and only when every tied candidate states a confidence. No normalization formula. No magnitude threshold. `NULL` is never treated as low.
5. **Never silently discard an assertion.** Losing arbitration is not supersession (S-3). No delete, no soft-delete, no filtering of a claim out of the evidence layer.
6. **Implement assertion supersession (S-1)**, which does not exist today: the same `source_record_id` asserting a different `value_hash` for the same `attribute` supersedes its own previous row, tenant-scoped. **Handle the re-assertion case (S-4):** the dedupe index `(organization_id, source_record_id, attribute, value_hash)` is already occupied by the superseded row, so re-asserting a previously-withdrawn value cannot simply insert. B1b must decide and test that path explicitly rather than discovering it as a 23505 in production.
7. **Preserve canonical-decision history additively (S-6, S-7, S-8).** Never clear `applied_to_canonical_at` or `applied_reason`. Never overwrite an existing stamp in a way that loses a step of history.
8. **Record why a canonical value won**, using only the ratified reason literals. Preserve `sources_disagree` and `canonical_value_already_set` byte-for-byte in the vocabulary; add new reasons rather than renaming existing ones.
9. **Make the applied-assertion selection deterministic.** Where several live assertions carry the winning value, the stamped assertion must be chosen by a stated, order-independent rule — not `candidates[0]`, which is today's order-dependent behaviour.
10. **Protect the unattested incumbent (D-4, step 5c-i).** A canonical value with no live assertion supporting it is never overwritten. Prove this with a test that seeds a canonical value and zero assertions.
11. **Keep `decideCanonicalUpdates` pure and keep WS-7 working.** `accountIntelligence.ts:428` calls it with an **empty canonical row** specifically to disable incumbent protection and expose `sources_disagree`. That calling convention must keep behaving that way. A signature change is acceptable; a behaviour change at that call site is not.
12. **Preserve tenant isolation** on every read, write and supersession, with `organization_id` in the predicate. Introduce no owner or company special case (SP-3).
13. **Be deterministic and idempotent** (SP-5, SP-8): identical inputs, identical outputs, regardless of row order; a re-run over an unchanged assertion set writes nothing.
14. **Deliberately rewrite the three pinned tests that D-4 and D-2 invalidate**, as decisions with stated reasons, not as deletions:
    - `:100-106` *"does not silently pick the first, the newest, or a preferred provider"* — **recency makes this false by design.** It must become: does not pick the first, does not pick a preferred provider, and picks the newest **only** under the ratified rule.
    - `:124-128` *"treats an empty string as set"* — must state the new empty-string behaviour explicitly (§4, EMPTY STRING).
    - the RULE C tests — must become re-arbitration tests plus an `unattested_incumbent` test.
15. **Change no scoring behaviour.** The scoring engine is FROZEN. `SCORING_RULES_VERSION`, the score-evaluation digest and `prospect_score_evaluations` are untouched. Note that arbitration changing a canonical attribute **will** change a score input and therefore the digest; that is the intended downstream effect and is not a scoring change.
16. **Introduce no enrichment or provider call.** No adapter, no credential, no network, no I/O in arbitration (SP-12).
17. **Change no ICP semantics.** Ratification, versioning and `evaluate.ts`'s `RULE 1. No ratified ICP ⇒ no contribution at all` are untouched.
18. **Change no lifecycle semantics.** The 7-state model, `PROSPECT_LIFECYCLE_VERSION` and the transition guards are untouched.
19. **Modify no Common Outreach component.** Nothing in `leadOutreachExecution`, the governance order, the email engine, the 040 bridge or the progression sweeper.
20. **Resolve no identity.** `identityResolutionService` stays the sole resolve-or-create path. `primary_email`, phone, `account_id`, `company_id` and `organization_id` remain unarbitrable (§3.1).
21. **Author no migration unless S-8's chosen shape requires one**, and if one is required, state why an append-only log could not. The conflict record is **derived, not stored** (§7.1), so no conflict table is authored.
22. **Prove it at T2 (real-schema PostgreSQL), not with mocks**, for every claim that depends on a database constraint: the dedupe index, the composite tenant FKs, the `applied_*` CHECK, and the supersession path. Mutation probes for the invariants, with the usual protocol — anchor matches exactly once, injection changes bytes, suite fails, restore in `finally`, re-hash byte-identical.

**B1b MUST NOT:**

- Implement, register or call any enrichment provider (that is **B2**).
- Add, design or specify a source adapter (Sales Navigator, MarketPulse, Active Leads — each a **separate D22 gate**).
- Build a conflict-review UI or workflow.
- Activate scoring (**B6**), build the lifecycle producer (**B3**) or the feedback path.
- Repurpose `unified_persons.source_priority` (§2.10, **O-3**).
- Normalise or calibrate confidence (**O-2**).
- Introduce an authority TTL or staleness expiry (**O-4**).

---

## 12. Open Owner Decisions

Only decisions that genuinely cannot be resolved from the existing architecture or evidence.

| # | Decision | Why it cannot be resolved here | Recommendation |
|---|---|---|---|
| **O-1** | **Accept the Sales Navigator pre-declaration?** SN authoritative for `job_title` only, seeded if and when an SN adapter is authorised; vacuous until then. SN authority over "company" is **not expressible** in this layer (§1.3). | No repository artefact grants SN authority over anything. SN is `available: false` behind a legal/terms gate. Declaring it is a product statement, not a code reading. | **Accept the mechanism, defer the declaration.** Ratify D-3 now; seed no declaration until an SN adapter is authorised. Nothing is blocked by deferring it, because arbitration with an empty declaration is exactly today's source-neutral behaviour plus recency. |
| **O-2** | **Is confidence ever comparable across providers?** If so, under what declared statement — and does per-attribute confidence get plumbed through `ProviderSourceRecord` first? | §6.1-6.2: no normalization exists, confidence is record-level, and one live writer derives it from an arbitrary field. There is no evidence from which comparability could be derived. | **Answer "no, not yet."** Keep D-2. Revisit only after per-attribute confidence is plumbed through, as a separate gate. |
| **O-3** | **What happens to `unified_persons.source_priority`?** A pre-existing `JSONB` column with **zero readers and zero writers**, named as though it were this policy's home. | Whether to adopt it, leave it dormant or retire it is a product/architecture call on an existing schema surface. | **Leave it dormant and do not adopt it.** It is entity-level; authority is per-`(entity_type, attribute)`. Adopting it would make the declaration unable to express the one thing the policy requires. Retiring it is a separate cleanup gate. |
| **O-4** | **Does authority or liveness ever expire with age?** Should a stale authoritative claim cede to a fresher non-authoritative one, or a long-silent source stop contesting? | Any TTL is a precedence policy with a number in it. No repository artefact suggests a duration, and inventing one would be exactly the silent precedence SP-7 forbids. | **No expiry.** Staleness is reported through WS-7 freshness, never arbitrated. If the owner wants expiry, it must be declared explicitly, per attribute, with a stated duration — and that is a further decision, not an implementation detail B1b may choose. |
| **O-5** | **Is `technologies` arbitrated as a scalar?** It is a serialised JSON array (`toAccountAttributes` JSON-serialises it so `String(...)` yields valid jsonb text). | Value identity by `normalized_value` means `["aws","gcp"]` and `["gcp","aws"]` are **different values** and therefore a permanent conflict. Whether set-valued attributes should merge, or arbitrate as opaque scalars, is a product decision about what the attribute means. | **Arbitrate as an opaque scalar for now**, and accept that two providers listing the same technologies in different orders will contest permanently. Set-valued arbitration (union? intersection? per-element provenance?) is a **separate D22 gate** and should not be smuggled into B1b. |
| **O-6** | **Acknowledge that arbitration inherits an approximate `observed_at`.** Not a choice so much as an acceptance: §5.1 shows `observed_at` is record-level and, in the enrichment path, taken from the first attribute. | Fixing the producers is a change to the enrichment path — **OUT OF SCOPE — separate D22 gate** — but the owner should not learn after B1b ships that recency arbitrated on an approximate timestamp. | **Accept, and schedule the producer fix separately.** B1b must not compensate inside arbitration; a heuristic correction would be undeclared precedence. |
| **O-7** | **Is operator/manual entry an authoritative source?** Under D-4, a manual correction creates an assertion like any other and can be out-recencied by a provider. | Whether a human correction outranks a provider is a product decision about who owns the record. The architecture is silent. | **Declare manual entry authoritative for every attribute, per tenant, as the first use of the D-3 mechanism** — if the owner wants human corrections to stick. This is the cleanest validation that authority-as-data works, and it needs no new code beyond D-3. **Flagged rather than decided**, because it changes what an operator correction means. |

**Decisions this gate explicitly does NOT make** (brief §14, recorded and stopped): which enrichment provider to implement; MarketPulse adapter design; Sales Navigator connector implementation; Active Leads ingestion; the lifecycle producer; the outreach-readiness model; feedback architecture; scoring changes; identity-resolution redesign; tenant-isolation redesign; suppression redesign. Each is **OUT OF SCOPE — separate D22 gate**.

---

## 13. Dependency Impact

### 13.1 What this decision unlocks

**B1b — arbitration implementation.** Fully unlocked by D-1 through D-5 plus O-1's "accept the mechanism, defer the declaration". Every behavioural question B1b would otherwise have to answer with a product judgement is answered in §4, §5, §6, §7 and §8. The one remaining choice (S-8's shape) is an engineering decision bounded by a ratified invariant.

**B2 — enrichment provider.** Unlocked **only after B1b ships**, and this is an architectural dependency, not project sequencing. Under today's rules a provider's assertions are:

- **withheld by RULE C** for every attribute that already has a value — permanently, because nothing re-arbitrates and `LI-6` does not exist;
- **withheld by RULE B** for every attribute where the provider disagrees with existing evidence — permanently, because `superseded_at` has no writer, so a disagreement never retires.

So a provider integrated before B1b would be **billed, called, and its evidence durably recorded, while being structurally unable to change a single canonical value** except for attributes that are both empty and uncontested. The audit's finding stands and this gate sharpens it: it is not that B2-before-B1b is *less effective*; for an already-populated prospect it is **inert by construction**.

A second, subtler reason: B2 before B1b would make the arbitration rollout **retrospective**. A provider ingesting for weeks under fill-only/abstain accumulates a large live assertion set with approximate timestamps and record-level confidences; switching on recency arbitration afterwards would re-decide thousands of attributes at once, from evidence recorded before the rules existed. Arbitrating first means each new source's evidence is arbitrated under known rules from its first row.

**Future source ingestion** (Sales Navigator, MarketPulse, Active Leads, CRM pull, any new provider). Unlocked by **D-3** specifically: because authority is data and `source_records.provider` is free text, adding a source needs no migration, no change to arbitration code, and no amendment to this policy — only a declaration. That is the whole return on ratifying the mechanism now rather than the first rule.

### 13.2 What this decision does NOT unlock, and what stays independent

| Work | Relationship to B1a |
|---|---|
| **B3 — outcome → PI feedback** | **Independent.** It concerns `outreach_outcomes` and the lifecycle writer, not the attribute surface. Can proceed in parallel. |
| **B4 — ingestion adapters for the three live source families** | **Independent** of arbitration policy; they already go through the boundary. |
| **B6 — activate scoring** | **Downstream of B1b, not of B1a.** Scoring reads canonical attributes; arbitration changes which values are there. Activating scoring before arbitration would calibrate against first-writer-wins values. |
| **B10 — end-to-end PI test** | **Independent**, and should ideally land before B1b so the arbitration change is observable end to end. |
| **The enrichment `observed_at` producer fix (O-6)** | **Independent** and separately gated; B1b must not wait for it, and must not compensate for it. |
| **A conflict review queue** | **Downstream and unscoped.** §7.1 shows it needs no new table — a human decision enters as a manual assertion — but the product is a separate gate. |
| **`LI-6`** | **Superseded by this gate.** The named-but-absent re-arbitration phase is what D-4 implements. B1b should retire the `LI-6` references in `ingestionBoundary.ts:39` and `:375` rather than leave a forward pointer to a phase that no longer exists. |

### 13.3 The critical path, restated

```
D22-B1a  arbitration POLICY           <- this document; awaiting owner ratification
   |
B1b      arbitration IMPLEMENTATION   <- unblocked the moment B1a is ratified
   |                                     (includes supersession S-1, which is new work)
B2       one enrichment provider       <- inert before B1b, by construction
   |
B6       activate scoring              <- calibrates on arbitrated values
```
with **B3**, **B4** and **B10** running in parallel throughout.

The gating item remains a decision rather than code. That has not changed since the audit; what has changed is that the decision is now written down in a form the owner can accept or reject line by line.

---

## Appendix A — Scope corrections to the brief

Recorded because the brief asked for ratification of things the repository does not support, and brief §3 says *"Do not guess"* and §4 says *"only if the repository/audit evidence supports it."*

| # | The brief says | Repository evidence | Resolution |
|---|---|---|---|
| **A-1** | The audit is `D22-PI-COMPLETE-GAP-AUDIT.md` | No such file. The D22 audit is `D22-PROSPECT-INTELLIGENCE-GAP-AUDIT.md` | Named file used as baseline; discrepancy recorded. |
| **A-2** | *"Sales Navigator is authoritative only for title + company"* is the existing intended rule | No artefact in the repository states it. SN is `available: false` behind a legal gate, with no adapter and no writer. | **NOT RATIFIABLE** as an operative rule. The mechanism is ratified (D-3); the declaration is pre-stated and deferred (O-1). |
| **A-3** | Arbitration should cover `email` and `phone` (brief §11's attribute list) | Both are **identity**, resolved by `identityResolutionService`; a test asserts the boundary cannot write `primary_email` | **OUT OF SCOPE — separate D22 gate.** Arbitrating them would be an identity-resolution redesign, which brief §14 forbids. |
| **A-4** | Arbitration should cover `company` | A person's employer is `account_id`, a resolved relationship owned by WS-1 account resolution — not an attribute column | **OUT OF SCOPE — separate D22 gate**, same reason. The account's own attributes are arbitrable and are in §3.1. |
| **A-5** | Arbitration should cover `name` | Supported, as three separate attributes: `full_name`, `first_name`, `last_name`. They arbitrate independently and can legitimately disagree with each other; no cross-attribute consistency rule is defined, and defining one would be a new policy. | Recorded. In §3.1 as three rows. |
| **A-6** | *"The audit already established that these provenance fields exist"* (`superseded_at`, `applied_to_canonical_at`, `applied_reason`) | They exist. **`superseded_at` has zero writers** — it is read in four places and written nowhere. | Existence confirmed; **implementation status corrected** (§2.5). This makes supersession new work in B1b, not a refinement. |

---

## Appendix B — Defects discovered during this gate (recorded, NOT fixed)

| # | Defect | Location | Consequence |
|---|---|---|---|
| **1** | **Six attributes are in the allowed write surface but have no assertion path.** `authority`, `influence`, `buying_role` (person) and `market`, `business_model`, `growth_stage` (account) are listed in the `*_ATTRIBUTE_COLUMNS` arrays and normalised by `toPersonAttributes`/`toAccountAttributes`, but `pendingFromPerson`/`pendingFromAccount` do not map them. No assertion can be created for them, so `decideCanonicalUpdates` never sees them — and the boundary is the only permitted writer. | `ingestionBoundary.ts:251-281` vs `attributes.ts:362-381` | 6 of 29 writable attributes are **structurally unwritable**. Not a product decision; a mapping gap. B1b should fix or explicitly document it. |
| **2** | **`observed_at` is record-level and, in the enrichment path, taken from the first attribute.** `enrichment/service.ts:229` uses `result.provenance[0]?.observedAt`, discarding the correct per-attribute timestamps that `EnrichmentResult.provenance` carries. | `enrichment/service.ts:229`; `result.ts:111-120` | Recency arbitration inherits an approximate timestamp (§5.1, **O-6**). |
| **3** | **`confidence` is record-level and derived from an arbitrary field.** `persistence.ts:223` takes the first field that states a numeric confidence and stamps it onto every assertion in the record. | `enrichment/providers/persistence.ts:223` | `source_assertions.confidence` is attribute-level in name only. This is what forces D-2 (§6.2). |
| **4** | **`superseded_at` has no writer.** The migration's "superseded, never deleted" contract is half implemented. | `source_assertions`; four readers, zero writers | Disagreement is **monotonic and permanent**: a source that corrects itself still contests forever (§1.4). |
| **5** | **`applied_to_canonical_at` cannot express a re-win without losing history.** A single timestamptz, tied by CHECK to `applied_reason`. | `source_assertions` | Constrains B1b's provenance shape (S-8). |
| **6** | **The applied-assertion stamp is order-dependent.** `decideCanonicalUpdates` takes `candidates[0].id` when several assertions carry the winning value. | `ingestionBoundary.ts:364` | Which assertion is recorded as canonical depends on query row order (B1b contract item 9). |
| **7** | **`unified_persons.source_priority` is dead schema.** `JSONB`, zero readers, zero writers, named as if it held precedence. | migration `20260506000001` | Invites a future reader to assume precedence is configured when it is not (**O-3**). |
| **8** | **`LI-6` is referenced twice as the owner of re-arbitration and does not exist.** | `ingestionBoundary.ts:39`, `:375` | A forward pointer to a phase that was never created; D-4 supersedes it. |

**None of these was fixed.** No source, test, migration or fixture was modified during this gate.

---

## Appendix C — Files inspected, with content hashes

Read-only. Hashes are the first 16 hex characters of sha256, recorded so a later gate can prove these files were unchanged by B1a.

| File | sha256 (16) |
|---|---|
| `backend/services/prospectIdentity/ingestionBoundary.ts` | `a4ce3b3f492c5c1c` |
| `backend/services/prospectIdentity/attributes.ts` | `9fc6630f8e654587` |
| `backend/services/prospectIdentity/accountIntelligence.ts` | `fc175ea7e99f1d96` |
| `backend/services/enrichment/providers/persistence.ts` | `4c767b405f0b4979` |
| `backend/services/enrichment/result.ts` | `4e8d2e55f8f7440e` |
| `backend/services/integrations/dataSourceCatalogue.ts` | `6cc3df06a9716c95` |
| `supabase/migrations/20261002000000_li2_source_records.sql` | `c0648d5d7605f355` |
| `backend/tests/unit/prospectIdentityIngestionBoundary.test.ts` | `6a18332bcfe0cfff` |

`ingestionBoundary.ts` at `a4ce3b3f492c5c1c` is **the same hash the D22 audit recorded**, confirming the canonical writer is unchanged since that audit.

Also read (not hashed, inspected for specific statements): `backend/services/enrichment/providers/observations.ts`, `backend/services/enrichment/providers/extensionBridge.ts`, `backend/services/enrichment/providers/cost.ts`, `backend/services/enrichment/service.ts`, `backend/services/crmIngestionService.ts`, `backend/services/leadIngestion/orchestrator.ts`, `supabase/migrations/20261022000000_pi_source_record_run_correlation_text.sql`, `supabase/migrations/20260506000001_identity_spine_source_columns_and_fk_columns.sql`, `docs/database/canonical-identity-guarantees.md`, `docs/pmo/prospect-intelligence/PI-P1-W02-SOURCE-ADAPTER-SPEC.md`.

**Working-tree provenance.** Twelve of the thirteen files cited by line number are byte-identical to `HEAD` (`git status` reports them clean). The thirteenth, `backend/services/crmIngestionService.ts`, carries an uncommitted modification from a prior PI gate that removed a legacy-lead path (hunks at lines 13, 97-143 and 434). The block cited in this document — `recordCrmProspectProvenance` and its `ingestSourceRecord` call — is **identical to `HEAD` over a 50-line window**; only its line number moved (worktree 314, `HEAD` 330). That file was not touched by this gate.

**Verification performed:** repository inspection, schema inspection (migration source only), audit inspection, static tracing, reading tests, reading migrations. **Not performed:** source modification, migration, database mutation, provider call, deployment, production access, test fixture mutation, implementation of B1b.

---

## Compact B1b contract

```
B1b MUST:

 1. Arbitrate at the ATTRIBUTE level, per (tenant, entity, attribute).
 2. Respect explicit source authority supplied as DATA; no provider name in code.
 3. Use COALESCE(observed_at, recorded_at) as the arbitration timestamp.
 4. Use confidence as a tie-break ONLY, within the tied-newest group, and only
    when every tied candidate states one. NULL is never treated as low.
 5. Never silently discard an assertion; losing arbitration is not supersession.
 6. Implement assertion supersession (same source record, same attribute,
    different value) — it does not exist today — and handle re-assertion of a
    previously superseded value.
 7. Preserve canonical-decision history additively; never clear
    applied_to_canonical_at or applied_reason.
 8. Record why a canonical value won, from the closed reason vocabulary;
    preserve 'sources_disagree' and 'canonical_value_already_set' verbatim.
 9. Make the applied-assertion stamp deterministic, not order-dependent.
10. Never overwrite an unattested incumbent canonical value.
11. Keep the decision function pure, and keep WS-7's empty-canonical-row
    calling convention behaving as it does today.
12. Preserve tenant isolation in every predicate; no owner/company special case.
13. Be deterministic for identical inputs and idempotent on re-run.
14. Rewrite the three invalidated pinned tests deliberately, as decisions.
15. Preserve existing scoring behaviour; the scoring engine is FROZEN.
16. Introduce no enrichment or provider call, and no I/O in arbitration.
17. Change no ICP semantics.
18. Change no lifecycle semantics.
19. Modify no Common Outreach component.
20. Resolve no identity; email, phone, account_id and tenancy stay unarbitrable.
21. Author no migration unless the provenance shape requires one; author no
    conflict table — the conflict is derived.
22. Prove every constraint-dependent claim at T2 on real PostgreSQL, with
    mutation probes.
```

---

**Gate status: B1a DECISION DOCUMENT COMPLETE. STOP.**

No implementation was started. B1b is **NOT** authorized. Enrichment is untouched. No source adapter was added. Scoring was not activated. B3 / B4 / B10 were not started.

**Awaiting owner ratification of D-1 … D-5 and a ruling on O-1 … O-7.** D-4 in particular changes behaviour that was deliberately frozen, and must not be treated as ratified by silence.
