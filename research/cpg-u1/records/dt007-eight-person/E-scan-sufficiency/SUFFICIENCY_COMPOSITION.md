# SUFFICIENCY_COMPOSITION — is §5.7.2 frame sufficiency a property of the merged frame only?

**Agent:** AGENT E of DEEPTECH-PARALLEL-007.
**Claim under test (from the assignment):** "sufficiency is a property of the merged frame ONLY,
and per-partition sufficiency is meaningless — or correct me if the code says otherwise."
**Verdict: the claim is CORRECT, with one refinement that matters operationally.** The *counts*
compose perfectly (they are additive over a partition); the *predicate* does not. Per-partition
sufficiency is not merely uninformative — for a jurisdiction partition it is guaranteed false,
and it would be a category error to ask for it.

All runs used the frozen instrument, aggregate
`<NEW_AGG>` (<NEW_N> files), from a
byte-identical scratch copy. Protocol-004 sha256
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. Synthetic fixtures only.

---

## 1. What the frozen check actually computes

`lib/frame.mjs` derives the thresholds; it does not hard-code them. Real output from the frozen
module:

```
enumeratePilotOutcomes: {"outcomes":4096,"halts":1,"refused":0,
                         "maxQuotas":{"fill-expected":60,"abstention-expected":25,"identity-hazard":15}}
MAX_HELD_OUT_QUOTAS  : {"fill-expected":60,"abstention-expected":25,"identity-hazard":15}
FRAME_MINIMUM        : {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}
sum(FRAME_MINIMUM)   : 210
```

This reproduces §5.7.2 item 9's first two self-test assertions exactly: 4096 outcomes, 1 HALT,
0 refusals; `Qmax` = 60/25/15; minimum 126/52/32, total 210. `FRAME_MINIMUM` is computed as
`POOL_MULTIPLIER × MAX_HELD_OUT_QUOTAS[c] + DEVELOPMENT_QUOTA[c]` = `2·Qmax_c + Dev_c`, so it
can never drift from the sizing rule it protects.

`frameSufficiency(admissible, ineligible)` then counts, **per class independently**:

```js
const have = admissible.filter((r) => r.expected_outcome_class === c && !ineligible.has(r.candidate_id)).length;
if (have < FRAME_MINIMUM[c]) shortfall.push({ class: c, eligible_admissible: have, required: FRAME_MINIMUM[c] });
```

It calls `assertUnique(admissible)` first — the §5.7 one-row-per-legal-entity rule. `ok` is the
conjunction over the three classes.

`cmdCheckFrameSufficiency` does **not** require a registration: it takes `--frame`, `--scan`,
`--registry` (and `--allow-synthetic`). So the sufficiency gate is reachable at any point during
enumeration, which matters for `INFORMATION_BARRIER_ANALYSIS.md`.

---

## 2. Real runs — the frozen `check-frame-sufficiency`

### 2.1 Single-enumerator frame: exactly minimal passes, one row fewer fails

```
$ node cpg_u1_data.mjs check-frame-sufficiency --frame fixtures/F1_single_enumerator.csv \
      --scan out/scan_F1_single_enumerator.json --registry fixtures/SYNTHETIC_registry.json --allow-synthetic
  fill-expected          eligible admissible 126  required 126
  abstention-expected    eligible admissible 52  required 52
  identity-hazard        eligible admissible 32  required 32
frame sufficient for every permitted pilot outcome; frame_hash 026d552904ecdf6c50d440c0763e540bc4f013883868dbd73eb49f3b096d6a4c
exit=0

$ ... --frame fixtures/F1m_single_minus_one.csv --scan out/scan_F1m_single_minus_one.json ...
  fill-expected          eligible admissible 125  required 126
  abstention-expected    eligible admissible 52  required 52
  identity-hazard        eligible admissible 32  required 32
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 125 < required 126
exit=1
```

