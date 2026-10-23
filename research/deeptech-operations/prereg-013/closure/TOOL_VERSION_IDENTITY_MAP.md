# §8 — TOOL_VERSION: NAME -> SOURCE TREE -> FINAL AGGREGATE

DEEPTECH-PARALLEL-013, closure stream. This is a **disclosure document, not an amendment**. Nothing was
renamed, nothing was edited in the instrument, and no historical terminology was eliminated.

> ## CITATION STABILITY WARNING — READ FIRST
>
> **`C:/tmp/dt013-candidate/tooling` is being edited LIVE by another DEEPTECH-PARALLEL-013 stream while
> this document was written.** Observed during this session: `lib/identity.mjs` created 04:50 (new — R28
> identity/authority validation plus the DR-12 sentinel normalisation), then `lib/registration.mjs` 04:51,
> `lib/harness.mjs` 04:54, `cpg_u1_data.mjs` 04:56, `test/mutate.mjs` 05:01, `test/selftest.mjs` 05:06.
>
> **Consequence: line numbers in `cpg_u1_data.mjs` and `lib/registration.mjs` are moving targets.** Every
> citation below is given as **`symbol` @ line-at-04:47 -> line-at-05:11**, and the **symbol** is
> authoritative. File counts likewise moved from **108 non-`node_modules` / 594 total** (04:47) to
> **109 / 595** (05:11), the difference being `lib/identity.mjs`.
>
> **No substantive claim in this document changed under the drift** — re-verified at 05:11: the constant's
> value, the `PROTOCOL_MARKERS` contents, the five write-only stamps, the absence from
> `registrationTemplate` and `SAMPLING_FIELDS`, and the zero read-backs are all unchanged. Only the
> integers moved. Files cited for §7 and §13 (`lib/sampling.mjs`, `lib/evidenceBundle.mjs`,
> `lib/analysis.mjs`, `lib/select.mjs`, `lib/packets.mjs`, `lib/ratings.mjs`, `lib/schema.mjs`,
> `lib/aggregate.mjs`, `lib/commitment.mjs`) were **not** touched by that stream and their line numbers are
> stable.
>
> This is also independent confirmation that `<FINAL_AGG>` cannot be computed yet: the tree is still being
> written.

---

## 1. THE MAPPING

> **CPG-U1 dataset tooling v6 — `cpg-u1-data-tooling-6` — current source tree
> `research/cpg-u1/tooling` (staged at `C:/tmp/dt013-candidate/tooling`; `<FINAL_N>` files, still growing —
> 594 at 04:47, 595 at 05:11) — final tooling aggregate `<FINAL_AGG>` over `<FINAL_N>` files.**

The file count is deliberately left as `<FINAL_N>` in the mapping statement for the same reason the
aggregate is: the tree is still being written (see the warning above). Quoting a count fixes it as final.

