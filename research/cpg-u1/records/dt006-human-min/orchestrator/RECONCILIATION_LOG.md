# DEEPTECH-HUMAN-MIN-001 — reconciliation log

Every agent claim the orchestrator checked, with the verdict. VERIFIED = I reproduced it myself.
CORRECTED = the claim is wrong or overstated and the corrected form is given. ACCEPTED-AS-ARGUMENT = a reasoned
position I did not independently re-derive, flagged as argument rather than fact.

Nothing in this programme is registered, committed or pushed. No frozen byte was modified.

---

## Agent A — role minimisation (returned)

Artefacts preserved to `C:/tmp/dt006-human-min/A-roles/` with hashes matching A's report:
`MODEL_RANKING.md` `a9dce40e557d43b918936c92bade31b7f51f514764689f0163c7128e9711fa81` ·
`ROLE_ELIMINATION_TABLE.md` `50fe9d170413c56135d106ec92abdde73399771a7efc51a5c49b92f8d7935dfa` ·
`SEPARATION_VS_JUDGEMENT.md` `2f42080642026c87b6a367dec07ceea4f362e326e186e78d04d685ff20527f7d`.

### VERIFIED

| Claim | How I checked it |
|---|---|
| `.gitignore:77` is `ROLE_*.md` and silently ignores the mandated deliverable `ROLE_ELIMINATION_TABLE.md` | `git check-ignore -v` → exit 0, `.gitignore:77:ROLE_*.md`. **Third instance** of this class after ERRATA E-3 (lines 50, 58). |
| The instrument carries a sixth disposition `PENDING`, absent from §15.1 | `lib/analysis.mjs:150` (`else if (f.final === null) disposition = 'PENDING'`) and `:234` (counted in the published disposition tally). |
| `PENDING` is non-VALID and therefore spends the §15.5(2) budget | `lib/analysis.mjs:164` — `valid = rows.filter(r => r.disposition === 'VALID')`; condition 2 at `:198` is `10 * valid.length < 9 * total`. |
| One human is impossible and the impossibility is mechanised | `reconcile.mjs:52`, `ratings.mjs:97`, `analysis.mjs` condition 3. Independently found before A reported — see `MECHANICAL_FLOOR.md`. |
| §4A.3 permits **zero** role combinations textually | §4A.3 + §4A.2(d) + §12 Eligibility, read directly. |
| Adjudicators receive a strict subset of what the primaries held and may not introduce a value or label | §9.5 read directly; `ratings.mjs:9`. |

### CORRECTED

**A's second ground for rejecting Model D (mechanised reference truth) is overstated.** A writes that a mechanised
extractor "drives that ratio toward 1 by construction" because it must read the structured sources CPG also reads,
so §9.8's 60% SOURCE-COINCIDENT cap "already refuses Model D; no amendment, no argument and no engineering is
needed to defeat it."

`lib/analysis.mjs:135-139` shows SOURCE-COINCIDENT is decided by **exact URL identity**, fragment-stripped under the
recorded AD-3 = `URL_WITHOUT_FRAGMENT`:

```
const coincident = (ref, urls) => {
  if (!ref.source_url) return false;
  if (D['AD-3'] === 'EXACT_URL_STRING') return urls.includes(ref.source_url);
  return urls.map(stripFragment).includes(stripFragment(ref.source_url));
};
```

It is **not** source-class overlap. A mechanised extractor reading a registry page that CPG does not cite is
`INDEPENDENT`, not `SOURCE-COINCIDENT`. So the 60% cap does not mechanically refuse a mechanised reference; it
creates a **material risk** that it would, strongest for `founded_year`, where Tier 1 is `REGISTRY_RECORD` and CPG
resolves registry identities.

**A's first ground survives intact and is the decisive one:** the extractor would be software written by the
developing organisation producing the values by which that organisation's software is judged (entry point C1), while
`constructed_without_cpg` (`schema.mjs:257`) would still read `'yes'` — the artefact would attest to the property it
violates. §9.1's Author row forbids the human equivalent.

**Net effect: Model D stays REJECTED, but on circularity alone.** The §9.8 argument is a supporting risk, not a
proof, and must not be presented as one.

### ACCEPTED-AS-ARGUMENT (not independently re-derived)

- Mutual exclusion is load-bearing in only 4 of 37 §22 rows (31, 34, 35, 36), and no §22 attack is defeated *only*
  by a distinct human — the requirement for distinct humans comes from §9.5 double entry and §12 α, which are
  reliability measurements rather than attack controls. **This is the most consequential reframing A offers** and it
  should be spot-checked against §22 during final assembly.
