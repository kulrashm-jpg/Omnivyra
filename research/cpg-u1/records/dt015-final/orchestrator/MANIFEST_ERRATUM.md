# ERRATUM — frozen manifest `e7f9d856…`, prose defects

**The manifest is NOT edited by this erratum.** It is frozen and a live certification is bound to it;
editing it would require a re-freeze and would invalidate the running experiment. This document records
the defects alongside it, which is the only correct handling for a frozen artefact.

**Every numeric, structural and cryptographic property of the manifest is independently verified correct.**
The defects below are all in *prose and self-check fields*. The data is right; the narrative is wrong.

## E-1 — `freeze_precondition` contradicts the manifest's own contents

Verbatim from the frozen file:

> "M468-M471 are reserved, contiguous and **empty** for DR-11 (the cpg_u1_data.mjs scan byId collapse),
> which has no owner ruling and is **not implemented in this tree**."

Measured, in the same file:

```
M468 present: true   M469 present: true   M470 present: true   M471 present: true
```

All four **are** allocated, to the DR-11 duplicate-`scan.results` refusal, assigned to partitions
1, 2, 0 and 1 respectively.

**Why it is stale rather than wrong-in-substance:** this sentence was written for the 441-entry
predecessor, when the block genuinely was empty. Half of it remains true — DR-11 has **no owner ruling**,
and it does not: it was a *delegated Claude decision*, recorded as
`DR-11 DECISION AUTHORITY: DELEGATED TO CLAUDE` / `DR-11 = ADOPT`. The clause that is now false is
"**not implemented in this tree**."

## E-2 — `reserved_block_empty` is vacuous, and worse than reported

The Stream A+B audit reported this field as self-certifying `true`. Measured, it is sharper than that:

```
verification.reserved_block_empty  : undefined
verification.reserved_not_allocated: []
```

The field is **absent**, and the list it derives from is **empty**. It is computed as
"none of the *expected-reserved* ids is present", and this manifest was generated with the
expected-reserved set empty — so the predicate ranges over zero elements and is **true by construction**.

**It is evidence of nothing.** This is the same failure class the programme keeps meeting: a check that
reports success because it examines nothing — the `grep` that exits 1 on no match, the header-less TSV, the
`git status` taken mid-checkout. A vacuous `true` is indistinguishable from a verified `true` at a glance,
which is precisely what makes it dangerous.

## E-3 — stale "441" in a 458-entry manifest

At least four places carry the predecessor's count: `spec_hash_definition.recompute_recipe` ("all 441"),
`partition_rule.deterministic` ("all 441 ids"), `partition_rule.recomputable_from_manifest_alone`, and
`regeneration_on_dr11.procedure` ("total 441 plus … at most 4; max allocated M467 or M471").

**The claims themselves hold for 458** — independently verified — but the quoted numbers are stale.

## E-4 — `required_environment.CPG_U1_ADAPTER_CLONE` is stale

It reads "No such clone exists yet." `C:/tmp/dt015-adapter` exists at `f01a7eb4…`, yields the correct
provider hash, and `BASELINE_ATTESTATION.json` records 18/18 adapter conformance against it.

## Why this matters, and why it is not an integrity failure

**The misreading hazard is real.** A frozen document that says its reserved block is empty, while holding
four mutants in that block, is exactly what an external reviewer would read as an integrity failure rather
than stale prose. That reading would be wrong, but it would be a reasonable reading of the artefact alone.

**What actually verifies, measured independently and read-only:**

| property | result |
|---|---|
| file digest | `e7f9d856…` ✅ |
| entries / distinct ids | 458 / 458 ✅ |
| shard sizes | 153 / 153 / 152 ✅ |
| pairwise disjoint · union exhaustive | ✅ ✅ |
| gaps | exactly the 26 retired ids; `484 − 26 = 458` ✅ |
| `manifest_digest` recomputed | `168415b9…` = stated ✅ |
| `partition_digest` recomputed | `fdb6938d…` = stated ✅ |
| spec hashes | **458 of 458** recomputed from the manifest's own recipe, 0 mismatches ✅ |
| partition rule | independently re-implemented from the manifest's prose, **0 mismatches in 458** ✅ |
| candidate bound inside | `7410ec6c…` / 595, matching the live candidate ✅ |
| M468–M471 | **populated** by the four DR-11 mutants ✅ |

So the manifest is **structurally and cryptographically sound**. Only its narrative is out of date.

## Disposition

**Do not edit the frozen manifest.** Carry this erratum with it in the evidence package, so a reviewer
reaches the contradiction and its resolution together. After the live run completes, the generator's
hard-coded `freeze_precondition` string (`generate_manifest.458.mjs:156`) and the vacuous
`reserved_block_empty` computation (`:31`, `:106`) should be corrected **for future manifests** — the
latter should fail, not pass, when its expectation set is empty.

## A boundary limitation recorded in the same breath

Separately from the manifest: the **authorised-change boundary is attested, not diffed.** No predecessor
`b9250356…` tree exists on disk, so a byte-level diff is impossible and **cannot be produced
retroactively**.

The indirect evidence is strong — across 441 shared ids spanning 30 target files, anchor or replacement
text changed for exactly **two** (M444, M457), both inside the authorised six; and the six approved files
are the six newest in the tree, in a contiguous 17-minute block **4h49m** after the newest non-approved
file.

But it is not a diff. It says nothing about the other 565 files, mtimes are freely settable, and
`b9250356…` is known only from records this programme wrote. **The candidate's own identity, by contrast,
is measured rather than attested.** If the evidence package is expected to demonstrate a diffable change
boundary, that expectation is not met.
