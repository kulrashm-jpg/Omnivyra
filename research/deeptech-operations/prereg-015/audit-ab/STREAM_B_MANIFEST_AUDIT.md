# CERT-015 STREAM B — FROZEN MANIFEST AUDIT (read-only)

Target: `C:/tmp/dt015-mutrun/manifest/FINAL_MUTATION_MANIFEST_458.json`
File digest measured: `e7f9d856ca60c15aed7b37e6893ccbd24b53aa6848695159e6f69575fef9fb8a` — matches
expected. **VERIFIED.**

The manifest was read only. It was not regenerated, not edited, not moved.

## B1 — every requested property

| property | expected | measured | status |
|---|---|---|---|
| file digest | `e7f9d856…fb8a` | `e7f9d856…fb8a` | VERIFIED |
| entries | 458 | 458 | VERIFIED |
| `frozen` | `true` | `true` | VERIFIED |
| shard sizes | 153 / 153 / 152 | `[153,153,152]` | VERIFIED |
| shards pairwise disjoint | yes | 0 ids in more than one shard | VERIFIED |
| union exhaustive over population | yes | union = 458 distinct ids = the whole entry set | VERIFIED |
| partition values in range | 0..2 | 0 out-of-range | VERIFIED |
| assignment deterministic & reproducible from the manifest alone | yes | independently re-derived → **0 mismatches** in 458 | VERIFIED |
| duplicate ids | none | none | VERIFIED |
| missing ids | none inside the allocated range beyond the retired set | none | VERIFIED |
| min id | — | `M01` (integer 1) | VERIFIED |
| max id | — | `M484` (integer 484) | VERIFIED |
| id format | `/^M[0-9]+$/` | all 458 conform | VERIFIED |
| gaps = retired set | {23,24,25,26,225,244,280–299} | exactly that, 26 values, in that order | VERIFIED |
| identity `484 − 26 = 458` | holds | 484 − 26 = 458 = entry count | VERIFIED |
| reserved block M468–M471 populated by DR-11 | yes | all four present (see B2) | VERIFIED |
| candidate aggregate bound in manifest | `7410ec6c…f752c6` | `candidate_aggregate` and `tooling_aggregate` both `7410ec6c…f752c6`, `tooling_file_count` 595 — matches the live candidate measured in Stream A | VERIFIED |
| `manifest_digest` (internal, id:spec_hash) | `168415b9…3be7` | recomputed `168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7` | VERIFIED |
| `partition_digest` | `fdb6938d…6805` | recomputed `fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805` | VERIFIED |
| `verification.failed_checks` | `[]` | `[]`, and all nine self-checks `true` | VERIFIED |
| adapter-kind entries | 5 | 5, all in partition 0 | VERIFIED |
| tuple arities | 453 four-element + 5 five-element = 458 | as stated | VERIFIED |
| deletion mutants with empty replacement | 20 | 20 carry `e3b0c442…b855`; **0** entries carry an empty *anchor* | VERIFIED |
| `mutate_source.sha256` vs the live file | equal | equal (`9c9bf533…fbc6`) | VERIFIED |

### Assignment reproduction, in detail

`adapter-pinned-stride-v1` was re-implemented from the manifest's own prose, using only fields
present in the file (`id`, `kind`, `partition_rule.partitions`):

1. `target[k] = floor(458/3) + (1 if k < 458 mod 3 else 0)` → `[153,153,152]`, equal to both
   `target_sizes` and `actual_sizes`.
2. Stage 1: the 5 `kind == "adapter"` mutants → partition 0, ascending integer id.
3. Stage 2: remaining ids ascending, dealt cyclically from 0, skipping any partition already at
   target and advancing the cursor before the deal.

Result: `[153,153,152]`, and every one of the 458 recomputed partitions equals the partition the
manifest records. No hashing, no randomness, no filesystem order is involved, and `K` is in the
file — so the assignment is reproducible by an outsider holding this file and nothing else.
**VERIFIED.**

