# DEEPTECH-PARALLEL-007 — reconciliation log

VERIFIED = the orchestrator reproduced it. CORRECTED = wrong or overstated, with the corrected form.
ACCEPTED-AS-ARGUMENT = reasoned position not independently re-derived.

Nothing registered, committed, pushed or executed. No frozen byte modified.

## Claims I reproduced myself

| From | Claim | My check |
|---|---|---|
| A | `test/selftest.mjs` contains a passing test `'multiple distinct enumerators permitted'` asserting zero errors, and beside it `'a second rater-1 refused'` | Verified at lines **829** and **830** (A cited 824). This is the strongest evidence in the wave: the registered instrument itself tests that an eight-person register conforms. |
| A | §5.7 "**Uniqueness** [enforced]: one row per legal entity. Duplicate identifiers or duplicate canonical domains are refused." | read directly at protocol line 380 |
| A, F | The worktree tooling trees are **587 files**, not the registered 593 | `orch_verify.mjs` on `dt4-reg`: 587 files, aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`. **F agrees with my value; A reported `b11e0066…` for the same file count — A's aggregate value is wrong, its substantive point is right.** Anyone re-verifying inside a worktree alone gets a mismatch; the registered instrument is the uncommitted 593-file `C:/tmp/dt002` tree. |
| B | `frame_hash` is **order-independent** | `canonicalRecords` does `[...records].sort(...)` on the sort key before serialising (`lib/canonical.mjs:15-21`); the frame is hashed with sortKey `candidate_id`. Two enumerators' CSVs concatenate in any order to the same committed hash. |
| B | `assertUnique` **throws** and is reached from the sufficiency path | `lib/select.mjs:44-51` raises `duplicate identifier …` / `duplicate canonical_domain …`; called from `lib/frame.mjs:42`, `select.mjs:71`, `:92` |
| B, G | §5.7.2 permits pre-commitment top-up | protocol: "If unmet, **no development commitment may be made; enumeration continues first**"; and "A development commitment to an insufficient frame is **STAGE_VOID_FRAME_INSUFFICIENT**: the slot is consumed and there is no retry" |
| B, G | `FRAME_MINIMUM` = 126/52/32 = **2 × Qmax + DEVELOPMENT_QUOTA** per class | imported: 2×60+6=126, 2×25+2=52, 2×15+2=32; `POOL_MULTIPLIER`=2, `DEVELOPMENT_QUOTA`=6/2/2. So pool minimum and development consumption are already inside the 210 and must not be double-counted. |
| G | Only `enumerator` may have `n > 1`; every other role is "exactly one person" | `lib/personnel.mjs:26`. This is why **enumeration is the only phase whose elapsed time responds to headcount at all.** |
| F | `checkFrameRow` is in **`lib/schema.mjs:93`**, not `lib/frame.mjs` | verified; `FRAME_COLUMNS` at `:12`, `CONTAMINATION_ATTESTATIONS` at `:38`. **A correction to my brief.** |
| F | The §5.3 contamination rule is genuinely `[enforced]` | `lib/schema.mjs:159-170`, comment "'yes' AND 'unknown' both make a company held-out-ineligible"; the `unknown` branch pushes `"… — NOT ESTABLISHED, treated as contaminated"`. This strengthens my conflict-landing-place finding below. |
| F | All 9 recruitment files carry unfilled markers and none is populated | 149 `<<UNFILLED: …>>` markers across the 9 files; no identity, pseudonym, hash or date invented; `git check-ignore` clean; control-byte scan clean |

## My own errors, corrected by agents

1. **"No lawful top-up of a short frame."** Wrong — §5.7.2 says "enumeration continues first". Before the development
   commitment rows may be added freely; §5.5's "rows may never be added" bites only *after*. The unrecoverable failure
   is *committing* to an insufficient frame. I retracted this to Agent D mid-flight. (Agent B)
2. **Citation error**: I attributed the "Enumerator barrier" and "Single frozen frame" bullets to §5.5.3; they sit
   under **§5.5** (lines 284–289; §5.5.1 begins at 291). (Agent A)
3. **Citation error**: I told agents `checkFrameRow` was in `lib/frame.mjs`; it is in `lib/schema.mjs:93`. (Agent F)
4. **"At zero independence cost"** — my phrase in the prior wave's report, and it is wrong as stated. No structural
   separation collapses, but §4A.1 makes a false enumerator declaration mean "the frame is not independent (§20.18)",
   and the frame is a single joint artefact with one `frame_hash` — so a false declaration by **either** enumerator
   taints the **whole** frame including the other's partition. The exposure doubles. (Agent G)
5. **My reason for rejecting a class partition was incomplete.** I said it discloses quota structure. Agent B adds the
   decisive ground: §5.2 defines the class as "the enumerator's **prediction**", so it is an **output** of the work and
   cannot be a partition key at all — an enumerator assigned one class who concludes another holds a row they may
   neither keep nor hand over.

## The prior wave's headline figure — CORRECTED

The "2.63–2.92 weeks" I reported is **not a range**. Agent G reconstructed it: **2.92** was the enumeration phase
halved (5.83 → 2.92 wk) and **2.63** was that same number minus one chosen recruitment cost. The error is a single
assumption — that a second enumerator removes exactly 50%.

Agent G's corrected figure, from a 648-cell joint grid with no corner-picking: **gross saving 0.98–4.53 weeks
(p10–p90), median 2.23**, central cell 2.51. And the stable structural result: a second enumerator removes
**22.4%–39.1% of the enumeration phase (median 29.9%), maximum 43.4% anywhere — never 50%.**

G is candid that 2.92 lands inside its plausible range only because two errors of opposite sign nearly cancel (the old
baseline understated the work at 116.7 h against G's 142 h, while overstating parallel efficiency at 100% against
~30%), and that "a figure that is right by cancellation is not a verified figure".

## The condition that decides the sign — and my answer

Agent G's headline risk: §4A.1 item 6 disqualifies anyone related to "any holder of **another** §4A.3 role", and "An
unknown answer is not 'no'". So a declaration signed before an eighth role-holder existed **cannot** cover that person.
Adding them after the register closes forces a re-declaration round plus a cold single-person search; G computes the net
as negative in **252 of 648** cells at central late-addition cost and **617 of 648** at worst. And
`checkPersonnelRegister` only tests that each declaration string is `"no"`, so **`check-personnel` exits 0 on a
methodologically stale register** — nothing mechanical catches it.

G flagged "is the personnel register still open?" as the pivotal question and could not answer it. **I can: it is
open.** `dt004-operations/people/` holds only `INDEPENDENCE_DECLARATION_TEMPLATE.md` and `declaration_intake.mjs`;
there is no populated register and no signed declaration in any preserved artefact, and the DAG records task B3
("Recruit 7 independent persons") as **BLOCKED — HUMAN REQUIRED**, never started.

**So Model R1 applies and the net is positive: +1.65 … +2.44 weeks** at the central gross. This makes the decision
**time-critical**: the eighth person must enter the *original* roster. If recruitment begins on a seven-person roster,
the opportunity is lost and re-adding them may cost more than it saves.

## Agent F's Q1, which I can answer from the directive

F asks whether "eight-person" means eight *independent* role-holders or seven plus the operator. The directive's
TARGET OPERATING MODEL lists eight required independent roles (Enumerator A, Enumerator B, reference Author,
Confirmer, reference Adjudicator, Rater 1, Rater 2, rating Adjudicator). So: **eight independent persons plus the
operator = nine humans.** F's reading is correct.

## Accepted as argument, not independently re-derived

- B's per-row time assumptions and the resulting 196.6 h one-enumerator total; its parallelisable fraction of 94.02%
  and realised speedup 1.64×; the effort-balanced pairing `{US-SEC, LEI-ONLY}` vs `{FR-SIRENE, BR-CNPJ}` saving ~17 h
  over the obvious geographic split.
- B's pricing of a single quota-free class sentence at **≈98.6 h (−36.6%)** — the best cost-effectiveness finding of
  the wave, and it works with one enumerator.
- G's Amdahl ceiling (6.59 wk at infinite enumerators; k=2 captures 38.1%) and its end-to-end totals.
- A's §22 analysis that a criterion-defined two-partition frame creates a **new observable** — per-`enumerated_by`
  composition statistics an outsider can compute from the §13.2A archive — which does not exist with one enumerator
  and is a genuine increase in the falsifiability of §23 claim (2). A is equally clear that it is **neutral** if the
  partition is not criterion-defined and **worse than one enumerator** if the operator allocates candidates.

## Agent E — scan and sufficiency composition

Preserved: 35 files, including a 310-line real command transcript.

### VERIFIED by me

| Claim | My check |
|---|---|
| **S-6: `cmdScan` silently collapses a duplicate `candidate_id` and exits 0** | `cpg_u1_data.mjs:233` is `new Map(frame.map((r) => [r.candidate_id, {...}]))` — a Map built from pairs keeps only the LAST value for a repeated key. **And it is reachable:** line 230 loads the frame with `loadCsv`, **not** `loadFrame` — and `loadFrame` (`:93-103`) is the only place the duplicate check lives (`if (seen.has(r.candidate_id)) res.errors.push('duplicate candidate_id')`). So `scan` accepts a frame `frame` would refuse. E measured 220 rows → 219 results, exit 0. |
| Counts are additive over a partition; the sufficiency **predicate** is not | E's real output: partition A 68/29/18 and B 58/24/16 both INSUFFICIENT (exit 1), union 126/53/34 sufficient (exit 0). Confirms my framing that per-partition sufficiency is meaningless. |
| The per-row scan decision composes exactly | 218/218 per-candidate results byte-identical between partition runs and the merged run; a hand-merged report is byte-identical to the tool's merged report |
| Only the operator can compute sufficiency | `check-frame-sufficiency` requires `--scan`; `scan` requires a clean clone at the frozen resolver SHA, which §4A.2 does not give an enumerator. So an enumerator **physically cannot** compute it. |

### My refinement to E's S-6 severity

E rates S-6 Medium and says it is "caught downstream by `loadFrame`". That is right, and I would put the containment
more precisely: the defect **fails closed** through two independent guards — `loadFrame`'s duplicate check refuses the
frame at `frame`/`check-frame-sufficiency`, and `contamination()` refuses any scan whose `frame_hash` does not match the
frame it is used with (E proved both, exit 1). So a duplicate cannot reach a commitment through this path; what it
produces is a **misleading intermediate artefact and a command that exits 0 on malformed input**. Worth fixing before
the aggregate freezes at §19.1, but not a soundness hole.

### U-1 — the genuinely new risk created by two enumerators, confirmed

Two enumerators record the **same legal entity** with a different decisive identifier **and** a different canonical
domain. `assertUnique` (`lib/select.mjs:44-51`) compares only `idKey(c)` and `c.canonical_domain`, so it is blind to
this. Result: two admissible rows for one entity, §5.7's "one row per legal entity" silently violated, and the frozen
frame can draw that entity twice. **Impossible at n = 1**, where one person would notice. This is the clearest
validity cost of the eight-person model and it needs a named owner — E's blocking OQ-5, since the reconciler may be
neither an enumerator (would see the other partition) nor the reference adjudicator (§4A.3).

### E's §20.18 finding — accepted as argument, and important

Only the operator can compute sufficiency; the operator is **not independent** (§4A.3); and §5.7.2 lets the operator
choose when to stop while seeing per-class shortfalls and named ineligible rows. So §20.18's "the frame is unbiased …
rests on enumerator independence only" is **incomplete** — it also rests on the operator's stopping rule. Sharpened by
two enumerators, because the operator then also chooses *whose* rows to stop taking. Mitigable without a protocol
change by pre-specifying and hashing a mechanical stopping rule.

### Disagreement between B and E on the partition key — resolved in B's favour

E recommends a **class-neutral interleaved** partition over jurisdiction, because a jurisdiction split correlates with
class composition so a symmetric blind ask does not equalise class yields. The concern is legitimate, but the remedy is
not available: an interleaved partition presupposes a **shared candidate list that does not exist before enumeration**.
Agent B tested exactly this and rejected it — an operator-built list destroys §20.18 enumerator independence, an
enumerator-built list breaches §4A.2's exhaustive receive-list, and a mechanically-built one would need a new
registered artefact. B's ex-ante-computability test decides it: **jurisdiction family is the only key knowable before
the work begins.** E's concern should therefore be carried as a declared limitation of the jurisdiction partition
(and it converges with B's own confounding warning), not as a competing design.

### E's contamination finding — converges with the previous wave

E argues, and I agree, that §4A.2(a)/(b) require an enumerator with no knowledge of CPG's development history while
C1(2)–C1(5) ask exactly that, and §5.3 makes `unknown` fatal — so **the protocol's arithmetic depends on enumerators
answering `no` on no evidence**, which §5.1 expressly says UNKNOWN is not. C1(2)–C1(5) therefore attest "the enumerator
is unaware of contamination" while being presented as "the company was not used in CPG development". This independently
reproduces and sharpens the finding from DEEPTECH-HUMAN-MIN-001. It is **head-count-independent** and does not argue
against the eighth person.

### E's barrier verdict

**Not a blocker**, and the tension pre-exists at one enumerator — confirming what I asked E to test. The second
enumerator adds **exactly one** new leak channel: the *asymmetry* of a continue-instruction (asking only Enumerator B
to continue tells them their partition is short, which under a jurisdiction split correlates with a class). Closable at
no validity cost by always asking both, by the same amount — surplus rows are harmless under §5.8
(`NOT_DRAWN` / `DEVELOPMENT_SURPLUS`); the cost is fees.

E also names a hazard iteration **aggravates** regardless of headcount: every extra round is another exposure to the
operator checking a borderline candidate against CPG or its stored lookups — §6.5(c), **study VOID, not flagged**, with
only §20.20's procedural protection. That is a stronger argument for one large over-provisioned ask than the
disclosure argument is.
