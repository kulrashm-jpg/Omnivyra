# DEEPTECH-PARALLEL-007 — the eight-person operating model

**Status: PREPARATION. Nothing registered, committed, pushed or executed. No frozen byte changed.**
Protocol-004 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` and the instrument aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) re-verified unchanged after all work.
`origin/main` = `af2fb6e99ce461894bf16f18c2251f75088eba18`.

Seven concurrent analyses, **all reported and reconciled** (A protocol, B partition, C tooling audit, D merge, E
scan/sufficiency, F recruitment, G timeline). Artefacts preserved to `C:/tmp/dt007-eight-person/`.

---

## 1. §4A.3 verification

**A second enumerator is explicitly permitted. No amendment, no re-freeze, no registration field affected.**

§4A.3 lists "**enumerator (≥ 1)**" among the roles and states: "**Several enumerators are permitted; each holds no
other role.**" The seven-role mutual exclusion and the "minimum 7 independent persons" sentence are a floor on
headcount and a count of *role labels* — not a cap on persons.

**The decisive evidence is in the instrument itself.** `test/selftest.mjs:829` is a *passing* test:

```js
{ const r = personnel(); r.assignments.push({ ...r.assignments[0], person_id: 'SYN-P-ENUM2', pseudonym: 'e2' });
  ok(chk(r).errors.length === 0, 'multiple distinct enumerators permitted'); }
