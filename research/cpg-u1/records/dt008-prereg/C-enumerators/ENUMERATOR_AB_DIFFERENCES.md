# ENUMERATOR_AB_DIFFERENCES — precisely what differs between Enumerator A and Enumerator B

**Classification: PREPARATION.** Both slots are UNFILLED. **No person exists, no one has been recruited
or approached, and nothing here names or describes anybody.** Every person-specific field is an unfilled
marker.

**The whole content of this file in one sentence:** A and B differ in **exactly two** things — the
**jurisdiction allocation** and the **`candidate_id` namespace prefix** — and everything else about them
is identical, including the register role string.

**Marker convention:** `<<UNFILLED: …>>` and `UNASSIGNED` are markers, never data.

Baseline, recomputed by the author of this file:

| Basis | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **verified** |
| Instrument | aggregate `<NEW_AGG>`, **<NEW_N>** files, at `C:/tmp/dt002/research/cpg-u1/tooling` — **verified** |
| Stale tree in this worktree | `research/cpg-u1/tooling`, **587** files, aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` — not the instrument |

---

## 1. The two differences

### Difference 1 — the jurisdiction allocation

`B-partition/PARTITION_DESIGN.md` §2(a) evaluates partition by jurisdiction family against its tests T1
(ex-ante computable) and T2 (quota-silent) and recommends, at `PARTITION_DESIGN.md:135`:

> A = {`US-SEC`, `LEI-ONLY`}, B = {`FR-SIRENE`, `BR-CNPJ`}

The four families are frozen in the instrument as `JURISDICTION_FAMILIES` (`lib/schema.mjs:42-48`):
`US-SEC` → `['CIK','LEI']`, `FR-SIRENE` → `['SIREN','LEI']`, `BR-CNPJ` → `['CNPJ','LEI']`,
`LEI-ONLY` → `['LEI']`. The family list is itself on §4A.2's receive-list, so a two-line allocation is
releasable material and carries no quota information (test T2).

| Field | A | B |
|---|---|---|
| Jurisdiction families in scope | `<<UNFILLED: from the recorded partition rule. PARTITION_DESIGN.md:135 recommends {US-SEC, LEI-ONLY}, but the rule of record governs, not this file.>>` | `<<UNFILLED: PARTITION_DESIGN.md:135 recommends {FR-SIRENE, BR-CNPJ}>>` |
| Partition rule identifier and sha256 | `<<UNFILLED: one rule, one hash, shared by both slots>>` | same value as A |
| Row target | `<<UNFILLED: count, derived by the operator; the enumerator is never told the sufficiency requirement itself>>` | `<<UNFILLED>>` |
| Overlap with the other slot, if the rule prescribes any | `<<UNFILLED: none, or the pre-registered overlap set>>` | `<<UNFILLED>>` |

Two properties of the allocation that are **not** a difference between A and B, and must not become one:

- **One rule, one hash, both slots.** There is not an "A rule" and a "B rule". There is one deterministic
  pre-registered rule with one sha256, recorded before either release (`PARTITION_DESIGN.md` §3 clause 2).
- **The `LEI-ONLY` boundary must be closed by instruction, not by judgement.** `PARTITION_DESIGN.md`
  §2(a) identifies the one genuine leak: a US, French or Brazilian registrant that *also* holds an LEI
  could be written as its national family by one enumerator and as `LEI-ONLY` by the other — two rows for
  one entity. `assertUnique` (`lib/select.mjs:47-48`) then **throws** on the duplicate identifier or the
  duplicate `canonical_domain`, and `check-frame-sufficiency` fails outright. The instruction that closes
  it is grounded in §5.1's own sentence: *"A company from an inaccessible jurisdiction is admissible only
  as `LEI-ONLY`."* Recorded instruction: `<<UNFILLED: the operator states the rule, identically, to both slots>>`.

### Difference 2 — the `candidate_id` namespace prefix

| Field | A | B |
|---|---|---|
| Reserved `candidate_id` prefix | `<<UNFILLED: a fixed prefix, recorded before release>>` | `<<UNFILLED: a fixed prefix, disjoint from A's and NOT a prefix of it>>` |

This is the subject of §3 and §4 below, because it is the one difference that carries a structural
hazard.

---

## 2. Everything that is identical — the exhaustive list

If a candidate difference is not one of the two above, it is a defect.