## B2 — the reserved block M468–M471

All four are present and populated with DR-11 (`cpg_u1_data.mjs` scan `byId` collapse) mutants:

| id | partition | kind | file | description |
|---|---|---|---|---|
| M468 | 1 | (none) | `cpg_u1_data.mjs` | duplicate scan results not refused (the byId collapse restored) |
| M469 | 2 | (none) | `cpg_u1_data.mjs` | a pair of scan results not counted as a duplicate |
| M470 | 0 | (none) | `cpg_u1_data.mjs` | duplicate scan result reported without its own contamination reasons |
| M471 | 1 | (none) | `cpg_u1_data.mjs` | duplicate scan result reported without its own held_out_ineligible_by_scan |

**VERIFIED** as populated. See D-1 and D-2 below: the surrounding prose and one self-check label
still describe this block as reserved and empty.

## B3 — spec-hash reproducibility

`spec_hash_definition` (`CPG-U1-MUTSPEC-v1`) was implemented literally from the manifest's own
`canonical_form` / `recompute_recipe`: seven LF-joined lines, no trailing LF, `kind` rendered as
the empty string when absent, anchor and replacement pre-hashed.

- **Checked: all 458 of 458** entries (not a sample — the recomputation needs no file reads, so
  the full population cost less than a sample of the tree would have).
- **Mismatches: 0.**
- Concatenating `"<id>:<spec_hash>\n"` in ascending integer-id order reproduces the stated
  `manifest_digest` exactly, so the per-entry hashes chain to the document-level digest.

**Is the definition fully self-contained? Yes.** Every one of the seven lines draws on a field
printed in the file itself (`id`, `description`, `file`, `kind`, `anchor_sha256`,
`replacement_sha256`). Because anchors and replacements are *pre-hashed*, `test/mutate.mjs` is not
needed to recompute any spec hash. **VERIFIED.**

The one honest limit: self-containment is about *reproducibility*, not *faithfulness*. An outsider
can confirm that each `spec_hash` is the correct hash of the stated fields, but confirming that
`anchor_sha256` is the hash of the text actually present in `mutate.mjs` requires the harness
source (the manifest documents the parse in `mutate_source.parse_method`, and its recorded
`mutate.mjs` sha256 matches the live file, which closes that gap by reference rather than by
recomputation here — recomputing it would have meant parsing and evaluating the MUTATIONS slice,
declined on CPU grounds while the run is live).

## B4 — the M444 / M457 expectation

**CONFIRMED, exactly as stated.** Diffed the frozen 458-entry manifest against the earlier
441-entry manifest (`C:/tmp/dt014-final/phase4/FINAL_MUTATION_MANIFEST.json`, whose
`candidate_aggregate` is the predecessor `b9250356…`):

- ids only in the old manifest (removed): **NONE**
- ids only in the new manifest (added): **M468–M484** — 17 ids; 441 + 17 = 458
- shared ids whose `spec_hash` changed: **exactly 2 — M444 and M457. No others.**

| id | file | what changed | what did not |
|---|---|---|---|
| M444 | `lib/identity.mjs` | `anchor_sha256` `d3743dc2…` → `d23c8144…`; `replacement_sha256` `cf978f99…` → `a9e195dd…`; `spec_hash` `8b7ddf36…` → `53f606fa…` | same id, same `description`, same target file, same `kind` |
| M457 | `lib/registration.mjs` | `anchor_sha256` `9449f9ea…` → `8fdf86fa…`; `replacement_sha256` `fd587f85…` → `6ad522d9…`; `spec_hash` `28a1c07e…` → `7007db1d…` | same id, same `description`, same target file, same `kind` |

This is precisely the declared shape of a deliberate re-point: identity and intent preserved, only
the anchor and replacement text moved, and only in two files — both inside the authorised six.
The other 439 shared spec hashes are unchanged, which is the order-independence property the
manifest claims (`order_independence`) holding in practice.

