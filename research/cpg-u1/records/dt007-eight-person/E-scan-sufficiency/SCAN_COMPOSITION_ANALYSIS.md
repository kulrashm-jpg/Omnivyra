# SCAN_COMPOSITION_ANALYSIS — does the CPG-C1 scan survive two enumerators?

**Agent:** AGENT E of DEEPTECH-PARALLEL-007.
**Question:** is the C1(1)+C1(6) scan a pure per-row function that composes over an enumerator
partition, or does it carry whole-frame state? And must it therefore run once on the merged
frame, or may it run per partition?
**Method:** source characterisation of the frozen instrument, plus real runs of the frozen
`scan` on synthetic partitions and their union.
**Frozen inputs (verified by this agent, not taken on trust):**

| Artefact | Identity |
|---|---|
| Protocol-004 | `research/cpg-u1/CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Instrument aggregate | `<NEW_AGG>`, **<NEW_N> files** — recomputed with the instrument's own `lib/aggregate.mjs` over `C:/tmp/dt002/research/cpg-u1/tooling` |
| Scratch copy used for every run | byte-identical: same <NEW_N> files, same aggregate |

> **Note on the worktree copy.** `C:/tmp/dt5-u4/research/cpg-u1/tooling` is **not** the frozen
> instrument. It holds 587 files and aggregates to `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`.
> It is missing `lib/analysis.mjs`, `lib/assignment.mjs`, `lib/evaluation.mjs`,
> `lib/evidenceBundle.mjs`, `lib/ratings.mjs` and `rules/analysis_decisions.json` (the B1–B6
> additions, which are uncommitted in `dt002`). Every run reported here used the <NEW_N>-file tree.

---

## 1. What the two mechanisms are

### §5.3 — six ineligibility rules, of two different kinds

| Rule | Established by | Kind |
|---|---|---|
| C1(1) | scanner over `git ls-files` at the frozen resolver SHA, §5.4 scope | **mechanical** |
| C1(2)–C1(5) | enumerator attestations in the frame row | **attested** |
| C1(6) | scanner against the registered development-only registry | **mechanical** |

§5.3: "For every contamination attestation, `unknown` is treated exactly like `yes`. An
unestablished contamination question makes a company ineligible [enforced]." Verified in
`lib/schema.mjs` `checkFrameRow`: for each of `CONTAMINATION_ATTESTATIONS`, both `yes` and
`unknown` push a basis string; only `no` is silent.

The registry is frozen at registration, append-only, 13 seed entries, and its completeness is
**not attested** beyond H2 (§19.2, §20.12).

### §5.4 — scan scope

Two path classes, `TEST` and `CPG_IMPLEMENTATION`, evaluated over `git ls-files` at the
resolver SHA **in a clean clone**. Implemented as two regexes in `lib/scan.mjs`
(`TEST_PATH`, `CPG_IMPLEMENTATION_PATH`) plus `scanScope(p)`.

---

## 2. Is the scan per-row or whole-frame? — source evidence

### 2.1 The matching functions are pure and per-row

`lib/scan.mjs` (99 lines) exports only pure functions. None of them takes the frame:

- `nameVariants(name)` — one string in, variants out.
- `namePattern` / `domainPattern` / `identifierPattern` — one token in, one regex out.
- `scanScope(p)` — one path in, a class or `null` out.
- `tokensFor(candidate)` — **one candidate** in, its token list out.
- `scanText(text, tokens)` — one file's text plus one candidate's tokens, hits out.
- `registryMatches(candidate, registry)` — **one candidate** plus the registry, matches out.

There is no module-level mutable state in `lib/scan.mjs`: `LEGAL_SUFFIXES` and the two path
regexes are constants. A candidate's C1(1) and C1(6) outcome is therefore a function of
`(candidate, repo@SHA, registry)` and of nothing else — in particular not of any other row.

### 2.2 `cmdScan` adds whole-frame state, but only of two kinds

`cpg_u1_data.mjs` `cmdScan` (lines 220–267):

```js
const state = new Map(frame.map((r) => [r.candidate_id, { r, tokens: tokensFor(r), hits: [] }]));
for (const { f, scope } of files) { ... for (const c of state.values()) for (const h of scanText(text, c.tokens)) c.hits.push(...); }
```

The loop is file-outer / candidate-inner, and each candidate's `hits` array is touched only by
its own tokens. **No cross-row read or write exists.** What is whole-frame is only:

1. **`frame_hash: hashRecords(frame, 'candidate_id')`** — a digest of every row.
2. **`files_scanned`** (`scopeCount`) — a count of in-scope, non-binary, ≤5 MiB files. It is
   incremented per file, independently of the frame, so it is the *same* for any non-empty
   frame at a given SHA.
3. **`scan_sha256 = fileSha(out)`** — a digest of the whole report file.

So: the **decision** composes; the **artefact** is frame-bound by construction.

### 2.3 One real defect found: `cmdScan` silently collapses a duplicate `candidate_id`

`new Map(frame.map(...))` keyed on `candidate_id` drops the earlier of two rows sharing an id,
and `cmdScan` never checks for duplicates. Measured on a 220-row frame in which two rows share
a `candidate_id`:

```
frame rows in F4dup_id.csv : 220
scan results               : 219
scan refused the duplicate : false
```

The scan exits 0. This is a **two-enumerator-specific hazard**: two enumerators working from
separate templates can easily collide on `candidate_id`. It is caught downstream — `loadFrame`
pushes `duplicate candidate_id`, so `frame`, `check-frame-sufficiency`, `commitment-payload`
and both draws refuse — but the *scan* gives no signal, and a scan whose `results` are shorter
than the frame is the kind of artefact an operator may not notice.

**Recommendation (owner decision, not a protocol edit):** the merge step must run `frame` before
`scan`, and enumerators must be given disjoint `candidate_id` prefixes in the frame template.

### 2.4 The scan does **not** enforce entity uniqueness

§5.7 "Uniqueness [enforced]: one row per legal entity" is implemented in `lib/select.mjs`
`assertUnique`, which is called from `frameSufficiency`, **not** from the scan. Two rows for the
same legal entity under different `candidate_id`s pass the scan cleanly. This too is a genuinely
whole-frame property, and it is therefore only ever checked at the merge.

---

## 3. Real runs — does it compose in fact?

Frozen synthetic resolver tree: `git rev-parse HEAD` = `3cf5f4f67355484f7088a2ff2bf1e52886cd32cf`,
clean; 4 tracked files, of which one `TEST` and one `CPG_IMPLEMENTATION` path are in scope and
one deliberately out-of-scope path names a candidate that must *not* be flagged.
Synthetic registry: `fixtures/SYNTHETIC_registry.json`, 2 entries, no real company.

Partition A = enumerator `ENUM-1` over `US-SEC` + `FR-SIRENE` (118 rows).
Partition B = enumerator `ENUM-2` over `BR-CNPJ` + `LEI-ONLY` (100 rows).

```
$ node cpg_u1_data.mjs scan --repo <synthrepo> --expect-sha 3cf5f4f6...d32cf \
      --registry fixtures/SYNTHETIC_registry.json --frame fixtures/F2a_partition_A.csv \
      --out out/scan_F2a_partition_A.json
