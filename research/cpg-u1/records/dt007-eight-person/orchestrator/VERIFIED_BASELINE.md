# DEEPTECH-PARALLEL-007 — orchestrator's verified baseline

Read or computed directly by the orchestrator. Nothing registered, committed, pushed or executed.
No frozen byte modified.

## Identities (re-verified at task start)

| Item | Value |
|---|---|
| `origin/main` | `af2fb6e99ce461894bf16f18c2251f75088eba18` |
| `origin/main:research/cpg-u1` tree | `2d66f68088e6f230d8ae92b180b6db53c49502b4` |
| Protocol-004 sha256 | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) |

## 1. A second enumerator is explicitly permitted — §4A.3

> **Roles:** operator (key custodian; not independent); **enumerator (≥ 1)**; reference Author; reference Confirmer;
> reference adjudicator; rater 1; rater 2; rating adjudicator.
>
> **Every independent role is held by a different person, and no independent role is held by the operator.**
> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**.
> - **Several enumerators are permitted; each holds no other role.**
> - An enumerator may not be the reference adjudicator. …

Tooling agrees: `lib/personnel.mjs:26` is
`else if (role !== 'enumerator' && n > 1) errors.push(...)` — multiple holders are permitted for `enumerator`
**and only** for `enumerator`.

**The strongest single piece of evidence, found by Agent A and verified by me** — the frozen instrument contains a
passing self-test asserting that an eight-person register is conformant. `test/selftest.mjs:829`:

```js
{ const r = personnel(); r.assignments.push({ ...r.assignments[0], person_id: 'SYN-P-ENUM2', pseudonym: 'e2' });
  ok(chk(r).errors.length === 0, 'multiple distinct enumerators permitted'); }
```

and immediately after it, `:830`:

```js
{ const r = personnel(); r.assignments.push({ ...r.assignments[4], person_id: 'SYN-P-R1B' });
  ok(chk(r).errors.some((e) => e.includes('exactly one')), 'a second rater-1 refused'); }
```

So the distinction is **deliberate and tested**: a second enumerator is accepted with zero errors, a second `rater-1`
is refused. Since the tooling aggregate is itself a registration object, the freeze *as implemented* asserts that the
eight-person register conforms. (Agent A cited this as line 824; it is at **829**. Substance correct, line corrected.)

## 2. Per-row attribution already exists in the frozen schema

`FRAME_COLUMNS` (22 columns) ends with **`enumerated_by`, `enumerated_at`, `enumeration_source_url`**, and
`lib/schema.mjs:124` enforces `enumerated_by` non-empty. The §15.3 screening log separately carries `screened_by`
(`cpg_u1_data.mjs:140`, `:155`).

**So the frozen instrument already attributes every frame row to an individual enumerator.** No schema change is
needed to tell two enumerators' rows apart. Nothing yet seen validates `enumerated_by` against the personnel
register — recorded as a gap for Agent C to confirm.

## 3. §19.3(3) — the potential STOP condition, and my reading

Heading: "### 19.3 Named prerequisites (**not decisions; must exist before the stated act**)". Item 3:

> **Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference Author, Confirmer
> and adjudicator, ≥ 2 raters and a rating adjudicator — before the respective stage (or a recorded absence of raters
> with the §12 ceiling). Seven mutually exclusive independent persons.

I read the closing sentence as a **minimum**, not an exact count: the section states what "must exist" (a floor by
nature); the item writes "enumerator(s)" with an explicit plural marker; it writes "≥ 2 raters", showing explicit
minimum notation in the same sentence; and §4A.3 says "minimum 7". **Agent A is testing the contrary reading**
(a bare cardinal with no minimum marker, unlike "≥ 2 raters" beside it) and will give an independent verdict.

## 4. The enumerator barrier is narrower than it first appears — and it bites on coordination

§4A.2's receive-list is exhaustive: "public sources; the frame template; §4A, **§5.1–§5.4**; the jurisdiction-family
list; the development-only registry." **§5.7.2 is not in that list**, so no enumerator ever learns the 126/52/32
thresholds. §5.5.3 adds: "**Enumerator barrier.** Enumerators never receive pilot, sizing or quota information
(§4A.2)."