Informational, not a defect: 8 shared ids changed partition, an unavoidable consequence of
resizing the shards from 441 to 458 entries.

## B5 — discrepancies found (REPORTED, NOT REPAIRED)

All are prose or labelling; **no numeric, structural or cryptographic property of the manifest is
wrong.** Nothing was edited.

**D-1 — `freeze_precondition` contradicts the manifest's own data.** The text still reads:
"M468-M471 are reserved, contiguous and empty for DR-11 … which has no owner ruling and is not
implemented in this tree." In this manifest M468–M471 **are allocated** to DR-11 mutants. The
string is hard-coded at `generate_manifest.458.mjs:156` and was not updated when the reservation
was consumed. Severity: documentation. A reader who trusts the prose over the entries would
mis-describe the population.

**D-2 — the `reserved_block_empty: true` self-check is vacuous.** The generator computes it as
`!EXPECT_RESERVED.some(n => present.has(n))` from `--expect-reserved`
(`generate_manifest.458.mjs:31,106`). This manifest was generated with that list **empty**
(`verification.reserved_not_allocated` is `[]`), so the check is trivially true over zero
elements. It reports `true` for a manifest in which the M468–M471 block is in fact populated.
It is not evidence of anything.

**D-3 — stale "441" throughout the prose of a 458-entry manifest.** At least four places:
`spec_hash_definition.recompute_recipe` ("any outsider can recompute all 441"),
`partition_rule.deterministic` ("all 441 ids are distinct integers"),
`partition_rule.recomputable_from_manifest_alone` (consistent but written for 441), and
`regeneration_on_dr11.procedure` ("total 441 plus … at most 4; max allocated M467 or M471"),
which now understates the real state (458 entries, max M484). The *claims* still hold for 458 —
verified above — but the numbers quoted are the predecessor's.

**D-4 (adjacent, not in the manifest) — `C:/tmp/dt015-mutrun/scripts/sample.sh` throughput
sampler is broken.** `throughput.txt` contains
`line 7: 0 \n 0: arithmetic syntax error in expression (error token is "0")`. The `count()`
helper's `grep -cE … || echo 0` emits two lines when the log exists but matches nothing, so
`$C1` is multi-line and the arithmetic fails. This only breaks the ETA measurement; it does not
affect the run, the manifest or any result. **Not repaired** — it is inside the live run's
script directory.

**D-5 — `required_environment.CPG_U1_ADAPTER_CLONE` is stale.** It states "No such clone exists
yet; provisioning one is a phase-4 prerequisite." `C:/tmp/dt015-adapter` now exists at HEAD
`f01a7eb4…` and yields the correct provider-configuration hash, and
`BASELINE_ATTESTATION.json` records it as the adapter clone with 18/18 adapter conformance.
Documentation only.

## B6 — status of the live run (OBSERVATION ONLY)

Recorded because it bounds what any later reader may conclude, not as a result.

- `scripts/run_k1.sh` runs the three shards **sequentially** (`for K in 0 1 2`), one concurrent
  worker. At audit time only shard 0 was live: `run_worker.mjs 0` (started 12:15:05 local) and
  `w0/clone/test/mutate.mjs --jobs 1 --only M01,M04,M07,…` (the partition-0 stride). Shards 1 and
  2 had no process, which is the expected state under K=1, not a stall.
- `k1_driver.log` shows `=== SHARD 0 start 2026-09-25T06:45:05Z ===` and no shard-0 end line.
- Per-worker TEMP isolation was proved for all three workers (`wrap0/1/2.out`), each
  `os.tmpdir()` inside its own `w*/temp`.
- `MERGE_REFUSED.json` is `BLOCKED` and binds the same `7410ec6c…`, `168415b9…`, `fdb6938d…`
  triple, which is the correct pre-completion state.
- **PENDING LIVE RUN:** the mutation population is incomplete. No kill count, survival count or
  mutation score exists yet, and no partial figure from any log may be quoted. Nothing in this
  audit depends on execution outcomes.
