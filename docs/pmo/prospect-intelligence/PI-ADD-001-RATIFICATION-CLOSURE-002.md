# PI-ADD-001-RATIFICATION-CLOSURE-002 — comprehensive ratification-readiness closure

**DOCUMENTATION AND EVIDENCE DISCOVERY ONLY.** No ratification. No owner decision made on the owner's behalf. No application code, test, schema, migration, configuration or runtime change. No database operation, production access or provider call. No commit, push, merge or deployment. **No existing artifact was modified.**

**Implementation authorization remains NONE. C-1a remains unauthorized.**

**This prompt is not treated as approval of any disputed requirement.**

---

## 1. Source baseline and hashes

Measured **2026-10-17T20:30:45+05:30 (IST)**. Prior baseline **not assumed**.

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree at start | — | **141 entries (67 M / 74 ??), 0 staged** | unchanged; pre-existing modified and untracked entries from earlier work packages were **not overwritten** |

| Source artifact | Expected SHA-256 / lines | **Actual** | Result |
|---|---|---|---|
| v0.1 `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` | `f244adb9…a5ad0` / 236 | match / **236** | **VERIFIED** |
| v0.2 `PI-REQUIREMENTS-ADDENDUM-002-PROPOSED.md` | `c6ae24e2…e9d1` / 394 | match / **394** | **VERIFIED** |
| v0.3 `PI-REQUIREMENTS-ADDENDUM-003-PROPOSED.md` | `3ef5a365…5477` / 536 | match / **536** | **VERIFIED** |
| `PI-ADD-001-V03-RATIFICATION-READINESS-001.md` | `30b00b93…a22c` / 368 | match / **368** | **VERIFIED** |
| `PI-ADD-001-V03-SEMANTIC-REVIEW-001.md` | `466cc141…16be` / 183 | match / **183** | **VERIFIED** |

**No discrepancy. All five remain byte-unchanged.**

### 1.1 Artifacts created by this task

| File | SHA-256 | Lines |
|---|---|---|
| `PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md` | `9e496a0929a4ee0115ef2adb281dd6d8240ae694f09ffd64db9b7420e99806b6` | **134** |
| `PI-ADD-001-RATIFICATION-CLOSURE-002.md` (this report) | reported in the delivery message (a file cannot contain its own hash) | **497** |

No other supporting files were created: every other required section fits here, and duplicating them would add redundancy without readability.

---

## 2. Headline: the position is materially worse than previously reported

A **second-reader review by a structurally separate agent** (record: [`PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md`](PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md)) surfaced **fifteen** additional non-PASS items and **one escalation**, and found a **demonstrable defect in the prior review's own mechanical scan**. Every material claim was then verified by the author against source — all **twelve confirmed**.

**Three findings are substantive architectural defects, not wording problems:**

| # | Defect | Verified evidence |
|---|---|---|
| **D-1** | **Terminality is not durable.** There is no current-state column — *"CURRENT state is derived from the most-recent (by `transitioned_at`) row"* (`20260520…sql:9`). Lifecycle rows cascade: `opportunity_feed_item_id … ON DELETE CASCADE` (`:16`). `opportunity_feed_items` is a retention target with `soft_delete_column: null` (`retention.ts:4, 57`), so retention on it is necessarily a **hard delete**. A retention run therefore destroys the `archived` row; the state becomes underivable; FR-A39 fails closed; **the account becomes permanently undeletable** — precisely the outcome FR-A33 exists to prevent | **CONFIRMED** |
| **D-2** | **`lifecycle_history`'s append-only protection is bypassed, not honoured.** `APPEND_ONLY_TARGETS = { 'lifecycle_history', 'moderation_decisions' }` (`retention.ts:69-72`) refuses hard deletes on the lifecycle table — but the cascade from its parent deletes those rows without the child's protection applying. The chain reaches further still: `signal_id … ON DELETE CASCADE` (`20260518…sql:97`), so `lead_signals` → `opportunity_feed_items` → `opportunity_lifecycle_states`. **FR-A37 forbids exactly this silent cascade of evidence, and the owner-adopted mechanism already contains it** | **CONFIRMED** |
| **D-3** | **Non-signal-origin opportunities cannot hold a lifecycle state.** `opportunity_feed_items.signal_id` is `NOT NULL` (`:97`) and the lifecycle anchor is `NOT NULL` to a feed item, so FR-A5's "manual entry and CRM import" opportunities have no feed item and therefore **no reachable lifecycle state, hence no terminality for FR-A32**. FR-A9's multi-signal accumulation also conflicts with `UNIQUE (organization_id, signal_id)` (`:113`) | **CONFIRMED** |

**Consequence for ratification:** these are not closable by documentation. **D-1 and D-2 mean the owner-decided terminality rule and FR-A37 cannot both hold as written against the adopted mechanism.** That is an owner decision about the mechanism, not a wording fix.

### 2.1 An author error, recorded plainly

The prior review reported **3** items citing withdrawn lifecycle vocabulary. **The correct figure is 4.** The author's scan word-boundary-matched the exact state names, so it caught `closed` in "auto-closed" — where the inflection equals the state name — but **missed `disqualify` in FR-A12's "auto-disqualify"**. Both patterns were re-executed to confirm: the old pattern returns False, a stem substring returns True.

Consequently the prior review's argument that its flags *"survive the independence limitation because they came from a mechanical scan"* is **weakened** — that scan had a demonstrable false negative. The correct method is a **stem** scan (`disqualif`, `clos`, `supersed`, `act`, `open`), which was not used.

The author also **withdraws** the prior proposed `closed`→`archived` remedy; see §4.2.

---

## 3. The authoritative blocker register

Grouping preserved as instructed: the paired `AC-A43`/`NC-A20` decisions appear as one summary row, with separate decision records in §5. The register is expanded to be authoritative — it would be dishonest to present only the original nine when the second-reader review surfaced more.