scanned TEST=1 CPG_IMPLEMENTATION=1 files at 3cf5f4f67355484f7088a2ff2bf1e52886cd32cf
held-out-ineligible by scan/registry: 3 of 118
  SYN-ENUM-1-0214: 1 repo hit(s), e.g. backend/tests/grounding.test.ts:3
  SYN-ENUM-1-0221: registry SYN-DEV-001
  SYN-ENUM-1-0291: 1 repo hit(s), e.g. backend/services/companyProfile/discoveredSource.ts:2
scan_sha256: aa8eb9c4cbf4f7b0509380b6c8563de8ba379abe4a90f13b5c34e635c1deede7
exit=0

$ ... --frame fixtures/F2b_partition_B.csv --out out/scan_F2b_partition_B.json
scanned TEST=1 CPG_IMPLEMENTATION=1 files at 3cf5f4f67355484f7088a2ff2bf1e52886cd32cf
held-out-ineligible by scan/registry: 2 of 100
  SYN-ENUM-2-0334: 1 repo hit(s), e.g. backend/tests/grounding.test.ts:4
  SYN-ENUM-2-0349: registry SYN-DEV-002
scan_sha256: a3f4f4a98df5b53f98df2ae3b88fe2f5b1da3639328af7958a550565e6781e09
exit=0