| | A and B |
|---|---|
| **Register `role` string** | the **literal** `enumerator` for both. Not `enumerator-2`, not `enumerator-b`. `INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is an exact-match list, and `lib/personnel.mjs:31` refuses anything else as `unknown role` — verified by execution. See `ENUMERATOR_B_AUTHORIZATION.md` §2.3. |
| Independence requirements | identical: §4A.1 items 1–4 and 6, §4A.2 (a)–(e), the same seven `DECLARATION_KEYS`, each exactly `"no"`. |
| Fee treatment | identical rule: §4A.1 item 5, fixed, non-contingent, agreed before release, hashed — or `study_fee_agreement_sha256: null`. The **amounts** are a matter for the operator and the two people; the **rule** does not differ. |
| Organisation confirmation | identical requirement, 64 lower-case hex, no `null` path (`lib/personnel.mjs:39`). |
| Receive-list | identical, and exhaustive (§4A.2): public sources; the frame template; §4A, §5.1–§5.4; the jurisdiction-family list; the development-only registry. |
| Never-receive list | identical (§4A.2, §5.5, §5.5.3, §5.7.2): pilot results, sizing output, quotas, any CPG output — **and the other enumerator's rows, partition content or findings**. |
| Frame template and its 22 columns | identical. `FRAME_COLUMNS` is one list (`lib/schema.mjs`), and `checkFrameRow` applies one set of rules. |
| Admissibility (§5.1), contamination (§5.3), identifier checksums (A3) | identical. |
| Submission format, validation, failure handling | identical — `F-recruitment/ENUMERATOR_SUBMISSION_PROCEDURE.md` is one document issued to both. |
| Evidence handling and contamination rules | identical — one document each, issued to both. |
| Release day and submission deadline | identical — `MATERIAL_RELEASE_GATE.md` GATE-R1 and `ENUMERATOR_DEADLINES.md` §3. |
| Standing post-release checks | identical (`ENUMERATOR_ELIGIBILITY_CHECK.md` §5). |
| Exclusions | identical: neither is the operator, neither holds another §4A.3 role, neither is or becomes the reference adjudicator. |
| What §4A.1 says their work is worth if a declaration is false | identical: *"the frame is not independent (§20.18)"* — and §20.18 makes the frame's unbiasedness rest on enumerator independence **only**. |
| `enumerated_by` semantics | identical field, different **value**: each writes their own `person_id`, exactly as it appears in the register. The value differing is not a difference in treatment; it is the field doing its job. |

**Not a permitted difference, however tempting:**

- a different row target *expressed as a per-class count or ratio* — that is quota information and a
  §5.5.3 Enumerator-barrier breach (`PARTITION_DESIGN.md` test T2: *"126 : 52 : 32 reduces to 2.42 : 1 :
  0.615 — any proportional per-class instruction discloses the quota structure"*);
- a different definition of `unknown`, of a contamination answer, or of `expected_outcome_class`;
- a per-class CONTINUE/STOP top-up signal to one slot but not the other (`PARTITION_DESIGN.md` OQ-1);
- a different frame template, a different registry copy, or a different protocol excerpt.

---

## 3. Why the prefix is an **operational** obligation and not a rule the instrument enforces

### What the instrument actually constrains

A `candidate_id` is constrained by exactly one thing, at `lib/schema.mjs:98`:

```js
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.candidate_id)) errors.push('candidate_id must be 1-64 of [A-Za-z0-9_-]');
```

**That is all.** Searching the whole <NEW_N>-file instrument for any namespace, prefix, ownership or
per-enumerator rule on `candidate_id` returns nothing: the only match for "prefix" anywhere in the
library is `lib/archive.mjs:106`, describing RFC 6962 Merkle leaf and node domain-separation bytes —
unrelated. There is:

- **no** rule that a `candidate_id` belongs to an enumerator;
- **no** rule relating `candidate_id` to `enumerated_by`;
- **no** reserved namespace, no separator convention, no length or shape convention beyond the regex;
- **no** check anywhere that two enumerators used disjoint namespaces.

### What the instrument *does* catch, and why it is not enough

| Mechanism | What it catches | When |
|---|---|---|
| `loadFrame` (`cpg_u1_data.mjs:97-101`): `if (seen.has(r.candidate_id)) res.errors.push('duplicate candidate_id')` | an **exact repeat** of a `candidate_id` | at load, after the merge |
| `assertUnique` (`lib/select.mjs:44-51`), called from `frameSufficiency` (`lib/frame.mjs:44`) | a duplicate `scheme:identifier` **or** a duplicate `canonical_domain` — it **throws** | at `check-frame-sufficiency` |

Both fire **after both enumerators have finished**. Neither prevents the collision; both convert it into
wasted work, and `assertUnique` converts it into a thrown command. And an exact-repeat check does not
address the harder case: two enumerators using overlapping *shapes* without an exact repeat still produce
ids whose provenance cannot be read off the id, which defeats the point of having a namespace at all.

### Therefore

> **Disjoint `candidate_id` prefixes are an OPERATIONAL OBLIGATION of the operator, fixed before release
> and recorded with the partition rule. Nothing in the instrument imposes them, and nothing in the
> instrument will tell the operator they were forgotten until the frame is already built.**

The obligation is enforced here instead:

| Where | What it enforces |
|---|---|
| `MATERIAL_RELEASE_GATE.md` **G0.4** | the two prefixes are recorded, disjoint, and **neither is a prefix of the other**, before release |
| `ENUMERATOR_PACKET_VALIDATOR.mjs` refusal **R9_CANDIDATE_PREFIX_COLLISION** | identical prefixes, and a prefix-of relationship, are both refused |
| `ENUMERATOR_{A,B}_ALLOCATION.md` §2 | the prefix is recorded per slot, as an unfilled marker until the operator sets it |

**"Disjoint" means neither is a prefix of the other**, not merely that they are unequal. `SYN` and `SYNB`
are unequal and **not** disjoint as namespaces: every id in the `SYNB` space is also in the `SYN` space,
so an id no longer identifies which enumerator produced it, and the operator cannot audit
`enumerated_by` against the id. The same reasoning applies to `person_id`, where the consequence is
sharper — see §5.

| Field | A | B |
|---|---|---|
| Prefix | `<<UNFILLED>>` | `<<UNFILLED>>` |
| Neither is a prefix of the other | `<<UNFILLED: operator verifies; the validator refuses otherwise>>` | — |
| Recorded alongside the partition rule hash, before release | `<<UNFILLED: yes / no>>` | `<<UNFILLED: yes / no>>` |

---

## 4. `frame_hash` order-independence — true, and conditional on uniqueness

`B-partition/PARTITION_DESIGN.md` §0 calls the order-independence of `frame_hash` *"the single most
important enabling fact"* for a two-enumerator frame: the two CSVs can be concatenated in any order and
the committed hash is identical, so the merge needs no negotiated row order.

The mechanism, at `lib/canonical.mjs:17-22`:

```js
export function canonicalRecords(records, sortKey) {
  const sorted = [...records].sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0));
  return canonicalJson(sorted);
}

