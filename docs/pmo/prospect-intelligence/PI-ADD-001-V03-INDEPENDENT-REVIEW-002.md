# PI-ADD-001 v0.3 — second-reader review record

**Companion to** `PI-ADD-001-RATIFICATION-CLOSURE-002.md`. **Documentation-only. Nothing is amended, ratified or authorized by this file.** No requirement was changed; no decision was made on the owner's behalf.

This file keeps the **reviewer's conclusions separate from the author's**, as required. §3 records the author's independent verification of each material claim.

---

## 1. Reviewer identity and the exact degree of independence

| | |
|---|---|
| Reviewer | A **separate agent instance** spawned for this review (`general-purpose`), with **no authoring context** for v0.1, v0.2, v0.3 or the prior semantic review |
| Review date | 2026-10-17 |
| Duration / effort | ~7 min, 13 tool calls |
| Brief given | The three artifacts, the governing nine-state vocabulary, the owner decisions in force, and the five excluded identifiers. **The author's conclusions were deliberately withheld**, and the reviewer was instructed to read the prior review **last** and treat it as a claim to test |

### 1.1 What this is, and what it is not — stated precisely

**It IS meaningfully independent in structure:** the reviewer did not author the documents, had no memory of writing them, received no conclusions to anchor on, read the sources before reading the prior review, derived the 78-item set with **its own parser**, and read the authoritative schema and code directly rather than relying on the author's summaries.

**It is NOT a human independent review.** It is the same model family, spawned and briefed by the author. **No human reviewer has examined these documents, and none is claimed.**

**Evidence that the independence was substantive rather than nominal:** the reviewer found a **demonstrable false negative in the prior review's own mechanical scan** (§2.1 item 1) and surfaced **fifteen** non-PASS items the prior review had passed, including two serious architectural defects. A nominally independent reread would not have produced that.

**Residual limitation:** a human review remains a ratification prerequisite. Model-family correlation cannot be excluded, and the reviewer's findings — though verified by the author in §3 — have not been assessed by anyone outside this system.

---

## 2. Reviewer's conclusions, as reported

**These are the reviewer's words and classifications, not the author's.**

### 2.1 Counts

| Outcome | Prior review | **Second reader** |
|---|---|---|
| PASS | 73 | **58** |
| CLARIFICATION REQUIRED | 3 | **12** |
| OWNER DECISION REQUIRED | 1 | **4** |
| BLOCKED BY Q3 | 1 | **3** |
| UNVERIFIED | 0 | **1** |
| **Total** | 78 | **78** |

The reviewer independently reproduced the central mechanical claim — **78 items, zero wording mismatches between v0.1 and v0.3** — with its own parser, and confirmed it holds.

### 2.2 Non-PASS items reported by the second reader

