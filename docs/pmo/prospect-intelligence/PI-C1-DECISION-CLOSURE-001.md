# PI-C1-DECISION-CLOSURE-001 — decision and schedule closure

**STRICTLY READ-ONLY.** No implementation, no migration created or applied, no database write, no production data or ACL access, no production migration-history query, no provider call, no feature-flag change, no commit, push, merge or deployment, no modification of `C:/virality` or any other worktree, and **no existing controlling document modified**. Two new files only (§2.3).

**This report is not implementation authorization. Neither is the proposed addendum.**

---

## 1. Readiness verdict

### **CONDITIONALLY READY** — the governance path is now settled; **three policy answers gate the schema**, and **OVERRUN RISK remains RAISED**.

Two of the gate's blockers are resolved by owner direction:

| Gate blocker | Was | Now |
|---|---|---|
| **P-26** requirement authority for the opportunity entity | **OPEN — BLOCKING** | **RESOLVED IN DIRECTION.** The vehicle is a separately approved, versioned addendum; the ratified manifest stays unchanged. Draft delivered as **PI-ADD-001 v0.1-PROPOSED** (§2.3). **Ratification itself remains OPEN** |
| **P-25** D-H — may legal erasure be permanently blocked? | **OPEN — BLOCKING** | **RESOLVED IN DIRECTION.** A governed legal-erasure path is required and erasure is not permanently blocked. **No retention period is defined and none was invented** |

What still gates C-1a is narrower than before and is entirely policy, not engineering:

| # | Question | Blocks |
|---|---|---|
| **Q1** | Which states are **terminal** for ordinary deletion — does an **acted** opportunity block it? | the account foreign-key action and its acceptance criteria |
| **Q2** | May an operator **bulk-resolve**, and must a resolution carry a **reason code** from a stated vocabulary? | the resolution path |
| **Q3** | What constitutes the **"approved policy"** for the legal-erasure path — who may invoke it, what authorization and evidence it requires, and what record survives | the erasure path and its acceptance criterion |

Q4 (the high-risk action catalogue) gates the second-approver flow, which is a later work package, not C-1.

**Smallest next action: answer Q1, Q2 and Q3, ratify or amend PI-ADD-001, and respond to the §5.5 overrun position. Nothing else is required to authorize C-1a.**

---

## 2. Verified baseline and sources

### 2.1 Repository — measured, not assumed

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree at start | — | **130 entries (67 M / 63 ??), 0 staged** | unchanged from the gate close; nothing reset, cleaned, stashed, switched or disturbed |

### 2.2 Source documents — hash and line count verified before use

| Document | SHA-256 | Lines | Result |
|---|---|---|---|
| `PI-C1-IMPLEMENTATION-GATE-001.md` | `f747c763bd0dbb48e6cd3f3f75809a781451abb114791a4f749a250e8b2622e9` | **446** | **MATCH on both** — hash and line count as specified by the brief |
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-002.md` | `34564a452997d1a8efca32c3…` | — | unchanged |
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` | `257185e621fa0b80eb970d4b…` | — | unchanged |
| `OMNIVYRA-PI-INTENT-CAPABILITY-AUDIT-001.md` | `37dda8956cc81b03a88e9b31…` | — | unchanged |
| `PI-MILESTONE-A-EXECUTION-001.md` (ledger) | `1ad1105accdd5866aa8a61df…` | — | unchanged |
| `IMPLEMENTATION-MANIFEST-001.md` (ratified carrier) | `651575cd73f1c3a7e6e04f0d…` | — | **unchanged — not edited** |

### 2.3 The two new files created by this task

| File | SHA-256 | Lines | Status |
|---|---|---|---|
| `docs/pmo/prospect-intelligence/PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` | `f244adb96027f8078ec263c2ae6aa25f5b46c0ce2ba6cc7daab239a0438a5ad0` | 236 | **PI-ADD-001 v0.1-PROPOSED — not ratified, not approved, not implementation-authorizing** |
| `docs/pmo/prospect-intelligence/PI-C1-DECISION-CLOSURE-001.md` | this file — hash reported on completion | — | decision-closure report |

No other file was created or modified.

---

## 3. Owner decisions applied, and what remains

### 3.1 Applied