Consequence: a partition rule may not instruct an enumerator in terms of class quotas. "We need more
abstention-expected rows" is quota information. This constrains the partition design — and it plausibly rules out a
partition **by outcome class** while leaving a jurisdiction partition untouched, since the jurisdiction-family list is
material enumerators already receive.

**This tension pre-exists for a single enumerator** (they too never learn the quotas), so it is probably not a cost of
the eight-person model. Agent E is establishing that.

**Agent B corrected my reason for rejecting a class partition, and the correction matters.** The leak is not nominal
but *arithmetic*: enumerators already know the three classes exist, because §5.2 is inside the §5.1–§5.4 material they
receive. What would breach the barrier is that the per-class volumes are unequal (126 : 52 : 32 ≈ 2.42 : 1 : 0.615),
so assigning one enumerator a single class effectively hands them that class's threshold up to the yield factor. Agent
B adds a third, independent ground: §5.2 defines the class as "the enumerator's **prediction**", so the class is an
**output** of the work and cannot be a partition key at all — an enumerator assigned "abstention-expected" who
concludes "fill-expected" holds a row they may neither keep nor hand over.

**Agent B also found the largest cost in the whole design, and it is not about parallelisation.** Because no enumerator
may be told the quotas, total volume must be set by the class with the worst target-to-yield ratio, and every other
class overshoots. With no class guidance at all the binding class is identity-hazard and the ask is ~712 candidates;
with a **quota-free qualitative sentence** — that rows must cover all three §5.2 classes, that fill-expected will be
commonest, and that the other two should be sought deliberately — the binding class becomes fill-expected and the ask
falls to ~400. Agent B prices that single sentence at **≈ 98.6 hours saved (−36.6%)**, disclosing no number, and it
applies with **one** enumerator as much as two. Its figures rest on stated per-row time assumptions, which Agent G is
checking independently.

### Correction to my own citation

I attributed the "Enumerator barrier" bullet and the "Single frozen frame" block to **§5.5.3**. Agent A corrected me
and it is right: §5.5 begins at line 259, §5.5.1 at 291, §5.5.2 at 304 and §5.5.3 at 311, so the bullets at lines
284–289 sit under **§5.5** itself, not §5.5.3. The text I quoted is accurate; the section number was wrong.

### One discrepancy left open, immaterial to the verdict

Agent A reports the worktree's own `research/cpg-u1/tooling` as 587 files with aggregate
`b11e0066a4a64a2203605061a3a8c1109da4a2dab88465f6985c7030c0c9e11d`. I get the same **file count (587)** but aggregate
**`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`**, which matches the value previously recorded
for the pre-B1–B6 in-repo base. Likely a difference in hashing invocation rather than in the tree. A's substantive
point stands and is worth repeating: **anyone re-verifying inside a worktree alone gets a mismatch, because the
registered instrument is the uncommitted 593-file `C:/tmp/dt002` tree.**

### Uniqueness is already enforced — §5.7

> "**Uniqueness** [enforced]: one row per legal entity. Duplicate identifiers or duplicate canonical domains are
> refused."

This is the only mechanical consequence of overlapping partitions, and it fires at `frame`. Note also §5.7's
jurisdiction balance rule — families are interleaved round-robin in the fixed order `US-SEC, FR-SIRENE, BR-CNPJ,
LEI-ONLY` — but that governs the **draw**, not enumeration.

## 5. The frame is frozen early and hard — §5.5

> "**Complete before the development commitment.** The complete frame F must exist and meet the sufficiency rule
> (§5.7.2) before the development commitment." · "**One frame for both stages.** The held-out payload's `frame_hash`
> and `scan_sha256` must equal the development payload's…" · "**No changes after the development commitment.** Rows
> may never be added, removed, edited, re-identified or reclassified (enforced: CLI refusal before the held-out
> commitment; VOID at chain verification)."

So the merge, the scan and the sufficiency check must all complete **before** the development commitment.

### CORRECTION — I was wrong that a short frame cannot be repaired

I told Agents B and D that "there is no lawful top-up of a short partition" and that an unbalanced partition "risks a
frame that fails sufficiency and cannot be repaired". **Agent B corrected me and it is right.** §5.7.2 reads:

> "If unmet, **no development commitment may be made; enumeration continues first** (enforced:
> `check-frame-sufficiency`, `commitment-payload`)." · "A development commitment to an insufficient frame is
> **STAGE_VOID_FRAME_INSUFFICIENT**: the slot is consumed and there is no retry (enforced at `draw-development`)." ·
> "At least 210 eligible admissible rows must be enumerated and screened before the development commitment."

So the two gates are distinct. **Before** the commitment, enumeration may continue and rows may be added freely — a
short frame costs calendar time, not the study. §5.5's "Rows may never be added…" bites only **after** the commitment.
The unrecoverable failure is *committing* to an insufficient frame, which the two named commands exist to prevent.

The buffer in the initial ask is therefore justified by round count, barrier latency and that tail risk — not by an
unrepairable frame. I retracted the wrong constraint to Agent D while it was still working.

This also confirms why the enumerator's load is **size-independent**: the frame must satisfy the fixed 126/52/32
minimum before any pilot exists to size the held-out set.

## 6. Inter-enumerator judgement conflicts already have a lawful home — my key finding

`EXCLUSION_REASONS` (16, from `lib/schema.mjs`): `A1_NOT_OPERATING_ENTITY`, `A1_NOT_ESTABLISHED`,
`A2_NO_CONTROLLED_DOMAIN`, `A2_NOT_ESTABLISHED`, `A3_INVALID_IDENTIFIER`, `A3_NOT_ESTABLISHED`,
`A4_NO_INDEPENDENT_TIE`, `A4_NOT_ESTABLISHED`, `A5_INACCESSIBLE_JURISDICTION`, `A5_NOT_ESTABLISHED`,
`A6_REFERENCE_NOT_OBTAINABLE`, `A6_NOT_ESTABLISHED`, `OUTCOME_CLASS_NOT_ESTABLISHED`, `MALFORMED_ROW`, `NOT_DRAWN`,
`DEVELOPMENT_SURPLUS`.

None names an inter-enumerator conflict — **and none is needed.** §5.1: "UNKNOWN means 'not established /
insufficient evidence'. It never means false, and it never satisfies a criterion [enforced: `checkFrameRow`;
exhaustive 81-combination test]."

**Two competent independent enumerators disagreeing on a criterion *is* insufficient evidence for it.** So a genuine
judgement conflict maps to `unknown` on the disputed criterion → never satisfies it → the row is ineligible and
excluded under an **already-existing** reason (`aN_NOT_ESTABLISHED`, or `OUTCOME_CLASS_NOT_ESTABLISHED` for a class
disagreement). The conflict is *preserved and published* in the §15.3 screening log rather than silently resolved.

**No new exclusion reason, no schema change, no re-freeze, no third human.** This is the exact opposite of the
rating-disagreement case in the previous wave, where §15.1 had no home for a disagreement at all. The cost is paid in
sufficiency headroom against 126/52/32, not in evidentiary strength. Agent D is confirming and implementing it.

## 6a. The sizing floor, verified exactly

`FRAME_MINIMUM` = `{fill-expected: 126, abstention-expected: 52, identity-hazard: 32}`, and it is exactly
**2 × Qmax + DEVELOPMENT_QUOTA** per class: 2×60+6 = 126, 2×25+2 = 52, 2×15+2 = 32 (`POOL_MULTIPLIER` = 2,
`DEVELOPMENT_QUOTA` = 6/2/2, Qmax = 60/25/15 over all 4096 pilot outcomes). So the pool minimum and the development
consumption are **already inside the 210** and must not be applied twice.

This confirms the **size-independence** of the enumerator's load: the floor is built from the *maximum* quota over
every possible pilot outcome, so the frame must satisfy 126/52/32 before any pilot exists to size the held-out set.
Agent G adds a consequence nobody had drawn: the eighth person is worth **most** at the 20-company floor, where
enumeration is ~51% of the study, and **least** at the 100-company cap, where it is ~37%.

Agent G also clarifies that §5.7.2 is a **per-class** rule — `frameSufficiency()` returns a per-class `shortfall[]`, so
reaching 210 in total is not sufficient and the binding constraint is the worst class. Any flat-yield-on-a-single-total
calculation is wrong.