### 2.2 Two jurisdiction partitions: each fails alone, the union passes

Partition A = `ENUM-1` over `US-SEC` + `FR-SIRENE` (70 fill / 30 abst / 18 hazard enumerated).
Partition B = `ENUM-2` over `BR-CNPJ` + `LEI-ONLY` (60 / 24 / 16). The scan removes 3 rows from
A and 2 from B.

```
$ ... --frame fixtures/F2a_partition_A.csv --scan out/scan_F2a_partition_A.json ...
  fill-expected          eligible admissible 68  required 126
  abstention-expected    eligible admissible 29  required 52
  identity-hazard        eligible admissible 18  required 32
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 68 < required 126; abstention-expected eligible 29 < required 52; identity-hazard eligible 18 < required 32
exit=1

$ ... --frame fixtures/F2b_partition_B.csv --scan out/scan_F2b_partition_B.json ...
  fill-expected          eligible admissible 58  required 126
  abstention-expected    eligible admissible 24  required 52
  identity-hazard        eligible admissible 16  required 32
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 58 < required 126; abstention-expected eligible 24 < required 52; identity-hazard eligible 16 < required 32
exit=1

$ ... --frame fixtures/F2u_union_AB.csv --scan out/scan_F2u_union_AB.json ...
  fill-expected          eligible admissible 126  required 126
  abstention-expected    eligible admissible 53  required 52
  identity-hazard        eligible admissible 34  required 32
frame sufficient for every permitted pilot outcome; frame_hash 90008ff6977098c929cccf4da95014b046a80a87f286748f0feb608a799389d5
exit=0
```

**68 + 58 = 126, 29 + 24 = 53, 18 + 16 = 34.** The counts are exactly additive; the predicate
flips from false-and-false to true.

### 2.3 One partition passes one threshold alone

Partition C = 40 fill / 60 abstention / 10 hazard: abstention-expected alone is 60 ≥ 52.

```
$ ... --frame fixtures/F3c_partition_C_abst_passes_alone.csv ...
  fill-expected          eligible admissible 40  required 126
  abstention-expected    eligible admissible 60  required 52
  identity-hazard        eligible admissible 10  required 32
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 40 < required 126; identity-hazard eligible 10 < required 32
exit=1

$ ... --frame fixtures/F3d_partition_D.csv ...
  fill-expected          eligible admissible 90  required 126
  abstention-expected    eligible admissible 5  required 52
  identity-hazard        eligible admissible 25  required 32
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 90 < required 126; abstention-expected eligible 5 < required 52; identity-hazard eligible 25 < required 32
exit=1

$ ... --frame fixtures/F3u_union_CD.csv ...
  fill-expected          eligible admissible 130  required 126
  abstention-expected    eligible admissible 65  required 52
  identity-hazard        eligible admissible 35  required 32
frame sufficient for every permitted pilot outcome; frame_hash 96107139d34cfe91eb04bff2d21caa8c47818ea7bf483a7582505285362946fa
exit=0
```

Note the message for C: `abstention-expected` is **absent** from the shortfall list, because it
alone was satisfied. The shortfall report is per class, so a partial pass is visible in the
output. This is exactly the output a two-enumerator operator would be tempted to act on, and
acting on it is what the information barrier forbids (see `INFORMATION_BARRIER_ANALYSIS.md`).

Every line above is copied verbatim from `out/TRANSCRIPT.txt`, produced by `RUN.sh`.

### 2.4 Additivity asserted programmatically against the frozen `frameSufficiency`

