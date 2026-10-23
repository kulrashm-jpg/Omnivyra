# AMDAHL_CEILING — what a second enumerator can and cannot buy

**AGENT G of DEEPTECH-PARALLEL-007. ENGINEERING ARTIFACT.** Derived by `g_calendar.mjs`; real output
in `RUN_OUTPUT.txt` §4 / `RUN_OUTPUT.json`. Changes no frozen byte. Not U1 evidence.

---

## 1. The question

The prior analysis took a 116.7-hour enumeration load, divided it by two, and reported the result as
a calendar saving. That is only valid if enumeration is **100 % parallelisable**. It is not. This
document identifies the part that is not, prices it, and computes the ceiling.

## 2. What is NOT parallelisable, traced to protocol or code

| # | Item | Why it is serial | Source |
|--:|---|---|---|
| 1 | **Whole-frame C1(1)+C1(6) contamination scan** | The committed `scan_sha256` is a scan of the **complete** frame at the resolver SHA in a clean clone, and the held-out payload's `scan_sha256` must **equal** the development payload's. It therefore runs once, after every row exists. Enumerators cannot run it at all — they never see the repository. | §5.3, §5.4, §5.5.3; `scan.mjs`; `heldOutInputs` → `SCAN_CHANGED`; §4A.2 |
| 2 | **§5.7 pool minimum** | `pool-check` evaluates `pool_c ≥ 2 × quota_c` on the merged frame, per stage and class. | §5.7; `select.mjs` |
| 3 | **§5.7.2 sufficiency** | `frameSufficiency()` counts admissible ∧ eligible rows **per class** across the whole frame and returns `shortfall[]`. A shortfall sends work back to the enumerators — a **serial feedback loop**, one full round trip per iteration. | §5.7.2; `frame.mjs` |
| 4 | **Duplicate reconciliation across partitions** | `assertUnique()` **throws** on a duplicate identifier or a duplicate `canonical_domain` anywhere in the admissible frame. The check is global; its resolution is human. **This cost does not exist at k=1.** | §5.7 "Uniqueness [enforced]"; `select.mjs` |
| 5 | **The merge** | One file, one `candidate_id` namespace, one `frame_hash`, one write-once §15.3 screening log, one enumerator sign-off. **Does not exist at k=1.** | §5.5, §15.3 |
| 6 | **Briefing** | Per person. It **grows** with headcount instead of shrinking: release the §4A.2 packet, walk the 22-column row contract and the tri-state rule, run the rehearsal. | §4A.2 |
| 7 | **Gate latency** | Independent, part-time, fee-engaged people in unknown time zones, with an operator-mediated §4A.2 barrier in between (the operator may return a class-count shortfall but not quota or sizing information). | §4A.2, §5.7.2 |

**Two collision channels survive a jurisdiction-family partition**, which is why item 4 is real
rather than theoretical:

- the same entity entered once as `US-SEC` / `FR-SIRENE` / `BR-CNPJ` and once as `LEI-ONLY`, since
  LEI is a permitted identifier in **every** family (§5.1 accessible-families table);
- two **distinct** legal entities of one corporate group, in different jurisdictions, sharing one
  canonical domain — refused on `canonical_domain` even though they are different entities.

A single enumerator sees its own whole file and avoids both by inspection. Two enumerators cannot,
because they must not coordinate on which companies they choose beyond the partition rule.

## 3. The fractions

```
PARALLELISABLE FRACTION p (of human hours, k=1 baseline) = 142 / (142 + 10) = 0.934
SERIAL FRACTION (1-p)                                    = 0.066
  Of ELAPSED time at k=1: parallel 88.8%, serial work 6.2%, gate latency 5%.
  => strictly serial share of ELAPSED at k=1 = 11.2%
```

The serial items, itemised, as the script prints them:

```
SERIAL ITEMS, k=1:
       3 h  briefing / §4A.2 packet release / rehearsal (PER PERSON, does not halve)
       6 h  whole-frame serial: partition design, C1(1)+C1(6) scan run and hit review,
            check-frame-sufficiency, pool-check, canonicalisation, frame_hash, §15.3 seal,
            sign-off, handoff
       1 h  re-run of the scan + sufficiency gate for each of 2 iterations
      10 h  TOTAL SERIAL

SERIAL ITEMS, k=2:
       6 h  briefing / §4A.2 packet release / rehearsal (PER PERSON, does not halve)
       6 h  whole-frame serial: ...
       1 h  re-run of the scan + sufficiency gate for each of 2 iterations
       4 h  MERGE: concatenate partitions, renumber candidate_id, run assertUnique,
            recount per class on the union (DOES NOT EXIST AT k=1)
    3.15 h  cross-partition uniqueness collisions: 4.7 rows x (drop + replacement candidate)
            (DOES NOT EXIST AT k=1)
   20.15 h  TOTAL SERIAL
```

**The serial part doubles when you add the second enumerator.** That is the structural point the
prior analysis missed: the denominator of Amdahl's law is not a constant of the phase — it is a
function of headcount.

## 4. The ceiling

```
AMDAHL LIMIT:
  elapsed with 1 enumerator            : 8 weeks
  elapsed with INFINITE enumerators    : 1.41 weeks  (serial work 20.1 h + 2 d gate latency)
  MAXIMUM POSSIBLE SAVING, any headcount: 6.59 weeks
  maximum speed-up factor              : 5.69x
  saving actually obtained by k=2      : 2.51 weeks = 38.1% of the ceiling

| k enumerators | elapsed weeks | saving vs k=1 | marginal saving of the k-th person |
|--:|--:|--:|--:|
| 1 | 8 | 0 | — |
| 2 | 5.49 | 2.51 | 2.51 |
| 3 | 4.28 | 3.72 | 1.21 |
| 4 | 3.75 | 4.25 | 0.53 |
| 6 | 3.37 | 4.63 | 0.38 |
| 8 | 3.33 | 4.67 | 0.04 |
```

## 5. So is the 2.63–2.92 week figure wrong?

**The task asked: "If the non-parallelisable part is large, the figure is wrong and you must say
so."** The honest answer has two halves and I will not collapse them.

**The non-parallelisable part is NOT large enough to make 2.92 weeks unreachable.** The ceiling is
6.59 weeks. 2.92 sits well inside it. I will not claim otherwise.

**But the figure is still wrong, for a different reason: the mechanism.** 2.92 weeks was obtained by
halving the hours — implying **100 % parallel efficiency**. The achievable efficiency is
**22–39 %** (median 29.9 %) across a 648-cell joint grid, and **43 % at the absolute best cell**.
So:

- **the figure is not confirmed** — it is an **upper bound presented as an estimate**;
- the *reason* it lands close to my median (2.23 wk) is that two errors of opposite sign nearly
  cancel: the prior baseline is **understated** (116.7 h vs my 142 h) and its parallel efficiency
  **overstated** (100 % vs 30 %). A figure that is right by cancellation is not verified;
- and the cancellation does **not** survive the recruitment netting, which is where the decision
  actually turns. See `RECRUITMENT_NET.md`.

## 6. What the ceiling implies for the decision

1. **A second enumerator is worth having; a third is marginal; a fourth is noise.** 2.51 / 1.21 /
   0.53 weeks for the 2nd / 3rd / 4th. Each of them also costs a §4A.1 declaration, an organisation
   confirmation, a fee agreement, a briefing, and one more share of the item-6 relational matrix.
2. **The saving is bounded by the serial tail, which the 8th person makes worse.** Any proposal to
   add more enumerators must price the merge and the per-person briefing, both of which scale with
   headcount in the wrong direction.
3. **Gate latency and sufficiency iterations lengthen both designs equally** and therefore do not
   change the saving at all — visible in the sensitivity table, where those two rows hold the saving
   flat at 2.51 weeks while moving both durations. They are a reason the *study* is longer, not a
   reason the second enumerator is worth less.
4. **Partition imbalance is the single differential lever.** It moves the saving from 3.04 weeks
   (perfect split) to 1.62 weeks (imbalance 0.40) while changing nothing else. Getting the split
   right is worth about 1.4 weeks, and the split can only be got right if the per-family screening
   yields are known — which they are not.

**Assumption warning.** Every hour figure above is an ASSUMPTION with a stated basis in §0 of
`g_calendar.mjs`. None is a measurement. The *structure* of the decomposition — which items are
serial and why — is traced to the protocol and the frozen code and does not depend on the numbers.