| ID | Reviewer outcome | Reviewer's stated problem (condensed) |
|---|---|---|
| **BR-A2** | BLOCKED BY Q3 | An unconditional retention promise ("for as long as the opportunity exists") over content that can contain third-party personal data. Collides with Q3's "what may or must survive" and with FR-A36's "surviving record shall name no individual" |
| **BR-A5** | CLARIFICATION REQUIRED | PI is declared authority over *lifecycle*, but the adopted nine-state mechanism physically lives in Community Discovery: `opportunity_lifecycle_states.opportunity_feed_item_id NOT NULL REFERENCES opportunity_feed_items(id)`. Lifecycle authority is asserted across the one-way boundary |
| **FR-A5** | CLARIFICATION REQUIRED | (a) Enumerates "a company event" as a first-class `need_source` while company-event production is unauthorized. (b) `opportunity_feed_items.signal_id` is NOT NULL, so manual/CRM-origin opportunities have **no feed item and therefore no reachable lifecycle state**, hence no terminality for FR-A32 |
| **FR-A9** | CLARIFICATION REQUIRED | Cardinality mismatch: `UNIQUE (organization_id, signal_id)` means one feed item per signal, while a lifecycle row hangs off exactly one feed item. A multi-signal opportunity has an ambiguous lifecycle anchor |
| **FR-A10** | CLARIFICATION REQUIRED | Verbatim `detected_reason` retention reintroduces the copy-drift FR-A8 exists to prevent (moderation state), and collides with FR-A36's "name no individual" |
| **FR-A12** | CLARIFICATION REQUIRED | **Contains "auto-disqualify" — a withdrawn state name in verb form.** The fourth withdrawn-vocabulary item, missed by the prior scan |
| **FR-A13** | CLARIFICATION REQUIRED | `closed` is withdrawn; **objects to the prior review's proposed `closed`→`archived` substitution** (see §2.3 item 3) |
| **FR-A19** | CLARIFICATION REQUIRED | `qualified` is both a lifecycle state and, here, an evaluation-store concern. v0.1's FR-A6 guard "a state and never a score" was removed by the amendment, leaving **two authorities for qualification and no stated precedence** |
| **FR-A29** | OWNER DECISION REQUIRED | Incomplete by construction until the Q4 catalogue exists (agrees with prior review) |
| **FR-A32** | OWNER DECISION REQUIRED | **Terminality is not durable.** No current-state column; state derived from the latest row; lifecycle rows CASCADE on `opportunity_feed_item_id`; `opportunity_feed_items` is a hard-delete retention target. A retention run destroys the `archived` row, the state becomes underivable, FR-A39 fails closed, and the account becomes **permanently undeletable** — the outcome FR-A33 exists to prevent |
| **FR-A33** | CLARIFICATION REQUIRED | The verb "clears" is not the owner-decided operation (transition-to-`archived`); "clears" reads as removing records, conflicting with FR-A37 and BR-A4 |
| **FR-A34** | BLOCKED BY Q3 | Depends on an approved policy not located (agrees with prior review) |
| **FR-A35** | BLOCKED BY Q3 | **v0.3 contradicts itself**: §3.2 classifies it UNCHANGED/Verified-YES while §6.2 states it "remain[s] unresolvable until the above is supplied" |
| **FR-A37** | OWNER DECISION REQUIRED | **The adopted mechanism already contains the silent cascade FR-A37 forbids**: lifecycle rows cascade from feed items, which cascade from `lead_signals`. `lifecycle_history`'s append-only protection is **bypassed via the cascade** |
| **AC-A11** | **OWNER DECISION REQUIRED** (escalated) | Cites two withdrawn names; and **which of the nine states a no-evaluation opportunity must read as is an owner act** — Q1-1 fixed only the vocabulary, and FR-A41's approved meanings exclude `detected` |
| **AC-A13** | CLARIFICATION REQUIRED | Same withdrawn name as FR-A13 |
| **AC-A14** | CLARIFICATION REQUIRED | "action state" is an undefined second state axis; not testable, and risks being implemented as a tenth lifecycle state. NC-A8 inherits the ambiguity |
| **AC-A17** | **UNVERIFIED** | Demands denial be attributable to row-level security, but production isolation rests on application logic plus composite FKs because the service role holds a bypass. Passing it establishes nothing about the live path; NC-A10 guards only the grant confound |
| **AC-A24** | CLARIFICATION REQUIRED | Inherits FR-A32's durability defect; also overlaps new AC-A32 while using the looser word "terminal" against AC-A30's single-named-constant demand |
| **AC-A27** | CLARIFICATION REQUIRED | "**any** Community Discovery record" is broader than FR-A24's four enumerated kinds, and the lifecycle table PI must write to is anchored to a Community Discovery record. A faithful scan would flag PI's own owner-decided transitions |

### 2.3 Reviewer's assessment of the prior review

**Agreed:** all five prior flags are legitimate; **none over-flagged**. Independence disclosure judged honest and prominent.

**Faults the reviewer identified:**

1. **The prior mechanical scan — rated "HIGH confidence, reproducible" — had a false negative.** It word-boundary-matched `disqualified`, so it caught `closed` in "auto-closed" (where the inflection equals the state name) but **missed `disqualify` in "auto-disqualify"** (FR-A12). The figure "3 items citing a withdrawn state name" is therefore **wrong — it is 4** — and the argument that the flags "survive the independence limitation because they came from a mechanical scan" is weakened by that scan having a demonstrable defect.
2. **FR-A35 passed and dismissed as "self-referential"** without mentioning that v0.3's own §6.2 and §7.1 declare it unresolvable pending Q3 — a contradiction resolved silently in the document's favour.
3. **The FR-A13/AC-A13 remedy direction is substantively wrong.** Under FR-A38, `archived` is the sole terminal state for deletion eligibility, so "auto-archived" would make stale opportunities automatically **deletion-eligible** and discard the intent that "recurrence remains visible" — worse than the stale wording. A mechanical substitution is unsafe.
4. **AC-A11 under-categorised** as clarification while the prior review itself asserted the answers; naming the state is an owner act.
5. **Reporting 0 UNVERIFIED** is only reachable by not testing any item against the system.
6. **Root cause: the method cannot find semantic defects.** Steps 3 and 4 were keyword scans; anything containing neither keyword set was auto-PASS. No item was read against the mechanism's schema, cardinality or cascade behaviour, so a Q3 dependency expressed without the word "policy" (BR-A2) was invisible by construction.

---

## 3. Author's verification of the reviewer's material claims

**Every claim below was verified independently by the author against source. None was accepted on the reviewer's assertion alone.**