| Direction | Effect |
|---|---|
| **D-H — legal erasure** | A **governed legal-erasure path under approved policy** is required; erasure is not permanently blocked by the deletion gate. Encoded as **FR-A34**. **No retention period defined; no automatic retention; no cascade of evidence** — FR-A35, FR-A37 |
| **C-1 requirement authority** | A separately approved, versioned addendum is the authority vehicle. **PI-ADD-001 v0.1-PROPOSED** drafted; `IMPLEMENTATION-MANIFEST-001.md` **untouched** |
| **Schedule** | Frozen dates and budgets preserved; recovery forecast produced (§5); infeasibility flagged (§5.5); **no baseline change made** |
| **D-A / D-A.1** | Community Discovery owns interpretation; PI owns the canonical spine; strictly one-way. **BR-A5, FR-A23…FR-A26**, with enforcement by scan (**NC-A5**) |
| **D-B** | Account-only, person-only or both, at least one subject; **no person minted** to satisfy a constraint. **FR-A2, FR-A3**; tested by **AC-A1…AC-A3** |
| **D-I** | Relational buying-role entity with mandatory inference provenance. **FR-A14…FR-A18**; tested by **AC-A7…AC-A9**, enforced by **NC-A4, NC-A9** |
| **D-J baseline** | Same authorized operator with step-up as the baseline; second approver only for designated high-risk actions. **FR-A28, FR-A29** |

### 3.2 OPEN — no approval inferred

| Item | Status | Blocks |
|---|---|---|
| **Q1** terminal states for ordinary deletion | **OPEN** | C-1a schema (§4) |
| **Q2** bulk-resolve and reason-code vocabulary | **OPEN** | the resolution path |
| **Q3** content of the "approved policy" for legal erasure | **OPEN** | the erasure path, AC-A29 |
| **Q4** designated high-risk action catalogue | **OPEN** | the second-approver work package, **not C-1** |
| **PI-ADD-001 ratification** | **OPEN** | authorization to implement C-1 |
| **OD-3** list permissions / archive semantics | **BLOCKED** | WP-4 |
| **OD-4** `added_via` contract | **BLOCKED** | WP-4 |
| **OD-5** person-erasure residue | **BLOCKED** | WP-5 |
| **D-C** person/contact reconciliation | **OPEN** | the bridge work package |
| **D-E** need-to-offering matching method | **OPEN** | the matching work package (which traces to ratified **FR-16/FR-17**, not to the addendum) |
| **Company-event sources** | **NOT AUTHORIZED** | signal types and weights in code are **code, not authorization** |
| Row-level-security design track | **OPEN** | — |

### 3.3 UNVERIFIED

| Item | Why |
|---|---|
| Production migration state of the five PI migrations | Production migration history is a prohibited operation here and was not queried |
| Production tenant isolation | Production ACLs never read. The service role holds a row-level-security bypass and the application connects as that role, so **isolation on the live path is application logic plus composite foreign keys, not row-level security** |
| Production values of the ingestion flag and its global kill switch | Not read |

---

## 4. The D-H design boundary

### 4.1 Why `ON DELETE RESTRICT` alone can block deletion indefinitely

`RESTRICT` makes the database refuse to delete a parent row while any child row references it. Applied to the account reference on an opportunity, that is exactly the wanted safety property for **ordinary** deletion: an account with live opportunities cannot be removed by accident, and the refusal is atomic.

The failure mode is what happens **next**. A refusal is only safe if something can clear the condition. With no governed resolution path:

1. An account accumulates one or more non-terminal opportunities.
2. Ordinary deletion is refused, correctly.
3. **There is no defined action that moves those opportunities to a terminal state**, because the states that count as terminal and the authority to change them are not settled.
4. The refusal therefore persists for the lifetime of the record. The account becomes **permanently undeletable**, and a control intended to prevent accidental loss has become a retention decision that nobody made.

That is why the gate withheld readiness on this point, and it is why the two halves must land together: the refusal (FR-A32) and the resolution path (FR-A33) are one design, not two.

### 4.2 Ordinary deletion and legal erasure are different paths

The owner direction separates them, and the design must keep them separate:

| | **Ordinary account deletion** | **Legal erasure** |
|---|---|---|
| Trigger | operator housekeeping | a rights request or legal obligation |
| Behaviour when opportunities are open | **REFUSED** (FR-A32) | **MUST PROCEED** through a governed path (FR-A34) |
| Why the difference | accidental loss of live commercial evidence is the risk | an unmet erasure obligation is the risk, and a refusal cannot be the final answer |
| What this report defines | the refusal mechanism, specifiable now (§4.3) | the **requirement** that a governed path exist — **not its policy** (§4.4) |

Collapsing the two would produce one of two defects: ordinary deletion that silently destroys evidence, or an erasure obligation that the schema refuses. The design admits neither.

### 4.3 Technical acceptance criteria that are specifiable now

| # | Criterion |
|---|---|
| TA-1 | Ordinary account deletion is **refused atomically** while a non-terminal opportunity references the account; nothing is partially deleted (**AC-A23**) |
| TA-2 | Ordinary account deletion **succeeds** once every referencing opportunity is terminal (**AC-A24**) |
| TA-3 | The refusal is produced by the **schema**, proven by a negative control that relaxes it and shows TA-1 fail, then restores (**NC-A3**) |
| TA-4 | The refusal message names the condition and a blocking **count**, and contains **no need statement and no attribute value** (**AC-A26**) |
| TA-5 | Any resolution action requires an explicit authorization check with step-up, and is **audited including on denial** (**AC-A18, AC-A19**) |
| TA-6 | Person erasure leaves the opportunity **account-anchored** with the evidence intact and no individual named (**AC-A25**) |
| TA-7 | No deletion or erasure path **cascades evidence silently**, and none weakens the at-least-one-subject invariant (**FR-A37**) |
| TA-8 | Legal erasure completes through the governed path **without being blocked** by TA-1 (**AC-A29** — *specifiable only after Q3*) |

### 4.4 The exact remaining policy questions — not invented, not assumed

| # | Question | Why it cannot be answered here |
|---|---|---|
| **Q1** | Which lifecycle states are **terminal** for ordinary deletion? Specifically, does an **acted** opportunity block deletion? | `closed`, `superseded` and `disqualified` are plainly terminal. **`acted` is genuinely ambiguous**: it means an approved action occurred, which is both a reason the record matters commercially and a reason it may need to persist for audit. Choosing either way is a policy choice about what deletion means |
| **Q2** | May an operator **bulk-resolve** blocking opportunities, and must a resolution carry a **reason code** — from which vocabulary? | Bulk resolution is the difference between a usable control and one operators route around. A reason-code vocabulary is a governance artefact, not a technical default |
| **Q3** | What is the **"approved policy"** that governs the legal-erasure path: who may invoke it, what authorization and evidence it requires, and **what record survives** erasure? | The direction requires a governed path *under approved policy*; the policy itself has not been supplied. Inventing it would be inventing retention — explicitly prohibited |

**These three are marked OPEN, and the corresponding implementation prerequisite (the account foreign-key action and its resolution path) remains OPEN.** No retention period is proposed, no automatic retention is proposed, no cascade is proposed, the at-least-one-subject invariant is not weakened, and **no legal-policy approval is claimed**.

### 4.5 What is deliberately not blocked

The owner has answered that legal erasure gets a governed path. This report therefore does **not** re-ask whether erasure may be blocked, and does not treat that as open. Only the **content** of the approved policy (Q3) is open.

---

## 5. Dated schedule recovery forecast

### 5.1 Frozen baselines — verified against the ledger

| Item | Brief states | **Ledger `1ad1105accdd5866…`** | Result |
|---|---|---|---|
| Milestone A′ date | 2026-11-25 | §3.1 **Wed 2026-11-25** | **MATCH** |
| Milestone A′ effort | 28.5 human engineer-days | §3 **"Focused effort: 28.5 engineer-days"** | **MATCH** |
| WP-7 date | 2026-11-17 | §3 row WP-7 **Tue 2026-11-17** | **MATCH** |
| WP-7 budget | 4.0 engineer-days | §3 row WP-7 **4.0** | **MATCH** |
| C-1 estimate | 8–12 engineer-days | Gate §9.3 **8–12 d**, MEDIUM-HIGH | **MATCH** |

**Baseline source:** `PI-MILESTONE-A-EXECUTION-001.md` §3, frozen at 2026-10-17T06:05:34+05:30. **No discrepancy. No baseline changed by this report.**

