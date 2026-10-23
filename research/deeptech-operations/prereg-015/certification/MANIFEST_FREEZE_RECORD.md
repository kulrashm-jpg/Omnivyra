# MANIFEST FREEZE RECORD — CERT-015

**Scope limit.** This record and everything it binds are **engineering evidence only**. Mutation
certification establishes that the asserted executable behaviour is *asserted correctly*. It is **not
U1 empirical validation**, it is not a substitute for it, and it establishes **no registration
readiness**. No registration, frame, treatment, evaluation tree, registry or protocol was touched.

---

## 1. The final candidate, re-derived before anything else

Re-derived with the tree's **own** `lib/aggregate.mjs` `toolingManifest()` — never
`xargs sha256sum | sha256sum`, which is order- and chunking-dependent and is not the protocol
definition.

```
$ node -e "import('file:///C:/tmp/dt013-candidate/tooling/lib/aggregate.mjs')…toolingManifest(root)"
root      : C:/tmp/dt013-candidate/tooling
files     : 595
aggregate : 7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6
```

| Binding | Expected | Re-derived | Verdict |
|---|---|---|---|
| tooling aggregate | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` | identical | **MATCH** |
| files | 595 | 595 | **MATCH** |
| protocol SHA (`CPG_U1_PROTOCOL_004.md`) | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | identical | **MATCH** |
| registry SHA (`tooling/rules/development_only_registry.json`) | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | identical | **MATCH** |

The aggregate definition is `CPG_U1_PROTOCOL_004` §19.1 / §24: sha256 of the UTF-8 text with one line
`"<sha256>  <relative/path>"` per file, sorted by path, each LF-terminated, over **every** file of the
tooling tree including vendored dependencies.

**Superseded and VOID.** `b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` (the
441-entry design state) and `638d68e6…` (the terminated PID 4092 run). Neither is merged, and neither
is read as evidence. Both prefixes are firewalled inside the frozen manifest
(`superseded_evidence_firewall.forbidden_aggregate_prefixes`) and both are refused by merge rule R2 —
a refusal that is exercised by two synthetic tests, not merely asserted.

Anchor precheck on the candidate (read-only; `--anchors` performs no copy, no write, no execution):

```
$ node C:/tmp/dt013-candidate/tooling/test/mutate.mjs --anchors
anchors: 458/458 occur exactly once
```

---

## 2. The generator was re-run, not hand-edited

The generator at `C:/tmp/dt014-final/phase4/generate_manifest.mjs` was written for the 441-entry /
`b9250356…` state. It was copied unchanged to
`C:/tmp/dt015-mutrun/manifest/generate_manifest.UNCHANGED.mjs` and run against the new candidate
first, before any modification:

```
wrote UNCHANGED_RUN.json
total 458; distinct 458; max M484; partition sizes 153/153/152; adapters per partition 5/0/0
candidate/tooling aggregate 7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6 over 595 files
protocol sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
DISCREPANCY: failed checks -> total_is_441, ids_distinct_441, max_allocated_is_M467,
             arithmetic_404_at_or_below_M430_plus_37_above, reserved_block_M468_to_M471_empty
