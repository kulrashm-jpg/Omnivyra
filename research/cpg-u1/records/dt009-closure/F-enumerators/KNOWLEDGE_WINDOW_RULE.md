# KNOWLEDGE_WINDOW_RULE — what each enumerator may know, before and after registration

**CLASSIFICATION: PREPARATION. A rule about material, not about persons.** No person exists. **No one
has been recruited, approached, engaged or named, and nothing has been released to anyone.** No
protocol byte and no instrument byte modified. **§4 of this file raises conflicts and does not resolve
them: nothing is silently amended.**

**Marker convention:** `<<PENDING_…>>` and `[ ]` are markers, never data.

Baseline: `origin/main` `33bceb1f919113c622587fa7c6403a0d4596bbad`; protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files), read-only from
`C:/tmp/dt002/research/cpg-u1/tooling`.

---

## 1. THE FROZEN WORDING — quoted exactly, because everything turns on it

§4A.2, verbatim (protocol lines 163–170):

> **Enumerators receive only:**
> - public sources;
> - the frame template;
> - §4A, §5.1–§5.4;
> - the jurisdiction-family list;
> - the development-only registry.
>
> **They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2).

Two structural facts:

1. **The receive-list is CLOSED.** The operative word is *"only"*. Anything not on those five lines is
   already not receivable. **Adding to the never-receive list therefore adds no restriction that the
   closed list does not already impose** — it only makes explicit what "only" already excludes. That
   observation decides most of §4 below.
2. **The never-receive clause is a specification, not the boundary.** It names four categories —
   *pilot results, sizing output, quotas, any CPG output* — and cites §5.5 and §5.7.2. Its function is
   emphasis: these four are the ones someone might otherwise think helpful.

§5.5 step 6 restates it from the other side (protocol line 288): *"**Enumerator barrier.**
Enumerators never receive pilot, sizing or quota information (§4A.2)."*

---

## 2. THE RULE, IN TWO PHASES

### Phase 1 — BEFORE registration

> **Recruitment and training material MAY be prepared.**

Preparation is not release. §4A.1 item 5's ordering bites on *release*; §4A.2's receive-list governs
what enumerators *receive*. Drafting a packet, a training deck, a declaration form or a fee-agreement
template creates no exposure.

Four conditions on Phase 1, each of which follows from something already frozen:

| # | Condition | Why |
|---|---|---|
| P1-1 | Prepared material may be **prepared** but not **released**. Release is governed solely by `MATERIAL_RELEASE_JOINT_GATE.md` and is a single joint act for the cohort. | §4A.1 item 5; release is irreversible |
| P1-2 | Prepared material must itself contain **nothing** on the §3 exclusion list. Preparing a training deck that explains the sufficiency thresholds and "deciding not to send that page" is not a control. | §4A.2's never-receive clause |
| P1-3 | Material prepared before registration must be **re-checked against the registered protocol hash** and the registered `registry_sha256`. §5.3: *"For this study the registry is frozen at registration"* and *"No changes apply after registration."* A packet quoting a pre-registration draft can teach a rule the study did not register. | §5.3; §19.3(1) |
| P1-4 | Preparing material is **not** recruiting. No person may be approached in a way that discloses study content before the gate. | §4A.1 item 5; §4A.2(b) |

### Phase 2 — AFTER registration

> **Each enumerator receives only what the frozen protocol permits, plus their own jurisdiction
> assignment.** Nothing else, at any time, from anyone, for any reason.

The permitted envelope, per enumerator:

| Permitted | Source | Note |
|---|---|---|
| Public sources | §4A.2 | Unrestricted; this is the research they do |
| The frame template | §4A.2 | `FRAME_COLUMNS`, `lib/schema.mjs:12–35` — the 23 columns, no values |
| §4A, §5.1–§5.4 | §4A.2 | Admissibility (§5.1), classes (§5.2), held-out ineligibility (§5.3), scan scope (§5.4). **§5.5 onwards is NOT on the list** |
| The jurisdiction-family list | §4A.2 | The four families `US-SEC / FR-SIRENE / BR-CNPJ / LEI-ONLY` (`JURISDICTION_FAMILIES`, `lib/schema.mjs:41–49`) |
| The development-only registry | §4A.2 | `rules/development_only_registry.json`; 13 seeded entries; needed for C1(6) |
| **Their own** rows, their own running count, their own row-level `checkFrameRow` diagnostics | Not a §4A.2 grant — §4A.2 constrains what an enumerator *receives*, not knowledge of their own work | DR-8 Rule A6 |
| **Their own** jurisdiction assignment and `candidate_id` prefix | **NOT on the §4A.2 list.** See §4, conflict K-3 | Operationally unavoidable for a partition |