export const hashRecords = (records, sortKey) => sha256(canonicalRecords(records, sortKey));
```

The comparator returns `0` for **equal** keys, and `Array.prototype.sort` is **stable** (required by the
language since ES2019). A stable sort with a comparator that cannot distinguish two records **preserves
their input order**. So:

> **Order-independence holds only while every `candidate_id` is unique.** With a duplicate
> `candidate_id`, the two colliding rows keep their input order through the sort, the canonical JSON
> differs, and the `frame_hash` differs — the hash becomes a function of the order in which the two
> enumerators' files happened to be concatenated.

**Verified by execution** against the frozen `lib/canonical.mjs`, three records, hashed forwards and then
with the array reversed:

| Case | forward `hashRecords` | reversed `hashRecords` | Equal |
|---|---|---|---|
| ids `A-1`, `B-1`, `C-1` — all distinct | `3bbc8d62c889c63905de22bcaf0b2e48dfbaaaa19e43137fea09e9376468ff31` | `3bbc8d62c889c63905de22bcaf0b2e48dfbaaaa19e43137fea09e9376468ff31` | **yes** |
| ids `X-1`, `X-1`, `Y-1` — one duplicate | `e99ee1b4d477a09c85fbf5098537e2dad80442b6d9e7093ce95e98e7b2962aee` | `04d22c54dbe4ec43ce7b76b017c4f32fdbbae26e9d7964a13a185a79d5f4429c` | **no** |

(The records were synthetic two-field objects held in memory; nothing was written, and nothing under
`C:/tmp/dt002` was modified.)

### Consequence

`loadFrame` (`cpg_u1_data.mjs:99`) marks a repeated `candidate_id` as a malformed row, so in the intended
pipeline the duplicate is caught before a frame reaches `hashRecords`. That is a **procedural** ordering,
not a property of the hash: any path that hashes records without going through `loadFrame` — a
recomputation, an outsider's verification script, a merge performed by hand — will silently produce an
order-dependent hash if a duplicate is present.

**So the enabling fact and the obligation are one statement, not two:** the merge needs no negotiated row
order **because** the `candidate_id` namespaces are disjoint. The disjointness is what buys the
order-independence. It is not a tidiness convention.

---

## 5. `person_id` — the same prefix hazard, with a sharper consequence

`person_id` is constrained by `PERSON = /^[A-Za-z0-9_-]{1,64}$/` (`lib/personnel.mjs:14`), and collisions
are checked at `lib/personnel.mjs:34` by a `Map` keyed on the **exact** string:

```js
    if (holder.has(a.person_id)) errors.push(`${where}: ROLE COLLISION — ${a.person_id} already holds ${holder.get(a.person_id)}; …`);