| # | Blocker | Identifier(s) | Verified from source | Inference / proposal | Decision required | Doc-only closable? | Evidence to close | Status | Consequence |
|---|---|---|---|---|---|---|---|---|---|
| **B1** | Q3 legal-erasure / retention policy | `FR-A34`, `FR-A35`, `AC-A29`, and now `BR-A2` | No approved policy located across **11 search scopes**; `PI-CONTRACT-002` self-declares *"AWAITING POLICY DECISIONS"* and *"invents no legal or compliance policy"*; no PI table in `RETENTION_TARGETS`; **no accountable owner named anywhere** | That a policy may exist outside the repository — **not** that none exists | Supply or identify the approved policy + 8 sub-decisions | **NO** | §7 policy request, items 1–4 | **BLOCKED** | Blocks ratification; blocks the deletion/erasure requirement family |
| **B2** | `AC-A43` / `NC-A20` owner intent (paired) | `AC-A43`, `NC-A20` | Each present exactly once in v0.2's body; no duplication; no collision. v0.2's header stops at `AC-A42`/`NC-A19` | That body presence implies owner intent — **explicitly not treated as proof** | Retain or explicitly withdraw, each | **YES** | A yes/no per item | **PENDING OWNER DECISION** | Blocks ratification until each is dispositioned |
| **B3** | Withdrawn lifecycle vocabulary | `AC-A11`, **`FR-A12`**, `FR-A13`, `AC-A13` | All four verified to cite withdrawn names; `AC-A11` cites two | Proposed replacement wording in §4 | Approve replacement wording; for `AC-A11`, **designate the state** | **YES** for FR-A12/FR-A13/AC-A13; **AC-A11 needs an owner designation** | Approved wording | **PENDING OWNER DECISION** | `AC-A11` is **not testable as written** |
| **B4** | `FR-A46` / `detection_ref` hard-delete limitation | `FR-A46`, `AC-A42`, `NC-A19` | `opportunity_feed_items` in `RETENTION_TARGETS` with `soft_delete_column: null`; `detection_ref` is a **proposal** property (`prospect_opportunities` exists in no migration) | That `detected_reason` survival makes it tolerable | Accept the tradeoff, or require a mitigation | **YES** (acceptance) | Explicit acceptance | **PENDING OWNER DECISION** | Also now implicated in **D-1/D-2**, which acceptance alone does not address |
| **B5** | Independent semantic review | all 78 | A **structurally separate** agent reviewed all 78; 15 new non-PASS items; author verified 12/12 material claims | That model-family independence substitutes for human review — **it does not** | Nominate a human reviewer, or accept the current level | **NO** | A reviewer outside this system | **PARTIALLY SATISFIED / PENDING** | Was a hard blocker; now materially advanced but not closed |
| **B6** | `FR-A29` Q4 catalogue | `FR-A29` | Requirement states on its face the catalogue is *"not defined by this addendum"*; records consistently define Q4 as the **designated high-risk action catalogue**, blocking the second-approver flow, not C-1 | None | Supply the catalogue | **NO** — needs a policy artifact | The catalogue | **PENDING OWNER DECISION** | Blocks a later package; **does not block C-1** |
| **B7** | `FR-A36` / `AC-A25` person-erasure path | `FR-A36`, `AC-A25` | `erasePerson` exists (`personErasure.ts:149`); **no production caller** in all `.ts`/`.tsx` outside `node_modules` and `archive/`; it **is** exercised by a real-schema suite; it touches 4 tables and has **zero** `lead_intelligence` references while `lead_intelligence_person_tenant_fk` is `ON DELETE RESTRICT` | That no other authorized path could exist — **not claimed**; only that none exists in the scope searched | Architecture decision on a governed path | **NO** | Q3 policy + an architecture decision | **UNVERIFIED / BLOCKED on B1** | `AC-A25` untestable where the path cannot run |
| **B8** | **Terminality not durable (D-1)** | `FR-A32`, `AC-A24`, `AC-A32` | §2 D-1 — all elements confirmed | That the consequence is permanent undeletability — follows by construction from FR-A39 fail-closed | How terminality is made durable | **NO** | An owner decision on the mechanism | **PENDING OWNER DECISION** | **Blocks ratification.** The decided rule cannot hold as written |
| **B9** | **Adopted mechanism contains the cascade FR-A37 forbids (D-2)** | `FR-A37`, `BR-A2` | §2 D-2 — cascade chain and append-only bypass confirmed | None | Scope FR-A37 to new PI paths, or change the mechanism | **NO** | An owner decision | **PENDING OWNER DECISION** | **Blocks ratification.** FR-A37 and FR-A40 cannot both hold |
| **B10** | **Non-signal-origin opportunities have no lifecycle anchor (D-3)** | `FR-A5`, `FR-A9` | §2 D-3 — `signal_id NOT NULL`, `UNIQUE (org, signal_id)` confirmed | None | Confirm whether manual/CRM-origin opportunities are in scope and how they carry state | **NO** | An owner decision | **PENDING OWNER DECISION** | Blocks ratification of FR-A5/FR-A9 |
| **B11** | Qualification has two authorities | `FR-A19`, `FR-A20` | `qualified` is a lifecycle state; FR-A19 places qualification in the evaluation store; v0.1's FR-A6 guard *"a state and never a score"* was removed by the amendment | None | State which store is authoritative and that the lifecycle `qualified` is not a score | **YES** (wording) | Approved precedence | **PENDING OWNER DECISION** | Ambiguity in a core requirement |
| **B12** | Lifecycle authority crosses the one-way boundary | `BR-A5`, `AC-A27`, `FR-A24` | Lifecycle table is anchored `NOT NULL` to a Community Discovery record and created by its phase migrations; the only transition route is `pages/api/active-leads/lifecycle.ts` | None | Define whether the lifecycle table is inside or outside the boundary, and the record set `AC-A27`'s scan covers | **YES** (scoping) | Approved scope | **PENDING OWNER DECISION** | `AC-A27` as written would flag PI's own owner-decided transitions |
| **B13** | `AC-A14` "action state" undefined | `AC-A14`, `NC-A8` | The nine-state set contains no actionability value; `opportunity_dispositions` is a third axis | None | Name the field or computation carrying actionability | **YES** | Approved definition | **PENDING OWNER DECISION** | Not testable; risks a tenth lifecycle state |
| **B14** | `AC-A17` certifies a mechanism production does not use | `AC-A17`, `NC-A10` | Production isolation rests on application logic plus composite FKs because the service role holds a row-level-security bypass | None | None available — a limitation to record | **NO** | Production verification, which is unauthorized | **UNVERIFIED** | Evidential value limited to a disposable database |
| **B15** | `FR-A10` verbatim retention vs FR-A8 / FR-A36 | `FR-A10` | FR-A8 forbids copying signal content to prevent moderation-state drift; `detected_reason` is detection-derived text | None | Bound what "verbatim" covers | **YES** | Approved bound | **PENDING OWNER DECISION** | Interacts with B1 |
| **B16** | `FR-A33` verb mismatch | `FR-A33` | FR-A42 permits only transition-to-`archived`; "clears" reads as removal | None | Align the verb | **YES** | Approved wording | **PENDING OWNER DECISION** | Low severity, but conflicts with FR-A37/BR-A4 as read |
| **B17** | v0.3 self-contradiction on `FR-A35` | `FR-A35` | v0.3 §3.2 classifies it UNCHANGED/Verified-YES; v0.3 **line 428** states it *"remain[s] unresolvable until the above is supplied"* | Either reading is defensible | Reconcile the classification | **YES** | Owner's classification | **PENDING OWNER DECISION** | Document integrity |
| **B18** | v0.3's "Verified: YES" column is misleading | all 78 | v0.3 §9.1 check 8 shows it means only *"wording extracted verbatim"*, yet all 78 carry it, including items §5.7 marks NOT IMPLEMENTED | None | Relabel in any successor | **YES** | — | **PENDING OWNER DECISION** | Reads as system verification; it is not |

