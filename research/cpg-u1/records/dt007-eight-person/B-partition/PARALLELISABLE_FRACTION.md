# DEEPTECH-PARALLEL-007 · AGENT B · PARALLELISABLE_FRACTION

**The question.** Is enumeration actually divisible, or is part of it indivisible? C1(6) matches against
the development-only registry across the whole frame; §5.7's pool minimum and §5.7.2's sufficiency are
properties of the **whole** frame; duplicate prevention needs a shared view. If the parallelisable
fraction is small, the saving is small.

**The answer, honestly.** **The parallelisable fraction is large: 94.0%.** The premise of the question —
that the whole-frame steps might dominate — does not hold, and the reason is specific and checkable: the
whole-frame steps are **machine operations with near-zero human cost**, not human labour. Enumeration,
which *is* human labour, is per-candidate and fully divisible. The real losses to parallelisation are
**imbalance** and the **straggler buffer**, not indivisibility.

---

## 1. Classification of every step

### Per-candidate — parallelisable (human labour, 196.6 h at scenario Q, A-F weighting)

| Step | Where | Why per-candidate |
|---|---|---|
| Find a candidate in a public source | §4A.2 ("public sources") | Independent per candidate |
| A1 operating legal entity | `a1_operating_legal_entity` | One entity |
| A2 canonical domain over HTTPS | `a2_domain_controlled_https` + `HOSTNAME` regex | One entity |
| A3 decisive identifier, checksum-valid, permitted for the family | `validateIdentifier`, `JURISDICTION_FAMILIES` | One entity; `lib/identifiers.mjs` is pure per-value |
| A4 identifier↔domain tie, https URL **and** note | `identifier_domain_evidence_url/_note`, enforced | One entity; the most expensive single cell |
| A5 family accessibility | derived from `jurisdiction_family` | One entity |
| A6 reference truth obtainable for all three fields | `a6_reference_obtainable` | One entity, three fields |
| `expected_outcome_class` prediction (§5.2) | one cell | One entity (two, for `identity-hazard`) |
| `identity_hazard_note` — naming the colliding entity | enforced non-empty | Two entities, still one row |
| C1(2)–C1(5) attestations | `CONTAMINATION_ATTESTATIONS` | Per-candidate self-knowledge |
| **C1(6) registry match, as a pre-screen** | `registryMatches(candidate, registry)` — `lib/scan.mjs:88` | **Per-candidate by construction.** The signature takes ONE candidate. The 13-entry registry is on §4A.2's receive-list, so each enumerator can pre-screen their own candidates against it with no shared view at all. |
| Filling the 22 `FRAME_COLUMNS` cells | `lib/schema.mjs:12-34` | Per row |

### Whole-frame — not parallelisable, but **nearly free in human time**

| Step | Where | Human cost | Why it is cheap |
|---|---|---|---|
| Merge the two CSVs | concatenation | ~0 | `frame_hash = hashRecords(frame,'candidate_id')` **sorts before hashing** (`lib/canonical.mjs:17-22`), so the hash is order-independent. No negotiated order, no merge semantics. |
| `candidate_id` uniqueness | `cpg_u1_data.mjs:99` | ~0 | Solved ex ante by a `E1-` / `E2-` prefix. |
| Structural validation | `cmdFrame`, `cpg_u1_data.mjs:204-220` | machine | Reports per-row; the operator reads a tally. |
| **Duplicate entity prevention** (`scheme:identifier`, `canonical_domain`) | `assertUnique`, `lib/select.mjs:44-51` | **0.5–2.0 h per round** | A set intersection. Note it **throws** from `frameSufficiency`, so it must run *before* the sufficiency check. Under a disjoint jurisdiction partition with the most-specific-family rule, the expected collision count is near zero. |
| **C1(1) repository scan** | `cmdScan`, `cpg_u1_data.mjs:222-264` | **compute + ~1.5 h review** | O(files × candidates) regex over `git ls-files` in a clean clone at the frozen resolver SHA, restricted to `TEST` + six `CPG_IMPLEMENTATION` prefixes. **Genuinely indivisible across enumerators for a second reason: the repository is not on §4A.2's receive-list**, so only the operator may run it. But it is a machine step; the human part is reading the flagged list. |
| **§5.7.2 sufficiency** | `frameSufficiency`, `lib/frame.mjs:41-53`; `cmdCheckFrameSufficiency:615` | **~0.5 h** | Three `filter().length` calls against `FRAME_MINIMUM`. A count. |
| §5.7 pool minimum | `poolShortfall`, `lib/select.mjs:54-62`; `pool-check:471` | ~0 | Also a count, and it happens **after** the development draw — outside enumeration entirely. |
| Screening log | `cpg_u1_data.mjs:140-158` | ~0 | Written by the tool. |
| `commitment-payload` | §5.5.3 | ~1.0 h once | Operator, once. |