### 5.2 Actual completions, from the ledger

| WP | Budget | **Actual completion** | Active effort |
|---|---|---|---|
| WP-1 | 0.5 d | 2026-10-17 | within session 1 |
| WP-2 | 5.0 d | **2026-10-17T07:00:12+05:30** | 54 min 38 s |
| WP-3 | 4.0 d | **2026-10-17T12:53:51+05:30** | 52 min 41 s |
| WP-6 | 3.0 d | **2026-10-17T14:16:40+05:30** | 42 min 29 s |
| **Baselined effort consumed** | **12.5 d** | — | — |

### 5.3 This task's own clock

| | |
|---|---|
| **Actual start** | **2026-10-17T17:07:24+05:30 (IST)** |
| External wait before start | **30 min 19 s** (gate close 16:37:05 → 17:07:24) — **not** engineering effort |
| Original estimate for this task | **0.5 engineer-days** |
| Estimate consumed at report | **~5 minutes** active |
| 75% threshold | 0.375 engineer-days — **not approached** |
| Remaining estimate | 0 — complete at this report |
| Monitoring | **No continuous monitoring is claimed between reports.** Every timestamp is a measured `date -Iseconds` |

### 5.4 Critical path and forecast — C-1 before WP-7, as directed

Remaining baselined work: WP-4 2.0 + WP-5 3.5 + WP-7 4.0 + WP-12 5.0 + WP-13 1.5 = **16.0 d**.
C-1 is **new scope the 28.5-day baseline never contained**: **+8–12 d**.
**Total remaining: 24.0 – 28.0 engineer-days.**

Directed path: **C-1 → WP-7 → WP-12 → WP-13**, with WP-4 and WP-5 re-entering when OD-3/OD-4/OD-5 are answered. Capacity remains **one sequential owner**, so nothing overlaps and no package has independent float.

**Calendar, Mon–Fri, from the next working day Mon 2026-10-19:**

| Target | Working days available | Work required | Float |
|---|---|---|---|
| **WP-7 — Tue 2026-11-17** | **22** | C-1 (8–12) + WP-7 (4.0) = **12–16 d** | **+6 to +10 d** → **FEASIBLE at both ends** |
| **Milestone A′ — Wed 2026-11-25** | **28** | **24.0 – 28.0 d** | **+4 d at the low C-1 estimate; ZERO at the high estimate** |

### 5.5 **OVERRUN RISK — REMAINS RAISED**

First raised 2026-10-17T16:33+05:30 in the gate; **no evidence has resolved it**, so it remains visible as instructed.

| Field | Content |
|---|---|
| Baseline at risk | **Milestone A′ — Wed 2026-11-25**, 28.5 engineer-days (verified §5.1) |
| Baseline **not** at risk | **WP-7 — Tue 2026-11-17** is feasible with **+6 to +10 days** of float |
| Forecast range | completion between **2026-11-19** (low C-1) and **2026-11-25** (high C-1) |
| **Quantified gap** | **Zero float at C-1 = 12 d.** Breach begins the moment total remaining work exceeds 28.0 d — i.e. **if C-1 exceeds 12.0 d, the breach equals the excess**: C-1 at 13 d → 1-day breach; at 14 d → 2 days; at 16 d → 4 days |
| **Second, sharper exposure — decision latency** | C-1 cannot start until Q1–Q3 are answered and PI-ADD-001 is ratified. **Every working day of delay consumes Milestone A′ float one-for-one.** At the high C-1 estimate the float is already zero, so **a single day's decision delay breaches the date** |
| **Latest feasible C-1 start** | **Mon 2026-10-19** at the 12-day estimate · **Fri 2026-10-23** at the 8-day estimate |
| **Latest date OD-3/OD-4/OD-5 can be answered** | **Mon 2026-11-09.** WP-4 + WP-5 (5.5 d) plus WP-12 + WP-13 (6.5 d) = 12.0 d, which requires the final 12 working days to 2026-11-25 |
| Confidence | **MEDIUM.** The arithmetic is certain; where C-1 falls within 8–12 d is not, and decision latency is outside engineering control |
| Recovery options — **none applied, none implemented** | **(a)** accept a revised Milestone A′ baseline · **(b)** keep the date and defer WP-4/WP-5 beyond Milestone A′, narrowing the milestone · **(c)** keep the date and defer C-1 until after WP-7, reversing the directed sequence · **(d)** answer Q1–Q3, ratify PI-ADD-001 and answer OD-3/OD-4/OD-5 promptly, which is the only option that preserves both the date and the directed sequence |
| Owner approval required | **YES** for any baseline change. None is proposed here |
| **Next review point** | the earlier of **(i)** receipt of Q1–Q3 and a ratification decision, or **(ii)** **Fri 2026-10-23** — the last date on which C-1 can start and still retain any Milestone A′ float |