EXIT=1
```

**The generator's logic needed no change.** It parsed 458 entries from the candidate's own
`test/mutate.mjs`, derived the correct 153/153/152 split and pinned all five adapter-kind mutants to
partition 0, unmodified. The five failures are all **hard-coded expectation constants describing the
old 441-entry population**, not defects in the parse, the spec hash or the partition rule.

### 2.1 Exactly what was changed

Four changes, in a copy at `C:/tmp/dt015-mutrun/manifest/generate_manifest.458.mjs`. The full unified
diff is preserved at `generator.458.diff` beside this record.

| # | Change | Why |
|---|---|---|
| **1** | The five population expectations became CLI options `--expect-total`, `--expect-max`, `--expect-le430`, `--expect-gt430`, `--expect-reserved`, **with the original 441-era literals as their defaults**. | The literals were assertions about the retired population. Making them parameters is the "parameter change" the brief permits. |
| **2** | Added `--freeze`, which sets `frozen: true` and restates `status`. | The manifest must be frozen by the generator, so that its output is still generator-produced and not hand-edited. |
| **3** | A new derived check `population_identity_max_minus_gaps_equals_total` (`maxN − gaps == total`). | A *generalisation*, not a weakening: it holds for the old set (467 − 26 = 441) and the new one (484 − 26 = 458), and it is the brief's own stated identity. |
| **4** | `superseded_evidence_firewall` now firewalls **both** `638d68e6` and `b9250356`. | The 441-entry tree became superseded after the generator was written. The brief names both as VOID. |

Two cosmetic follow-ons of change 1: `reserved_not_allocated` and the recorded anchor observation are
now derived rather than literal.

### 2.2 The change is confined to the expectation layer — proved, not asserted

The patched generator was re-run **with no `--expect-*` flag at all**, so every default was the
original literal, and its output was compared to the unchanged generator's:

```
mutants array identical : true
manifest_digest  same   : true
partition_digest same   : true
checks(original) : {... arithmetic_404_at_or_below_M430_plus_37_above:false, reserved_block_M468_to_M471_empty:false}
checks(patched)  : {... arithmetic_404_at_or_below_M430_plus_37_above:false, population_identity_…:true, reserved_block_empty:false}
```

The entire 458-entry `mutants` array, `manifest_digest` and `partition_digest` are **byte-identical**.
The only delta is the added check key and the renamed reserved-block key. No spec hash, no partition
assignment and no digest is affected by the patch.

### 2.3 The frozen invocation

```
node generate_manifest.458.mjs \
  --candidate C:/tmp/dt013-candidate/tooling \
  --protocol  C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md \
  --partitions 3 \
  --expect-total 458 --expect-max 484 --expect-le430 404 --expect-gt430 54 --expect-reserved '' \
  --freeze \
  --out FINAL_MUTATION_MANIFEST_458.json

total 458; distinct 458; max M484; partition sizes 153/153/152; adapters per partition 5/0/0
candidate/tooling aggregate 7410ec6c…62405e18af32c5e95b89df752c6 over 595 files
protocol sha256 c50fc680…6bf6395f2c691df00b719
manifest_digest  168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7
partition_digest fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805
all verification checks PASS
EXIT=0
```

`--expect-reserved ''` is empty because the reserved block M468–M471 is **no longer reserved**: this
candidate allocates it. That is the DR-11 regeneration path the 441-era manifest itself prescribed,
taken as prescribed — by regenerating, not by editing.

---

## 3. Spec-hash stability against the 441 set

Spec hashes are order-independent by construction: `CPG-U1-MUTSPEC-v1` depends only on a mutant's own
five fields (`id`, `description`, `file`, `kind`, `anchor_sha256`, `replacement_sha256`) and not on its
index, the total, `K`, or any other entry. So an entry surviving from the 441 set **must** hash
identically, and a changed hash on an otherwise unchanged mutant would mean the generator is not
order-independent.

```
ids common      : 441
ids only in 441 : 0
ids only in 458 : 17 -> M468,M469,M470,M471,M472,M473,M474,M475,M476,
                        M477,M478,M479,M480,M481,M482,M483,M484
spec_hash CHANGED on a surviving mutant : 2
```

**439 of 441 are byte-identical. Two changed, and both are explained — neither is a generator defect.**

| id | What changed | What did NOT change |
|---|---|---|
| **M444** | `anchor_sha256` `d3743dc2…` → `d23c8144…`; `replacement_sha256` `cf978f99…` → `a9e195dd…` | `id`, `description`, `file` (`lib/identity.mjs`), `kind` |
| **M457** | `anchor_sha256` `9449f9ea…` → `8fdf86fa…`; `replacement_sha256` `fd587f85…` → `6ad522d9…` | `id`, `description`, `file` (`lib/registration.mjs`), `kind` |

The changed fields are the **anchor and replacement source fragments themselves** — the mutant
specifications, not their ordering. Both are deliberate, and the candidate tree documents each one in
place:

```js
// M444 RE-POINTED (F4, same ID, same mutant): its anchor was the FOREIGN synthetic-marker list, which F4
// removed because no document defines those words as forbidden identity tokens. Substring matching still
// exists, and still matters, for the instrument's OWN fixture marker, so the anchor moves there and the
// mutation is unchanged in kind: substring match -> whole-value match.

