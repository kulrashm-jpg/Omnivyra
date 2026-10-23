# CRITICAL_PATH — is enumeration on it, and does shortening it shorten the study?

**AGENT G of DEEPTECH-PARALLEL-007. ENGINEERING ARTIFACT.** Derived by `g_calendar.mjs`; real output
in `RUN_OUTPUT.txt` §6 / `RUN_OUTPUT.json`. Changes no frozen byte. Not U1 evidence.

---

## 1. Answer

**Yes. Enumeration is strictly on the critical path, nothing on the chain can overlap it, and a week
removed from it is a week removed from the study.** It is also **the only phase on the chain whose
elapsed time is a function of headcount at all** — which is simultaneously why the eighth person is
the only headcount-based acceleration available, and why there is a hard cap on what any headcount
decision can be worth.

**Reference truth does NOT absorb the saving**, even though it is the largest phase at the cap
(330 records per recorder). It is downstream and strictly serial after enumeration.

---

## 2. The chain, re-derived from the protocol (not copied from the DAG)

```
  funding (>=6 conf at checkpoint, §5.5.2)
  -> OSF registration, public, no embargo, registry-issued timestamp (§5.5.1)
  -> COMPLETE frame F enumerated (§5.5 step 3)
  -> C1(1)+C1(6) scan at the resolver SHA (§5.3, §5.4)
  -> check-frame-sufficiency, E_c >= 126/52/32 (§5.7.2)   [no commitment permitted before this]
  -> development commitment (spends O_dev; digest binds frame_hash + scan_sha256)
  -> H_commit+6 depth -> H_rand = H_commit+12 -> H_rand+6 finality -> drand round R at
     MTP(H_rand+6)+3h (§5.7.1)
  -> development draw (6/2/2) -> PILOT -> held-out sizing (the 13 configurations)
  -> held-out commitment (binds the development manifest, pilot and sizing; SAME frame_hash)
  -> held-out randomness -> held-out draw
  -> reference truth, BOTH stages, Author and Confirmer in parallel, each doing 100% of rows
  -> reference adjudication (a THIRD person, neither recorder, §9.5)
  -> seal; seal_hash PUBLISHED and timestamped BEFORE execution (§9.6)
  -> the single authorised held-out execution inside the §6.5 window
  -> blind rating, 2 raters in parallel, each doing 100% of held-out rows
  -> rating adjudication (neither rater, §12.2)
  -> analysis
```

This agrees with dt005 `DAG.md`'s serial chain. I re-derived it rather than adopting it, and found no
discrepancy in the **ordering**. The disagreement with the DAG is in the **duration** of C4 (see §5).

## 3. Why enumeration cannot be overlapped

| Direction | Constraint | Source |
|---|---|---|
| Nothing before it can start later | Enumeration cannot start before registration: the §5.5 ordering is funding → registration → frame construction. | §5.5.1 "Ordering" |
| Nothing after it can start earlier | The development commitment **digest contains `frame_hash` and `scan_sha256`**, so the frame must be complete and §5.7.2-sufficient before the commitment is broadcast. A commitment naming an insufficient frame is `STAGE_VOID_FRAME_INSUFFICIENT`: **the outpoint slot is consumed, there is no retry, the study is VOID.** | §5.5.3, §5.7.2, §5.10; enforced at `draw-development` |
| Reference truth cannot start early | Reference truth researches **drawn** companies only, and the draw needs the commitment, which needs the frame. | §9.1, §9.2 |
| No frame extension later | One complete frame for both stages; rows may never be added, removed, edited, re-identified or reclassified after the development commitment. | §5.5, §5.7.2, `FRAME_CHANGED` |

## 4. Why no other phase can absorb the saving, and why no other phase can be accelerated by headcount

**Reference truth cannot be shortened by headcount at all.** Not "is not"; **cannot be**:

- `checkPersonnelRegister()` refuses `n > 1` for `reference-author` and `reference-confirmer` —
  `role ${role} must be held by exactly one person`;
- `reconcile()` requires an Author record **and** a Confirmer record for **every** drawn company ×
  field, with `author.recorded_by !== confirmer.recorded_by`. Splitting rows between two Authors does
  not exist as an option in the frozen code.

The same holds for rating (`ratings.mjs` refuses two sheets with the same `rated_by`; §12 requires ≥ 2
**independent** raters, each covering all rows) and for both adjudications (a single third person who
may be neither of the two workers).

**So the structure is:** pairs of mutually blind workers, each doing 100 % of the rows, in phases the
evidence chain forces to be serial — plus exactly one phase, enumeration, that is genuinely divisible.
The prior analysis got this structural point right and I confirm it.

## 5. End-to-end totals

Reference (25 min/record) and rating (4.4 min/observation) are taken at **the prior analysis's own
values, deliberately**: they are common to both designs and so cannot affect the difference, only the
denominator. Both are ASSUMPTIONS.