| Link | Value | Where it is stated | Status |
|---|---|---|---|
| **Tooling name** (package identity) | `cpg-u1-data-tooling-6` | `TOOL_VERSION` @ `cpg_u1_data.mjs:49 -> :50` — `const TOOL_VERSION = 'cpg-u1-data-tooling-6';` | **CURRENT. MUST NOT CHANGE.** See §4. |
| **Governed generation** (protocol terminology) | `tooling v4` | `CPG_U1_PROTOCOL_004.md:18, :25, :953, :1098` | **CURRENT AND CORRECT AS WRITTEN.** Historical/protocol terminology; do not renumber. |
| **Feature generations** (documentation) | v3 · v4 · v5 · v5.1 · v6 | `tooling/README.md:1, :89, :193, :208, :218-222, :224, :283` | Correct as written. Headings stay; annotate above them, never renumber. |
| **Current source tree** | `research/cpg-u1/tooling` | in-repo path; candidate staged at `C:/tmp/dt013-candidate/tooling` | 108 non-`node_modules` / 594 total @ 04:47; **109 / 595 @ 05:11** (see warning) |
| **Final tooling aggregate** | **`<FINAL_AGG>`** | to be written into `registration_record` once computed | **DOES NOT EXIST YET** — see §3 |
| **Final file count** | **`<FINAL_N>`** | same | **DOES NOT EXIST YET** |
| **Protocol** | `CPG_U1_PROTOCOL_004` / `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | frozen | unchanged by anything here |

`CPG_U1_PROTOCOL_004.md:25` states the constraint that makes this a documentation act and not a protocol
act: the tooling's "aggregate SHA-256 is bound in the registration record (`tooling_aggregate_sha256`),
**not in this file**".

## 2. THE THREE AXES ARE INDEPENDENT — VERIFIED

These three numbers name three different things. Treating them as one number is the error §8 exists to
prevent.

**Axis A — the protocol's governed generation: "tooling v4".** Verified: `grep -n "tooling v[0-9]"` over
the frozen protocol returns exactly five lines — `:18` ("It **governs the dataset tooling v4** (CPG-043)"),
`:25` (the governed-tooling table row), `:81` (a *historical* note that candidate-002 named `tooling_v2`
and protocol-003 governed tooling v3), `:953` ("implemented in protocol-004 and tooling v4") and `:1098`
("**IMPLEMENTED (tooling v4)**"). `grep -nE "tooling v5|tooling v6|data-tooling-[0-9]"` over the protocol
returns **zero lines**. The protocol never says v5 or v6 and never states a package identity at all.

> **Therefore: "tooling v4" in Protocol-004 is not stale and must not be "corrected".** It is the CPG-043
> governed generation — the scope of what the protocol governs — and Protocol-004 is frozen. §8 is
> explicit: *"tooling v4" may remain only where it is explicitly historical/protocol terminology*. All
> five sites are exactly that.

**Axis B — the package identity: `cpg-u1-data-tooling-6`.** Verified at both timestamps: `TOOL_VERSION`
appears at exactly **seven** places — a comment pointing at the constant (`:2`), the declaration
(`:49 -> :50`) and five `tool:` stamps. Nowhere else in the tree (108 non-`node_modules` files at 04:47,
109 at 05:11). The protocol states no package identity at all, so this axis exists only in the tooling.

**Axis C — the README's feature generations v3..v6.** Verified: `README.md:1` is headed "CPG U1 dataset
tooling — v6 (`cpg-u1-data-tooling-6`: executable end to end, DEEPTECH-PARALLEL-002)", and the enforcement
sections are split "additions in v6" (`:193`), "additions in v4" (`:208`), "additions in v3" (`:224`) with
"(v5)" / "(v5.1)" row prefixes at `:218-222`. These are **feature generations** — a changelog axis — and
they are the record of what was added when. Renumbering them would destroy the history.

## 3. WHY THE FINAL AGGREGATE IS A PLACEHOLDER

The final aggregate **does not exist yet**, and writing any concrete digest here would be a false claim.

- **DR-11 is unresolved.** Its recommended fix ("read-time well-formedness refusal") touches
  `cpg_u1_data.mjs`, `test/selftest.mjs` and `test/mutate.mjs`.
- **R28, R15 and DR-12 are in flight**, each with its own instrument edits; DR-12 alone is a three-file
  atomic unit that moves the mutation count.
- Every one of those edits is inside the hashed tree, so each one moves the aggregate.

> **`<FINAL_AGG>` and `<FINAL_N>` are the only admissible values in any prepared edit until the single
> in-tree edit session has closed and exactly one recomputation has been performed.** The correct order is:
> in-tree edit session -> one recomputation -> write `<FINAL_AGG>`/`<FINAL_N>` into the current files ->
> register.
>
> **The pre-decision candidate digest measured during the live mutation run is NOT the final value and must
> never be written as one.** It is a measurement of an unapproved candidate tree.

## 4. THE `TOOL_VERSION` CONSTANT MUST NOT BE EDITED

```
cpg_u1_data.mjs:49  (04:47)  ->  cpg_u1_data.mjs:50  (05:11)
  const TOOL_VERSION = 'cpg-u1-data-tooling-6';
