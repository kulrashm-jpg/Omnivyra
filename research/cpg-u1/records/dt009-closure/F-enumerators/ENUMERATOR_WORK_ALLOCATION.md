# ENUMERATOR_WORK_ALLOCATION — the jurisdiction partition, the namespace rule, and the submission procedure

**CLASSIFICATION: PREPARATION. A partition over SLOTS, not an assignment to persons.** No person
exists. **No one has been recruited, approached, engaged or named. No allocation has been made to
anyone and no enumeration has been performed.** No real frame, no candidate, no company. No protocol
byte and no instrument byte modified.

**Marker convention:** `<<PENDING_…>>`, `UNASSIGNED` and `[ ]` are markers, never data. **Every
person-specific field below is an unfilled marker; the partition is fixed, the people are not.**

Baseline: `origin/main` `33bceb1f919113c622587fa7c6403a0d4596bbad`; protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files), read-only from
`C:/tmp/dt002/research/cpg-u1/tooling`, recomputed unchanged after every command.

---

## 1. THE PARTITION

Carried forward from `C:/tmp/dt007-eight-person/B-partition/PARTITION_DESIGN.md` §3, which evaluated
five schemes against two structural tests and recommended:

| Slot | Jurisdiction families | `candidate_id` prefix | Person |
|---|---|---|---|
| **ENUMERATOR_A** | `US-SEC`, `LEI-ONLY` | `<<PENDING_DECISION: proposed `A-`>>` | `<<PENDING_PERSONNEL: ENUMERATOR_A — NO PERSON RECRUITED>>` |
| **ENUMERATOR_B** | `FR-SIRENE`, `BR-CNPJ` | `<<PENDING_DECISION: proposed `B-`>>` | `<<PENDING_PERSONNEL: ENUMERATOR_B — NO PERSON RECRUITED>>` |
| Volume ask, each | `<<PENDING_DECISION: M rows — one number, no class content>>` | — | — |

The four families are frozen in the instrument — `JURISDICTION_FAMILIES` and `FAMILY_ORDER`,
`lib/schema.mjs:41–49` — and the family *list* is already material the enumerator receives under
§4A.2, so a two-line assignment is fully pre-registrable.

**Why this pairing rather than the obvious geographic one.** From
`PARTITION_DESIGN.md` §3 and `WORKLOAD_ARITHMETIC.md`: `{US-SEC, LEI-ONLY}` vs
`{FR-SIRENE, BR-CNPJ}` gives **100.4 h vs 96.1 h — 4.3 h idle, 97.9% efficiency**, better balanced
than `{US-SEC, FR-SIRENE}` vs `{BR-CNPJ, LEI-ONLY}`. And it puts `LEI-ONLY` — the catch-all §5.1
assigns to *inaccessible* jurisdictions — in the **same head** as `US-SEC`, which removes the largest
single source of cross-enumerator entity collision. Those figures are carried forward, not recomputed
here.

**Why the family axis rather than the outcome-class axis.** Splitting by `expected_outcome_class` would
have to tell each enumerator which classes to produce, and class content is quota-adjacent
(§4A.2 never-receive, §5.7.2). The family axis is computable from the **search locus** before any
research: a candidate found in a US filing register is `US-SEC`, so no enumerator ever researches a
candidate only to discover it belongs to the other.

---

## 2. OPERATIONAL RULE 1 — assign the MOST SPECIFIC ACCESSIBLE FAMILY

> **"Assign the most specific accessible family. Use `LEI-ONLY` only for an entity whose jurisdiction
> is not one of the three accessible national families."**

**Grounding — §5.1, protocol line 214, verbatim:**

> **Accessible jurisdiction families** … `US-SEC` (CIK or LEI), `FR-SIRENE` (SIREN or LEI), `BR-CNPJ`
> (CNPJ or LEI), `LEI-ONLY` (LEI). **A company from an inaccessible jurisdiction is admissible only as
> `LEI-ONLY`.**