```
FRAME_MINIMUM (frozen): {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}

== A / B / A∪B (both fail alone)
partition A                fill-expected= 68  abstention-expected= 29  identity-hazard= 18   ok=false
partition B                fill-expected= 58  abstention-expected= 24  identity-hazard= 16   ok=false
union                      fill-expected=126  abstention-expected= 53  identity-hazard= 34   ok=true
  additive fill-expected          68 + 58 = 126  vs union 126  -> true
  additive abstention-expected    29 + 24 = 53  vs union 53  -> true
  additive identity-hazard        18 + 16 = 34  vs union 34  -> true
  ok(A)=false  ok(B)=false  ok(A∪B)=true

== C / D / C∪D (one class passes alone)
partition A                fill-expected= 40  abstention-expected= 60  identity-hazard= 10   ok=false
partition B                fill-expected= 90  abstention-expected=  5  identity-hazard= 25   ok=false
union                      fill-expected=130  abstention-expected= 65  identity-hazard= 35   ok=true
  additive fill-expected          40 + 90 = 130  vs union 130  -> true
  additive abstention-expected    60 + 5 = 65  vs union 65  -> true
  additive identity-hazard        10 + 25 = 35  vs union 35  -> true
  ok(A)=false  ok(B)=false  ok(A∪B)=true

== single enumerator
F1 (exactly minimal)       fill-expected=126  abstention-expected= 52  identity-hazard= 32   ok=true
F1 minus one row           fill-expected=125  abstention-expected= 52  identity-hazard= 32   ok=false

COUNTS ARE ADDITIVE OVER A PARTITION           : true
PREDICATE IS ADDITIVE (ok(A)&&ok(B) <=> ok(A|B)): false
EXACTLY-MINIMAL PASSES / ONE FEWER FAILS       : true
exit=0
```

---

## 3. The same company in both partitions

### 3.1 Same `candidate_id`

```
$ ... --frame fixtures/F4dup_id.csv --scan out/scan_F4dup_id.json ...
ERROR: 1 malformed frame row(s) — run "frame" and fix before drawing
exit=1

$ node cpg_u1_data.mjs frame --frame fixtures/F4dup_id.csv --allow-synthetic
  MALFORMED SYN-ENUM-1-0659: duplicate candidate_id
frame rows: 220  malformed: 1
exit=1
```

`loadFrame` catches it; `refuseMalformed` stops the run before sufficiency is even computed.

### 3.2 Different `candidate_id`, same legal entity (same identifier and domain)

```
$ ... --frame fixtures/F4dup_entity.csv --scan out/scan_F4dup_entity.json ...
ERROR: FRAME_INVALID: duplicate identifier CIK:900659 — one row per legal entity
exit=1
```

This is `assertUnique`, reached from inside `frameSufficiency` and reported as `FRAME_INVALID`.
**This is the single most important merge guard for the two-enumerator model**, and it is a
whole-frame property by nature: neither enumerator can see it, and no per-partition check can
find it. Double enumeration of the same company is caught, but *only* at the merge, and *only*
when the two enumerators agree on the identifier or the canonical domain. Two enumerators who
disagree on which identifier is decisive for the same entity (e.g. one records `CIK`, the other
`LEI`) and record slightly different canonical domains would produce **two admissible rows for
one legal entity that the instrument cannot detect** — see §5.

### 3.3 Cross-binding refusals

```
# union frame + partition-A scan
ERROR: scan was produced for a different frame (frame_hash mismatch) — re-scan the exact frame
exit=1

# union frame + union scan, but a differently-serialised registry file
ERROR: scan was produced with a different development-only registry — re-scan
exit=1
```

---

## 4. Verdict

**Sufficiency is a property of the merged frame only. Per-partition sufficiency is meaningless.**
Three separate reasons, each independently sufficient:

1. **The thresholds are absolute, not per-capita.** `FRAME_MINIMUM` is derived from the *study's*
   maximum held-out quota plus the *study's* development quota. It has no notion of a partition
   and cannot be divided by the number of enumerators without changing what it protects. Asking
   an enumerator's partition to meet 126/52/32 would demand 2 × 210 = 420 eligible admissible
   rows for a two-enumerator study, for no methodological benefit.