```
| config | design | recruit | enumerate | chain | reference | ref adj+seal | exec | rating | tail | TOTAL wk |
| 12/5/3 (20 co) | 7-human (1 enumerator) | 4 | 8 | 0.06 | 1.88 | 0.98 | 0.02 | 0.22 | 0.41 | **15.57** |
| 12/5/3 (20 co) | 8-human (2 enum, up front) | 4.29 | 5.49 | 0.06 | 1.88 | 0.98 | 0.02 | 0.22 | 0.41 | **13.35** |
| 12/5/3 (20 co) | 8-human (2 enum, added late) | 5.29 | 5.49 | 0.06 | 1.88 | 0.98 | 0.02 | 0.22 | 0.41 | **14.35** |
| 60/25/15 (100 co) | 7-human (1 enumerator) | 4 | 8 | 0.06 | 6.88 | 0.98 | 0.02 | 1.1 | 0.41 | **21.45** |
| 60/25/15 (100 co) | 8-human (2 enum, up front) | 4.29 | 5.49 | 0.06 | 6.88 | 0.98 | 0.02 | 1.1 | 0.41 | **19.23** |
| 60/25/15 (100 co) | 8-human (2 enum, added late) | 5.29 | 5.49 | 0.06 | 6.88 | 0.98 | 0.02 | 1.1 | 0.41 | **20.23** |

12/5/3 (20 companies): end-to-end saving, UP FRONT = 2.22 wk; ADDED LATE = 1.22 wk
  enumeration as a share of the whole study, 1 enumerator = 51.4%
60/25/15 (100 companies): end-to-end saving, UP FRONT = 2.22 wk; ADDED LATE = 1.22 wk
  enumeration as a share of the whole study, 1 enumerator = 37.3%
```

Three things to read off this table.

1. **The saving passes through 1:1 and is identical at the floor and the cap** (2.22 wk both), because
   only enumeration changes and enumeration is size-independent. Confirmation that the saving is not
   absorbed.
2. **But its relative value is not identical.** At the 20-company floor, enumeration is **51.4 %** of
   the study; at the 100-company cap it is **37.3 %**. The eighth person matters most exactly when
   CPG performs *well* in the pilot (high `T` → small held-out sample → reference truth cheap →
   enumeration dominates). That is unknowable in advance.
3. **My totals differ from the prior analysis's** (15.57 / 21.45 wk against its 12.60 / 19.41 wk for
   the 7-human design) almost entirely because my enumeration phase is 8.00 wk against its 5.83 wk.
   I do not claim my figure is the measured one; I claim its figure omitted the serial tail.

## 6. An unresolved discrepancy between three independent estimates

| Source | One-enumerator enumeration duration |
|---|---|
| dt005 `DAG.md` task C4, band | **2–4 weeks** |
| dt006 `H-timeline`, derived | **5.83 weeks** |
| this analysis, derived | **8.00 weeks** (7.10 wk of screening + 0.50 wk serial + 0.40 wk gate latency) |

They reconcile only at the optimistic end of two assumptions at once: at 12 min/candidate, yield 0.8
and the bare §5.7.2 floor, my model gives **2.91 weeks**, inside the DAG band. **At least two of the
three estimates are wrong and none of them is measured.** This is an owner question. It matters
because the *fraction* of the study that enumeration represents — and therefore the value of the
eighth person — depends on it.

## 7. What would actually shorten the study more than the eighth person

Stated as observations from the chain, not as recommendations, and **none of them reduces an
observation count, a frame minimum or a workload**:

1. **Start recruitment before registration.** dt005 already records this: B3 and A3 are independent,
   and running B3 first removes 2–6 weeks. It is larger than the enumeration saving and costs nothing.
2. **Balance the enumeration partition.** Worth ~1.4 weeks (3.04 wk saving at a perfect split against
   1.62 wk at imbalance 0.40) at zero recruitment cost — but it requires knowing the per-family
   screening yields, which nobody does.
3. **Reduce the number of sufficiency round trips.** Each iteration costs a full gate latency and
   lengthens *both* designs equally. Over-enumerating against the dt004 margin plan (236 rather than
   the bare 210) buys iterations down at the cost of screening hours — which is *more* work, not
   less, and is the correct direction of trade given that `STAGE_VOID_FRAME_INSUFFICIENT` is
   unrecoverable.
4. **Nothing can accelerate reference truth.** 90–330 records per recorder, two recorders each doing
   100 %, and the code forbids splitting. At the cap it is 6.88 weeks and it is irreducible by
   resourcing.

**Every duration figure here is an ASSUMPTION with a stated basis in §0 of `g_calendar.mjs`. None is
a measurement. None may be cited as U1 evidence.**