```

§8 and wave 012 both name this line as **`cpg_u1_data.mjs:49`**. At 05:11 the same declaration sits at
**`:50`**, one line lower, because the stream implementing R28 inserted an import for the new
`lib/identity.mjs`. **The line number is not the subject; the declaration is.** Cite it by symbol.

> **CONFIRMED: this line must not change.** Three independent reasons, each sufficient:
>
> 1. **It moves the aggregate.** `cpg_u1_data.mjs` is inside the tree that `toolingManifest`
>    (`lib/aggregate.mjs:8-23`) hashes. A one-character edit changes the file hash, the manifest text and
>    therefore `tooling_aggregate_sha256`, forcing a full re-certification for no verification benefit.
> 2. **It contradicts every artefact already stamped.** The constant is written into five artefact
>    classes — scan report, development manifest, sizing, held-out manifest, dataset seal. Changing it
>    would make freshly produced artefacts disagree with the existing ones about which tool made them,
>    while neither set is wrong.
> 3. **It closes no verification gap.** The value is already correct and already current: the tooling
>    *is* generation 6 and `cpg-u1-data-tooling-6` *is* its name. There is no defect to fix.
>
> **The answer to §8 is a disclosure — this document — not an amendment.** Equally: Protocol-004 must not
> be renamed to eliminate "tooling v4" (see §2, Axis A).

### `TOOL_VERSION` is pinned nowhere — verified at six points

The constant is decorative. Nothing anywhere compares it, so nothing can be made to disagree about it.

| Check | Result |
|---|---|
| In `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:321-323 -> :352-354`)? | **No.** The 20 entries are `PROTOCOL_VERSION`, `STUDY_ID`, `D = 6`, `K = 12`, `180 days`, `Δ = 3 h`, `30 days`, `QUICKNET.hash`, `bls-unchained-g1-rfc9380`, `SEED_DOMAIN`, `cpg-u1-commitment-digest/v1`, `PAYLOAD_SCHEMA`, `OSF Registries`, `STUDY_OPERATOR`, `UNASSIGNED`, `cpg-u1-rater-order/v1`, `cpg-u1-execution-authorization/v1`, `E >= 126 / 52 / 32`, `CITED_URL_RULE`, `EVALUATION_TREE_DOMAIN`. |
| In `registrationTemplate` (`lib/registration.mjs:33 -> :34`)? | **No.** It takes `{protocolSha, toolingAggregate, registrySha}` and emits `schema`, `study_id`, `protocol_version`, `protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`, `registry`, the identity leaves, `network`, `outpoints`, `checkpoint`, `parameters`. No tooling *name* field exists in the registration record at all. |
| In `SAMPLING_FIELDS` (`lib/registration.mjs:119 -> :130`)? | **No.** `['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256', 'network', 'outpoints', 'checkpoint', 'parameters']`. |
| Read back anywhere? | **No.** `grep` for `.tool` / `['tool']` / `"tool"` / `'tool'` across all `.mjs` files, excluding the five `tool:` writes, returns **zero lines**. |
| Checked by `verify-protocol`? | **No** — it checks `PROTOCOL_MARKERS` only (`:358` at 05:11), and the constant is not one. Re-read at 05:11: the 20 entries are byte-identical to the 04:47 reading. |
| Named in the protocol? | **No** — `grep -nE "data-tooling-[0-9]"` over the protocol returns zero. |

The five stamp sites, all write-only:

```
artefact                  line @04:47   line @05:11   stamp
scan report                   :289          :320      tool: TOOL_VERSION, rules: ['CPG-C1(1) repository scope D-D', ...]
development manifest          :457          :510      manifest_version: 3, tool: TOOL_VERSION, stage: 'development', ...
sizing                        :484          :537      const sizing = { sizing_version: 1, tool: TOOL_VERSION, ... }
held-out manifest             :552          :605      manifest_version: 3, tool: TOOL_VERSION, stage: 'held-out', ...
dataset seal                  :629          :682      seal_version: 4, tool: TOOL_VERSION, status: 'DATASET SEALED — NOT EXECUTED'
```

Five stamps at both timestamps — the count, the artefacts and the write-only property are invariant under
the drift.

> **Consequence for §8: because nothing pins it, there is no divergence to repair and no gate to
> strengthen. The name is documentation. Document it; do not touch it.**

## 5. STILL-BROKEN LINKS IN THE IDENTITY CHAIN — NOT THIS STREAM'S SCOPE

Six locations outside the instrument tree hold the **superseded** aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (and one a superseded file count).
Listed here for completeness only. **Another stream owns these; this stream changed none of them and
recommends no edit to them now** — they must be rewritten in one pass *after* `<FINAL_AGG>` exists, or
they will simply acquire a second wrong value.

| # | Link | Line | Held value | Verified |
|---|---|---|---|---|
| 1 | `dt004-operations/registration/registration_record.DRAFT.json` | `:6` | `tooling_aggregate_sha256: f7699f05...dbb04e5cc5dd` | yes, read directly |
| 2 | `dt004-operations/registration/registration_fields.TEMPLATE.json` | `:6` | same | yes, read directly |
| 3 | `dt004-operations/dataset/tools/instrument.mjs` | `:18` | `EXPECTED_AGGREGATE = 'f7699f05...'` (gate at `:108-110`) | yes |
| 4 | `dt004-operations/execution/tools/instrument.mjs` | `:22` | `REGISTERED_TOOLING_AGGREGATE = 'f7699f05...'` (gate at `:85-86`) | yes |
| 5 | `dt004-operations/people/tools/instrument.mjs` | `:23` | `REGISTERED_TOOLING_AGGREGATE = 'f7699f05...'` (gates at `:50`, `:66-67`) | yes |
| 6 | `dt004-operations/reference/tools/lib/instrument.mjs` | `:19` | `REQUIRED_AGGREGATE = 'f7699f05...'` (gate at `:63-65`) | yes |
| 7 | `dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs` | `:42-43` | `REGISTERED_TOOLING_AGGREGATE = 'f7699f05...'` **and `REGISTERED_TOOLING_FILE_COUNT = 593`** | yes, read directly |

Two observations that matter for whoever does own this:

- All four `instrument.mjs` gateways **fail closed** on a mismatch, so today they refuse to run against
  the current tree rather than validating it wrongly. The hazard is a blocked workflow, not a false pass.
- `REGISTERED_TOOLING_FILE_COUNT = 593` is **one less** than the candidate tree's 594. A file count is not
  a hash; the pair `(<FINAL_AGG>, <FINAL_N>)` must be written together or the mismatch message will name
  a count that was never registered.

## 6. AGGREGATE EFFECT

> **Does §8 move the aggregate? NO.**

Verified mechanically, not asserted: `toolingManifest(root)` (`lib/aggregate.mjs:8-23`) walks `root` and
hashes only files beneath it; `root` is `dirname(cpg_u1_data.mjs)` = the tooling tree. This document lives
at `research/deeptech-operations/prereg-013/closure/`, outside that tree. No file inside the tree was
opened for writing. `cpg_u1_data.mjs:49` is unchanged. `CPG_U1_PROTOCOL_004.md` is unchanged (hash
re-verified: `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`). `tooling/README.md` is
unchanged — the nine README defects are a *separate* decision (D-7) that **does** move the aggregate and is
deliberately not touched here.

**Mutation-count effect: none.** No mutant anchor text changes, so the live 404-mutant run is unaffected by
this decision.

**Owner approval needed: none** for the disclosure itself. What does need approval is the *later* act of
writing `<FINAL_AGG>`/`<FINAL_N>` into the chain, which cannot happen until the edit session closes.