```

**Verified by execution:** a register whose `person_id`s include both `P0` and `P0-EXTRA` returns
`errors: []`, `blockers: []` from `checkPersonnelRegister`. The equality test passes, and nothing else
looks at the relationship between the two strings.

This matters because `person_id` is what `enumerated_by` carries into **every row** of the frame
(`lib/schema.mjs:31-33`), and because the post-merge reconciliation of `enumerated_by` against the
register is done by **no tool at all** (`RECRUITMENT_DELTA.md` §9 Q4). If one enumerator's `person_id` is
a prefix of the other's, any reconciliation done by matching, grepping or prefix-searching attributes rows
to the wrong person — and attribution is the entire basis on which §4A.1's *"enumerator work: the frame is
not independent"* consequence can be scoped to one enumerator rather than the whole frame.

Enforced at `MATERIAL_RELEASE_GATE.md` G2.5 and by the validator's `R6_PERSON_ID_COLLISION`, which
refuses both equality and a prefix relationship, in either direction.

| Field | A | B |
|---|---|---|
| `person_id` | `UNASSIGNED` | `UNASSIGNED` |
| Distinct | `<<UNFILLED: verified>>` | — |
| Neither a prefix of the other | `<<UNFILLED: verified — the register will NOT tell you>>` | — |

---

## 6. The cost of difference 1, declared rather than fixed

Partitioning by jurisdiction makes **enumerator identity perfectly confounded with jurisdiction family**
(`PARTITION_DESIGN.md` §2(a), risk R-1). §5.7's decision D-A publishes the realised jurisdiction
composition. Under this allocation, any enumerator-specific systematic error — a lax reading of A4, a
habit of answering a contamination question `unknown` — lands on **one whole family** and is
indistinguishable from a jurisdiction effect. §20.3 already limits jurisdiction generalisation, and
§20.18 places the frame's unbiasedness on enumerator independence alone.

The mitigation `PARTITION_DESIGN.md` records is **declaration, not repair**: declare the confounding in
advance, and publish the realised `enumerated_by` × family composition next to the D-A composition.

| Field | Value |
|---|---|
| Confounding declared in advance, where | `<<UNFILLED: the pre-registration section that carries it>>` |
| `enumerated_by` × family composition will be published next to D-A | `<<UNFILLED: yes / no>>` |
| Alternative partition chosen instead, if any, and why | `<<UNFILLED: or "none — jurisdiction partition per PARTITION_DESIGN.md:135">>` |

---

## 7. Summary table

| Dimension | Differs? |
|---|---|
| Jurisdiction families in scope | **YES — difference 1** |
| `candidate_id` namespace prefix | **YES — difference 2** |
| `person_id` value | different values, but that is identity, not treatment; **must be non-prefix** |
| `enumerated_by` value written in each row | each writes their own `person_id` — the field doing its job |
| Register `role` string | **NO** — both are the literal `enumerator` |
| Declarations, eligibility, fee rule, organisation confirmation | **NO** |
| Receive-list, never-receive list | **NO** |
| Frame template, columns, validation, submission, deadlines | **NO** |
| Release day | **NO** — one act, both slots (GATE-R1) |
| Row target as a **number** | may differ (operator-derived) |
| Row target expressed **per class** | **PROHIBITED for both** — quota disclosure |
| Everything else | **NO. If it differs, it is a defect.** |

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