**No blocker is marked closed. A written note does not close one.**

---

## 4. Proposed wording — `AC-A11`, `FR-A13`, `AC-A13`, and `FR-A12`

**All proposals are PENDING OWNER APPROVAL. v0.3 and every prior proposal are unedited.** If approved, each would change in a **successor version**, never in place.

The vocabulary in force (owner decision Q1-1, verified in schema and code): `detected`, `triaged`, `reviewing`, `qualified`, `monitoring`, `outreach_planned`, `converted`, `dismissed`, `archived`. Withdrawn: `open`, `disqualified`, `acted`, `closed`, `superseded`.

Also in force and relevant: the **evaluation** axis is separate and already exists — `ScoreState = 'scored' | 'abstained' | 'unevaluated'` (`backend/apiHandlers/prospects/prospectIntelligenceRead.ts:158`). **No new state is invented by any proposal below.**

### 4.1 `AC-A11` — requires an owner designation, not merely a rewording

| | |
|---|---|
| **Before (v0.1, verbatim)** | *"An opportunity with no evaluation reads **open**, never disqualified"* |
| **Problem** | Cites two withdrawn state names, and **conflates two axes** — lifecycle state and evaluation state. Not testable as written |
| **Why this is an owner decision** | Q1-1 fixed the *vocabulary* only. FR-A41's owner-approved meanings cover `triaged`, `reviewing`, `monitoring` — **`detected` was not among them.** Which of the nine states a no-evaluation opportunity must read as is therefore an owner act |
| **Proposed after — option A (axis-separating, author's recommendation)** | *"An opportunity with no recorded evaluation reads `unevaluated` on the evaluation axis and is never `dismissed` on that basis; its lifecycle state is unaffected by the absence of an evaluation."* |
| **Proposed after — option B (state-designating)** | *"An opportunity with no recorded evaluation reads `<STATE>` and is never `dismissed` on that basis"*, where `<STATE>` is the state the owner designates |
| **Why option A is recommended** | It preserves the original intent exactly — absence of evaluation must never read as a negative verdict — **without** requiring a state designation, because it keeps the claim on the axis the original was really about. It invents nothing: `unevaluated` already exists. **It does not interpret "no evaluation" as permission to infer a qualification result** |
| **Scope** | Neither option expands or narrows scope |
| **Status** | **PENDING OWNER DECISION** |

### 4.2 `FR-A13` and `AC-A13` — the author's earlier remedy is WITHDRAWN

| | |
|---|---|
| **Before — `FR-A13` (verbatim)** | *"Staleness shall be **reported**, not auto-closed, so recurrence remains visible"* |
| **Before — `AC-A13` (verbatim)** | *"A stale opportunity is reported stale and is **not** auto-closed"* |
| **Context check, as required** | In both, "auto-closed" **does** denote a lifecycle transition — moving the record to a state that removes it from active view. So it is a state reference, not an unrelated sense |
| **The prior proposed remedy is withdrawn** | The prior review proposed substituting `archived`. Under **FR-A38** `archived` is the **sole terminal state for deletion eligibility**, so "auto-archived" would make stale opportunities **automatically deletion-eligible** and destroy the stated intent that *"recurrence remains visible"*. **A mechanical `closed`→`archived` substitution is unsafe and is not proposed** |
| **Proposed after — `FR-A13`** | *"Staleness shall be **reported** and shall trigger **no automatic lifecycle transition**, so recurrence remains visible."* |
| **Proposed after — `AC-A13`** | *"A stale opportunity is reported stale and **no automatic lifecycle transition occurs**; its state is unchanged by staleness alone."* |
| **Why** | Names **no** state, so it cannot drift with the vocabulary; forbids the behaviour the original forbade, including `archived` and `dismissed`, both of which would hide recurrence; preserves intent exactly |
| **Status** | **PENDING OWNER DECISION** |

### 4.3 `FR-A12` — newly identified, same class

| | |
|---|---|
| **Before (verbatim)** | *"Contradictory signals shall **lower confidence** and shall **retain both signals**. Evidence shall never be silently overwritten or deleted, and a contradiction shall not auto-disqualify an opportunity"* |
| **Problem** | "auto-disqualify" is a withdrawn state name in verb form. **Missed by the author's scan** (§2.1) |
| **Proposed after** | *"…and a contradiction shall not by itself cause an opportunity to be `dismissed`, nor trigger any automatic lifecycle transition."* |
| **Why** | `dismissed` is the approved analogue of the withdrawn `disqualified`; the added clause closes the same gap as §4.2 |
| **Status** | **PENDING OWNER DECISION** |

### 4.4 Requirements that would change if approved

`AC-A11`, `FR-A12`, `FR-A13`, `AC-A13` — in a **successor version only**. No other identifier is touched by these proposals.

---

## 5. `AC-A43` and `NC-A20` — two separate owner decisions

**Claims from the prior report were validated against source before being repeated. One was wrong.**

| Prior claim | Verification | Result |
|---|---|---|
| v0.2 header lists AC-A30…AC-A42 and NC-A12…NC-A19 | v0.2 line 22, verbatim | **CONFIRMED** |
| `AC-A43` derived from approved A-4 / FR-A33 direction | v0.2 line 255 traces *"FR-A33, FR-A40"* | **CONFIRMED** |
| `NC-A20` is the negative control for the approved narrow bulk scope | v0.2 line 271 proves *"AC-A40 must fail"*; AC-A40 traces FR-A42 | **CONFIRMED** |
| **Rejecting `AC-A43` leaves `FR-A40` without a direct test** | **INCORRECT.** `AC-A33` (*"A `converted` opportunity blocks deletion until archived"*) also traces FR-A40 | **CORRECTED — see below** |
| Rejecting `NC-A20` leaves the "do not broaden" boundary without a negative control | `NC-A20` is the **only** NC referencing AC-A40 | **CONFIRMED** |

**The corrected consequence:** `AC-A43` is the **only** acceptance criterion tracing to **`FR-A33`** (the governed resolution path). Rejecting it would leave **FR-A33**, not FR-A40, without any acceptance criterion.

### 5.1 Decision 1 — `AC-A43`

| | |
|---|---|
| **Verbatim text** | *"Resolution uses the existing enforced transition path; the allowlist is never bypassed, and an illegal transition is refused by the allowlist rather than by caller discipline"* (v0.2:255; traces FR-A33, FR-A40) |
| **Verified** | Present exactly once; no duplication; no collision; faithfully tests a mechanism verified in code (`canTransitionLifecycle` → `transitionLifecycle`, which throws on refusal) |
| **Not established** | That the owner reviewed or intended this derived criterion. **Body presence is not treated as proof of intent** |
| **Decision required** | Retain `AC-A43` as an individually identified acceptance criterion, or **explicitly withdraw** it? |
| **If retained** | No change to v0.3. v0.2's header is stale only. New-identifier count stands at 32 |
| **If withdrawn** | Recorded as withdrawn in a successor version; **no renumbering**; and **FR-A33 is left with no acceptance criterion at all** |
| **Author's recommendation** | **Retain.** It is the only test of FR-A33, and FR-A33's own rationale is what prevents an account becoming permanently undeletable |
| **Status** | **PENDING OWNER DECISION** |

### 5.2 Decision 2 — `NC-A20`

| | |
|---|---|
| **Verbatim text** | Control: *"Expose a second bulk lifecycle transition"* · Proves: *"**AC-A40 must fail**"* (v0.2:271) |
| **Verified** | Present exactly once; no duplication; no collision; the **only** NC covering AC-A40, which tests the owner-approved instruction *"Do not broaden this into general bulk opportunity resolution"* |
| **Not established** | Owner review of this derived control |
| **Decision required** | Retain `NC-A20`, or **explicitly withdraw** it? |
| **If retained** | No change to v0.3 |
| **If withdrawn** | The approved "do not broaden" boundary would have **no negative control**, so a future widening of bulk scope would not be detected by the suite |
| **Author's recommendation** | **Retain**, for that reason |
| **Status** | **PENDING OWNER DECISION** |

**Neither item was deleted, renumbered, withdrawn or reinterpreted. No owner decision was invented.**

---

## 6. `FR-A46` / `detection_ref` — acceptance or mitigation request

### 6.1 Verified source facts

| Question | Verified answer |
|---|---|
| Is `opportunity_feed_items` in `RETENTION_TARGETS`? | **YES** — `backend/types/retention.ts:4` |
| Actual `soft_delete_column` setting | **`null`** — `:57`, binding `{ table: 'opportunity_feed_items', time_column: 'created_at', soft_delete_column: null }` |
| Available archival modes | `RETENTION_ARCHIVAL_MODES = ['soft_delete','hard_delete']` (`:15-16`); with `soft_delete_column: null`, **hard delete is the only applicable mode** |
| Is `detection_ref` a plain UUID or FK-constrained? | **Neither in schema — it does not exist.** `prospect_opportunities` appears in **no migration**. "Plain UUID, no FK" is a property of the **proposal**, not of the system |
| Is `detected_reason` persisted separately? | **YES on the Community side** — `opportunity_feed_items.detected_reason TEXT NOT NULL`. On the PI side it is **proposed** (FR-A10), not implemented |
| What can the retention operation do to referenced rows? | **Hard-delete them**, and the deletion **cascades** to `opportunity_lifecycle_states` (`20260520…sql:16`) |

### 6.2 Consequences, stated accurately

- If retention hard-deletes the referenced feed item, **`detection_ref` can become unresolved.** This is **not** a guarantee of indefinite traceability, and none is claimed.
- `detected_reason` surviving on the PI opportunity is a **proposal** (FR-A10), so the mitigation is prospective, not current.
- **The limitation is wider than previously recorded:** the same hard delete also removes the **lifecycle history** (D-1/D-2). v0.3 §5.3 analysed only `detection_ref` resolvability and did not reach this.

### 6.3 The decision requested

> **Either** accept the known limitation as an explicit design tradeoff — `detection_ref` may become unresolved after a retention action, with `detected_reason` as the durable record — **or** require a separately designed mitigation to be assessed and authorized later.

**Acceptance is not presumed.** **FR-A46 remains PENDING OWNER ACCEPTANCE.** No FK, retention change, archival mechanism or persistence model was implemented or designed here.

**Caution for the owner:** accepting B4 alone does **not** address **D-1/D-2**. Accepting `detection_ref` unresolvability is a narrower decision than accepting loss of the lifecycle history.

---

## 7. Q3 — evidence discovery outcome and policy request

**Q3 remains BLOCKED.** Prior scopes were not merely repeated; **three new scopes were added.**

### 7.1 Search scopes — 8 prior, 3 new

| # | Scope | Result |
|---|---|---|
| 1–8 | As recorded in `PI-ADD-001-V03-RATIFICATION-READINESS-001.md` §4.1: docs filenames, docs content, `PI-CONTRACT-002`, `PI-CONTRACT-001`, the contract register, `retention.ts`, the manifest, policy-owner search | No approved policy; no accountable owner |
| **9 — NEW** | Non-docs locations: repository root, `.github`, any `legal/` directory | **4 root-level policy files, all credit/billing** (`CREDIT_POLICY_*`). **None on data retention or erasure** |
| **10 — NEW** | **Git history across ALL refs** for any file ever added or deleted matching `retention\|erasure\|gdpr\|privacy\|dpa` with a `.md`/`.pdf`/`.docx` extension | **No such file was ever added or deleted on any ref.** This rules out "a policy existed and was removed" |
| **11 — NEW** | The contract register's registered concerns | **13 concerns registered; data retention and legal erasure are NOT among them.** `PI-CONTRACT-002` exists as a document but is **not a registered concern** |

**Not searched, and why:** no external system — legal repository, contract management, ticketing, email — is accessible or authorized here. **No denied access operation was bypassed by another tool or route.**

### 7.2 Outcome

| Item | Status |
|---|---|
| Accountable policy owner | **NOT EVIDENCED** — not named in any accessible source |
| Approved policy document and version | **NOT LOCATED** |
| Approval authority and approval evidence | **UNVERIFIED** |
| The 8 Q3 sub-decisions | **ALL UNRESOLVED** |
| Precise missing information | The policy document, its approval evidence, its effective scope, and the 8 sub-decisions |
| **Q3** | **BLOCKED** |

**Absence from the repository is NOT inferred to mean no policy exists elsewhere.** No legal requirement, retention period, surviving record, deletion semantics or exception was invented. **No database operation was attempted and no denied operation was re-routed.**

### 7.3 Policy request — prepared for the owner to route; NOT sent

> **This has not been sent and is not represented as sent.**
>
> **Subject: Request for the approved legal-erasure and data-retention policy governing Prospect Intelligence**
>
> Prospect Intelligence holds **third-party personal data** — individuals who are not tenant users and hold no account. A requirements addendum (PI-ADD-001) cannot be ratified, and its deletion and erasure requirements cannot be specified or tested, until the governing policy is identified.
>
> A search of **eleven** accessible scopes found **no approved policy, no approval evidence, and no named accountable owner**. Git history across all refs shows no such policy document was ever present. `PI-CONTRACT-002-data-lifecycle.md` sets out the decision points but states it *"invents no legal or compliance policy"* and is *"AWAITING POLICY DECISIONS"*. Data retention and legal erasure are not registered concerns in the contract register.
>
> **Please supply or identify:**
>
> 1. **The approved policy document and its version.**
> 2. **Approval evidence and the approving authority** — who approved it, when, under what mandate.
> 3. **The eight sub-decisions and their rationale:** (a) authorized initiator and approver; (b) evidence required to establish a valid request and where it is recorded; (c) applicable scope and subject references, including whether a request extends from a person to their inferred roles, their opportunities, and account-level records that no longer name them; (d) handling of each artefact class **individually, not as a cascade** — opportunity content including any need statement, referenced signals, buying-role inferences, provenance records, evaluation records, audit records; (e) **what may or must survive** erasure, with no assumption made, including about audit metadata; (f) authorization, audit and tenant-isolation requirements for the erasure path; (g) refusal and escalation behaviour when a request cannot be safely resolved — for example where `lead_intelligence_person_tenant_fk` (`ON DELETE RESTRICT`) blocks it; (h) **retention periods** — none is proposed by this programme and none should be inferred from a technical default.
> 4. **Applicable scope, exceptions and effective date** stated in that policy.
>
> **Please also route this to the appropriate legal/compliance authority if it does not sit with you**, and name that authority so the record can be completed.

---

## 8. Independent review — status and handoff

**Full record: [`PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md`](PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md)** — `9e496a09…06b6`, 134 lines. The reviewer's conclusions are kept separate from the author's there, with the author's verification of each material claim in its §3.

| | |
|---|---|
| Was an independent reviewer available? | **A structurally separate agent instance was** — no authoring context, conclusions withheld, read the sources before the prior review, derived the 78-item set with its own parser, and read the authoritative schema directly |
| Is this a **human** independent review? | **NO. None has occurred and none is claimed** |
| Was the independence substantive? | **Yes, demonstrably.** It found a **false negative in the author's own mechanical scan**, surfaced **15** new non-PASS items, escalated one, and **over-flagged nothing** |
| Gate status | **PARTIALLY SATISFIED — PENDING** a human or otherwise externally independent reviewer |

### 8.1 Handoff packet for a human reviewer

| Item | Location |
|---|---|
| Original requirements | `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` (`f244adb9…`, 236 lines) |
| Current proposal | `PI-REQUIREMENTS-ADDENDUM-003-PROPOSED.md` (`3ef5a365…`, 536 lines) |
| Prior author self-review | `PI-ADD-001-V03-SEMANTIC-REVIEW-001.md` (`466cc141…`, 183 lines) — **contains a known false negative, §2.1** |
| Second-reader record | `PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md` (`9e496a09…`, 134 lines) |
| This closure report | `PI-ADD-001-RATIFICATION-CLOSURE-002.md` |
| Governing decisions | `PI-Q1-Q2-DECISION-CLOSURE-002.md`, `PI-Q1-Q2-OWNER-DECISIONS-001.md` |
| Authoritative mechanism | `backend/types/opportunityLifecycle.ts`, `backend/types/retention.ts`, `supabase/migrations/20260518_phase4_community_discovery_opportunities.sql`, `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql` |
| **Instruction to the reviewer** | Assess the 78 UNCHANGED items against the nine-state mechanism's **schema, cardinality and cascade behaviour** — not by keyword scan. **Use stem matching** for withdrawn vocabulary (`disqualif`, `clos`, `supersed`, `act`, `open`), since word-boundary matching demonstrably misses inflections. Record per-item outcomes and rationale for every non-PASS. Keep conclusions separate from the author's |

---

## 9. `FR-A29` — Q4 dependency analysis

| | |
|---|---|
| **Exact source wording (v0.1, verbatim)** | *"A **second approver** shall be required only for designated high-risk actions. The designation catalogue is **not defined by this addendum** — see §6"* |
| **What "Q4" denotes in this project** | Verified consistent across the record trail: the **designated high-risk action catalogue**. `PI-C1-OWNER-DECISIONS-002.md:218` links it to Q3-1's approver question; `:378` and `:412` and `PI-Q1-Q2-DECISION-CLOSURE-002.md:201` all record it as **OPEN, blocking the second-approver flow and not C-1** |
| **What is actually missing** | The catalogue itself — the enumerated list of actions designated high-risk |
| **Dependency owner, if evidenced** | **Programme owner** — consistently recorded as an owner decision. **No separate authority is evidenced** |
| **Nature of the dependency** | A **policy decision**, not a product requirement or external deliverable. It requires no engineering input and no external evidence |
| **Required artifact and acceptance evidence** | An owner-approved enumerated catalogue, plus a decision on whether the existing credit-scoped approval machinery (`required_approvals_for_action()`, `sign_credit_action_approval()`, `credit_action_approval_signatures`) is **generalized** or **paralleled** — it is action-scoped today, not generic |
| **Exact action to close** | Owner supplies the catalogue and the generalize-or-parallel decision |
| **Targeted owner question** | *"Which actions on an opportunity are designated high-risk and therefore require a second approver rather than step-up by the same operator? And should the existing credit-action approval machinery be generalized to carry them, or should a parallel mechanism be built?"* |
| **Status** | **PENDING OWNER DECISION. FR-A29 remains unresolved.** Blocks a later work package, **not C-1** |

---

## 10. `FR-A36` / `AC-A25` — erasure-path dependency analysis

The three strands are kept separate, as required.

### 10.1 Approved policy direction

`FR-A34` (owner direction D-H): legal erasure proceeds through a **governed legal-erasure path under approved policy** and is not permanently blocked by ordinary deletion refusal. `FR-A36`: person erasure removes the person without destroying the account-anchored opportunity, and the surviving record names no individual. **Both are directions; neither is implemented.**

### 10.2 Current implementation facts — verified, with scope stated

| Fact | Evidence | Scope of verification |
|---|---|---|
| `erasePerson` exists | `backend/services/prospectIdentity/personErasure.ts:149`, with `deletePersonRow` at `:384` and a fail-closed guard at `:356` | direct read |
| **No production caller** | Only non-test references are its own definition, the barrel export `prospectIdentity/index.ts:129`, and two comment mentions in `erasurePlan.ts` | **All `.ts`/`.tsx` repo-wide, excluding `node_modules` and `archive/`.** **It is NOT claimed that no other authorized path could exist** — only that none exists in this scope. A path outside the repository, a future route, or direct operator SQL are not excluded |
| It **is** exercised end to end | `backend/tests/realschema/dl_relationship_decisions.test.ts` — *"§11 the COMPLETE erasure path, through the real erasePerson"*, 4 call sites, against real PostgreSQL | direct read |
| It touches **4** tables | `contact_governance_records`, `identity_claims`, `source_assertions`, `unified_persons` | direct read |
| **It does not handle `lead_intelligence`** | **Zero** references in `personErasure.ts`, and `erasurePlan.ts` does not enumerate it as a blocker | direct read |
| A hard RESTRICT can block it | `lead_intelligence_person_tenant_fk` — `FOREIGN KEY (unified_person_id, company_id) REFERENCES unified_persons(id, company_id) ON DELETE RESTRICT` (`20260921000000:184-187`) | direct read |

**Consequence, stated conditionally:** where a `lead_intelligence` row references the person, `erasePerson`'s final delete would raise a foreign-key violation. **Whether such rows exist in production is UNVERIFIED** — no production access. And the passing real-schema suite does **not** disprove it: those fixtures evidently contained no such rows, so **the existing test does not cover this path.**

### 10.3 Missing evidence

Route or authority by which a governed erasure is invoked; a decision on handling the RESTRICT blocker; audit and tenant-isolation requirements for the path; and **the approved policy that defines what the path must do** (B1).

### 10.4 Legal-policy dependency

**`FR-A34` is BLOCKED on Q3.** `FR-A36`/`AC-A25` additionally depend on an architecture decision (§10.5). **`AC-A25` is untestable wherever the path cannot run.**

### 10.5 Minimum decisions and evidence needed — no design produced here

| # | Needed | Type |
|---|---|---|
| 1 | The approved policy (B1) | policy / external |
| 2 | How a governed erasure is **invoked** — operator route with capability and step-up, an operator-only job, or another authorized mechanism | architecture decision |
| 3 | How the `lead_intelligence` RESTRICT is handled — detach, delete first, or refuse with escalation. **A refusal path must exist**, per Q3 sub-decision (g) | architecture decision, policy-dependent |
| 4 | Whether the real-schema suite must be extended to cover the RESTRICT case | test-scope decision |
| 5 | Audit and tenant-isolation requirements for the path | derived from the policy |

**No erasure path was designed or implemented. `FR-A36` and `AC-A25` remain UNRESOLVED.**

---

## 11. Ratification-readiness matrix

| # | Row | Status | Kind |
|---|---|---|---|
| 1 | Source artifact integrity (all five) | **VERIFIED** | evidence |
| 2 | Original v0.1 identifier preservation (83, no dupes, no gaps) | **VERIFIED** | proposed requirement set |
| 3 | v0.3 identifier-set completeness (= v0.1 ∪ v0.2, 115 rows) | **VERIFIED** | proposed requirement set |
| 4 | Wording fidelity of the 78 UNCHANGED items | **VERIFIED** — zero mismatches, reproduced by two independent parsers | proposed requirement set |
| 5 | v0.2 header discrepancy (`AC-A43`, `NC-A20`) | **PENDING OWNER DECISION** | documentation defect |
| 6 | Semantic review of the 78 items | **PENDING OWNER DECISION** — 20 non-PASS | review outcome |
| 7 | **Independent** review | **PENDING** — structurally separate agent done; **no human review** | review process |
| 8 | Withdrawn-vocabulary items (`AC-A11`, `FR-A12`, `FR-A13`, `AC-A13`) | **PENDING OWNER DECISION** | proposed requirement |
| 9 | `FR-A6` amendment | **VERIFIED** as a recorded decision | recorded decision |
| 10 | `BR-A6` restated rationale | **VERIFIED** | current code behaviour |
| 11 | **D-1 terminality not durable** | **PENDING OWNER DECISION** | current code behaviour + proposed requirement |
| 12 | **D-2 adopted mechanism contains the forbidden cascade** | **PENDING OWNER DECISION** | current code behaviour + proposed requirement |
| 13 | **D-3 non-signal-origin opportunities have no lifecycle anchor** | **PENDING OWNER DECISION** | current code behaviour + proposed requirement |
| 14 | `FR-A19` two authorities for qualification | **PENDING OWNER DECISION** | proposed requirement |
| 15 | `BR-A5` / `AC-A27` boundary scoping | **PENDING OWNER DECISION** | proposed requirement |
| 16 | `AC-A14` undefined action-state axis | **PENDING OWNER DECISION** | proposed requirement |
| 17 | `AC-A17` certifies an unused mechanism | **UNVERIFIED** | current code behaviour |
| 18 | `FR-A10` verbatim-retention tension | **PENDING OWNER DECISION** | proposed requirement |
| 19 | `FR-A33` verb mismatch | **PENDING OWNER DECISION** | proposed requirement |
| 20 | `FR-A35` v0.3 self-contradiction | **PENDING OWNER DECISION** | documentation defect |
| 21 | v0.3 "Verified: YES" column misleading | **PENDING OWNER DECISION** | documentation defect |
| 22 | `FR-A46` / `detection_ref` acceptance | **PENDING OWNER DECISION** | proposed requirement |
| 23 | `FR-A29` Q4 catalogue | **PENDING OWNER DECISION** | policy decision |
| 24 | `FR-A36` / `AC-A25` erasure path | **UNVERIFIED / BLOCKED on B1** | current code behaviour + policy |
| 25 | **Q3 policy** | **BLOCKED** | recorded decision absent |
| 26 | Q1 / Q2 owner decisions | **VERIFIED** as recorded decisions | recorded decision |
| 27 | Q1 / Q2 directions **implemented** | **UNVERIFIED** — three compliant, six not implemented | current code behaviour |
| 28 | Stale-reference corrections documented without editing sources | **VERIFIED** | documentation |
| 29 | **Formal ratification of v0.3** | **PENDING OWNER DECISION** — **NOT ratification-ready** | formal ratification |
| 30 | **Implementation authorization** | **NOT RUN** — none exists, none sought | implementation authorization |

### 11.1 Verdict

**v0.3 is NOT ratification-ready, and Q3 is NOT the only substantive blocker.**

Three defects (**D-1, D-2, D-3**) are architectural, verified against schema and code, and **cannot be closed by documentation**. **D-1 and D-2 together mean the owner-decided terminality rule (FR-A38/FR-A39) and FR-A37 cannot both hold as written against the mechanism the owner adopted under Q1-1.** That is the most consequential finding in this package and it is new.

---

## 12. Exact decisions and evidence still required

| # | Decision | Recommended | Consequence if not taken |
|---|---|---|---|
| 1 | **D-1** — how is terminality made durable, given retention cascades the lifecycle history away? | Owner decision on the mechanism. Options the owner may consider: a durable current-state column; excluding `opportunity_feed_items` from retention; or a PI-side terminal marker | FR-A32/AC-A24/AC-A32 are unsatisfiable after retention; accounts become permanently undeletable |
| 2 | **D-2** — scope `FR-A37` to new PI paths only, or change the adopted mechanism's cascades? | Scope FR-A37 explicitly, and record the cascade as a known limitation | FR-A37 and FR-A40 contradict each other |
| 3 | **D-3** — are manual/CRM-origin opportunities in scope, and if so how do they carry lifecycle state? | Confirm scope; if in scope, a lifecycle anchor independent of `opportunity_feed_items` is needed | FR-A5/FR-A9 unratifiable |
| 4 | **`AC-A11`** wording | **Option A** (§4.1) — axis-separating, invents nothing, needs no state designation | Not testable as written |
| 5 | **`FR-A12` / `FR-A13` / `AC-A13`** wording | §4.2–§4.3 — name **no** state, forbid automatic transition | Three criteria cite withdrawn names |
| 6 | **`AC-A43`** retain or withdraw | **Retain** — the only test of FR-A33 | FR-A33 left untested |
| 7 | **`NC-A20`** retain or withdraw | **Retain** — the only control on the approved boundary | Boundary unguarded |
| 8 | **`FR-A46`** accept or mitigate | Owner's call; note it does not cover D-1/D-2 | Unresolved limitation |
| 9 | **`FR-A19`** qualification precedence | State the authoritative store; restore the "state not a score" guard | Core ambiguity |
| 10 | **`BR-A5` / `AC-A27`** boundary and scan scope | Define the record set | Scan would flag approved transitions |
| 11 | **`AC-A14`** name the actionability field | — | Not testable; risks a tenth state |
| 12 | **`FR-A33`** verb; **`FR-A35`** classification; **`FR-A10`** bound; **"Verified: YES"** relabel | As proposed | Document integrity |
| 13 | **`FR-A29`** Q4 catalogue + generalize-or-parallel | — | Blocks a later package |
| 14 | **Q3 policy** | §7.3 request; **name the accountable authority** | Ratification blocked |
| 15 | **Human independent reviewer** | Nominate one; handoff packet ready (§8.1) | Review gate unclosed |

---

## 13. Checks performed, not performed, and limitations

### 13.1 Performed

Five source hashes and line counts (all match) · exact v0.2 header wording extracted · `AC-A43`/`NC-A20` body text extracted, duplication and collision checked · **trace-column analysis correcting the FR-A40 claim** · retention configuration read (`RETENTION_TARGETS`, bindings, `APPEND_ONLY_TARGETS`, archival modes) · `prospect_opportunities` existence checked (absent) · lifecycle migration read (cascade, derived current state) · Phase-4 migration read (`signal_id NOT NULL`, `UNIQUE (org, signal_id)`) · `erasePerson` tables and callers enumerated repo-wide · `lead_intelligence` reconciliation re-verified · Q4 definition traced across records · **11 Q3 scopes including git history across all refs** · `ScoreState` vocabulary verified · second-reader review commissioned and **12/12 of its material claims independently verified** · the author's own scan defect reproduced and confirmed · control-byte scans on both new files (clean) · worktree preservation confirmed.

### 13.2 Not performed

| # | Not performed | Reason |
|---|---|---|
| 1 | Any test suite, typecheck or lint | documentation-only; no code changed |
| 2 | Any database operation | prohibited |
| 3 | Production access, ACL or migration-history read | prohibited; **no denied operation re-routed** |
| 4 | External provider call | prohibited |
| 5 | Search of any system outside this repository | none accessible or authorized |
| 6 | **Human independent review** | no human reviewer available |
| 7 | Proof that no policy exists outside the repository | impossible; **explicitly not claimed** |
| 8 | Verification that `lead_intelligence` holds production rows | prohibited; the §10.2 consequence is therefore **conditional** |

### 13.3 Limitations

The second-reader review is **model-family-correlated** and was briefed by the author; it is not a substitute for human review. The author's prior scan is now known to have had a false negative, so **other false negatives of the same class cannot be excluded** — which is precisely why the handoff packet instructs stem matching. Production behaviour is unverified throughout.

---

## 14. Time ledger and schedule-risk status

### 14.1 Frozen baselines — preserved, unchanged

| Item | Frozen | Changed? |
|---|---|---|
| Milestone A′ deadline | **2026-11-25** | **NO** |
| Milestone A′ baseline | **28.5 human engineer-days** | **NO** |
| WP-7 baseline | **2026-11-17, 4.0 human engineer-days** | **NO** |
| C-1 estimate | **8–12 human engineer-days** | **NO — not revised** |
| **OVERRUN RISK** | **RAISED; zero float at the high C-1 estimate** | **unchanged** |
| Next checkpoint | **Friday, 2026-10-23** | **unchanged** |

No estimate, scope, date or float changed. Agent wall-clock throughput is **not** substituted for the human engineer-day baseline.

### 14.2 This task

| | |
|---|---|
| **Actual start** | **2026-10-17T20:30:45+05:30 (IST)** |
| **End** | **2026-10-17T20:47:45+05:30 (IST)** |
| External waiting before start | **15 min 24 s** (prior close 20:15:21 → 20:30:45) — not engineering effort |
| External waiting during | **~7 min** awaiting the second-reader review — **not** author engineering effort |
| Original estimate | **0.5 engineer-days** |
| Wall-clock elapsed | **17 min 00 s** (20:30:45 → 20:47:45) |
| Active engineering effort | **~10 minutes** (wall-clock minus the ~7 min second-reader wait) |
| 75% threshold (0.375 d) | **not approached** |
| Foreseeable overrun **of this task** | **none** |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

### 14.3 Schedule-risk assessment — a new adverse signal, flagged immediately

**No baseline is changed, and no estimate is revised.** But the owner should see this now rather than at the checkpoint:

**D-1, D-2 and D-3 are architectural defects in the mechanism C-1 was to be built on.** The prior position was that C-1's remaining gate was essentially policy (Q3) plus wording. That is no longer the case: terminality durability and the cascade conflict are **design questions about the adopted mechanism**, and their resolution may change C-1's schema and tests.

**This is NOT presented as a C-1 estimate revision** — no revision is made, and the 8–12 day figure stands unchanged. It is flagged as an **input the owner should weigh**, because at the high C-1 estimate float is already **zero**, and a design change to the mechanism would land on a plan with no slack.

**Recovery options remain the four previously recorded; none is applied.** Owner approval is required for any baseline change.

---

## 15. Closing statements

| Gate | Status |
|---|---|
| **Q1 / Q2** | **DECIDED AND RECORDED** |
| **Q3** | **BLOCKED** — policy not located, approval unverified, no accountable owner evidenced, nothing invented |
| **Independent review** | **PARTIALLY SATISFIED / PENDING** — structurally separate agent completed; **no human review has occurred** |
| **Formal ratification of PI-ADD-001 v0.3** | **NOT RATIFIED — PENDING OWNER DECISION.** **NOT ratification-ready**; 15 decision groups outstanding, three of them architectural |
| **Implementation authorization** | **NONE. C-1a and C-1b remain unauthorized.** |

**Closed: nothing.** **Pending owner decision: B2, B3, B4, B6, B8–B13, B15–B18.** **Blocked by missing evidence: B1, B7.** **Unverified: B5 (human review), B14 (production isolation), and production behaviour throughout.**

**No code, test, schema, migration, configuration, database, commit, push, merge or deployment work occurred. v0.1, v0.2, v0.3, the readiness report and the prior semantic review remain byte-unchanged. No decision was made on the owner's behalf, and no requirement was silently renumbered, withdrawn or reinterpreted.**