$ ... --frame fixtures/F2u_union_AB.csv --out out/scan_F2u_union_AB.json
scanned TEST=1 CPG_IMPLEMENTATION=1 files at 3cf5f4f67355484f7088a2ff2bf1e52886cd32cf
held-out-ineligible by scan/registry: 5 of 218
  SYN-ENUM-1-0214: 1 repo hit(s), e.g. backend/tests/grounding.test.ts:3
  SYN-ENUM-1-0221: registry SYN-DEV-001
  SYN-ENUM-1-0291: 1 repo hit(s), e.g. backend/services/companyProfile/discoveredSource.ts:2
  SYN-ENUM-2-0334: 1 repo hit(s), e.g. backend/tests/grounding.test.ts:4
  SYN-ENUM-2-0349: registry SYN-DEV-002
scan_sha256: b3eedc15b3d7556f944b251734afbb327a0fd0352c792d7e243a0b017a616963
exit=0
```

Flagged(union) = Flagged(A) ∪ Flagged(B), exactly. `SYNTHETIC-CO-399`, named only in the
out-of-scope path, is flagged in none of the three — §5.4 scope holds under partitioning.

Byte-exact comparison of every per-candidate `results` entry (`compose_check.mjs`, using the
instrument's own `canonicalJson`):

```
--- per-row composition ---
partition rows compared      : 218
union rows                   : 218
byte-identical result objects: 218
differing result objects     : 0
PER-ROW SCAN DECISION COMPOSES: true

--- whole-frame fields (do NOT compose) ---
A      frame_hash=66da2d41...380409  files_scanned={"TEST":1,"CPG_IMPLEMENTATION":1}  repo_sha=3cf5f4f6...d32cf
B      frame_hash=36168154...8141da  files_scanned={"TEST":1,"CPG_IMPLEMENTATION":1}  repo_sha=3cf5f4f6...d32cf
union  frame_hash=90008ff6...9389d5  files_scanned={"TEST":1,"CPG_IMPLEMENTATION":1}  repo_sha=3cf5f4f6...d32cf
frame_hash(A) === frame_hash(union): false
frame_hash(B) === frame_hash(union): false
files_scanned identical across all three: true

--- is a hand-merged scan report equal to the tool-produced one? ---
concatenated results === union results (canonical): true
sha256(pretty hand-merged) === union scan_sha256  : true
union scan_sha256 (file)                          : b3eedc15...616963
```

The last block is the sharpest result: a report assembled by concatenating A's and B's
`results` and recomputing `frame_hash` from the merged frame is **byte-identical** to the report
the tool produces on the merged frame. The scan is fully reconstructible from its partitions.

### 3.1 Determinism, write-once and the two guards

```
$ ... --frame fixtures/F2u_union_AB.csv --out out/scan_F2u_union_AB_rerun.json
scan_sha256: b3eedc15b3d7556f944b251734afbb327a0fd0352c792d7e243a0b017a616963
exit=0
BYTE-IDENTICAL re-scan: yes

$ ... --out out/scan_F2u_union_AB.json            # existing path
ERROR: .../out/scan_F2u_union_AB.json already exists — outputs are write-once (no re-roll). Use a new output path.
exit=1

$ ... --expect-sha 0000...0000
ERROR: repo HEAD 3cf5f4f6...d32cf != --expect-sha 0000...0000 (contamination is assessed at the FROZEN resolver SHA)
exit=1