---

## 3. THE CLOSED EXCLUSION LIST

Eight categories. No enumerator receives any of them, before, during or after enumeration.

| # | Excluded | Grounded in | Status against §4A.2 |
|---|---|---|---|
| X-1 | **Current candidate quality** — any assessment of how good the accumulating pool is, aggregate admissibility rates, or how close it is to being enough | Not on the closed receive-list; and it is "quota" information in substance, since "enough" is defined only by §5.7.2's `E ≥ 126/52/32` | Consistent — but see K-2 |
| X-2 | **Expected eligibility outcomes** — the study's or anyone else's expectation of how candidates will be classified or how many will survive §5.1–§5.4 | Not on the receive-list; equivalent to sizing/quota information | **AMBIGUOUS — see K-1** |
| X-3 | **The other enumerator's selections** — rows, identifiers, domains, company names, volume, running count, progress, or identity | Not on the receive-list. DR-8 A6. Structurally the §22 row 31 channel: two enumerators comparing counts reconstruct the combined count, and over two rounds that localises the §5.7.2 threshold | Consistent, and the strongest item on this list |
| X-4 | **Contamination findings** — the §5.4 scan output (`scan_sha256`), C1(1)/C1(6) scanner determinations, and any late-discovered contamination under §5.3 | Scan output is not on the receive-list | **CONFLICTS AS WRITTEN — see K-4** |
| X-5 | **Reference truth** — any §9 reference value, source, Author/Confirmer record, adjudication or reconciled file | Not on the receive-list. §4A.3: the enumerator *"authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7)"* — so reference truth is exactly the thing their work is scored against | Consistent |
| X-6 | **Model outputs** — any CPG output whatsoever, including the development pilot and the instrument check | §4A.2 never-receive (*"any CPG output"*) **and** §4A.2(b): *"not have run CPG or seen any CPG output (including the development pilot and instrument check) before completing the frame"* | Consistent; the only item that is doubly grounded |
| X-7 | **Rater results** — §12 ratings, per-rater sheets, adjudication artifacts, agreement statistics | Not on the receive-list; and they are downstream CPG output | Consistent |
| X-8 | **Future held-out draw information** — anything about the held-out draw before it is drawn: seeds, drand rounds, commitment payloads, sampling records, which rows were or will be drawn | Not on the receive-list; §5.5/§5.7.1 | Consistent. Note the *post-draw* artifacts are **published** (§18) — the exclusion is prospective only |

**One clarification the list needs, and it is not an amendment.** X-1, X-2 and X-4 are exclusions on
what the **study tells** an enumerator. None of them restricts the enumerator's **own judgement**, which
§5.1–§5.4 requires them to exercise: the enumerator *must* answer A1/A2/A4/A6 (§5.1), *must* assign
`expected_outcome_class` (§5.2 — *"the enumerator's **prediction**"*), and *must* answer the four
contamination attestations `c1_2`…`c1_5` (§5.3). Reading X-1/X-2/X-4 as touching those would make
§5.1–§5.4 unperformable. **See K-1 and K-4: this needs the owner's wording, not our silent gloss.**

---

## 4. THE CONFLICT CHECK — §4A.2's closed list versus the directive's rule

**Method.** For each element of the directive's rule, ask: does §4A.2 *grant* it (on the receive-list),
does §4A.2 *withhold* it (not on the closed list), or does the directive's wording **cross** a grant?
A directive exclusion of something §4A.2 withholds is **consistent** — a closed list already excludes
it. A directive exclusion of something §4A.2 **grants** is a **conflict**. A directive *grant* of
something §4A.2 does not list is also a **conflict**.

### VERDICT

