# BOTTLENECK_ANALYSIS — where two people become the binding constraint

**AGENT H of DEEPTECH-HUMAN-MIN-001. ENGINEERING ARTIFACT.** Computed by `h_timeline.mjs`; real
output in `RUN_OUTPUT.txt`. Observation counts are FIXED INPUTS and are never reduced.

---

## 1. The answer, stated plainly

The binding constraint at two people is **not time**. It is **P3, reference adjudication** — the
first phase in the chain with **zero eligible workers** — followed immediately by **P6, rating
adjudication**. Both are refused mechanically by the frozen instrument. The two-human design does
not run slowly; it stops.

**By how much?** The unmeetable demand at P3 is, at the cap configuration and the assumed
disagreement rate of 0.25, **83 adjudication decisions ≈ 16.6 h ≈ 4.2 working days of a person who
does not exist**. At P6 it is **60 decisions ≈ 8.0 h ≈ 2.0 working days of a second person who does
not exist**. The shortfall is one whole person (the two adjudication loads can be carried by one
third person: 24.6 h total, 1.23 working weeks — 6% of the study's human hours).

## 2. Three independent mechanical gates, exercised

All three were run against synthetic rosters and a synthetic row. No real company, no identity, no
network.

### Gate 1 — `checkPersonnelRegister` (`lib/personnel.mjs`)

| Roster | Verdict |
|---|---|
| 7 distinct persons | **PASS** |
| 3 persons (P-1 enum+author+rater1, P-2 confirmer+rater2, P-3 both adjudicators) | REFUSED — 4 ROLE COLLISION errors |
| 2 persons | REFUSED — **5** ROLE COLLISION errors |

> `assignment 3 (reference-adjudicator): ROLE COLLISION — P-1 already holds enumerator; all
> independent roles are mutually exclusive`

This gate refuses **any** roster below 7, because §4A.3's mutual exclusion is unconditional. It is
therefore *not* the discriminating gate — it fails 3-person and 2-person rosters alike. The
discriminating gates are 2 and 3.

### Gate 2 — `reconcile()` (`lib/reconcile.mjs`), one synthetic disagreeing row

| Attempt | Verdict |
|---|---|
| No adjudicator at all (the honest 2-person position) | **REFUSED**: `author and confirmer disagree (STATED\|1999 vs STATED\|2000) — independent adjudication required` |
| Adjudicated by the Author | **REFUSED**: `adjudicator must differ from both author and confirmer` |
| Adjudicated by the Confirmer | **REFUSED**: same |
| Adjudicated by a distinct third person | **ACCEPTED** |

This is the load-bearing finding. There is **no escape hatch**:

- You cannot leave disagreements unresolved — `reconcile()` errors, and `seal` "refuses any reference
  file that is not byte-identical to the reconciliation of the blind records" (§9.5). No seal ⇒ no
  §6.5 authorisation ⇒ no execution.
- You cannot declare them `REFERENCE_CONFLICT` to get past it — `REFERENCE-CONFLICT` is an
  *adjudicator decision* in `ADJUDICATION_DECISIONS`, so it still needs an adjudication row from an
  eligible third person.
- You cannot use the operator. §9.6's whole guarantee is that "the operator receives the seal hash
  only" and "therefore cannot choose reference values after seeing CPG output". An
  operator-adjudicator destroys exactly the property the seal exists to establish — and §4A.3 says
  "no independent role is held by the operator".

### Gate 3 — `lib/ratings.mjs`

Both guards are present in the frozen source:

- `the two sheets were rated by the same person — ≥ 2 independent raters are required`
- `the rating adjudicator must be neither rater (§4A.3)`

**Therefore three independent persons is the minimum roster the frozen tooling will carry through
reconciliation and rating adjudication. Two is not a roster; it is a dead end at P3.**

## 3. Does the two-human design finish sooner? Netted out honestly

### The saving side (real)

Recruitment. `T(n) = fixed + per_person·n`, calibrated so `T(7)` equals the DAG B3 figure, with
`fixed_fraction` swept because nobody knows it:

| `T(7)` | `fixed_fraction` | recruit 7 | recruit 3 | recruit 2 | saving 7→3 |
|---|---|---|---|---|---|
| 2 wk | 0.00 | 2.00 | 0.86 | 0.57 | **1.14 wk** |
| 2 wk | 0.75 | 2.00 | 1.71 | 1.64 | **0.29 wk** |
| 6 wk | 0.00 | 6.00 | 2.57 | 1.71 | **3.43 wk** |
| 6 wk | 0.75 | 6.00 | 5.14 | 4.93 | **0.86 wk** |

Range of the recruitment saving from 7 people to 3: **0.29–3.43 weeks.** From 3 to 2: **0.07–0.86
weeks**, i.e. negligible.

### The cost side (also real, and larger)

- **Zero weeks of extra work.** No phase lengthens. This is worth stating because the intuitive
  argument — "two people must do more rows, so it takes longer" — is **wrong** for this protocol.
  Reference construction and rating are already exactly-two-worker phases in which each worker does
  100% of the rows. Two people do the identical work in the identical time.
- **P3 and P6 become impossible.** Not slow. Impossible, and refused by three separate mechanical
  checks.
- **If a future protocol version permitted self-adjudication** (which would need a new protocol file
  per §6.2, and which would forfeit the independence claim the study exists to make), the
  adjudication work still has to happen and is still serial. The two-human counterfactual total is
  **12.50 weeks post-recruitment at the cap — exactly the same as the three-human design** (and
  exactly the same as an eight-person design). Self-adjudication buys **0.00 weeks**.

### The saving that is not a headcount effect at all

The 2.92 weeks by which the 2- and 3-person designs beat the 7-person design post-recruitment is
**entirely the second enumerator**. §4A.3 already permits several enumerators
(`checkPersonnelRegister` allows `n > 1` for `enumerator` only). Adding an eighth person as a second
enumerator captures **all 2.92 weeks** with the protocol unchanged and independence intact:

| Design | Post-recruitment (cap) | Post-recruitment (floor) |
|---|---|---|
| 7-human (1 enumerator) | 15.41 wk | 8.60 wk |
| **8-human (2 enumerators)** | **12.50 wk** | **5.69 wk** |
| 3-human (2 enumerators) | 12.50 wk | 5.69 wk |

**8-vs-3 post-recruitment gap: 0.00 weeks.** The entire residual advantage of a small team is
recruitment search time: **0.36–4.29 weeks** end-to-end over the swept calibrations.

### Verdict

> **The two-human design is not faster. It produces no result.** Against the only meaningful
> yardstick — earliest *adjudicated* result — it is infinitely slower. And the small-team advantage
> that survives at three people is worth **0.36–4.29 weeks**, all of it recruitment, and it is
> obtainable **more cheaply and without any independence cost** by moving in the opposite direction:
> **adding** an eighth person to enumerate.

## 4. Irreducible serial delays (no headcount removes these)

Sum at the cap configuration, `mean_block_minutes = 10`, `registry_publication_days = 1`:

| id | hours | what |
|---|---|---|
| S1 | 1.00 | Funding outputs reach D = 6 confirmations at/before the checkpoint (§5.5.2) |
| S2 | 24.00 | OSF registration acquires a registry-issued timestamp (§5.5.1) |
| S3 | 0.17 | Development commitment mined |
| S4 | **5.17** | Development wait: D = 6, `H_rand = H_commit + 12`, block `H_rand + 6`, then drand `R ≥ MTP + 3 h` |
| S5 | 0.17 | Pilot + §8.5 instrument check on 10 companies (machine) |
| S6 | 0.17 | Held-out commitment mined, after development finality |
| S7 | **5.17** | Held-out wait: same depths and drand rule |
| S8 | 24.00 | Published seal record acquires a registry-issued timestamp, later than `R_ho`'s scheduled time (§6.5) |
| S9 | 1.67 | The single authorised held-out run, 100 companies (machine) |
| | **61.5 h = 2.56 calendar days** | |

Per-stage arithmetic: blocks to finality `K + D = 18` = 3.00 h; `MTP(H_rand+6) ≈ t(H_commit+13)` =
2.17 h; drand `R` at 2.17 + 3.00 = **5.17 h**. **The drand Δ = 3 h rule binds, not block depth.**
Robust to block time: 8 / 10 / 14 min/block ⇒ 60.4 / 61.5 / 63.8 h total.

**Correction to DAG.md.** It prices "commitments/draws" at "~1 week of mostly waiting". Pure
block + drand waiting is **11.67 h ≈ 0.49 days**. The remaining ~6 days of that week are the **two
registry publication latencies (S2, S8)** and operator handling. That matters for planning: the week
is *administrative*, not *cryptographic*, so it compresses with registry responsiveness and not at
all with headcount.

Outer bounds that cap rather than delay: 180 days (each outpoint, §5.10 abandonment), 30 days
(missing drand round → study VOID, §5.7.1).

## 5. Sensitivity — which conclusions are robust, which flip

| Conclusion | Robust? |
|---|---|
| Two people cannot complete P3 or P6 | **ROBUST. Not an assumption at all** — three mechanical refusals in the frozen tooling, independent of every time figure. Holds at every configuration and every rate, including a reference disagreement rate of exactly 0.05, because even one disagreement is refused. |
| No phase lengthens going from 7 to 2 | **ROBUST.** Structural: the blind-pair phases are 2-worker phases by construction. Independent of all per-unit assumptions. |
| The post-recruitment saving of a small team is 0.00 weeks against an 8-person roster | **ROBUST** under every swept rate (the saving is identically 0.00 in all 44 sweep rows, because it is the same enumeration split in both). |
| The recruitment saving is 0.29–3.43 weeks (7→3) | **ASSUMPTION-SENSITIVE.** It depends entirely on `fixed_fraction`, which is unknown and unmeasured. At `fixed_fraction = 0.75` the saving nearly vanishes; at 0.00 it is largest. |
| Post-recruitment elapsed ≈ 15.4 weeks at the cap | **HIGHLY ASSUMPTION-SENSITIVE.** `productive_hours_per_day` ∈ {2,3,4,6,8} ⇒ **30.5 / 20.4 / 15.4 / 10.4 / 7.9 weeks**. A factor of ~4. No point estimate is defensible. |
| Reference construction dominates the schedule | **ROBUST across rates, FLIPS across configurations.** At the cap the Author's 137.5 h exceeds the enumerator's 116.7 h; at the floor the enumerator's 116.7 h dominates the Author's 37.5 h. `reference_record_minutes` ∈ {12,…,60} moves the 7-human total over **15.84 → 29.04 weeks**. |
| Rating is cheap relative to reference | **ROBUST.** Sweeping the fill-row assumption over 3–30 min and the fill fraction over 0.07–1.00 moves the 7-human total only 18.98 → 21.34 weeks; sweeping `reference_record_minutes` moves it 15.84 → 29.04 weeks. Rating is not where the schedule lives. |
| Which phase is the bottleneck | **ROBUST for the 2-person case** (P3/P6, mechanically). For the 7-person case the longest *throughput* phase flips between **enumeration** (floor configuration) and **reference construction** (cap configuration) — so an enumerator-side investment is the better bet before the pilot result is known, and a reference-side investment after. |
| The chain/publication floor is ≈ 2.6 days | **ROBUST to block time** (±4% over 8–14 min) but **dominated by `registry_publication_days`**: at 0.25 days it is ~0.6 days, at 3 days it is ~6.6 days. |

### One conclusion that flips on a quantity nobody can know

If a future protocol version permitted unresolved reference disagreements to be recorded as
`REFERENCE_CONFLICT` without an adjudicator, §15.2 excludes them from every denominator and §15.5(2)
declares the run **INCONCLUSIVE** once fewer than 90% of held-out observations are VALID. That makes
the design's viability hinge on the reference disagreement rate:

| assumed rate | disagreeing observations (cap) | outcome under that hypothetical rule |
|---|---|---|
| 0.00 | 0 | survivable |
| 0.05 | 17 | survivable |
| 0.10 | 33 | on the knife-edge |
| **> 0.10** | ≥ 34 | **run-level INCONCLUSIVE, mechanically** |
| 0.25 (assumed) | 83 | INCONCLUSIVE |

The rate is **unknowable before the work is done**. So even the most permissive imaginable relaxation
converts a headcount saving into a **coin flip on the entire result**, decided by a quantity that
cannot be estimated in advance. That is the strongest argument in this analysis against paying for
speed with people.

## 6. Open owner questions

1. Is a **second enumerator** (8 people, protocol unchanged) authorised? It is the only saving found
   here that costs nothing: 2.63–2.92 weeks post-recruitment.
2. Should the prior "≈ 9–13 weeks after registration" figure be **restated as 8.6–15.4 weeks,
   configuration-dependent**, and should planning use the cap (15.4)? The cap corresponds to pilot
   total fills `T ≤ 3` — the *pessimistic* CPG outcome, so it is the likely one to plan against.
3. What **`productive_hours_per_day`** will actually be contracted per person? Nothing else in this
   model moves the answer by a factor of four.
4. Is `registry_publication_days` measurable from OSF's published behaviour before registration? It
   is ~78% of the entire irreducible serial floor.
5. Has anyone estimated the **reference disagreement rate** from a synthetic rehearsal (dt5-ref D2)?
   It sizes the adjudicator's load and, under any relaxation, decides INCONCLUSIVE.