$ ... (after touching the repo)
ERROR: repo has working-tree changes — scan a clean clone only
exit=1
```

---

## 4. Answer: must the scan run once on the merged frame?

**It must be RUN once on the merged frame. It may be COMPUTED per partition.**

The distinction is the whole answer.

1. **Composition (the decision).** Per-row C1(1)/C1(6) outcomes composed byte-exactly, 218/218.
   Each enumerator's partition may be scanned independently as a **non-binding pre-check** — for
   example to tell an enumerator that a candidate is ineligible (see the disclosure caveat in
   `INFORMATION_BARRIER_ANALYSIS.md` §5) — and the results will be identical to the merged run.

2. **The binding artefact must be the whole-frame one.** Three independent reasons:
   - The commitment payload has exactly **one** `scan_sha256` (`lib/commitment.mjs`
     `PAYLOAD_KEYS`), and `commitment-payload` takes a singular `--scan`. There is nowhere to
     put two scans.
   - `contamination()` refuses a scan whose `frame_hash` differs from the frame's, proved on a
     real run: `ERROR: scan was produced for a different frame (frame_hash mismatch) — re-scan
     the exact frame`, exit 1. A partition scan is mechanically unusable with the merged frame.
   - `contamination()` also refuses if the scan's `registry_sha256` differs from the supplied
     registry: `ERROR: scan was produced with a different development-only registry — re-scan`,
     exit 1. Two enumerator-side scans against differently-serialised registry files would both
     be rejected.
   - The uniqueness rule (§5.7) and the duplicate-`candidate_id` check exist **only** at the
     merge (§2.3, §2.4). A per-partition scan can never see them.

3. **No merge command exists.** There is no `scan --append`, no `merge-scans`. Hand-assembling
   the merged report — even though §3 shows it would be byte-identical — would produce a binding
   artefact that no registered command produced. Since the scan is a single cheap pass over the
   in-scope files and is entirely indifferent to the number of rows, **there is no reason to do
   anything but re-scan the merged frame once.**

## 5. Can a two-enumerator workflow breach "the held-out scan equals the development scan"?

§5.5.3 rule (7) requires the held-out payload's `frame_hash` and `scan_sha256` to equal the
development payload's; a mismatch is **Held-out stage VOID**. Checked, and the answer is **no,
not through the scan**:

- One frame, one scan, one `scan_sha256` per payload — enforced by the payload schema.
- The scan is deterministic at a fixed SHA: the re-run produced the identical `scan_sha256`
  (§3.1). Since §5.5 forbids any frame change after the development commitment, the held-out
  scan is the *same file*, not a re-computation, and rule (7) is trivially satisfied.
- `writeOnce` prevents a scan being quietly replaced; `--expect-sha` and the porcelain guard
  prevent a scan at a drifted tree.

**The real breach risk is upstream of the scan and is created by iteration, not by the second
enumerator.** §5.7.2 says that when sufficiency is unmet "enumeration continues first", so the
frame legitimately grows through several rounds before the development commitment. Each round
produces a new frame and needs a new scan. The hazard is an operator committing round *k*'s
scan against round *k+1*'s frame. The instrument fails closed on exactly that (the frame_hash
refusal above, exit 1), and `writeOnce` forces every round's scan to a fresh path. So the
iteration workflow that two enumerators make more likely is already mechanically guarded.

**Residual, unguarded:** nothing forces the operator to scan the *final* frame rather than stop
at a sufficient intermediate one — but that is a frame-composition choice, covered in
`INFORMATION_BARRIER_ANALYSIS.md` §6, not a scan defect.

---

## 6. Findings summary

| # | Finding | Evidence |
|---|---|---|
| S-1 | C1(1) and C1(6) are pure per-row functions of `(candidate, repo@SHA, registry)`; no cross-row state | `lib/scan.mjs` has no mutable module state; `cmdScan`'s inner loop touches only each candidate's own `hits` |
| S-2 | Per-row scan results compose byte-exactly across a partition | 218/218 byte-identical; union flagged set = A ∪ B |
| S-3 | A hand-merged report is byte-identical to the tool's merged report, once `frame_hash` is recomputed | `compose_check.mjs` real output |
| S-4 | The scan *artefact* does not compose: `frame_hash` and `scan_sha256` are frame-bound | three differing `frame_hash` values |
| S-5 | A partition scan is mechanically unusable with the merged frame | `frame_hash mismatch`, exit 1 |
| S-6 | **Defect:** `cmdScan` silently collapses duplicate `candidate_id`s and exits 0 | 220 rows → 219 results |
| S-7 | Entity uniqueness (§5.7) is checked only at the merge, inside `frameSufficiency` | `assertUnique` called from `lib/frame.mjs`, not from the scan |
| S-8 | The scan is deterministic at a fixed SHA, so §5.5.3 rule (7) cannot be breached through the scan | identical `scan_sha256` on re-run |
| S-9 | The frozen self-test could **not** be run: it requires `CPG_U1_RESOLVER_CLONE` at `f01a7eb4199be4e04d4fee7fc0116303949dc553` | `SELFTEST PRECONDITION FAILED`, exit 2 — a precondition, not a failure |

---

## 7. Does a second enumerator change what the scan PROVES?

**Verdict: UNCHANGED. Neither stronger nor weaker in evidentiary content — but the worst case gets
worse.** The argument, not an assertion:

### 7.1 Split the claim in two, because the two halves behave differently

The §5.3 safeguard is a conjunction of a mechanical half and an attested half.

**The mechanical half — C1(1) and C1(6) — is attestor-independent, and I proved it composes.**
Its outcome is a function of `(candidate, repo@SHA, registry)`. No enumerator's name, judgement or
honesty enters it. It is identical whether one person or eight submitted the rows: 218/218
byte-identical results across the partition, union flagged set = A ∪ B (§3). **A second enumerator
therefore cannot change what the scan proves, because the scan does not consult the enumerator at
all.** That is the clean part of the answer, and it is now measured rather than assumed.

What the mechanical half proves is also strictly bounded, and the bounds are the two §20 items:

- **§20.12:** "The development-only registry's completeness rests on an attestation (H2), not on a
  mechanical proof." So C1(6) proves *matches one of the 13 registered entries*, not *was not used
  in development*.
- **§20.20:** no-preview protection is procedural and audit-based; "Nothing in this protocol can
  prove that an unlogged private query did not occur." So C1(4)-type contamination that left no
  repository trace and no registry entry is undetectable by any means the study has.

Neither bound moves with the number of enumerators.

### 7.2 "Two independent attestations" is not what happens — the protocol forbids it

The appealing intuition is that two enumerators give two independent attestations of the same
company, and that a conjunction of two independent "no"s is stronger than one. **This is false
here, and provably so.** Each enumerator attests C1(2)–C1(5) **only for their own rows**, and
§5.7's uniqueness rule refuses two rows for one legal entity. I demonstrated the refusal on a real
run:

```
ERROR: FRAME_INVALID: duplicate identifier CIK:900659 — one row per legal entity
exit=1
```

So every row in a valid frame has **exactly one** attestor, whatever the number of enumerators.
The redundancy that would make the claim stronger is mechanically excluded by the very rule that
keeps the frame well-formed. **There is no path by which two enumerators strengthen the
contamination claim.**

### 7.3 Is it weaker? Two opposing effects, and they do not cancel in the same place

**(i) The expected contamination is unchanged.** The frame has the same number of rows and each row
has one attestor. If each attestor has per-row error rate p, the expected number of wrongly-"no"
rows is p·|F| at n = 1 and p1·|A| + p2·|B| at n = 2. With comparable attestors these are the same
number. No first-order change.

**(ii) The dispersion falls.** A systematic misreading of C1(2) — "used in developing the CPG
resolver, the protocol, the dataset tooling, or reference-truth procedures" is genuinely ambiguous
— now taints only that enumerator's partition rather than the whole frame. Two attestors diversify
a common-mode error. **In this narrow sense a second enumerator is a mild improvement.**

**(iii) The worst case is worse, and this is the effect that matters.** §4A.1's consequence is
all-or-nothing and frame-scoped, not partition-scoped:

> "If a declaration is later found false, that person's work is non-independent … **enumerator
> work:** the frame is not independent (§20.18)."

There is no clause limiting a false enumerator declaration to that enumerator's rows. So a
two-enumerator frame has **two single points of failure for the same total consequence**: either
declaration being found false makes *the whole frame* non-independent, including the other
enumerator's sound partition. At n = 1 there is one such point. In union-bound terms the
probability that *the frame* is non-independent roughly doubles, while the expected number of
contaminated *rows* is unchanged. **That is the precise sense in which two enumerators are worse:
the failure is correlated by the clause, not by the data.**

### 7.4 The deeper problem: C1(2)–C1(5) are close to vacuous, at any n

The orchestrator's observation is decisive and I confirm it from the code and the clauses.

§4A.2(b) **requires** that an enumerator "not have run CPG or seen any CPG output (including the
development pilot and instrument check) before completing the frame". §4A.2(a) requires they "not
have implemented CPG, this protocol, the tooling or the development-only registry". So an eligible
enumerator has, by construction, **no first-hand knowledge of CPG's development history**. Yet
C1(2)–C1(5) ask them exactly that: was this company used in developing the resolver, were its
values derived from CPG output, was there any prior CPG execution, is it the implementers' own
entity.

And §5.3 makes `unknown` fatal — verified in `checkFrameRow`, where both `yes` and `unknown` push a
contamination basis and only `no` is silent:

> "For every contamination attestation, `unknown` is treated exactly like `yes`. An unestablished
> contamination question makes a company ineligible [enforced]."

**Follow that through.** A scrupulous enumerator who reads §5.1's rule that "UNKNOWN means *not
established / insufficient evidence*" would answer `unknown` to C1(2)–C1(5) for nearly every
company, since they have no evidence either way. Every such row becomes held-out-ineligible. The
frame could then never reach 126/52/32 in the *eligible* counts, and `check-frame-sufficiency`
would refuse indefinitely. **The protocol's own arithmetic therefore depends on enumerators
answering `no` on the strength of the operator-supplied registry and the absence of any contrary
indication — that is, on treating "I have no reason to think so" as "no", which §5.1 expressly says
UNKNOWN is not.**

So what C1(2)–C1(5) actually attest is *"this enumerator is unaware of any contamination"*, while
the protocol presents them as *"this company was not used in CPG development"*. The only person who
could truthfully make the second statement is the CPG implementer — who is barred from being an
enumerator by §4A.2(a), and whose knowledge is supposed to be embodied in the registry, whose
completeness is H2 and §20.12.

**Consequence for this item:** C1(2)–C1(5) add little to what C1(1) + C1(6) already prove, at any
number of enumerators. The contamination safeguard is essentially the mechanical half. Since the
mechanical half is attestor-independent and provably composes, **two enumerators leave the
contamination claim's strength unchanged.** What changes is only §7.3(iii): two people can each
void the frame's independence.

### 7.5 What would actually strengthen it

Not more enumerators. Three things, in descending value:

1. **Close the §5.3 asymmetry.** Either reword C1(2)–C1(5) to what they measure ("the enumerator is
   unaware of …"), or move them off the enumerator entirely and onto the implementer, whose
   knowledge they require — i.e. fold them into the registry, whose completeness is already the
   declared H2 attestation. Today the protocol asks a person who is *required to be ignorant* to
   certify a fact that requires knowledge, and then treats their ignorance as certification.
2. **Widen C1(1)'s scope or C1(6)'s registry**, since those are the parts that actually prove
   something. §5.4's own note shows the value of widening: "at the resolver SHA, Cloudflare and
   Tesco also occur in CPG grounding **source** … which a test-only scope would miss."
3. **Nothing about enumerator count.** It is orthogonal to contamination.

*(These are observations for the owner. No protocol byte was changed. Any tooling change would have
to precede registration, since the aggregate is frozen there — §19.1.)*

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

