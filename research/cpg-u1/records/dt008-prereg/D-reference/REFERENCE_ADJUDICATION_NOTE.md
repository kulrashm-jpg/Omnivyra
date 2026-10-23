# REFERENCE_ADJUDICATION_NOTE — two verified facts about reference adjudication, and one recorded defect

**Classification: PREPARATION.** No adjudication has occurred, no decision exists, no person holds the
role. This note records what the protocol and the verified instrument **already** do. It proposes no
change and designs around nothing.

Baseline: protocol `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument
aggregate `<NEW_AGG>` over <NEW_N> files at
`C:/tmp/dt002/research/cpg-u1/tooling`. Both recomputed. All line numbers below are of that tree.

---

## 1. FACT 1 — the decision space is `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT`, and no value may be introduced

**A prior wave recorded this. Re-verified here, and confirmed — with one clarification the bare
statement omits.**

### 1.1 What §9.5 and §9.1 say

§9.5, verbatim:

> The adjudicator chooses between the two records or declares a conflict, and **cannot supply a third
> value**.

§9.1, in the adjudicator's "Must not" column, verbatim:

> Hold any other §4A.3 role (including enumerator); **introduce a new value**

§9.2.1, verbatim:

> **Decisions** are `RECORD_1`, `RECORD_2` or `REFERENCE-CONFLICT`. They are mapped mechanically to
> AUTHOR / CONFIRMER after the decision (`resolve-reference-adjudication`).

### 1.2 What the instrument enforces

`resolveReferenceDecisions` (`lib/packets.mjs:61-69`) accepts exactly those three spellings and throws
on anything else:

```
if (r.decision === 'REFERENCE-CONFLICT') return { ...r };
if (!['RECORD_1', 'RECORD_2'].includes(r.decision)) throw new Error(`...: blind decision must be RECORD_1|RECORD_2|REFERENCE-CONFLICT`);
```

`cmdSeal`'s `blindReferenceAdjudication` (`cpg_u1_data.mjs:545-564`) wraps that in
`BLIND_ADJUDICATION_REFUSED`, requires the decisions to cover **exactly** the packet's items
(`the blind decisions do not cover exactly the packet items (missing, extra or duplicated decision)`),
and requires the resolved file to be **exactly** the mechanical resolution
(`--adjudication is not the mechanical resolution of the blind decisions`).

Structurally, there is **nowhere to put a value**: `ADJUDICATION_COLUMNS` (`lib/schema.mjs:207`) is
`candidate_id`, `field`, `decision`, `rationale`, `adjudicated_by`, `adjudicated_at` — **no
`expected_value`, no `source_url`, no `source_class`**. `reconcile` then takes every published value
column from one of the two blind records (`src = a` or `src = c`, `lib/reconcile.mjs:54-75`) and from
nowhere else. The adjudicator's inability to introduce a value is enforced by the **shape** of the
file, not only by a rule.

### 1.3 The clarification — two decision vocabularies, and the adjudicator uses only one

There are **two** enums, and conflating them produces a refusal:

| Enum | Members | Who writes it |
|---|---|---|
| The adjudicator's **blind** decision | `RECORD_1`, `RECORD_2`, `REFERENCE-CONFLICT` | the **adjudicator**, in the blind decisions CSV, on the §9.2.1 packet |
| `ADJUDICATION_DECISIONS` (`lib/schema.mjs:210`) | `AUTHOR`, `CONFIRMER`, `REFERENCE-CONFLICT` | **nobody by hand** — it is the output of `resolve-reference-adjudication`, and it is what `reconcile` validates (`lib/reconcile.mjs:38`) |

The mapping is recomputed from the sealed held-out sampling record, per item, by
`authorIsRecord1(recordSha, candidate_id, field)` (`lib/raterOrder.mjs:49`; used at
`lib/packets.mjs:34` when the packet is built and again at `:65` when decisions are resolved). §9.2.1:
*"Record 1 is the Author's record iff the first hexadecimal digit of
`order_key("reference-adjudicator-record-1", candidate_id, field)` is even."* There is **no mapping
file** — nothing to trust, nothing to leak, nothing to tamper with; the comment at
`lib/packets.mjs:60` says so: *"recomputed from the held-out record (no mapping file to trust)"*.

**Consequence for the adjudicator packet:** the role's CSV must say `RECORD_1` / `RECORD_2`, never
`AUTHOR` / `CONFIRMER`. `cpg_u1_data.mjs:543` is explicit: *"An adjudication typed by role name
(AUTHOR/CONFIRMER) without a blind packet is refused."* This is stated in
`REFERENCE_ADJUDICATOR_PACKET.md` §5 and §6.

### 1.4 And an agreement may not be adjudicated at all

§9.5: `AGREED` — *"an adjudication may not override it"*. Enforced at `lib/reconcile.mjs:56`:

```
if (j) { errors.push(`${k}: adjudication supplied for an AGREED record — an adjudicator may not override agreement`); continue; }
```

and upstream the packet never contains an agreeing item: `buildReferenceAdjudicationPacket`
(`lib/packets.mjs:31`) skips every pair where `agreementKey(a) === agreementKey(c)` —
*"agreeing records are never released"*.

---

## 2. FACT 2 — an unadjudicated difference is refused outright, so every difference must be adjudicated before a seal is possible

**A prior wave recorded this. Re-verified here, and confirmed.**

### 2.1 The refusal

`lib/reconcile.mjs:58`, verbatim:

```
if (!j) { errors.push(`${k}: author and confirmer disagree (${agreementKey(a)} vs ${agreementKey(c)}) — independent adjudication required`); continue; }
```

`continue` means the row is **not emitted**: an unadjudicated difference does not fall through to a
default, is not published as a conflict, and is not silently dropped from the denominator. It becomes an
**error**.

### 2.2 The error is fatal in both commands that matter

- `cmdReconcile` (`cpg_u1_data.mjs:566-574`; `process.exit(1)` at `:572`) prints the errors and then
  `if (errors.length) process.exit(1);` — **exit code 1, no output file written.** The reconciled
  reference file is never produced.
- `cmdSeal` (`cpg_u1_data.mjs:585`) calls the same `reconcileFrom` and fails with
  `reference truth has <n> error(s) — a dataset is never sealed with errors`.
- Even if a reference file existed from somewhere else, `seal` refuses it:
  *"--reference is not byte-identical to the reconciliation of the blind records — reference truth must
  come from reconcile, never be hand-edited."*

**Therefore: every difference must be adjudicated before a seal is possible.** §9.5's "**Must** be
adjudicated" is not advisory; it is a gate with an exit code. And since §9.6 publishes the seal hash
**before** held-out execution, an unadjudicated difference blocks the entire run, not merely one row.

### 2.3 What follows operationally

- **"Adjudicate a subset" is not an available contingency.** If the disagreement count exceeds whatever
  window was assumed, the window must grow; the scope cannot shrink. Recorded in
  `REFERENCE_WORKLOAD_NOTE.md` §3.1 and `REFERENCE_ADJUDICATOR_PACKET.md` §8.
- **The adjudicator is on the critical path** to the published seal hash and therefore to held-out
  execution.
- **There is no way to route around a missing adjudicator.** `check-personnel` reports
  `role reference-adjudicator is UNFILLED` as a blocker (`lib/personnel.mjs:25`), and the recorders
  cannot resolve their own difference: `lib/reconcile.mjs:59` refuses an `adjudicated_by` equal to
  either recorder's `recorded_by` — *"adjudicator must differ from both author and confirmer"*.
- **Nor around a missing recorder.** `lib/reconcile.mjs:52` refuses
  `author and confirmer must be different people (§9.4)`, so one person cannot fill both recorder
  slots and thereby produce zero disagreements.

---

## 3. The three distinctness checks, in one place

Because the validator in this directory mirrors them:

| Check | Location | Message |
|---|---|---|
| Author ≠ Confirmer | `lib/reconcile.mjs:52` | `author and confirmer must be different people (§9.4)` |
| Adjudicator ∉ {Author, Confirmer} | `lib/reconcile.mjs:59` | `adjudicator must differ from both author and confirmer` |
| No person holds two roles; operator holds none | `lib/personnel.mjs:33`, `:34` | `ROLE COLLISION — ...` |

`REFERENCE_PACKET_VALIDATOR.mjs` asserts the first two as a **structural** rule over the three slots'
`person_id`s, so a register that would fail at reconcile time fails at packet-assembly time instead.

---

## 4. Recorded defect — a `REFERENCE-CONFLICT` row publishes the **Author's** value

**Recorded in a prior wave; re-verified here, and confirmed. Noted, not designed around.**

### 4.1 The mechanism

In `lib/reconcile.mjs`, `src` is initialised to the Author's record and is reassigned on **one** branch
only:

```
let src = a; let resolution = 'AGREED'; ...
if (j.decision === 'AUTHOR')            resolution = 'ADJUDICATED_AUTHOR';          // src stays a
else if (j.decision === 'CONFIRMER')  { src = c; resolution = 'ADJUDICATED_CONFIRMER'; }
else                                  { resolution = 'REFERENCE_CONFLICT'; conflict = true; }   // src stays a
```

The emitted row then draws `value_kind`, `expected_value`, `authoritative_source_name`, `source_class`,
`source_url`, `publication_date`, `as_of_date` and `search_note` from `src` — i.e. **from the Author's
record** — while `ambiguity_flag` is set to `REFERENCE-CONFLICT`.

The same asymmetry exists, less visibly, for `AGREED` rows: agreement compares only
`agreementKey` = `value_kind` + normalised `expected_value` (`lib/schema.mjs`), so when both recorders
reach the same value from **different documents**, the published source columns are the Author's and the
Confirmer's citation is not published at all.

### 4.2 Why it does not corrupt an endpoint

A `REFERENCE_CONFLICT` row is **excluded from every denominator and published** (§9.5; §15.1 lists
`REFERENCE-CONFLICT` as a disposition; §15.2: *"Reference truth REFERENCE-CONFLICT (sealed) →
REFERENCE-CONFLICT — excluded, published"*). No label is computed from it, so no endpoint reads the
value. The seal also records the resolution tally (`resolutions` in the seal object), so the count of
conflicts is published.

### 4.3 Why it is still a defect

The row's value columns assert something the adjudication explicitly declined to assert. A reader of the
published reference file sees one value, one source and one URL on a row whose whole meaning is *"the two
records could not be reconciled"*. It is asymmetric between the two recorders, and it is asymmetric in a
direction a reader cannot detect from the file, because the file does not say whose record survived.

Candidate remedies exist — blanking the value columns on a conflict, or emitting both records' values —
but **both change the sealable artifact and therefore the `reference_hash` and the `seal_hash`**, and
this note proposes **no instrument change**: the instrument is registered and frozen. What is required
of this wave is that the defect is **recorded** so that whoever publishes the reference file can state
it in the limitations, and so that the adjudicator is told not to act on it.

### 4.4 What must **not** be done about it

- **The adjudicator must not choose `RECORD_1` or `RECORD_2` in order to control which value is
  published on a conflict row.** That is precisely the value-introduction §9.1 forbids. This is stated
  in `REFERENCE_ADJUDICATOR_PACKET.md` §6.4.
- **The operator must not hand-edit a conflict row.** `seal` refuses any reference file that is not
  byte-identical to the reconciliation.
- **No one must treat the value on a conflict row as reference truth.** It is excluded from every
  denominator; citing it as truth would be worse than the defect.

---

## 5. What remains blocked on the operator

| Blocked | Why |
|---|---|
| Whether the §4.1 defect is disclosed in the publication, and in what words | A publication decision. The defect is recorded here for that decision; this note does not make it. |
| Whether the frozen instrument is left as-is | It is registered. Any remedy changes `reference_hash` and `seal_hash`; that is a registration question, not an engineering one. |
| The adjudicator's window and its overflow contingency | The item count is the disagreement count, unknown until both record sets exist, and a subset cannot be adjudicated (§2.3). |
| Everything person-specific | No person has been recruited; all three slots are UNFILLED. |

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