2. **For a jurisdiction partition it is guaranteed false in the interesting classes.** `A5`
   admits exactly four families; a partition covering two of them cannot supply the whole frame's
   quota unless the study is grossly over-enumerated. Both real partitions failed all three
   thresholds (§2.2), and both were of realistic size.

3. **The check's own inputs are whole-frame.** `assertUnique` (one row per legal entity) and the
   duplicate-`candidate_id` check are defined over the merged frame. A per-partition `ok=true`
   would be a claim made without the information needed to make it.

**The refinement.** The *counts* are additive (proved: 68+58=126, 29+24=53, 18+16=34, and again
for C/D), so a partition count is a perfectly valid *contribution*. The operator may legitimately
maintain a running per-partition tally and sum it. What is meaningless is the *predicate* applied
to a partition — and this is precisely why an operator is drawn towards the forbidden instruction
"your partition is short on abstention-expected". The arithmetic is available; the disclosure is
barred. That tension is the subject of `INFORMATION_BARRIER_ANALYSIS.md`.

**Where the protocol should say so.** §5.7.2 speaks of "the number `E_c` of admissible,
held-out-eligible rows in F", which is already unambiguous — F is the single frozen frame, not a
partition. §5.5.3's "Complete before the development commitment. The complete frame F must exist
and meet the sufficiency rule" confirms it. Nothing in the protocol invites a per-partition
reading. **No protocol change is needed for this item**; what is missing is an operational note
(not normative) that with several enumerators the sufficiency gate runs once, at the merge.

---

## 5. Risks this exposed

| # | Risk | Severity | Note |
|---|---|---|---|
| U-1 | Two enumerators record the **same legal entity** under different decisive identifiers *and* different canonical domains → two admissible rows, `assertUnique` blind, §5.7 "one row per legal entity" silently violated, and the frozen frame carries a duplicate that can be drawn twice | **High** | `assertUnique` keys on `idKey(c)` and `canonical_domain` only. A single enumerator cannot create this; two can. Needs an owner decision: a cross-partition entity-reconciliation step before the merge, performed by someone who is not an enumerator |
| U-2 | Duplicate `candidate_id` across enumerators: `scan` exits 0 with one fewer result (see `SCAN_COMPOSITION_ANALYSIS.md` S-6) | Medium | Give each enumerator a disjoint id prefix in the frame template; run `frame` before `scan` |
| U-3 | The operator reads the per-class shortfall list and acts on it by directing a specific enumerator at a specific class | **High** | This is the §4A.2 breach; see `INFORMATION_BARRIER_ANALYSIS.md` |
| U-4 | Iteration produces several (frame, scan) pairs and the operator commits a stale pairing | Low — mechanically guarded | `frame_hash` mismatch refusal, exit 1; `writeOnce` on every scan output |
| U-5 | With a jurisdiction partition, class composition correlates with jurisdiction, so a symmetric "enumerate N more each" instruction does not equalise class yields | Medium | Makes blind iteration converge slowly on the scarce class; raises the initial over-ask |

---

## 6. Files

| File | Purpose |
|---|---|
| `make_fixtures.mjs` | builds all ten synthetic frames using the instrument's own `FRAME_COLUMNS`, `toCsv`, checksum-valid synthetic CIK/SIREN/CNPJ/LEI |
| `make_repo_and_registry.mjs` | builds the synthetic resolver tree and the synthetic development-only registry |
| `compose_check.mjs` | byte-exact per-row scan composition comparison |
| `sufficiency_additivity.mjs` | calls the frozen `frameSufficiency` on partitions and unions; asserts count additivity |
| `RUN.sh` | every command, in order, reproducibly |
| `fixtures/`, `out/` | the synthetic frames, the synthetic registry, and all real command outputs |
| `out/TRANSCRIPT.txt` | verbatim capture of every command, its output and its exit code — the single source for every number quoted in these documents |
| `dup_id_probe.mjs` | shows the duplicate-`candidate_id` collapse in `scan` |

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