- Mechanising the *scoring rule* is non-circular because the tooling aggregate is registered (§5.5.1) before frame
  construction and therefore before `H_rand` exists (§22 row 2); mechanising the *reference value* is circular.
  The asymmetry is sound in principle and is the strongest single idea to come out of the wave.
- Of 16 functions, exactly 3 are irreducible judgements: reference value construction, its second instance, and
  entity attribution (§10.1 branch 2).
- Model ranking E > B > C > A, D rejected.

### A's own corrections to my briefing, which I accept

- A withdrew its claim that pure exclusion is "evidentially stronger still" once it verified the six-of-sixty
  budget, and adopted the principle that **resolution rules dominate exclusion rules**. That matches my own
  independent finding in `ALPHA_FRAGILITY.md`.
- A sharpened my point 4: because `REFERENCE_COLUMNS` (`schema.mjs:213-218`) carries `author` / `confirmer` /
  `resolution` / `adjudicated_by`, a dual-role rater would see **their own pseudonym in the `author` field** — an
  explicit cue, not merely latent recognition. Its proposed mitigation (omit those four fields from the rater
  packet's reference record, since none is a §10.1/§10.2 input) is a genuine improvement and should be carried into
  the amendment draft. **VERIFIED by the orchestrator:** `REFERENCE_COLUMNS` (`schema.mjs:213-216`) does contain
  `author`, `confirmer`, `resolution`, `adjudicated_by`, and `checkItem` (`raterPackets.mjs:60`) enforces
  `exactKeys(it.reference_record, REFERENCE_COLUMNS)` — "reference_record must be exactly the sealed reference row".
  So the cue is real and strictly enforced, and A's mitigation is a genuine code change that moves the tooling
  aggregate, not a configuration choice.

### Open item A raised that needs an owner decision

The §5.7.2 empirical gate is **UNVERIFIED and was not testable in this task**: whether ≥ 210 rows (126/52/32)
survive *register-only* screening across the four jurisdiction families. If it fails, frame mechanisation fails and
Model E degrades to Model B. A did not test it because enumeration is out of scope — correctly.

---

## Agents B, C, D, E, F, H — verification summary

### Claims I reproduced myself (VERIFIED)

| Agent | Claim | My check |
|---|---|---|
| B, F, H | Only **13** held-out configurations are reachable, not 49 | `orch_reachable.mjs`: image of `min(60,max(12,ceil(180/T)))` over `T in 1..18` = {12,13,14,15,17,18,20,23,26,30,36,45,60}; 36 of 49 interval values unreachable |
| B, F | Exactly 90% **passes** (`10*valid < 9*total` is strict) | read `analysis.mjs:198` |
| B | On `REFERENCE_CONFLICT`, `src` is never reassigned, so the sealed+published row carries the **Author's** value while flagged conflict | `reconcile.mjs:53-73` — `let src = a` and only `CONFIRMER` reassigns |
| B | Conflicts manufacture false §9.7 class-prediction mismatches | `stratumMismatches` counts `value_kind==='STATED' && ambiguity_flag==='none'`; a conflict row has `ambiguity_flag==='REFERENCE-CONFLICT'`, so it is not counted; §9.7 forbids correcting the published mismatch |
| C | The rating adjudicator may assign `REFERENCE-AMBIGUOUS` **even if neither rater gave it** | `packets.mjs:109` returns it unconditionally |
| C | Prototype: 98/98 assertions, 250 cases, 8 035 resolutions | re-ran the suite, exit 0 |
| D | `FRAME_COLUMNS.length === 22`, not 23 | imported schema; template header has 22 fields |
| D | An independent enumerator **cannot honestly answer C1(2)-C1(5)** | §5.3 line 239: "For every contamination attestation, `unknown` is treated exactly like `yes`. An unestablished contamination question makes a company ineligible [enforced]." C1(2)-C1(5) are attestations about the implementers' own history; §4A.2 gives enumerators the development-only registry, which is exactly the operator disclosure D identifies |
| D | Prototype: 58 checks | re-ran, 58 passed 0 failed, exit 0 |
| E | 28 of 28 role pairs FORBIDDEN-BY-TEXT; k=4 -> BOTH 0, k=5 -> BOTH 12 | re-ran `exclusion_matrix.mjs`, exit 0, output matches |
| E | §6.5's "reading" limb plus the "(a) ... or after it completes" window literally catches the rating stage; "The study is VOID, not flagged" | read §6.5 lines 460-500 |
| E | `reconcile`/`seal` have **no named runner**, while §18.3 halts on "the operator having seen reference truth. The run is void, not repaired" | read §9.6 and §18.3 |
| F | The binding constraint is a **count of one** | `reconcile.mjs:58` errors and `cmdReconcile` exits 1; `finalRatings` throws `RATING_ADJUDICATION_MISSING` |
| F | `REFERENCE_CONFLICT` is reachable only by an adjudicator's active decision | `reconcile.mjs:65` — the `else` branch of the adjudication decision |
| F | alpha is a pure two-rater statistic, untouched by adjudication | `analysis.mjs:181` pairs `rater_1_label`/`rater_2_label` from `f.r1`/`f.r2`, never from `resolution` |
| H | Reference truth covers **both** stages | `cmdReconcile` reads `--dev-manifest` and `--held-out-manifest`; `reconcile()` documents "BOTH stages" |

### Corrections the agents made to MY briefing, which I accept

1. **13 configurations, not 49** (B, F, H) — my sweep was over an interval, not the sizing rule's image.
2. **Reference work is 90-330 records per recorder, not 60-300** (F, H) — reference covers development + held-out. My "120 rows at the floor" understated it by 50%.
3. **My serialisation claim was refuted** (H) — `reference -> seal -> execute -> rate` is chain-forced at every headcount, so the seven-person design has no overlap to lose.
4. **"Adjudicators add no information" was too strong** (C) — they add no new *scoring* label, but the choice is worth ~1.585 bits and can decide SUCCESS vs FAILURE at ~30 fills.
5. **My conservative-ordering proposal is unsound** (C) — the `{UNSUPPORTED-FILL, REFERENCE-AMBIGUOUS}` pair has no conservative direction; per-endpoint extremisation collapses into the sensitivity interval.
6. **Folding enumeration into the two humans is dominated** (D) — same headcount saving as elimination (7 -> 6) but strictly worse methodology, because the class prediction flows from enumerator memory into a labelling role and §9.2.1/§12.2 exclude the class from both packets precisely so it cannot act. "Blinding a packet cannot blind a memory."
7. **alpha's tolerance is wider than I said** (F) — 16.7%-21.8% at the quota-derived label mix, not 11-16%; and at that mix §15.5(2) binds first at every configuration.

### Disagreement between agents, and how I resolve it

**A ranks a two-human model first; E and H say the floor is 4-5 and two is a dead end.** Both are right about
different questions. E and H computed partitions of **all seven roles** over k people — where the adjudicators are
third parties by construction, so k=2 is impossible. A **deletes** five roles and mechanises their function, leaving
four role-slots. The numerical disagreement is a scope difference, not a contradiction.

Applying E's own alpha rule to A's reduced design settles it: with only Author, Confirmer, rater-1 and rater-2
remaining, E's requirement that **at least one rater hold no reference role** cannot be met by two people, because both
hold reference roles. It requires a third. So the honest floor is **three**, reached as
Author + Confirmer + one unprimed rater, with the second rater drawn from the reference pair.

### Head-count-independent defects found, which matter regardless of this task's outcome

1. §6.5's reading limb voids every study on a strict reading (E) — needs an explicit carve-out for §12/§13 artefacts.
2. `reconcile`/`seal` have no named runner while §18.3 voids a run if the operator saw reference truth (E).
3. A sixth disposition `PENDING` exists in code and not in §15.1 (A).
4. `REFERENCE_CONFLICT` rows publish the Author's value as if established (B).
5. Conflicts manufacture permanent false §9.7 mismatches (B).
6. `T <= 2` configurations already fail G1 at zero human error: E[fills] = 10 < 20 at T=1 (F).
7. The rater packet leaks the reference team's pseudonyms and each row's contest status (A, E).
8. §12.2 over-claims that the adjudicator "never receives the number of disagreements" — the packet *is* that list (E).
9. `.gitignore:77` (`ROLE_*.md`) silently ignores a mandated deliverable — third instance after ERRATA E-3 (A).
10. `workload_scheduler.mjs` understates reference load by 30 records per recorder (H).
11. `ENUMERATOR_WORKSPACE.md` and `ADMISSIBILITY_CHECKLIST.md` say 23 frame columns; there are 22 (D).