## 6b. THE DECISIVE CONDITION — and I can answer it

Agent G's headline risk is that the saving **reverses** if the eighth person is added *late*: §4A.1 item 6 disqualifies
anyone related to "any holder of **another** §4A.3 role", and "An unknown answer is not 'no'", so a declaration signed
before an eighth role-holder existed **cannot** cover that person. Adding them after the register closes forces a
second declaration round plus a cold single-person search. G computes the net as **negative in 252 of 648 grid cells**
at central late-addition cost, and in 617 of 648 at worst — a reversal of up to ~2.9 weeks. Worse,
`checkPersonnelRegister` only tests that each declaration string is `"no"`, so **`check-personnel` exits 0 on a
methodologically stale register** — nothing mechanical catches it.

G correctly flagged "is the personnel register still open?" as the question the whole sign turns on, and could not
answer it. **I can: it is open.** Only `INDEPENDENCE_DECLARATION_TEMPLATE.md` and the `declaration_intake.mjs` tool
exist in `dt004-operations/people/`; there is no populated register and no signed declaration anywhere in the
preserved artefacts. The DAG records task B3, "Recruit 7 independent persons", as **BLOCKED — HUMAN REQUIRED**, never
started.

**Therefore Model R1 (decided up front) applies, not Model R2 (added late), and the net effect is positive:
+1.65 … +2.44 weeks at the central gross saving.** This is conditional on acting **before** recruitment begins — which
makes it time-critical in a way the original directive did not anticipate. If recruitment starts on a seven-person
roster, the opportunity is lost and re-adding the eighth person may cost more than it saves.

## 7. Jurisdiction families, for the partition design

`JURISDICTION_FAMILIES` = `{"US-SEC":["CIK","LEI"], "FR-SIRENE":["SIREN","LEI"], "BR-CNPJ":["CNPJ","LEI"],
"LEI-ONLY":["LEI"]}` — four families, so a jurisdiction partition has four indivisible units. They are **not**
interchangeable in effort: registry data availability differs, so a two-and-two split by count may be very unequal in
hours. `OUTCOME_CLASSES` = `["fill-expected","abstention-expected","identity-hazard"]`.

## 8. BASELINE CHANGE DURING THE WAVE — recorded, immaterial

At the end of this wave `origin/main` was no longer `af2fb6e99ce461894bf16f18c2251f75088eba18`. It had advanced to
**`33bceb1f919113c622587fa7c6403a0d4596bbad`** — "Merge pull request #271 … integrate/pi-batch1-t2", the PI programme's
batch-1 T2 integration, unrelated to CPG-U1.

**Nothing this wave depends on changed.** `research/cpg-u1` is the identical tree
`2d66f68088e6f230d8ae92b180b6db53c49502b4` at **both** commits; the protocol is still
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; and the instrument at `C:/tmp/dt002` still
recomputes to `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` over 593 files. All seven agents worked
detached at `af2fb6e9`, which remains a valid base for this analysis.

Recorded so that no later reader mistakes the moved tip for drift in the frozen material.

## 9. Final test verification, run by me

| Suite | Result | Note |
|---|---|---|
| C `test_partition.mjs` | 76 passed, 0 failed | requires `CPG_U1_TOOLING`; without it 73 passed / 3 skipped |
| C `test_auditlog.mjs` | 36 passed, 0 failed | as above (34 / 2 skipped) |
| C `mutate.mjs` | 56 mutants, **56 killed, 0 survived** | without `CPG_U1_TOOLING`: 55 killed, 1 survivor (`GENESIS length changed`), killed only by the env-gated conformance test |
| D `merge.test.mjs` | **125 passed, 0 failed** | takes the frozen tooling dir as argv |
| D `mutate.mjs` | **70 mutants, 70 killed, 0 survived** | >120 s; run in background |

Artefacts preserved: **100 files** under `C:/tmp/dt007-eight-person/`. Report sha256
`c168669475a5f0fc830efd69ad6d3f99d6fba579dc65237e5b09e52d55b693c6` (before this appendix was added to the baseline).
