# RATING_INTEGRITY_NOTES

**Stream:** DEEPTECH-PARALLEL-008 / E-rating
**Classification:** ENGINEERING ARTIFACT. PREPARATION ONLY. Nothing here is an execution record.
**Status:** preparation note. **No U1 stage has run.** No frame, no reference truth, no rating and no
registration exists. No person is recruited, named or approached. Every role slot in this stream is
`UNASSIGNED`.

## 0. What this note is, and what it is not

This note **records and independently confirms** four mechanical properties of the rating stage, each
against the line of the **registered, frozen instrument** that enforces it. It was written by reading
the instrument, not by trusting the packets: every claim below was re-derived from the source, and one
claim in the existing packets was refined as a result (§5).

It is **not** a design document. It proposes no change to the protocol, no change to the instrument, and
no procedure built around the observation in §5. Where this note and the protocol disagree, **the
protocol wins and this note is defective.**

### Provenance of every citation

| | |
|---|---|
| Protocol | `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Instrument | aggregate sha256 `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` over **593** files |
| Read from | `C:/tmp/dt002/research/cpg-u1/tooling` — **read only; never written to** |
| Recomputed with | the instrument's own `lib/aggregate.mjs` (`toolingManifest`), which reported `files 593` and that exact aggregate |

> **Instrument trap — recorded because it is load-bearing.** This worktree carries its **own**
> `research/cpg-u1/tooling`, and it is **stale**: **587** files, aggregate
> `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`. It imports, it runs, and it
> produces a *self-consistent wrong* aggregate — so nothing fails loudly if it is used by mistake.
> **Every line number in this note is a line of the 593-file tree at `C:/tmp/dt002`.** Both validators
> in this programme refuse a tree that is not the registered one, and
> `test/test_rating_packet_validator.mjs` names the 587-file tree in its refusal message.

---

## 1. Two DISTINCT raters are mechanically enforced in TWO places

**CONFIRMED.** The same condition is checked at two independent points in the pipeline, so neither a
mis-built resolution nor a mis-built analysis can let one person be both raters.

### 1.1 At resolution time — `lib/ratings.mjs:97`

```js
// lib/ratings.mjs:97  (inside resolveRatingAdjudication)
if (sheet1.rated_by === sheet2.rated_by) errors.push('the two sheets were rated by the same person — ≥ 2 independent raters are required');
```

`resolveRatingAdjudication` is the function that turns the rating adjudicator's blind decisions into the
rating resolution artifact (`lib/ratings.mjs:95`). The check is on the **sheets' own `rated_by`
fields**, not on a register the operator supplies alongside them, so it cannot be satisfied by editing a
register: the two sheets must themselves carry different recorders.

### 1.2 At analysis time — `analyze`'s condition 3, `lib/analysis.mjs:199`

```js
// lib/analysis.mjs:199  (§15.5 condition 3, "3_rating")
'3_rating': { triggered: (alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : alphaBelow(alpha)) || sheet1.rated_by === sheet2.rated_by || 10 * completelyRated < 9 * total,
```

`sheet1.rated_by === sheet2.rated_by` is one of **three** disjuncts that trigger the §15.5 rating
condition. Two consequences worth stating precisely:

- It is an `||`, so a same-person pair triggers condition 3 **on its own** — independently of α and
  independently of the completeness fraction. A high α does not rescue it.
- It fires **even when no adjudication ever happened.** `lib/ratings.mjs:97` is only reached if the
  raters disagreed on at least one completely-rated item and a resolution was therefore required
  (`finalRatings`, `lib/ratings.mjs:136`). If the two sheets **agreed everywhere**, no resolution is
  built and `:97` never runs — and `lib/analysis.mjs:199` still catches it. **That is why two places is
  not redundancy.** The two checks cover different paths through the pipeline, and the analysis-time
  one is the one that cannot be avoided.

**Verification performed:** both lines read directly from the 593-file tree at the stated line numbers;
the `||` structure of `:199` read in full, not inferred from the surrounding comment.

---

## 2. The rating adjudicator may be NEITHER rater — `lib/ratings.mjs:98`

**CONFIRMED.**

```js
// lib/ratings.mjs:98
if ([sheet1.rated_by, sheet2.rated_by].includes(adjudicator)) errors.push('the rating adjudicator must be neither rater (§4A.3)');
```

The check is against **both** sheets, not against one, so an adjudicator who rated either sheet is
refused. It cites §4A.3 — the seven-mutually-exclusive-roles rule — and the frozen register check
enforces the same exclusivity structurally: `lib/personnel.mjs:6` lists seven `INDEPENDENT_ROLES`
including `rater-1`, `rater-2` and `rating-adjudicator`, and `lib/personnel.mjs:34` refuses any
`person_id` that already holds another role (`ROLE COLLISION — all independent roles are mutually
exclusive`). `lib/personnel.mjs:33` separately refuses the **operator** in any independent role.

So the rule appears twice for this stage too: once on the artifacts (`ratings.mjs:98`, on the sheets'
own `rated_by` and the adjudicator argument) and once on the register (`personnel.mjs:34`).

**One limit, stated so a pass is not over-read.** All of this compares **identifiers for equality**. It
cannot detect one person holding two pseudonyms, and `lib/personnel.mjs`'s own header says the checks
*"cannot verify that declarations are true."* A green check means the ids differ, never that the people
do.

---

## 3. α is computed on the raters' OWN labels, so adjudication cannot change it

**CONFIRMED — and independently traced end to end, not taken from the comment.**

The instrument states the intent at `lib/analysis.mjs:178` (*"Krippendorff's α over the raters' own
labels (before adjudication)"*), but a comment is not enforcement. The data path was traced:

| Step | Line | What it establishes |
|---|---|---|
| The rater sheets are indexed by observation, straight from the sheets | `lib/ratings.mjs:133` — `const s1 = new Map(sheet1.ratings.map(...)); const s2 = ...` | `r1`/`r2` originate in the sheets |
| Each observation's record carries `{ r1, r2, final }` | `lib/ratings.mjs:153` — `out.set(key, { r1: a, r2: b, final })` | the raters' records and the *final* label are **separate fields** |
| The adjudicated label is written **only** into `final` | `lib/ratings.mjs:151` — `else { const r = byKey.get(key); final = { label: r.label, sub_reason: r.sub_reason, adjudicated: true }; }` | `byKey` (the resolution) reaches `final` and **nothing else**; `a` and `b` are never reassigned |
| The analysis row takes the rater labels from `r1`/`r2` | `lib/analysis.mjs:157` — `rater_1_label: f.r1.label, rater_2_label: f.r2.label` | the rater label columns are the sheets' labels |
| The analysis row takes the scored label from `final` | `lib/analysis.mjs:156` — `label: valid ? f.final.label : null, ... adjudicated: f.final ? f.final.adjudicated : false` | the adjudicated label lands in a **different column** |
| α is fed the rater columns and only those | `lib/analysis.mjs:181` — `alphaNominal(alphaPop.map((r) => [r.rater_1_label, r.rater_2_label]))` | `resolution` is **not** an input to α |
| α's arithmetic uses only the pairs it is given | `lib/analysis.mjs:81-91` — `alphaNominal(pairs)` counts label frequencies and `a !== b` disagreements | no other state enters the statistic |

`resolution` appears nowhere in the α expression. The adjudicator's decision reaches the `label`,
`sub_reason` and `adjudicated` columns; it never reaches `rater_1_label` or `rater_2_label`.

### 3.1 The α *population* is untouched as well — checked, because the label values alone are not the whole claim

α could in principle be moved without touching a label, by moving rows **into or out of** the population
that α is computed over. That was checked too, and it cannot happen:

```js
// lib/analysis.mjs:179-180
const alphaPop = rows.filter((r) => r.rater_1_label !== 'pending' && r.rater_2_label !== 'pending'
  && (D['AD-1'] === 'ALL_COMPLETELY_RATED_ITEMS' || !['INVALID', 'REFERENCE-CONFLICT', 'REFERENCE-STALE'].includes(r.disposition)));
```

- The completeness half of the filter reads `rater_*_label`, which §3 just established the adjudicator
  cannot write.
- The disposition half excludes exactly `INVALID`, `REFERENCE-CONFLICT` and `REFERENCE-STALE`. In the
  disposition chain at `lib/analysis.mjs:146-152`, all three are decided **before** `f.final` is ever
  consulted — from `inadmissible`, `o.machine_state`, `ref.resolution` and `ref.as_of_date`. The only
  dispositions the adjudicator's choice can select between are `REFERENCE-AMBIGUOUS`
  (`lib/analysis.mjs:151`) and `VALID` (`:152`), and **neither is in the exclusion list**.

So the adjudicator can change neither the labels α sees nor which rows α sees. **α is closed to
adjudication under both AD-1 settings.** (AD-1 is an open analysis decision in this programme; this
conclusion holds either way, which is why it is stated for both.)

**Consequence, stated plainly:** the rating adjudicator cannot rescue a low α and cannot damage a high
one. Resolving disagreements does not make the raters look like they agreed. α measures the raters, and
§12's threshold (**α ≥ 0.667**, `lib/analysis.mjs:181`, tested exactly by `alphaBelow` at
`lib/analysis.mjs:94`) is therefore a measurement of the two raters and nobody else.

---

## 4. The adjudicator's decision space, and the unconditional `REFERENCE-AMBIGUOUS`

**CONFIRMED.** The decision space is exactly three values, and the mapping from decision to label is at
`lib/packets.mjs:103-113`:

```js
// lib/packets.mjs:109-112
if (r.decision === 'REFERENCE-AMBIGUOUS') return { ...r, label: 'REFERENCE-AMBIGUOUS' };
if (r.decision === 'LABEL_A') return { ...r, label: it.label_a };
if (r.decision === 'LABEL_B') return { ...r, label: it.label_b };
throw new Error(`${r.candidate_id}|${r.field}: decision must be LABEL_A|LABEL_B|REFERENCE-AMBIGUOUS`);
```

| Decision | Resulting label | Line |
|---|---|---|
| `LABEL_A` | `it.label_a` — whichever rater's label was presented as A **on this item** | `lib/packets.mjs:110` |
| `LABEL_B` | `it.label_b` — whichever rater's label was presented as B **on this item** | `lib/packets.mjs:111` |
| `REFERENCE-AMBIGUOUS` | `'REFERENCE-AMBIGUOUS'`, **unconditionally** | `lib/packets.mjs:109` |
| anything else | `throw` — *"decision must be LABEL_A\|LABEL_B\|REFERENCE-AMBIGUOUS"* | `lib/packets.mjs:112` |

### 4.1 `:109` is unconditional — what that does and does not permit

`lib/packets.mjs:109` returns `REFERENCE-AMBIGUOUS` **without consulting `it` at all.** It does not check
whether either rater offered that label; `it.label_a` and `it.label_b` are not read on that branch. So:

- **The adjudicator CAN assign a label neither rater gave.** If rater A said `SUPPORTED-FILL` and rater
  B said `INCORRECT-FILL`, the adjudicator may return `REFERENCE-AMBIGUOUS`, which is neither.
- **The adjudicator CANNOT introduce a new *scoring* label.** `REFERENCE-AMBIGUOUS` is the seventh entry
  of `RATING_LABELS` (`lib/packets.mjs:8`) and it is an **exclusion**, not a score: §10.3 excludes it
  from every denominator, counted and published. Every other member of `RATING_LABELS` is reachable
  **only** through `LABEL_A` or `LABEL_B`, i.e. only as a label one of the two raters actually recorded.
  There is no decision value that produces a fresh scoring label.

The asymmetry is therefore narrow and one-directional: the third option can only ever move an
observation **out** of scoring, never into a score no rater chose. That third option is not free —
choosing it spends the §15.5(2) exclusion budget, and every use is published.

### 4.2 The surrounding refusals, for completeness

`resolveRatingAdjudication` additionally refuses a decision on an item that is not in the deterministic
packet, a duplicate decision, an `adjudicated_by` that is not the assigned adjudicator, a missing
rationale, a malformed `adjudicated_at` (`lib/ratings.mjs:103-108`) and a *"disagreement without a
decision"* (`lib/ratings.mjs:110`). `finalRatings` then refuses a resolution whose hash does not
recompute, one bound to other sheets or another evaluation, one made on a packet other than the
deterministic one, and one that does not decide **exactly** the disagreements
(`lib/ratings.mjs:138-141`). The adjudicator's freedom is confined to the three-value `decision` column.

---

## 5. NOTED, NOT DESIGNED AROUND: the rater packet carries the reference team's pseudonyms and each row's contest status

This is recorded because it is a property of the **frozen** instrument that anyone reading a rater packet
should know. **No procedure in this stream is built around it, no mitigation is proposed, and no change
to the instrument or the protocol is implied.**

`REFERENCE_COLUMNS` (`lib/schema.mjs:213-217`) is the sealed reference row, and its last four columns are:

```js
// lib/schema.mjs:215-216  (the tail of REFERENCE_COLUMNS)
'publication_date', 'as_of_date', 'search_note', 'ambiguity_flag', 'independence_class',
'author', 'confirmer', 'resolution', 'adjudicated_by',
```

And the rater packet builder requires the reference record to be **exactly** that row — no subset:

```js
// lib/raterPackets.mjs:60  (inside checkItem)
if (!exactKeys(it.reference_record, REFERENCE_COLUMNS)) throw new Error(`evaluation item ${it.candidate_id}|${it.field}: reference_record must be exactly the sealed reference row`);
```

`exactKeys` is an **equality** on the key set, so the four columns can be neither dropped nor added to.
Consequently every rater and the rating adjudicator see, for every observation:

- `author` and `confirmer` — the **pseudonyms of the two reference recorders** for that row;
- `resolution` — one of `AGREED`, `ADJUDICATED_AUTHOR`, `ADJUDICATED_CONFIRMER`, `REFERENCE_CONFLICT`
  (`lib/schema.mjs:218`), i.e. **whether that row was contested at reference time**, and which side won;
- `adjudicated_by` — the reference adjudicator's pseudonym, on rows that were contested.

`lib/packets.mjs:77` applies the same `exactKeys(ev.reference_record, REFERENCE_COLUMNS)` requirement to
the rating-adjudicator packet, so the rating adjudicator sees it too.

**Two things this is not.** It is not a leak of rater identities to each other: Label A / Label B is
assigned per item from `order_key("rating-adjudicator-label-a", …)` (`lib/raterOrder.mjs:51`), so the
mapping flips item by item and no rater identity appears in the rating-adjudicator item keys. And it is
not a defect finding — it is the sealed row, `reconcile` is its only author (`lib/schema.mjs:212`), and
the row is what it is. It is recorded here only so that no one later describes the rater packet as
carrying *only* reference values.

**The corresponding instruction already exists in the packets and is not restated as a new rule:**
`RATING_ADJUDICATOR_PACKET.md` §4.1 already directs the holder not to act on `author`, `confirmer`,
`resolution` or `adjudicated_by`, because none is an input to §10.1 or §10.2.

---

## 6. What this note does NOT establish

| Not established | Why |
|---|---|
| That any rater or rating adjudicator is independent | Every check above compares identifiers and structure. `lib/personnel.mjs`'s header states it *"cannot verify that declarations are true."* |
| That anyone is recruited | Nobody is. Every role slot in this stream is `UNASSIGNED`. |
| Any α value, any label, any rating | Nothing has been rated. No number in this note is a result. |
| That the two-rater rule survives a single person under two pseudonyms | Equality on ids cannot see that. It is a register-integrity question, not a tooling one. |
| Anything about AD-1 or AD-2 | Both remain open analysis decisions. §3.1 was written to hold under either AD-1 setting precisely so this note does not presume one. |

## 7. Files read, and files written

**Read (never written):** `C:/tmp/dt002/research/cpg-u1/tooling/lib/{ratings,analysis,packets,raterPackets,schema,personnel,reconcile,aggregate,sizing}.mjs`
and `research/cpg-u1/CPG_U1_PROTOCOL_004.md`.

**Written:** this file only, inside `research/deeptech-operations/prereg-008/E-rating/`.
No protocol byte, no instrument byte, and no file outside this directory was modified. No commit, no
push, no registration, no network access.