§5.1 is on §4A.2's receive-list, so the rule restates something the enumerator already holds; it adds
no information.

**What it prevents, concretely.** A US registrant that *also* holds an LEI satisfies **both**
`US-SEC` (CIK **or LEI**) and `LEI-ONLY` (LEI) on the bare `JURISDICTION_FAMILIES` table. Without this
rule, Enumerator A could enter it as `US-SEC` and Enumerator B as `LEI-ONLY` — **one legal entity,
two rows**, which §5.7 forbids (*"**Uniqueness** [enforced]: one row per legal entity"*). The
consequence is not cosmetic: `assertUnique`, `lib/select.mjs:44–51`, **throws**:

```
47    if (ids.has(idKey(c))) throw new Error(`duplicate identifier ${idKey(c)} — one row per legal entity`);
48    if (domains.has(c.canonical_domain)) throw new Error(`duplicate canonical_domain ${c.canonical_domain} — one row per legal entity`);
```

and it is called from the sufficiency path (`lib/select.mjs:71`), so a collision surfaces as a failed
`check-frame-sufficiency` at the worst possible moment — immediately before the development commitment,
where §5.7.2 makes an insufficient commitment **STAGE_VOID_FRAME_INSUFFICIENT** with *"no retry"*.

**The residual hazard this rule does NOT close — and it is the operator's.** Two enumerators may record
the **same legal entity** with a **different decisive identifier** *and* a **different
`canonical_domain`**. `assertUnique` compares only `idKey(c)` and `canonical_domain`, so it is
**blind** to that case, and §5.7's "one row per legal entity" is then silently violated with no throw
at all. Cross-partition entity reconciliation must therefore be done by **someone** — and:

- an **enumerator** may not (they would see the other partition: `KNOWLEDGE_WINDOW_RULE.md` X-3);
- the **reference adjudicator** may not (§4A.3: *"An enumerator may not be the reference
  adjudicator"* — and more to the point, the adjudicator decides contested reference values and must
  not be handed frame composition);