> **Mostly consistent, with FOUR items requiring owner decision — of which K-3 and K-4 are genuine
> conflicts with the frozen wording, K-1 is a genuine conflict on one reading, and K-2 is an
> ambiguity.** The directive's exclusion list as a whole is **narrower than, or equal to, what
> §4A.2's closed receive-list already excludes**, so as an exclusion list it adds restriction and
> takes nothing away — except where an excluded category **overlaps an express grant**. That happens
> twice (K-1, K-4).
>
> **And: YES — "operational information necessary to perform their assigned work" IS BROADER than
> §4A.2's closed list. Plainly so. See K-3.** Read as a grant it conflicts; read as an additional
> ceiling it does not.

---

### K-1 — "expected eligibility outcomes" (X-2) versus §5.2, which is EXPRESSLY GRANTED

**Exact frozen clause crossed:** §4A.2 receive-list, third bullet — *"§4A, **§5.1–§5.4**"* — read with
§5.2 (protocol lines 216–222):

> ### 5.2 Classes
>
> | Class | Definition (**the enumerator's prediction**, made before any reference research) |
> |---|---|
> | `fill-expected` | An authoritative source is **expected** to state at least one of the three fields |
> | `abstention-expected` | No authoritative source is **expected** to state any of the three fields |

**The conflict.** §5.2 is on the receive-list and its entire subject is *expected* outcomes — the
enumerator's own expectation, which they are **required** to record in the `expected_outcome_class`
column (`lib/schema.mjs:22`). An exclusion phrased "expected eligibility outcomes", taken literally,
excludes the very section §4A.2 grants and the very column the frame template requires.

**Exact directive wording at issue:** the list item **"expected eligibility outcomes"**.

**What the owner must decide — do not let us decide it.** Recommended wording, for the owner to adopt,
vary or reject:

> "expected eligibility outcomes" means **any expectation of eligibility outcomes originating outside
> the enumerator** — the study's own projections, aggregate survival rates under §5.1–§5.4, another
> enumerator's class distribution, or any statistic over the accumulating frame. It does **not** touch
> the enumerator's own §5.2 `expected_outcome_class` prediction, which §4A.2 expressly grants them the
> section for and the frame template requires them to record.

**Status: DECISION REQUIRED. Not amended here.**

---

### K-2 — "current candidate quality" (X-1): ambiguity, not conflict

**Exact directive wording at issue:** **"current candidate quality"**.

§4A.2 does not grant "quality" information, so excluding it is consistent with the closed list. The
ambiguity is the same shape as K-1: §5.1's admissibility criteria are granted, and an enumerator
applying them is necessarily judging candidate quality one row at a time.

The distinction that makes the rule workable — and it is already established by DR-8 A6 — is
**per-row versus aggregate**:

- **per-row, their own:** permitted. `checkFrameRow`'s `MALFORMED_ROW` diagnostics and per-row
  admissibility exclusion reasons are §5.1–§5.4 enforcement, which they already hold, and carry no
  count.
- **aggregate, over the frame:** excluded. This is where quality becomes quota: §5.7.2 defines
  sufficiency as `E_c ≥ 2·Qmax_c + Dev_c`, i.e. **`E ≥ 126 / 52 / 32`**, and §5.7.2 is **expressly
  cited in §4A.2's never-receive clause**. An enumerator who learns "the pool is nearly good enough"
  has been told a fact about those numbers.

**Status: AMBIGUITY. Recommend recording the per-row / aggregate distinction. No conflict with §4A.2.**

---

### K-3 — "operational information necessary to perform their assigned work" IS BROADER THAN §4A.2's CLOSED LIST

**Exact directive wording at issue:** **"operational information necessary to perform their assigned
work"**.

**Say it plainly: yes, it is broader.** §4A.2's receive-list has exactly five items and the word
*"only"*. The following are all *necessary to perform the assigned work* under a two-enumerator
partition and **none is on that list**:

| Necessary in practice | On §4A.2's list? |
|---|---|
| **Their jurisdiction assignment** — "you work `US-SEC` and `LEI-ONLY`" | **No.** The *jurisdiction-family **list*** is granted. A per-enumerator **subset assignment** is a different object |
| **Their `candidate_id` prefix** — required for the disjoint-namespace rule | **No.** `candidate_id` is constrained only by `^[A-Za-z0-9_-]{1,64}$` (`lib/schema.mjs:98`); no namespace rule exists anywhere in the protocol |
| **The submission channel, format and deadline** | **No** |
| **The declaration form and fee agreement** | **No** — these are §4A.1 objects, and §4A *is* granted, so arguably in |
| **§5.7's "one row per legal entity" uniqueness rule** | **No.** §5.7 is outside §5.1–§5.4, and §5.7.2 is expressly never-receive |
| **The instruction "assign the most specific accessible family"** | Partly — §5.1 contains *"A company from an inaccessible jurisdiction is admissible only as `LEI-ONLY`"*, and §5.1 is granted; the operational instruction restates it |

**Two readings, and they diverge:**

- **Reading G (grant).** The phrase authorises releasing whatever is operationally necessary. **This
  CONFLICTS with §4A.2.** "Receive only" plus a five-item list cannot accommodate an open-ended
  necessity test; on Reading G the closed list stops being closed, and the study could justify handing
  an enumerator §5.7.2 on the ground that they "need to know when to stop".
- **Reading C (ceiling).** The phrase is an *additional restriction* on top of §4A.2: even within the
  five permitted items, release only what is necessary. **This is CONSISTENT** — it narrows, never
  widens.

**Recommended disposal, for the owner:**

1. **Adopt Reading C** as the meaning of the phrase, and say so in the decision log: the phrase is a
   ceiling, not a grant, and §4A.2 remains the only source of permission.
2. **Separately** dispose of the residue Reading C cannot supply — the jurisdiction assignment and the
   `candidate_id` prefix — because **a two-enumerator partition cannot operate without them.** Two
   options:
   - **(a)** Record a reading that *"the jurisdiction-family list"* includes the per-enumerator
     restriction of that list. Defensible: an assignment is a subset of a granted object, and it
     introduces no new fact about any candidate. **Recommended.**
   - **(b)** Record an explicit operational addition, named as such.
   In **either** case, note the disclosure that comes with it: telling A *"your families are `US-SEC`
   and `LEI-ONLY`"* discloses that **someone else holds `FR-SIRENE` and `BR-CNPJ`** — i.e. it discloses
   the existence and the scope of Enumerator B. That is **not** on the receive-list and is the one
   unavoidable leak of the partition design. It is bounded: it reveals B's *scope*, never B's
   *identity* (DR-8 A5) and never B's *rows* (X-3). **The owner should decide whether to record this
   disclosure in the registration narrative. Recommended: yes.**

**Status: CONFLICT on Reading G; CONSISTENT on Reading C. DECISION REQUIRED, plus a separate decision
on the jurisdiction assignment and prefix. Not amended here.**

---

### K-4 — "contamination findings" (X-4) crosses TWO express grants

**Exact frozen clauses crossed:**

1. §4A.2 receive-list, third bullet — *"§4A, **§5.1–§5.4**"*. **§5.3 is titled "Held-out ineligibility
   (CPG-C1)" and is the protocol's contamination section**, containing C1(1)–C1(6), the rule *"For
   every contamination attestation, `unknown` is treated exactly like `yes`"*, and the four attestation
   columns the enumerator must fill.
2. §4A.2 receive-list, fifth bullet — *"**the development-only registry**"*. §5.3 describes it as
   *"seeded with 13 entries from the implementers' own CPG history"* and names them. **The
   development-only registry IS a contamination finding** — a list of companies contaminated by prior
   CPG use — and §4A.2 grants it expressly, because C1(6) cannot be answered without it.

**The conflict.** An exclusion phrased "contamination findings", taken literally, withholds §5.3 and
the development-only registry — both expressly granted, and both **indispensable**: without the
registry the enumerator cannot apply C1(6), and without §5.3 they cannot answer `c1_2`…`c1_5`. This is
the sharpest conflict in the set, because it is not merely a reading problem: applying the exclusion
literally would make the enumeration **impossible**.

**Exact directive wording at issue:** the list item **"contamination findings"**.

**What the owner must decide.** Recommended wording, for the owner to adopt, vary or reject:

> "contamination findings" means the **outputs of the §5.4 scan** (the scan artifact and its
> `scan_sha256`), the scanner's C1(1) and C1(6) determinations over the frame, any aggregate count of
> contaminated or ineligible rows, and any **late-discovered contamination** recorded under §5.3 after
> registration. It does **not** include §5.3 itself or the development-only registry, both of which
> §4A.2 expressly grants and without which C1(2)–C1(6) cannot be answered at all.

**Status: CONFLICT AS WRITTEN. DECISION REQUIRED. Not amended here.**

---

### Items checked and found consistent — no decision needed

| Directive item | Why consistent |
|---|---|
| X-3 the other enumerator's selections | Not on the closed list. And §4A.2's *"quotas"* covers the count channel: the combined running count localises §5.7.2's threshold |
| X-5 reference truth | Not on the closed list; §9's objects never appear in §4A.2 |
| X-6 model outputs | Doubly grounded — §4A.2's never-receive *"any CPG output"* and §4A.2(b) |
| X-7 rater results | Not on the closed list; downstream CPG output |
| X-8 future held-out draw information | Not on the closed list. Prospective only: post-draw sampling records are published (§18) |
| Phase 1 "recruitment and training material may be prepared" | Preparation is not release; §4A.1 item 5 and §4A.2 both govern *release* / *receipt*. Conditions P1-1…P1-4 above |
| Phase 2 "only what the frozen protocol … permit[s]" | This is §4A.2's *"only"*, restated. Identical |
| The never-receive citation *"(§5.5, §5.7.2)"* | Confirmed against the protocol: §5.5 is the two-stage / commitment / randomness section, §5.7.2 is frame sufficiency (`E ≥ 126/52/32`). The citations are accurate |

---

## 5. Operator checklist

```
[ ]  K-1 decided and the wording for "expected eligibility outcomes" recorded
[ ]  K-2 per-row / aggregate distinction recorded
[ ]  K-3 decided: Reading C adopted; jurisdiction assignment + candidate_id prefix disposed of
         under option (a) or (b); the partition-scope disclosure recorded in the narrative
[ ]  K-4 decided and the wording for "contamination findings" recorded
[ ]  Packet contents enumerated item by item and checked against the §2 permitted envelope
[ ]  Packet contents checked against the §3 exclusion list, as amended by K-1 and K-4
[ ]  Prepared material re-checked against the REGISTERED protocol hash and registry_sha256 (P1-3)
[ ]  Nothing released — release is MATERIAL_RELEASE_JOINT_GATE.md, not this file
```

**All boxes unchecked. Nothing has been decided and nothing has been released.**

---

## 6. Risks

| # | Risk | Severity | Mitigation / residual |
|---|---|---|---|
| R-1 | K-4 applied literally; the development-only registry is withheld; C1(6) cannot be answered and every affected row is `unknown`, which §5.3 treats **exactly like `yes`** — mass held-out ineligibility | **Critical**, and it would look like diligence | K-4 must be decided before any packet is assembled |
| R-2 | K-3 read as a grant (Reading G); the closed list quietly stops being closed | High | K-3 recommends Reading C in the decision log |
| R-3 | The partition assignment discloses Enumerator B's scope to A | **Unavoidable** under any two-enumerator partition | Bounded: scope only, never identity (A5) or rows (X-3). Disclose in the narrative |
| R-4 | K-1 applied literally; the enumerator declines to fill `expected_outcome_class`; the frame template cannot be completed | High | K-1 decision |
| R-5 | An enumerator infers the sufficiency threshold from operator prompting ("a few more fill-expected rows") | Medium, and entirely informal | X-1 / K-2; no tool detects a spoken hint |
| R-6 | This file is mistaken for the decision | Medium | §4 is headed as a flag, not a resolution; every K item says "Not amended here" |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2 (lines 155–170), §4A.3, §5.1, §5.2 (216–222),
  §5.3 (226–248), §5.4 (250–257), §5.5 (259–290, incl. line 288 enumerator barrier), §5.7, §5.7.2
  (383–395), §9.2, §9.7, §18, §19.3, §20.18, §22 row 31
- `C:/tmp/dt002/research/cpg-u1/tooling/lib/schema.mjs` (`FRAME_COLUMNS`, `JURISDICTION_FAMILIES`,
  `candidate_id` pattern at `:98`), `lib/personnel.mjs`, `lib/frame.mjs`
- `C:/tmp/dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md` (rule A6 and its receive-list analysis),
  `DR9_ENUMERATOR_INSTRUCTION_TEXT.md`
- `C:/tmp/dt007-eight-person/B-partition/PARTITION_DESIGN.md` §§4–5