### The one thing that is genuinely indivisible in a way that matters

**Not any step — a property.** Sufficiency is a predicate over the **merged** frame, so **neither
enumerator can ever self-certify "done"**. That is not lost throughput; it is lost *feedback*. Its cost
appears in the arithmetic twice, and both entries are real:

* **barrier latency** — 4.0 h of operator work per round during which both enumerators are blocked
  (merge + dedupe + scan review + sufficiency);
* **the straggler buffer** — +15% per half, because in-flight covering is impossible (see
  `WORKLOAD_ARITHMETIC.md` §7b).

---

## 2. Amdahl

```
parallelisable (per-candidate human effort) P = 196.6 h
serial (whole-frame human effort)           S =  12.5 h
   = 3.0 partition rule + 0.5 id namespace + 1.0 commitment prep
   + 2 rounds x (2.0 merge/dedupe + 1.5 scan review + 0.5 sufficiency)

p = P / (P + S) = 196.6 / 209.1 = 94.02%      serial fraction = 5.98%

speedup(N) = 1 / ((1 - p) + p/N)
   N = 2   -> 1.89     (ideal 2.00; loss 5.6%)
   N = 4   -> 3.39
   N = 8   -> 5.64
   N -> inf -> 16.7    <- the hard ceiling on enumeration parallelism, whatever the headcount
```

**Sensitivity — the conclusion does not depend on the serial estimate.** Even at a deliberately punitive
serial cost the two-way speedup barely moves, because two workers can only ever lose half of the serial
fraction:

| serial S | p | speedup at N=2 | N→∞ ceiling |
|---|---|---|---|
| 12.5 h (A-S, 2 rounds) | 94.0% | **1.89** | 16.7 |
| 20.5 h (4 rounds) | 90.6% | 1.83 | 10.6 |
| 40.0 h (3.2× A-S) | 83.1% | 1.71 | 5.9 |
| 80.0 h (6.4× A-S) | 71.1% | 1.55 | 3.5 |

To pull the two-way speedup below 1.5 the serial share would have to exceed ~44% of total effort — i.e.
more than 150 h of whole-frame operator work, against 196.6 h of enumeration. Nothing in the instrument
supports that: the whole-frame commands are counts, regexes and hashes.

---

## 3. The implied ceiling on saving

```
2.00   theoretical maximum for two enumerators
1.89   Amdahl, N=2, p=94.0%
1.85   best achievable 2+2 jurisdiction imbalance ({US-SEC,LEI-ONLY} vs {FR-SIRENE,BR-CNPJ})
1.75   count-balanced-but-effort-unbalanced 2+2 split
1.68   after the +15% straggler buffer the partition itself makes necessary
1.64   realised elapsed: 47.5 -> 29.0 days, at +15% total human hours
1.38   1+3 jurisdiction split (LEI-ONLY alone)
1.00   worst permitted imbalance (100/0), and scheme (e) at 2x the effort
```

**So: the saving is real but it is not 2×, and indivisibility is not what limits it.** The ranking of
losses is:

1. **Straggler buffer, −9%** (1.85 → 1.68) — caused by the partition, unavoidable while enumerators
   cannot see each other's counts.
2. **Serial fraction, −5.6%** (2.00 → 1.89) — irreducible but small.
3. **Imbalance, 0% to −29%** depending entirely on the pairing. This is the one the design controls, and
   the fix costs nothing: pair the hardest family with the easiest.
4. **Barrier rounds, −2%** (1.68 → 1.64).

---

## 4. The comparison that matters more than any of this

| lever | saving | cost | needs a second person? |
|---|---|---|---|
| A quota-free class-coverage instruction (scenario Q vs N) | **98.6 h (−36.6%)** | one English sentence, no number disclosed | **No** |
| A second enumerator, best pairing, buffered | **18.5 elapsed days (−39%)** | +38.4 human hours, +1 §4A.1 vetting, R-1 confounding, R-6 taint exposure | Yes |

They are independent and they compose. The first should be adopted regardless. The second is worth
buying **only if elapsed calendar time before the development commitment is the binding constraint** —
because it buys elapsed time by *spending* human hours and by accepting the enumerator/family
confounding described in `PARTITION_DESIGN.md` §3 and R-1.

**If elapsed time is not binding, one enumerator is the better design**: no confounding, no straggler
buffer, no barrier rounds, no second §4A.1 exposure, 38.4 fewer human hours, and a frame whose
independence claim under §20.18 rests on one person's declaration rather than two.