| # | Reviewer claim | Verification | Result |
|---|---|---|---|
| 1 | FR-A12 contains "auto-disqualify" | v0.1 line 56: *"…a contradiction shall not auto-disqualify an opportunity"* | **CONFIRMED** |
| 2 | The prior regex could not match it | Executed both patterns on the text: `(?<![a-z])disqualified(?![a-z])` → **False**; substring `disqualif` → **True** | **CONFIRMED — the author's scan had a real false negative** |
| 3 | Lifecycle rows cascade from feed items | `20260520_phase6_realtime_lifecycle_workflow.sql:16` — `opportunity_feed_item_id UUID NOT NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE` | **CONFIRMED** |
| 4 | `lifecycle_history` is append-only protected | `backend/types/retention.ts:69-72` — `APPEND_ONLY_TARGETS = { 'lifecycle_history', 'moderation_decisions' }` | **CONFIRMED** |
| 5 | `opportunity_feed_items` is a hard-delete retention target | `retention.ts:4` (member) and `:57` — `soft_delete_column: null` | **CONFIRMED** |
| 6 | Therefore the append-only protection is bypassed by the cascade | Follows from 3 + 4 + 5: deleting the parent feed item cascades the protected child rows away without the child's own protection applying | **CONFIRMED by construction** |
| 7 | No current-state column; state derived | `20260520…sql:9` — *"CURRENT state is derived from the most-recent (by transitioned_at) row."* | **CONFIRMED** |
| 8 | `signal_id` NOT NULL and one feed item per signal | `20260518_phase4…sql:97` — `signal_id UUID NOT NULL REFERENCES lead_signals(id) ON DELETE CASCADE`; `:113` — `CONSTRAINT opportunity_feed_items_signal_unique UNIQUE (organization_id, signal_id)` | **CONFIRMED** |
| 9 | Cascade chain reaches `lead_signals` | `:97` is itself `ON DELETE CASCADE`, so `lead_signals` → `opportunity_feed_items` → `opportunity_lifecycle_states` | **CONFIRMED** |
| 10 | v0.3 contradicts itself on FR-A35 | v0.3 line **428**: *"FR-A34, FR-A35 and AC-A29 remain unresolvable until the above is supplied."* while §3.2 lists FR-A35 among the UNCHANGED/Verified-YES items | **CONFIRMED** |
| 11 | `acted` and `superseded` do not appear in the 78 | Re-scanned by substring; no occurrences | **CONFIRMED** |
| 12 | Prior review over-flagged nothing | Author agrees: all five prior flags stand | **CONFIRMED** |

### 3.1 The author's corrected vocabulary count

**The prior review's figure of 3 withdrawn-vocabulary items is wrong. The correct figure is 4: `AC-A11`, `FR-A12`, `FR-A13`, `AC-A13`.**

The author's scan used a word-boundary match on the exact state names, which cannot match inflections. A substring scan on the stems (`disqualif`, `clos`, `supersed`, `act`) is the correct method and was not used. **This is recorded as an author error, not softened.**

### 3.2 Where the author's judgement differs from the reviewer's

| Item | Reviewer | Author's position after verification |
|---|---|---|
| **FR-A35** | BLOCKED BY Q3 | **Agreed that v0.3 contradicts itself and must be reconciled.** The author notes the substantive reading is defensible either way — the constraint "this addendum defines no retention period" is satisfied by not defining one — but v0.3 cannot classify it both VERIFIED and unresolvable. **Classification is an owner call; recorded as PENDING OWNER DECISION rather than silently resolved either way.** |
| **FR-A13 / AC-A13 remedy** | Objects to `closed`→`archived` | **Author accepts the objection.** Auto-archiving would make stale opportunities deletion-eligible under FR-A38, defeating the intent. The author's earlier proposed direction is **withdrawn**; §4 of the main report proposes wording that names no auto-transition at all |
| **AC-A11 category** | OWNER DECISION REQUIRED | **Author accepts the escalation.** FR-A41's approved meanings cover only `triaged`, `reviewing`, `monitoring`; `detected` was not among them, so designating the state is an owner act |

**No disagreement was resolved in the author's favour without verification, and the two places where the reviewer corrected the author are recorded as corrections.**

---

## 4. Outcome

| | |
|---|---|
| Independent-review gate | **PARTIALLY SATISFIED — a structurally separate reviewer examined all 78 items; a human reviewer has not** |
| Non-PASS items, consolidated across both reviews | **21** (20 from the second reader, plus the author's FR-A13/AC-A13/AC-A11/FR-A29/FR-A34 which the reviewer subsumed or escalated) |
| Items the second reader newly surfaced | **15**, plus 1 escalation |
| Most serious findings | **(a)** terminality is not durable — a retention hard delete cascades the lifecycle history away and the account becomes permanently undeletable; **(b)** the adopted mechanism already contains the silent cascade FR-A37 forbids; **(c)** non-signal-origin opportunities cannot hold a lifecycle state at all |
| v0.3 ratification-ready? | **NO** |

**A further defect in v0.3 itself, outside the 78, raised by the reviewer and confirmed by the author:** v0.3's per-item **"Verified: YES"** column reads as "verified against the system" but means only "wording extracted verbatim" (v0.3 §9.1 check 8). All 78 rows carry it, including items v0.3 §5.7 marks NOT IMPLEMENTED. **The column is misleading and should be relabelled in any successor version.**