- the **operator** can, but is **not independent** (§4A.3), so the reconciliation becomes an operator
  act on frame composition — exactly the §22 row 31 hazard (*"Operator authors a globally biased
  frame"*).

**DECISION REQUIRED — who reconciles cross-partition entity duplicates?** Carried forward unresolved
from DR-8 §(e) / `INFORMATION_BARRIER_ANALYSIS.md` OQ-5. It is **not** resolved here. Recommended
framing for the owner: the operator performs a purely **mechanical** reconciliation against a
pre-registered tie-break rule (e.g. earliest `enumerated_at`, then lowest `candidate_id` in byte
order), publishes the rule **before** enumeration, and publishes every reconciliation it performed —
so the act is constrained and auditable rather than discretionary.

---

## 3. OPERATIONAL RULE 2 — DISJOINT `candidate_id` PREFIXES

> **Each enumerator's `candidate_id` values begin with a distinct, pre-registered prefix. The two
> prefixes are disjoint (neither is a prefix of the other).**

### 3.1 The instrument imposes no namespace rule — verified

`candidate_id` is constrained by **exactly one** rule in the whole instrument,
`lib/schema.mjs:98`:

```
98    if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.candidate_id)) errors.push('candidate_id must be 1-64 of [A-Za-z0-9_-]');
```

The same pattern appears as `CANDIDATE` / `CANDIDATE_ID` in `lib/harness.mjs:16` and
`lib/raterOrder.mjs:14`. **There is no namespace rule, no prefix rule, no per-enumerator rule and no
uniqueness rule on `candidate_id` anywhere** — not in the protocol, not in `lib/schema.mjs`, not in
`lib/frame.mjs`. `A-1` and `A-1` are both valid and indistinguishable. The prefix convention is
therefore **ours**, it must be pre-registered to have force, and nothing enforces it.

### 3.2 WHY it matters: `frame_hash` order-independence holds ONLY while ids are unique

`frame_hash` is `hashRecords(frame, 'candidate_id')` (`cpg_u1_data.mjs:252`), and
`lib/canonical.mjs:16–21`:

```
16  export function canonicalRecords(records, sortKey) {
17    const sorted = [...records].sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0));
18    return canonicalJson(sorted);
19  }
21  export const hashRecords = (records, sortKey) => sha256(canonicalRecords(records, sortKey));
```

The comparator returns **0** for equal `candidate_id`s. `Array.prototype.sort` is stable, so tied rows
keep their **input** order — and the input order of a merged two-enumerator frame is whatever order the
operator concatenated the two submissions in. **Demonstrated on the frozen instrument:**

```
unique ids, order 1:   664d61583a6006f9b9455d45bf996e531e7414295c5a0139eb0bd58a7a0b66a4
unique ids, order 2:   664d61583a6006f9b9455d45bf996e531e7414295c5a0139eb0bd58a7a0b66a4   <- identical
duplicate ids, order 1: 672e7ab0a6d247644740a1220b1506dac2e41c13924fa4e0696434962e417a9d
duplicate ids, order 2: 893899a665bbec83ab9e3e5747d38def8ec8cb4cc54c67b134d33b3a0c7d0117   <- DIFFERENT
```

**So a single duplicated `candidate_id` makes `frame_hash` depend on the merge order.** That is
directly load-bearing:

- `lib/harness.mjs:50` — `verify(ctx.frameHash === dev.frame_hash, 'FRAME_MISMATCH', …)`;
- `lib/harness.mjs:156` — the same for the held-out manifest;
- `lib/execution.mjs:46` — `if (hashRecords(frameRows, 'candidate_id') !== hoManifest.frame_hash) throw new Error('supplied frame is not the sealed frame')`;
- `cmdAuthorizeExecution` — `if (frameHash !== hoManifest.frame_hash) fail('FRAME_CHANGED: supplied frame is not the sealed frame')`.

A frame with duplicated ids can therefore be re-serialised into a **different** `frame_hash` without
changing a single row, which defeats the point of committing to the hash — and it would surface as
`FRAME_MISMATCH` / `FRAME_CHANGED` **after** the commitment, when there is nothing to do about it.
Note also that `assertUnique` (§2) checks `idKey` and `canonical_domain` — **not `candidate_id`** — so
duplicate `candidate_id`s with distinct identifiers and distinct domains pass `assertUnique` and hit
the hash instead.

**Disjoint prefixes make the collision structurally impossible** at the point where two independent
people are generating ids with no sight of each other's work. That is the whole justification.

### 3.3 The convention

```
ENUMERATOR_A:  <<PENDING_DECISION: prefix — proposed "A-", e.g. A-0001 … A-nnnn>>
ENUMERATOR_B:  <<PENDING_DECISION: prefix — proposed "B-", e.g. B-0001 … B-nnnn>>
```

Constraints on whatever prefixes the owner picks:

- both must keep every id inside `^[A-Za-z0-9_-]{1,64}$` (so `-` and `_` are the only separators
  available — **no `:`, no `/`, no `.`**);
- neither prefix may be a prefix of the other (`E1-` / `E1B-` is not disjoint enough to reason about
  cheaply; `A-` / `B-` is);
- a prefix must not encode the person — it will appear in the **published** frame, and §4A.1 requires a
  pseudonymous ID in study artifacts. `A-` / `B-` encode the *slot*, which is already disclosed by the
  partition (`KNOWLEDGE_WINDOW_RULE.md` K-3);
- the prefixes are **pre-registered** before enumeration, since nothing enforces them afterwards.

`PARTITION_DESIGN.md` §4 proposed `E1-` / `E2-`. Either is fine; the owner picks one and records it.
**DECISION REQUIRED (minor): which prefixes.**

---

## 4. `enumerated_by`

Every row carries the enumerator's **pseudonymous register ID** in `enumerated_by`
(`FRAME_COLUMNS`, `lib/schema.mjs:32`) — never a name, never an email, never the `person_id` from the
restricted register if that `person_id` is identifying. §4A.1: *"a pseudonymous ID is used in study
artifacts"*, and the frame is a published artifact (§18).

```
ENUMERATOR_A enumerated_by:  <<PENDING_PERSONNEL: ENUMERATOR_A PSEUDONYM — NOT ASSIGNED>>
ENUMERATOR_B enumerated_by:  <<PENDING_PERSONNEL: ENUMERATOR_B PSEUDONYM — NOT ASSIGNED>>
```

**Note what two `enumerated_by` values do and do not prove.** They make the frame *look* like two
independent judgements. Whether it *is* rests entirely on `NON_DEPENDENCE_CONDITION.md`, which is not
mechanically checkable. The registration narrative should not let a reader read two values as two
verified independences.

---

## 5. THE SUBMISSION PROCEDURE

Per round, per enumerator, independently. **Nothing in this procedure lets either enumerator see
anything of the other's.**

| Step | Act | Performed by | Constraint |
|---|---|---|---|
| S-1 | Produce rows in the assigned families only, applying §5.1–§5.4 and Rule 1 | enumerator | Own work only |
| S-2 | Assign `candidate_id` with own prefix; write own pseudonym in `enumerated_by`; fill `enumerated_at`, `enumeration_source_url` | enumerator | Rule 2 |
| S-3 | Submit the batch through `<<PENDING_DECISION: submission channel — restricted, operator-controlled, one channel per enumerator, no shared folder>>` by `<<PENDING_DATE — NOT SET; see prereg-008/C-enumerators/ENUMERATOR_DEADLINES.md>>` | enumerator | **Separate channels.** A shared drop discloses the other's rows and volume — `KNOWLEDGE_WINDOW_RULE.md` X-3 |
| S-4 | Run `frame` / `checkFrameRow` **on that enumerator's batch alone** and return the per-row result to that enumerator only | operator | Per-row diagnostics carry no count and reveal nothing of the other partition. `PARTITION_DESIGN.md` §5: this is the single most valuable permitted feedback — it stops a systematic A4 mistake being repeated 200 times |
| S-5 | Merge the two batches; run the cross-partition entity reconciliation | **`<<PENDING_DECISION: WHO? — see §2>>`** | **BLOCKED on the §2 owner decision** |
| S-6 | Run `check-frame-sufficiency` on the merged frame | operator | §5.7.2. Output is **quota information**: never returned to either enumerator |
| S-7 | Return a **global** one-bit `CONTINUE` / `STOP` signal to both | operator | §5.7.2 requires that something say *continue* (*"enumeration continues first"*). **Global only — a per-class signal enumerates the thresholds over rounds.** `PARTITION_DESIGN.md` OQ-1, recommended against; still open |
| S-8 | Repeat S-1…S-7 until `STOP` | — | — |

### 5.1 What each enumerator is told at S-4 and S-7 — and what they are not

| Told | Not told |
|---|---|
| Their own per-row admissibility and contamination result | The combined per-class eligible-admissible counts (*"we have 118 fill-expected, get 8 more"* is §5.7.2 in all but name) |
| Their own malformed rows and the reason | Any per-class `CONTINUE`/`STOP` signal |
| Their own running count of submitted rows | The other enumerator's rows, volume, running count, progress or identity |
| Their own family assignment and volume ask (one number, no class content) | The sufficiency thresholds `126 / 52 / 32` |
| A **global** `CONTINUE` / `STOP` | Anything else |

**The class instruction is qualitative, and deliberately so** (carried forward from
`PARTITION_DESIGN.md` §4 item 6): *"Rows must cover all three outcome classes of §5.2. `fill-expected`
will be the commonest; deliberately seek candidates of the other two kinds as well."* No number, no
ratio, no threshold.

**A timing fact worth recording.** §5.5 puts enumeration at **step 3** and the development pilot and
sizing at **steps 7–8**. During enumeration there is no pilot result and no sizing output *in
existence* to leak, so §4A.2's prohibitions on those two are temporally vacuous. The live prohibitions
during enumeration are §4A.2(b) and the **quota** barrier — and `126 / 52 / 32` is a constant, so the
quota barrier is not time-limited.

---

## 6. What is blocked on the operator

| # | Blocked | Why |
|---|---|---|
| B-1 | Any allocation to a person | No person exists. Both slots `<<PENDING_PERSONNEL>>` |
| B-2 | **Who performs cross-partition entity reconciliation (S-5)** | §2. **Unresolved since DR-8 §(e) / OQ-5.** Blocks the merge step, not enumeration itself |
| B-3 | Which `candidate_id` prefixes | §3.3. Minor, but must be pre-registered |
| B-4 | The volume ask `M` | One number, no class content |
| B-5 | The submission channel and deadlines | S-3; deadlines skeleton exists at `prereg-008/C-enumerators/ENUMERATOR_DEADLINES.md`, all dates unfilled |
| B-6 | Whether a per-class CONTINUE/STOP is permitted | S-7 / `PARTITION_DESIGN.md` OQ-1. Recommended: **no** |
| B-7 | The pre-registered tie-break rule for reconciliation | §2 recommendation; must be published **before** enumeration to constrain the operator |
| B-8 | `KNOWLEDGE_WINDOW_RULE.md` K-3 — whether the per-enumerator family assignment is within §4A.2's grant | Without it, the partition cannot be communicated at all |

---

## 7. Risks

| # | Risk | Severity | Mitigation / residual |
|---|---|---|---|
| R-1 | Same entity entered twice under different families | High, fully preventable | Rule 1; `assertUnique` catches the same-identifier / same-domain case by **throwing** at `check-frame-sufficiency` |
| R-2 | Same entity entered twice with **different** identifier **and** different domain | **High and undetected** | `assertUnique` is blind to it. Only S-5 catches it — and S-5 is **B-2, unassigned** |
| R-3 | `candidate_id` collision makes `frame_hash` merge-order dependent | High; surfaces as `FRAME_MISMATCH` / `FRAME_CHANGED` **after** commitment | Rule 2; demonstrated in §3.2. Nothing in the instrument enforces the prefix |
| R-4 | A shared submission folder leaks the other's rows and volume | Medium; easy to do by accident | S-3 requires separate operator-controlled channels |
| R-5 | S-7 drifts from global to per-class under schedule pressure | Medium | B-6; over rounds a per-class signal enumerates `126 / 52 / 32` |
| R-6 | The operator's S-5 reconciliation becomes discretionary frame authorship | Medium-high — this is §22 row 31 | §2: pre-registered mechanical tie-break, published before enumeration, every reconciliation published |
| R-7 | A prefix encodes the person and reaches the published frame | Low | §3.3; pseudonym only, slot-level at most |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2, §4A.3, §5.1 (incl. line 214), §5.2, §5.3,
  §5.4, §5.5, §5.7, §5.7.2, §18, §22 row 31
- `C:/tmp/dt002/research/cpg-u1/tooling/lib/schema.mjs` (`FRAME_COLUMNS`, `JURISDICTION_FAMILIES`,
  `FAMILY_ORDER`, `:98`), `lib/select.mjs:44–51,71`, `lib/canonical.mjs:16–21`, `lib/harness.mjs:16,50,156`,
  `lib/raterOrder.mjs:14`, `lib/execution.mjs:46`, `cpg_u1_data.mjs:252` and `cmdAuthorizeExecution`
- `C:/tmp/dt007-eight-person/B-partition/PARTITION_DESIGN.md` §§1–5, 7–8; `WORKLOAD_ARITHMETIC.md`
- `C:/tmp/dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md` §(e) and rule A6;
  `DR9_ENUMERATOR_INSTRUCTION_TEXT.md`
- `C:/tmp/dt008-prereg/C-enumerators/ENUMERATOR_DEADLINES.md`, `ENUMERATOR_AB_DIFFERENCES.md`