// M457 RE-POINTED (F4b, same ID, same mutant): F4b lifted the classification out of the `else if` chain so
// that a piped registration_id is classified too, which removed the leading `else `. The anchor follows
// the line; the mutation still deletes the classification and nothing else.
```

**Conclusion: order-independence holds.** The two hashes changed because their inputs changed, which
is the property working correctly. The correct reading is the opposite of an alarm — a re-pointed
anchor that kept its old hash would have been the defect, because the old anchor text no longer exists
in the refactored source and the mutant would silently fail its anchor precheck. Both re-pointed
mutants pass the `458/458 occur exactly once` precheck.

This is also exactly what merge rule **R8** defends at run time: matching ids is not sufficient, so the
merge re-derives every spec hash from each worker's own clone and requires equality with the manifest.

---

## 4. Verification of the frozen manifest — independent, not self-reported

Re-verified by a separate script that reads only the emitted JSON and **does not trust the manifest's
own `checks` block**:

```
PASS  frozen === true
PASS  candidate_aggregate bound              PASS  tooling_aggregate bound
PASS  tooling_file_count === 595             PASS  protocol_sha256 bound
PASS  entries === 458                        PASS  distinct ids === 458
PASS  max id === M484
PASS  gaps are exactly the 26 retired  count 26
PASS  identity 484 - 26 === 458  484 - 26 = 458
PASS  all 458 spec_hash recomputable from the manifest alone
PASS  458 distinct spec_hash
PASS  every id has a partition in {0,1,2}
PASS  shard sizes 153/153/152
PASS  shards pairwise disjoint (empty intersections)
PASS  union size === 458 (exhaustive)
PASS  sum of shard sizes === 458
PASS  every id in EXACTLY one shard
PASS  adapter-kind ids are exactly M254-M258
PASS  every adapter mutant in partition 0
PASS  no adapter mutant in partition 1 or 2
PASS  manifest_digest recomputes

INDEPENDENT VERIFICATION: ALL PASS
```

The 26 gaps, enumerated in full, are exactly the retired set:

```
23, 24, 25, 26, 225, 244, 280, 281, 282, 283, 284, 285, 286, 287, 288,
289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299
```

`484 − 26 = 458` — the population identity holds as an arithmetic identity over the enumerated gap
list, not as a restated count.

All 458 spec hashes were recomputed **from the manifest alone**, using only the
`spec_hash_definition` block it carries, with no access to `mutate.mjs`. An outsider can therefore
reproduce every hash from the document.

---

## 5. Freeze

| Field | Value |
|---|---|
| `frozen` | `true` |
| `candidate_aggregate` (bound in) | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` |
| `tooling_aggregate` (bound in) | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` |
| `tooling_file_count` | 595 |
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| `manifest_digest` | `168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7` |
| `partition_digest` | `fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805` |
| **frozen file digest** (sha256 of the file's bytes) | `e7f9d856ca60c15aed7b37e6893ccbd24b53aa6848695159e6f69575fef9fb8a` |

**After this point the population may not change.** Any change to the candidate tree changes the
aggregate, which changes `manifest_digest` and `partition_digest`, and merge rules R2 and R8 then
refuse every partition output — pre- and post-change output cannot be combined. That is the intended
behaviour and the reason the freeze is meaningful.

### 5.1 Carried by the manifest, as required

| Required content | Field |
|---|---|
| total count | `verification.total` = 458, and `mutants[]` length |
| every mutant id | `mutants[].id`, all 458 |
| per-mutant spec hash | `mutants[].spec_hash` |
| partition assignment | `mutants[].partition`, plus `verification.partition_id_lists` |
| candidate aggregate | `candidate_aggregate` |
| tooling aggregate | `tooling_aggregate`, with `tooling_file_count` and the §19.1/§24 definition |
| protocol SHA | `protocol_sha256` |
| spec-hash definition, stated in-document | `spec_hash_definition` (`CPG-U1-MUTSPEC-v1`), with `canonical_form`, `separator`, `empty_string_sha256`, `order_independence` and `recompute_recipe` |