**No deadline moved, no estimate reset, no scope reduced, no work resequenced, no recovery option implemented.** The frozen baseline remains in ledger §3 and is not edited.

### 5.6 Agent throughput — reported, and deliberately not substituted

Observed active effort has been far below the human-day budgets: WP-2 **54 min 38 s** against 5.0 d, WP-3 **52 min 41 s** against 4.0 d, WP-6 **42 min 29 s** against 3.0 d. On that throughput neither date is at risk.

**This is not used to clear the alert and is not substituted for the baseline.** The baseline is denominated in **human engineer-days** and is frozen; replacing it with observed agent wall-clock would be the silent re-baselining the direction forbids. The figures are offered solely as evidence the owner may weigh under recovery option (a).

---

## 6. Risks

| Risk | Severity | Position |
|---|---|---|
| Decision latency consumes all Milestone A′ float | **HIGH** | §5.5 — zero float at the high C-1 estimate; **Fri 2026-10-23** is the review trigger |
| Deletion gate shipped without a resolution path | **HIGH** | prevented — the prerequisite is held **OPEN** pending Q1–Q3 |
| A retention period invented to unblock design | **HIGH if it occurred** | **did not occur.** FR-A35 defines none |
| C-1 implemented against an unratified addendum | MEDIUM | PI-ADD-001 is marked PROPOSED in its title, header, every status row and §7 |
| Milestone A′ breach at the high C-1 estimate | MEDIUM | quantified in §5.5; four options, none applied |
| Second-approver machinery is credit-action scoped, not generic | MEDIUM | gate P-15; scoped to a later work package, needs Q4 |
| Production migration state still UNVERIFIED | MEDIUM | compounds before release, **not** before C-1, which is local-only |
| A negative control that silently matches nothing | MEDIUM | NC-A1…NC-A11 each require a planted defect, a proven failure, then restore |

---

## 7. Statement of non-action

During this task: **no C-1a or application change was implemented**; **no migration was created or applied**; **no database operation of any kind was run** — no container started, no SQL executed; **no production data, ACL or migration history was accessed**; **no provider was called**; **no feature flag was altered**; **no unapproved decision was resolved by assumption** — OD-3, OD-4, OD-5, D-C, D-E and company-event sources remain exactly as recorded; **no commit, push, merge or deployment occurred**; **`C:/virality` and every other worktree were untouched**; **no existing controlling document was modified**, including `IMPLEMENTATION-MANIFEST-001.md`.

Only the two files in §2.3 were created.

---

## 8. Verdict and smallest next action

### **CONDITIONALLY READY** — governance path settled; three policy answers and one ratification gate C-1a; **OVERRUN RISK RAISED on Milestone A′ only**

| | |
|---|---|
| WP-7 — 2026-11-17 | **FEASIBLE**, +6 to +10 days float |
| Milestone A′ — 2026-11-25 | **AT RISK** — +4 days float at the low C-1 estimate, **zero** at the high estimate, and eroding by one day per working day of decision delay |

### Smallest next action

1. **Answer Q1, Q2 and Q3** (§4.4) — the only inputs that gate the C-1a schema.
2. **Ratify or amend PI-ADD-001 v0.1-PROPOSED** (`f244adb96027f807…`).
3. **Respond to §5.5** — select a recovery option or accept the zero-float position.
4. Separately, and to protect the end of the plan, **answer OD-3/OD-4/OD-5 by Mon 2026-11-09**.

When 1–3 are done, the next work package is **C-1a only** — three tables, one migration, one rollback script — and the gate should be re-entered before C-1b.

**No implementation is authorized by this report or by the proposed addendum. Explicit owner authorization is required before any implementation work begins.**