```

and `:830` asserts the converse — `'a second rater-1 refused'`. `lib/personnel.mjs:26` is
`else if (role !== 'enumerator' && n > 1)`, so multiple holders are permitted for `enumerator` **and only** for
`enumerator`. Since the tooling aggregate is itself a registration object, **the freeze as implemented asserts that an
eight-person register conforms.**

**One residual doubt, not softened.** §19.3(3) ends with a bare "Seven mutually exclusive independent persons" — no
minimum marker, in the same sentence where the author *did* write "≥ 2 raters". I and Agent A both judge it a minimum
(the section heading says its items "must exist", a floor by nature; it writes "enumerator(s)"; and **no mechanism
anywhere implements a cap** — no §5.10 VOID state, no §15.5 condition, no §21 step, and no personnel field in the
registration record at all). But an outsider verifying under §21 who reads §19 and not §4A could raise it in public,
and adversarial verifiability is this study's whole value. **Disposal: one decision-log entry plus one line of
registration narrative citing §4A.3 and `selftest.mjs:829`. Changes no frozen byte.**

---

## 2. The eight-person model

Eight independent persons plus the operator = **nine humans**. The operator remains not independent (§4A.3) and holds
no independent role.

| # | Role | Change |
|---|---|---|
| 1 | **Enumerator A** | new label for the existing single enumerator |
| 2 | **Enumerator B** | **the added person** |
| 3 | Reference Author | unchanged |
| 4 | Reference Confirmer | unchanged |
| 5 | Reference Adjudicator | unchanged |
| 6 | Rater 1 | unchanged |
| 7 | Rater 2 | unchanged |
| 8 | Rating Adjudicator | unchanged |

No existing role is replaced, merged, removed or weakened. Both enumerators carry the literal role string
`enumerator`; a label like `enumerator-2` would be refused as `unknown role` (`personnel.mjs:31`).

---

## 3. Two-enumerator architecture

**The frozen instrument already supports this, and needs no code.** `FRAME_COLUMNS` (22) ends with `enumerated_by`,
`enumerated_at`, `enumeration_source_url`, and `lib/schema.mjs:124` requires `enumerated_by` non-empty. Per-row
attribution exists today.

Agent C proved the whole path end-to-end on a synthetic 210-row two-enumerator frame, with real command output:

```
frame --frame merged_ab.csv   → 210 rows, malformed 0, frame_hash f2ff1899…  exit 0
frame --frame merged_ba.csv   → frame_hash f2ff1899…                          exit 0   ← identical, B's rows first
scan  … --frame merged_ab.csv → 1 of 210 held-out-ineligible                  exit 0
check-frame-sufficiency       → 126/126, 52/52, 32/32 "frame sufficient"      exit 0
```

**Architecture: each enumerator submits an independent CSV in the frozen 22-column format with their own
`enumerated_by`; the operator concatenates; `frame` then `check-frame-sufficiency` must both exit 0 before the
development commitment.** Three lines of operator procedure, no tooling change.

The refusals that protect the operator are also real: a naive `cat a b` (duplicate header as a data row) → 12 checks
fire, exit 1; the same `candidate_id` from both → `MALFORMED … duplicate candidate_id`, exit 1; the same company under
two ids → `FRAME_INVALID: duplicate identifier CIK:100001 — one row per legal entity`, exit 1 at the sufficiency gate.

**`frame` alone is not the gate** — it exits 0 on a duplicated company. The acceptance gate must be
`check-frame-sufficiency`.

---

## 4. Partition strategy

**Jurisdiction family, effort-balanced: A = {US-SEC, LEI-ONLY}, B = {FR-SIRENE, BR-CNPJ}.**

`JURISDICTION_FAMILIES` = `{US-SEC:[CIK,LEI], FR-SIRENE:[SIREN,LEI], BR-CNPJ:[CNPJ,LEI], LEI-ONLY:[LEI]}` — four
indivisible units, and **not interchangeable in effort**: `LEI-ONLY` permits one scheme rather than two and is the
catch-all for inaccessible jurisdictions, while `isValidCik` is `/^[0-9]{1,10}$/` with **no checksum**, so US-SEC gets
the weakest mechanical A3 check and the burden shifts to the human A4 step. A 50/50 *count* split is a ~1.35× *effort*
spread.

**Pair the hardest family with the easiest.** `{US-SEC, LEI-ONLY}` vs `{FR-SIRENE, BR-CNPJ}` gives 4.3 h idle (97.9%
efficiency); the obvious geographic pairing `{US-SEC, FR-SIRENE}` vs `{BR-CNPJ, LEI-ONLY}` gives 17.1 h idle (92%).

**Rejected alternatives, each for a structural reason.** A partition **by outcome class** fails twice: §5.2 defines the
class as "the enumerator's **prediction**", so it is an *output* of the work and cannot be a partition key at all — an
enumerator assigned one class who concludes another holds a row they may neither keep nor hand over; and the per-class
volumes are unequal (126 : 52 : 32), so a class assignment hands over the threshold up to the yield factor. A
**hash-split** or **interleaved list** fails because it presupposes a shared candidate universe that does not exist
before enumeration — operator-built destroys §20.18 enumerator independence, enumerator-built breaches §4A.2's
exhaustive receive-list, and a mechanically-built one would need a new registered artefact. **Both enumerate
everything** is 2× effort for 1.0× makespan, and the cross-check step appears forbidden as written: to check B's row, A
must *receive* it, which §4A.2's closed list does not permit.

**Known, declared cost:** a jurisdiction partition **confounds enumerator identity with jurisdiction family**, so an
enumerator-specific habit (a lax A4 reading, an `unknown` reflex) lands on one whole family and is indistinguishable
from a jurisdiction effect. Agent E independently raised the same concern and preferred a class-neutral interleave; I
resolved it in favour of jurisdiction because interleaving is not available (above). **The mitigation is free:** publish
the realised `enumerated_by` × family composition beside the §5.7 jurisdiction composition that is already published.

**Disjointness gap, closed:** a US/FR/BR registrant holding an LEI could be entered as its national family by one
enumerator and `LEI-ONLY` by the other. Closed by one instruction grounded in §5.1's own sentence — **assign the most
specific accessible family** — plus `E1-`/`E2-` candidate_id prefixes and a pre-registered tie-break.

---

## 5. Independence and information flow

**All 28 role pairs are FORBIDDEN-BY-TEXT; nothing is inferred.** The only permitted multiplicity is enumerators.

**Enumerator-to-enumerator independence is textually ambiguous and must be settled on the record.** §4A.1 item 6
excludes anyone related to "any holder of **another** §4A.3 role". A strict-literal reading ("a role other than mine")
would **not** reach a co-enumerator holding the same label — so **two spouses could co-enumerate and pass every
mechanical check**, gutting the only benefit the eighth person buys. The purposive reading is correct and the
instrument supports it: the declaration key is `close_relationship_with_developer_operator_or_role_holder` —
"role_holder", unqualified. Adopting it adds no rule and needs no amendment, but it must be recorded **before the
roster is fixed**.

**Nothing forbids communication or requires blinding between enumerators**, and that silence is coherent: the frame is
a **union**, not a comparison. There is no inter-enumerator agreement statistic anywhere in §10/§12/§15 and no
enumeration adjudicator, so blinding would buy no statistic while obstructing uniqueness and coverage — forcing an
intermediary, and the only available intermediary is the operator, i.e. exactly the §22 row 31 channel.

**The information barrier is not a blocker, and the tension pre-exists at one enumerator.** §4A.2's receive-list is
"public sources; the frame template; §4A, **§5.1–§5.4**; the jurisdiction-family list; the development-only registry",
and the never-receive clause's parenthetical `(§5.5, §5.7.2)` puts the 126/52/32 numbers expressly on the barred side.
So no enumerator — one or two — may be told the quotas. §5.7.2 *prescribes* iteration ("enumeration continues first"),
so the question is never whether the operator may go back, only what may be said.

- **May be said:** the §4A.2 list; the family assignment; a disjoint `candidate_id` prefix; a **pre-agreed total row
  count, never per class**, deliberately over-provisioned; "submit all three classes as encountered"; row-level
  admissibility diagnostics on their *own* rows; and one bit, "not yet complete, continue".
- **May not:** any per-class count or target, a per-class continue signal, or anything about the other's rows.
- **Who computes sufficiency: the operator, and mechanically only the operator** — `check-frame-sufficiency` needs a
  `--scan`, and `scan` needs a clean clone at the frozen resolver SHA, which §4A.2 does not give an enumerator. An
  enumerator *physically cannot* compute it. This creates no §5.5/§6.5/§9.6/§18.3 problem: the barrier constrains what
  the operator *tells*, not what it *computes*, and the operator is *required* to compute it.

**The second enumerator adds exactly one new leak channel: asymmetry.** Asking only Enumerator B to continue tells them
their partition is short, which under a jurisdiction split correlates with a class. **Closable at no validity cost** by
always asking both, by the same amount — surplus rows are harmless under §5.8 (`NOT_DRAWN`/`DEVELOPMENT_SURPLUS`); the
cost is fees.

**Where the eight-person model is evidentially POSITIVE, conditionally.** With a criterion-defined disjoint partition
and self-sourced candidates, a globally biased frame requires **two coordinated false declarations** rather than one,
and — the stronger point — a **new observable** appears: an outsider holding the §13.2A archive can compute
per-`enumerated_by` composition statistics (class, jurisdiction, source domain, identifier scheme, admissibility and C1
rates), and a between-partition asymmetry is evidence of bias in the deviating partition. **That audit does not exist
at all with one enumerator.** It is **neutral** if the partition is not criterion-defined, and **worse than one
enumerator** if the operator allocates candidates — attribution laundering, which nothing in the text forbids and no
tool can detect. It can never make §23 claim (2) cryptographic: what is committed is the *record* of attribution, never
its truth.

---

## 6. Duplicate and reconciliation mechanism

**The detector already exists — do not build one.** `assertUnique` (`lib/select.mjs:44-51`) throws
`duplicate identifier <scheme:id> — one row per legal entity` or `duplicate canonical_domain <domain> — …`, and is
reached from `lib/frame.mjs:42` (the sufficiency path) and both draw commands. It is complete for *admissible* rows,
because an admissible row cannot have `UNKNOWN` for either key.

**Judgement conflicts already have a lawful home, and it needs no new vocabulary and no third human.** §5.1: "UNKNOWN
means 'not established / insufficient evidence'. It never means false, and it never satisfies a criterion [enforced:
`checkFrameRow`; exhaustive 81-combination test]." **Two competent independent enumerators disagreeing on a criterion
*is* insufficient evidence for it.** So a genuine conflict maps to `unknown` on the disputed criterion → never
satisfies it → the row is ineligible and excluded under an **already-existing** reason from the closed 16-item
`EXCLUSION_REASONS` list (`A1_NOT_ESTABLISHED` … `A6_NOT_ESTABLISHED`, or `OUTCOME_CLASS_NOT_ESTABLISHED` for a class
disagreement). The conflict is **preserved and published** in the §15.3 screening log rather than silently resolved —
which is what the directive requires. The cost is paid in sufficiency headroom against 126/52/32, not in evidentiary
strength. §5.3's contamination analogue is enforced identically (`schema.mjs:159-170`: `unknown` pushes
"— NOT ESTABLISHED, treated as contaminated").

**Two-enumerator consistency on a1–a6 is structural, not procedural.** `checkFrameRow` (`lib/schema.mjs:92-176`) is a
**pure function of one row** — no cross-row state, no operator input, no clock, no network. A3 and A5 are *computed*
(checksum + family/scheme compatibility); A2 is partly computed; A4 `yes` without a valid https evidence URL **and** a
non-blank note is downgraded to outright **fail**. So nothing either enumerator writes can change how the other's rows
are judged.

**What the frozen code does NOT catch — wider than first thought.** Verified:

- **U-1:** the same legal entity under a *different* identifier **and** a *different* canonical domain. `assertUnique`
  compares only those two keys, so it is blind. Two admissible rows for one entity, §5.7 silently violated, and the
  frozen frame can draw that entity twice. **Impossible at one enumerator.**
- **Inadmissible rows are never checked at all.** `frameSufficiency(admissible, ineligible)` is documented "@param
  admissible rows with no exclusion (after checkFrameRow)", so `assertUnique` only ever sees admissible rows. Any
  duplicate pair in which *either* row is inadmissible passes unnoticed.
- **`wikidata_qid` is never checked for duplication anywhere** in the tree.
- Duplicate **names** are not checked; **parent/subsidiary** relationships are undetectable from the 22 columns without
  network access, and are properly routed to the `identity-hazard` mechanism instead.
- **Timing:** `assertUnique` fires only at `check-frame-sufficiency`, which needs `--scan` and `--registry`, and throws
  on the *first* duplicate. Agent D's merger closes exactly this gap — it reports all groups on all decisive axes over
  all rows including inadmissible ones, before any scan, as a list rather than a throw. (Correction to my own note:
  the frozen failure is legible, not a stack trace — `sufficiencyOf` wraps the call and emits `FRAME_INVALID: …`.)

**The reconciler can be neither an enumerator (would see the other partition) nor the reference adjudicator (§4A.3)** —
so it falls to the operator, and that must be recorded.

**Three behaviours an owner should see, all verified by Agent D:**

1. **A contamination-attestation conflict does not exclude — it promotes.** §5.3 makes `unknown` equivalent to `yes`,
   so the row stays **admissible** but **held-out-ineligible**; and `drawDevelopment` orders ineligible companies
   **first**, so a `c1_*` conflict *actively moves the row into the development set*. That is the protocol's own logic,
   not a defect, but it is a different disposition from exclusion.
2. **Only the earliest failing criterion is published.** A group with three conflicts yields one reason in the §15.3
   log. **So the merge transcript and the conflict list must be sealed alongside the frame**, or the multi-conflict
   record is lost.
3. **A `company_name` conflict has no lawful token.** No `UNKNOWN` is permitted for that field, and excluding the row
   would mean overwriting a field the enumerators agree on — fabrication. The lawful disposition is to **withdraw both
   rows before the development commitment**, which §5.5 permits (its prohibition binds only *after*) and which needs no
   person and no new reason.

**Cost, and what it does not cost.** Each conflict costs one candidate against 126/52/32, and **nothing** from
§15.5(2)'s 90%-VALID budget — that covers post-draw observations, whereas a merge conflict happens before the frame
exists. The shortfall is recoverable because §5.7.2 says "enumeration continues first". Agent D sizes the
over-enumeration at roughly 7% (≈225 submitted rows for 210) at a 10% disagreement rate.

**So exclusion is lawful, sufficiency holds, and the model needs no adjudicator — §4A.3's seven-person minimum is
untouched.**

---

## 7. Frame-integrity mechanism

**`frame_hash` is order-independent if and only if `candidate_id` is unique** — a correction Agent D made to my own
claim, which I verified. `hashRecords(records, sortKey)` calls `canonicalRecords`, which does `[...records].sort(...)`
on the sort key before serialising (`lib/canonical.mjs:15-21`), using `<`/`>` on UTF-16 code units, never
`localeCompare`. But `Array.prototype.sort` is **stable** (ES2019), so two rows sharing a `candidate_id` are serialised
in **input order**. Measured against the frozen `hashRecords`:

```
unique ids,    forward vs reversed → identical
duplicate id,  forward d7da98fb…  reversed b6e1fc33…  → DIFFERENT
```

Practically the design is safe, because a duplicate-`candidate_id` frame is refused at `frame`
(`cpg_u1_data.mjs:99` → `MALFORMED_ROW` → exit 1) and so can never reach a commitment. Agent C's experimental proof
stands for the case that matters — `merged_ab.csv` and `merged_ba.csv` both yield
`f2ff1899d70e3c09377ca47d3f35632ea9b6dd9f7b037367d6a6e808b7d78316`. **But the precise claim is conditional, and I had
stated it flatly. Concatenation order is not part of frame identity *provided* the id namespaces are disjoint** — which
makes namespace disjointness an operational obligation, not a property of the artefact. `candidate_id` is
enumerator-assigned and constrained only by `^[A-Za-z0-9_-]{1,64}$`; no namespace rule exists anywhere, so two
enumerators both starting at `C001` would collide on every row.

Two residuals Agent D found in that refusal path: the duplicate check is positional (the *second* occurrence is
flagged, so the message is order-dependent), and `frameHash` is still **computed and printed before the exit** — so an
operator copying that number out of a failed run copies something irreproducible.

**A compensating property that makes merge decisions safe.** `rankKey(seed, c) = sha256("<seed>|<scheme>:<value>")` is
keyed on the **identifier**, never on `candidate_id` — verified byte-identical under renaming. So a merge rule such as
"the surviving row keeps the code-unit-smallest `candidate_id`" is **provably selection-neutral**: it changes
`frame_hash` but cannot move any row in the draw order.

**Byte-determinism beyond the hash.** The hash does not absorb Unicode normalisation form, a BOM, in-field CR/LF or CSV
quoting style — and nothing in the frozen code normalises, so NFC vs NFD yields both a different hash **and** a spurious
field conflict. Agent D's merger NFC-normalises every field, absorbs a BOM, and refuses in-field control characters;
it produces identical output bytes under `LANG`/`LC_ALL` of `tr_TR.UTF-8`, `C` and `de_DE.UTF-8` (Turkish chosen
deliberately, being the locale where a locale-aware `toLowerCase` corrupts a domain) and under three timezones.

**Attribution is already cryptographically bound.** `frame_row_hashes` is `sha256(canonicalJson(row))` per
`candidate_id`, and the row *includes* `enumerated_by` — so who enumerated what is committed on-chain via
frame_hash → payload → OP_RETURN, before the randomness block exists. It is bound, but not human-readable and **never
checked against the personnel register**: `enumerated_by` is free text, appearing in only three places tree-wide.
Nothing stops one enumerator writing the other's id.

**The scan composes at the decision level but must be run once on the merged frame.** `lib/scan.mjs` has no
module-level mutable state; Agent E measured 218/218 per-candidate results byte-identical between partition runs and
the merged run, and a hand-merged report byte-identical to the tool's. But the payload carries exactly one
`scan_sha256`, `contamination()` refuses a scan whose `frame_hash` does not match (exit 1), and no merge command
exists — so **re-scan the merged frame; it is one cheap pass.**

**Sufficiency counts are additive; the predicate is not.** Agent E's real output: partition A 68/29/18 and partition B
58/24/16 both INSUFFICIENT (exit 1), union 126/53/34 sufficient (exit 0). **Per-partition sufficiency is meaningless**
— the gate runs once, at the merge.

**A defect found, verified, and contained.** `cmdScan` builds `new Map(frame.map(r => [r.candidate_id, …]))`
(`cpg_u1_data.mjs:233`), which silently keeps only the last row for a repeated id — 220 rows in, 219 results out,
**exit 0**. It is reachable because line 230 loads via `loadCsv`, **not** `loadFrame`, and `loadFrame` is the only place
the duplicate check lives. It **fails closed** downstream through two independent guards (`loadFrame`'s duplicate check
and the `frame_hash` binding), so a duplicate cannot reach a commitment this way — what it produces is a misleading
intermediate artefact and a command exiting 0 on malformed input. Worth fixing, but not a soundness hole. **Time-boxed:
§19.1 freezes the aggregate at registration, so it is decided before registration or not at all.**

---

## 8. Workload calculation

Derived from code: `FRAME_MINIMUM` = **126/52/32 = 210** admissible held-out-eligible rows, and it is exactly
**2 × Qmax + DEVELOPMENT_QUOTA** per class (2×60+6, 2×25+2, 2×15+2) — so the §5.7 pool minimum and the §5.8 development
consumption are **already inside the 210** and must not be double-counted.

**The enumerator's load is size-independent** — `FRAME_MINIMUM` is built from the *maximum* quota over all 4096 pilot
outcomes, and the frame must pass sufficiency before the development commitment, i.e. before any pilot exists. A
consequence worth noting: the eighth person is worth **most** at the 20-company floor, where enumeration is ~51% of the
study, and **least** at the 100-company cap, where it is ~37%.

**§5.7.2 is a per-class rule** — `frameSufficiency` returns a per-class `shortfall[]`, so reaching 210 in total is not
sufficient and the binding constraint is the worst class. Any flat-yield-on-a-single-total calculation is wrong.

Every time-per-unit figure below is an **ASSUMPTION** with a stated basis. None is measured; none may be cited as U1
evidence.

| | one enumerator | two enumerators |
|---|---|---|
| candidates to screen (central) | ~393 | same total |
| human hours | 142–197 | **rises** to 152–162+ (briefing ×2, merge, cross-partition reconciliation) |
| elapsed, balanced | 8.00 wk | 4.96 wk |
| elapsed, imbalance 0.15 (central) | 8.00 wk | **5.49 wk** |
| parallelisable fraction | — | 93–94% of hours |

**Total work does not fall — it rises.** Only elapsed time falls, and only for the per-candidate part.

**The largest saving available is not parallelisation at all.** Because no enumerator may be told the quotas, total
volume must be set by the worst target-to-yield class and every other class overshoots. With no class guidance the ask
is ~712 candidates; with a **quota-free qualitative sentence** — that rows must cover all three §5.2 classes, that
fill-expected will be commonest, and that the other two should be sought deliberately — the ask falls to ~400. **Agent
B prices that one sentence at ≈98.6 hours (−36.6%), it discloses no number, and it works with one enumerator.**

Blind iteration cannot target the short class, so the first ask must be sized from the **scarcest** class
(`abstention-expected`, threshold 52) — of the order of 360–400 submitted candidates, ~1.8–2× the 210 floor.
**§20.22 understates this: it declares the floor on the accepted frame, not the ask.**

---

## 9. Calendar saving — the claimed figure is CORRECTED

**The "2.63–2.92 weeks" I previously reported is not a range and is not right.** Agent G reconstructed it: **2.92** was
the enumeration phase simply *halved* (5.83 → 2.92 wk); **2.63** was that same number minus one chosen recruitment
cost. The error is one assumption — that a second enumerator removes exactly 50%.

Corrected, from a 648-cell joint grid with no corner-picking:

| | value |
|---|---|
| gross saving, p10–p90 | **0.98 – 4.53 weeks** |
| median | **2.23 weeks** |
| central cell | 2.51 weeks |
| share of the enumeration phase removed | **22.4% – 39.1% (median 29.9%), maximum 43.4% anywhere — never 50%** |
| Amdahl ceiling at infinite enumerators | 6.59 weeks; k=2 captures 38.1% |
| marginal saving | 2nd person 2.51 wk · 3rd 1.21 · 4th 0.53 · 8th 0.04 |

G is candid that 2.92 sits inside its plausible range only because two errors of opposite sign nearly cancel — the old
baseline understated the work (116.7 h against 142 h) while overstating parallel efficiency (100% against ~30%) — and
that "a figure that is right by cancellation is not a verified figure".

**Enumeration is genuinely on the critical path and the saving is not absorbed.** It cannot start before registration;
nothing downstream can start earlier because the commitment digest contains `frame_hash` and `scan_sha256`; and
reference truth needs the draw, which needs the commitment. Moreover **enumeration is the only phase whose elapsed time
responds to headcount at all** — `checkPersonnelRegister` refuses `n > 1` for every other role, and `reconcile()`
demands an Author *and* a Confirmer record for every drawn company × field. That is what makes the eighth person the
only available headcount acceleration, and simultaneously caps what it can be worth.

**Partition imbalance is the only differential lever** (3.04 wk balanced → 1.62 wk at 0.40 imbalance). Gate latency and
sufficiency iterations lengthen *both* designs equally and do not change the saving.

---

## 10. Human recruitment delta

**Exactly one more person, of an existing role type.** Same seven `DECLARATION_KEYS` (one frozen array used for every
role), one more declaration, one more organisation confirmation, one more fee agreement, one more eligibility check. No
new role type; `INDEPENDENT_ROLES` stays at 7 entries. No schema change — `assignments` is already an array.

**THE FINDING THAT DECIDES THE SIGN.** §4A.1 item 6 disqualifies anyone related to "any holder of **another** §4A.3
role", and "An unknown answer is not 'no'". So **a declaration signed before an eighth role-holder existed cannot cover
that person.** Adding them after the register closes forces a second declaration round (pairwise checks
C(7,2)=21 → C(8,2)=28) plus a cold single-person search. Agent G computes the net as **negative in 252 of 648 grid
cells** at central late-addition cost and **617 of 648** at worst — a reversal of up to ~2.9 weeks. And
`checkPersonnelRegister` only tests that each declaration string is `"no"`, so **`check-personnel` exits 0 on a
methodologically stale register**; nothing mechanical catches it.

**I established the condition G could not: the register is OPEN.** Only `INDEPENDENCE_DECLARATION_TEMPLATE.md` and
`declaration_intake.mjs` exist; there is no populated register and no signed declaration in any preserved artefact, and
the DAG records "Recruit 7 independent persons" as **BLOCKED — HUMAN REQUIRED**, never started.

**Therefore the net is positive: +1.65 … +2.44 weeks.** But this makes the decision **time-critical in a way the
directive did not anticipate: the eighth person must enter the *original* roster.** If recruitment begins on seven, the
opportunity is lost and re-adding them may cost more than it saves.

**"At zero independence cost" — my phrase, and wrong as stated.** No structural separation collapses. But §4A.1 makes a
false enumerator declaration mean "the frame is not independent (§20.18)", and the frame is a **single joint artefact
with one `frame_hash`** — so a false declaration by **either** enumerator taints the **whole** frame including the
other's sound partition. **Two single points of failure for the same total consequence.** Small, but not absent.

**A trap to avoid:** with two slots, **both** fee agreements must be signed before **either** person receives material,
or §4A.1 item 5's exception fails and the payment falls back under item 3 — which disqualifies them.

---

## 11. Protocol impact

**None. No amendment is expected and none is required.** The STOP condition in the directive was not triggered.

| Clause | Effect |
|---|---|
| §4A.3 | already permits several enumerators — **no change** |
| §4A.1, §4A.2 | apply per enumerator unchanged; item 6 needs a **recorded interpretation**, not an amendment |
| §5.1–§5.4, §5.7, §5.7.2 | unchanged; the gate simply runs once at the merge |
| §15.3 | `screened_by` is one CLI scalar per stage, so it must be a **panel designator**; per-row attribution is recovered by joining the sealed log to the sealed frame on `candidate_id` |
| §19.3(3) | residual "seven" ambiguity — disposed by recorded interpretation |
| §22 #34 | **unchanged** — mutual exclusion is enforced over any number of enumerators |
| §22 #31 / §20.18 / §23 claim (2) | **conditionally positive** (see §5); must still be reported with row 31 UNRESOLVED and §20.18 unamended |

**Three protocol-text observations that are head-count-independent and worth recording** (none blocks this work):
§20.18's "rests on enumerator independence only" is **incomplete** — only the operator can compute sufficiency, the
operator is not independent, and §5.7.2 lets the operator choose when to stop while seeing per-class shortfalls, so it
also rests on the operator's stopping rule. §20.22 declares the accepted-frame floor rather than the enumeration ask.
And §5.3's C1(2)–C1(5) attest "the enumerator is unaware of contamination" while being presented as "the company was
not used in CPG development" — the protocol's arithmetic depends on enumerators answering `no` on no evidence, which
§5.1 expressly says UNKNOWN is not.

---

## 12. Tooling changes

**Required: none.** The recommended path is zero-change.

**Built as clearly-labelled PROPOSALS outside the frozen tree** (adoption would move the aggregate and must therefore
precede registration or not happen):

| Artefact | What it does |
|---|---|
| `partition/partition.mjs` | partitions the **enumeration domain**, not candidates — the twelve `(jurisdiction_family × outcome_class)` cells the protocol already defines. No discretionary run-time parameter; byte-reproducible; `candidate_id` namespaces **derived** from each pseudonymous `person_id` so two enumerators structurally cannot mint the same id; emits an `allocation_digest` suitable for pre-registration |
| barrier check inside it | evaluated **first**, on raw input: refuses forbidden key names, forbidden values, and **any bare number** — a number in a partition input is a quota. The emitted allocation carries **scope only, no count** |
| `partition/auditlog.mjs` | hash-chained append-only enumeration log. **Reuses `lib/eventlog.mjs`'s semantics** (GENESIS, `seq`, `prev_event_sha256`, `event_sha256`), asserted byte-identical to the frozen `eventHash`. Records `row_sha256` using the *same* function whose results the manifest already publishes as `frame_row_hashes`, so it reconciles against a published field. Pseudonymous ids and **dates, never timestamps** (a clock time leaks working hours → time zone) |

`lib/eventlog.mjs` could not be reused directly because `EVENT_LOG_SCHEMA` and `EVENT_TYPES` are frozen constants
admitting no enumeration event; the exact three-line diff is documented for adoption.

**Optional fixes, decidable only before registration:** make `cmdScan` refuse duplicate `candidate_id`s (§7 above), and
validate `enumerated_by` against the personnel register (`frame` would need a `--personnel` option). Neither is
required for the eight-person model.

---

## 13. Tests and validation

All counts re-run by me, not relayed.

| Suite | Result |
|---|---|
| `test_partition.mjs` | **76 passed, 0 failed** |
| `test_auditlog.mjs` | **36 passed, 0 failed** |
| `mutate.mjs` | **56 mutations, 56 KILLED, 0 SURVIVED** |
| Agent E's scan/sufficiency transcript | 29 captured command exits, 310 lines |
| Agent D `merge.test.mjs` (real CLI + frozen `cpg_u1_data.mjs`) | **125 assertions, 125 passed, 0 failed** |
| Agent D `mutate.mjs` | **70 mutants, 70 killed, 0 survived** |
| zero-change end-to-end | `frame` → `scan` → `check-frame-sufficiency`, all exit 0 |
| merged output through the **frozen** `frame` | 12 rows, malformed 0, `frame_hash 7ecfaddf…`, **exit 0**; merger's independently computed hash identical |

**One nuance worth recording.** On my first run in the preserved copy I got **73/76, 34/36 and 55/56 killed**, with the
survivor `auditlog.mjs: GENESIS length changed`. The cause is environmental, not a defect: the conformance tests that
assert byte-identity against the frozen module are gated on `CPG_U1_TOOLING`, and the `GENESIS` mutant is killed only
by them. With the variable set I reproduce Agent C's figures exactly. **Anyone re-verifying must set
`CPG_U1_TOOLING`, or they will see a survivor and think something is wrong.**

**Both prototype agents reported their first pass honestly and closed every survivor the right way.** Agent D's first
complete pass was **80 mutants, 60 killed, 20 survived**: ten were equivalent mutants in five duplicated three-way
comparators, closed by **removing the duplication** (one exported comparator with its contract asserted directly, which
is why the count fell to 70); two were unreachable guards, **deleted as dead code** rather than covered by a test that
could not kill them; and nine were genuine test gaps, closed with real coverage including a three-member duplicate group
and the never-exercised `wikidata_qid` branches. It also found a real defect in its own output — the transcript's
contraband array was built in argv order, so two of four outputs were not byte-identical under reversed input while the
frame was.

Agent C reported its first mutation pass honestly as **41/56**, and closed all 14 survivors the right way — four were
genuine equivalent mutants fixed by making the guard reachable or **deleting dead code**, and the rest by moving the
barrier check to the top (which is also more correct) and adding boundary and hand-signed-chain cases. It also found
and fixed flakiness in its own harness, where a Windows file-handle race could make a crash look like a score.

---

## 14. Remaining blockers

**Human-required (unchanged by this work):** all eight independent persons must be recruited, declared and
organisation-confirmed; the nine registration prerequisites from the prior wave remain (custodian, accountable OSF
identity, PID type and value, `registration_id`, `registration_timestamp`, outpoints, checkpoint, `as_of`).

**Decisions that must be taken before registration or enumeration begins:**

1. **The eighth person must join the original roster** — time-critical; after the declaration round the arithmetic may
   reverse.
2. **§19.3(3) "seven"** — record the minimum interpretation.
3. **§4A.1 item 6 between co-enumerators** — record the purposive reading before the roster is fixed.
4. **May an enumerator be told a count?** ⚠ **A live conflict with prior prepared work.**
   `dataset/JURISDICTION_PARTITIONS.md` from an earlier wave contains a section headed "What an enumerator should
   therefore target" giving "≈ 236 rows — 136/60/40, split evenly across the four families (34/15/10 per family)",
   derived from the §5.7.2 floor. Agent C's barrier would **refuse** such an allocation, and §4A.2's never-receive
   parenthetical `(§5.5, §5.7.2)` puts those numbers on the barred side. The operator may hold them for planning; the
   **enumerator packet must not**. Options: (a) strict — scope only; (b) permissive — pre-register the floor as
   execution-independent; (c) split — scope plus an over-provisioned batch size that is not a protocol-derived
   quantity. **(b) cannot be adopted after enumeration begins.** My recommendation: (c).
5. **Who reconciles cross-partition entity duplicates (U-1)?** Not an enumerator, not the reference adjudicator.
6. **The C1(2)–C1(5) instruction must be pre-registered**, identically for both enumerators — required for one
   enumerator too.
7. **Fix `cmdScan`'s duplicate collapse?** Before registration or not at all.
8. **Symmetric-ask and batch schedule** — write down and hash before enumeration, or the stopping rule is
   discretionary (and §20.18 is thereby incomplete).
9. **May a tool write `unknown` on behalf of a disagreement?** Agent D's whole conflict design rests on it. If the owner
   rules that only the person who failed to establish a criterion may write `unknown`, the design collapses to
   "withdraw every conflicted group" — more expensive, still no adjudicator — or to a new exclusion reason, which is a
   re-freeze and therefore a STOP condition.
10. **Is §4A.2's "receive only" list exhaustive?** If it is not, returning a conflicted row to **its own author** for
    re-checking (without disclosing what the other person said) recovers rows at no cost to independence and beats
    withdrawal. If it is exhaustive, withdrawal stands.
11. **Sealing:** confirm that the merge transcript and the conflict list join the §14 sealed object list — otherwise the
    multi-conflict record is lost (§6 above).
12. **Assign disjoint `candidate_id` prefixes** before enumeration. The merger refuses collisions but will not rename,
    and the frame hash's order-independence depends on namespace disjointness.

---

## 15. Next critical-path action

**Authorise the eighth person as Enumerator B now, before recruitment begins, and issue the recruitment package for
eight rather than seven.** That single act preserves a saving of **+1.65 to +2.44 weeks** which lapses the moment the
seven-person declaration round closes. It needs no amendment, no re-freeze and no code.

Take four decisions in the same sitting, because each is cheap now and expensive or impossible later: the §19.3(3)
interpretation; the §4A.1 item 6 reading between co-enumerators; the enumerator-count disclosure question (item 4
above); and whether to fix `cmdScan` before the aggregate freezes.

**Two things that are worth more than this entire exercise, and should not be crowded out by it:**

- **The quota-free class sentence.** One sentence in the enumerator packet, disclosing no number, worth ≈98.6 hours
  (−36.6%) — larger than the second enumerator's contribution and available with one enumerator.
- **Start recruitment before registration.** The DAG already records that recruitment and registration are independent
  and that running recruitment first removes **2–6 weeks** — larger than the enumeration saving, and it costs nothing.

**No U1 evidence exists. No independent validation exists.** Every duration in this report is an assumption with a
stated basis, not a measurement.
