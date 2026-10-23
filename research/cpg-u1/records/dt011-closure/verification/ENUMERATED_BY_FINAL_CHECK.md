# `enumerated_by` — final personnel-binding check

**Wave:** DEEPTECH-PARALLEL-011, verification stream (directive §5)
**Candidate:** `C:/tmp/dt009-merge/tooling`, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files
**Method:** static enumeration over the candidate tree (exhaustive grep for `enumerated_by` — 22 hits across
`cpg_u1_data.mjs` (2), `lib/enumeration.mjs` (6), `lib/schema.mjs` (2), `README.md` (2),
`templates/candidate_frame.template.csv` (1) and `test/selftest.mjs` (9); every code-bearing hit is cited
in §1–§5 below, the remainder being doc comments and README prose), plus one read-only Node probe against a **scratch copy** of `lib/` to settle the
`personnel.mjs:32` masking question empirically. No write under `C:/tmp/dt009-merge`; no mutation suite; no
selftest.
**Labels used:** VERIFIED / OWNER DECISION REQUIRED / BLOCKED / NOT EXECUTED

---

## 1. Writers of `enumerated_by`

**VERIFIED — the tooling never writes `enumerated_by`. It is written only by humans, into the frame CSV.**

| file:line | what it is |
|---|---|
| `lib/schema.mjs:32` | declares `enumerated_by` as FRAME_COLUMN index 19 of 22 (`FRAME_COLUMNS`, `:12-34`) |
| `templates/candidate_frame.template.csv:1` | the blank CSV header the enumerator fills in — the sole authoring surface |
| `test/selftest.mjs:133` | fixture writer: `enumerated_by: 'synthetic-enumerator'` |
| `test/selftest.mjs:878, 885, 906-914` | fixture writers for the attribution tests |
| `test/selftest.mjs:2377` | fixture writer: `enumerated_by: 'cpg-implementer-NOT-INDEPENDENT'` (negative control) |

No production code path assigns, defaults, normalises, rewrites or infers the value. Grep confirms no
occurrence of `enumerated_by:` or `enumerated_by =` outside `lib/schema.mjs` (declaration) and `test/`
(fixtures). Consequences worth recording:

- **There is no operator-side source of truth to forge against** — the value is an unverifiable human claim
  by construction. `README.md:247` states the limitation explicitly: the tooling cannot verify "that
  pseudonymous IDs denote distinct real people".
- **Whitespace is not normalised on write, only on read.** `lib/enumeration.mjs:29` trims for comparison;
  the CSV retains the original bytes, which are what `frame_hash` covers (§5). So `'SYN-P0'` and `' SYN-P0'`
  are the *same* enumerator for validation but *different* frames for hashing. Not a defect — but it means a
  cosmetic whitespace edit to the frame after commitment is a `FRAME_CHANGED` refusal
  (`cpg_u1_data.mjs:497, :765`), which an operator could mistake for tampering.

---

## 2. Readers of `enumerated_by`

**VERIFIED — exactly two production readers, both in `lib/enumeration.mjs`.**

| file:line | reader | what it reads for |
|---|---|---|
| `lib/enumeration.mjs:29` | `checkEnumerationAttribution` | `typeof r?.enumerated_by === 'string' ? r.enumerated_by.trim() : ''` — the only place the value is extracted |
| `lib/schema.mjs:124` | `checkFrameRow` | `if (!r.enumerated_by.trim()) errors.push('enumerated_by is required')` — presence only |
| `lib/canonical.mjs:7-21` | `canonicalJson` (indirect) | reads it as one key among all record keys when computing `frame_hash` (§5) |

**Notably absent from the readers list:**

- `entry()` — the manifest entry builder (`cpg_u1_data.mjs:133-137`) does **not** carry `enumerated_by`.
- `LOG_COLUMNS` — the screening log (`cpg_u1_data.mjs:139-141`) does **not** carry it. It carries
  `screened_by`, which is an unrelated operator-supplied `--screened-by` value.
- `REFERENCE_ITEM_KEYS` (`lib/packets.mjs:12`) — correctly excludes it; the Author/Confirmer must not learn
  who enumerated a row (`CPG_U1_PROTOCOL_004.md:569`).
- The seal (`cpg_u1_data.mjs:628-640`) records no enumerator field.

So `enumerated_by` survives downstream **only** inside `frame_hash`, never as a readable field in any
manifest, log, packet or seal. An outsider holding the published artefacts but not the frame CSV cannot read
who enumerated what; they can only verify the frame CSV they are given hashes to the committed value. Given
that the personnel register is restricted by design (`lib/personnel.mjs:1`), this is coherent — but it means
**attribution is verifiable only by someone holding both the frame CSV and the restricted register.**

---

## 3. Validators — roster check or shape regex?

**VERIFIED — roster membership, not a shape regex. There is no shape regex on `enumerated_by` anywhere.**

Exactly **one** validator resolves the value against people:

```
lib/enumeration.mjs:43    const eligible = new Set(enumerators);
lib/enumeration.mjs:44    for (const a of attributed) {
lib/enumeration.mjs:45      if (a.id && !eligible.has(a.id)) errors.push(`${a.where}: enumerated_by ${a.id} is not an eligible enumerator …`);
```

where `enumerators = registeredEnumerators(personnel)` (`lib/enumeration.mjs:15-17`) = the `person_id` of
every assignment whose `role === 'enumerator'`. This is **exact string equality after trim against the
`lib/personnel.mjs` roster** — strictly stronger than a regex. Four adjacent checks in the same function:

| check | file:line | effect |
|---|---|---|
| presence (per row) | `lib/enumeration.mjs:32` | blank/absent/non-string → refused |
| register structure propagated | `lib/enumeration.mjs:34-35` | every `checkPersonnelRegister` error becomes an attribution error |
| enumerator slot filled | `lib/enumeration.mjs:41` | no enumerator in register → refused |
| A ≠ B (8-person model) | `lib/enumeration.mjs:42` | one person in both enumerator slots → `ROLE COLLISION` refused |
| roster membership (per row) | `lib/enumeration.mjs:45` | unregistered or wrong-role id → refused |
| non-blank (row schema) | `lib/schema.mjs:124` | blank → `MALFORMED_ROW` |

`PERSON = /^[A-Za-z0-9_-]{1,64}$/` (`lib/personnel.mjs:14`) is applied to `reg.operator.person_id`
(`lib/personnel.mjs:19`) and to `a.person_id` (`lib/personnel.mjs:32`) — i.e. to the **register**, never to
`enumerated_by`. The frame value inherits the shape constraint only transitively: a value can only match a
roster entry, and a malformed roster entry makes the whole register error out (§6). This is sound, but it is
**one link long** — see the coupling note in §6.

CLI enforcement, the only place any of this runs:

```
cpg_u1_data.mjs:220   const attribution = checkEnumerationAttribution(frame, { personnel: readJson(need(o, 'personnel')) });
cpg_u1_data.mjs:222   if (attribution.length) fail(`ENUMERATION_ATTRIBUTION_REFUSED: ${attribution.length} error(s) — …`);
```

Test coverage of the validator is genuinely good: `test/selftest.mjs:881-914` covers three positive controls
(A, B, and a frame split between A and B), forged id, wrong role (`rater-1`), a §4A.1 declaration not "no",
a missing organisation confirmation, one person in both enumerator slots, an unfilled enumerator slot,
whitespace-only id, absent field, and §4A staging. End-to-end CLI coverage at `test/selftest.mjs:1327`
(accepts), `:1329` (`--personnel is required`), `:1334` (`ENUMERATION_ATTRIBUTION_REFUSED`).
Mutation coverage at `test/mutate.mjs:471-478`: **M424–M430**, seven mutants including two positive controls
(M429, M430) that must break *acceptance*. M425 specifically mutates away the `reg.errors` propagation line.

---

## 4. Fail-open or fail-closed on an unknown or absent `enumerated_by`?

### 4.1 Inside `checkEnumerationAttribution` with a register — **FAIL-CLOSED. VERIFIED.**

Probe results against a scratch copy of `lib/` (read-only; register built from `INDEPENDENT_ROLES`, all
declarations `'no'`, valid 64-hex fingerprints):

| case | errors returned | verdict |
|---|---|---|
| absent field (`{candidate_id}` only) | 1 — "enumerated_by is missing" | closed |
| whitespace-only `'   '` | 1 — "enumerated_by is missing" | closed |
| forged id `'SYN-P-FORGED'` | 1 per row — "not an eligible enumerator" | closed |
| wrong role (`rater-1`'s id) | "not an eligible enumerator" | closed |
| enumerator slot unfilled | "role enumerator is UNFILLED" | closed |
| one person in both enumerator slots | "both enumerator slots" | closed |
| operator id used as enumerator | "ROLE COLLISION — the operator may hold no independent role" | closed |
| enumerator's §4A.1 declaration = `'yes'` | "personnel register: … ran_or_saw_cpg_output" | closed |

### 4.2 Without a register — **FAIL-OPEN, but unreachable from the CLI. VERIFIED.**

`lib/enumeration.mjs:33` guards the whole roster block on `if (personnel !== undefined)`. With no register,
a forged id passes with **zero errors** — confirmed by probe, and asserted as intended behaviour at
`test/selftest.mjs:910` ("no register supplied: resolution is not attempted (same guard shape as
`checkRaterAssignment`)"). Presence is still required (`test/selftest.mjs:909`).

This is unreachable from the CLI because `cpg_u1_data.mjs:220` wraps the register in
`need(o, 'personnel')`, and `need` (`cpg_u1_data.mjs:68`) calls `fail('--personnel is required')` when the
flag is absent *or* valueless (`!o[k] || o[k] === true`). Tested end-to-end at `test/selftest.mjs:1329`.
There is exactly one call site, so there is no second caller that could omit the register.
**Correctly fail-closed in practice; the fail-open branch is a library affordance, not a live hole.**

### 4.3 The real fail-open — **`frame` is not a mechanical prerequisite of anything. OWNER DECISION REQUIRED.**

`checkEnumerationAttribution` has exactly **one** caller tree-wide: `cpg_u1_data.mjs:220`, inside `cmdFrame`.
`loadFrame` has **seven** callers, and the other six never resolve attribution:

| file:line | command | attribution checked? |
|---|---|---|
| `cpg_u1_data.mjs:206` | `frame` | **yes** (`:220`) |
| `cpg_u1_data.mjs:365` | `commitment-payload --stage development` | no |
| `cpg_u1_data.mjs:435` | `draw-development` | no |
| `cpg_u1_data.mjs:490` | `heldOutInputs` → `size`, `pool-check`, `draw-held-out` | no |
| `cpg_u1_data.mjs:655` | `check-frame-sufficiency` | no |
| `cpg_u1_data.mjs:762` | `authorize-execution` | no |
| `cpg_u1_data.mjs:810` | `harnessContext` → `harness-pilot`, `harness-held-out` | no |

`--personnel` appears at only three CLI sites (`cpg_u1_data.mjs:220` `frame`, `:751` `check-personnel`,
`:984` `rater-assignment-fingerprint`); none of the six is one of them.

**What that means.** `refuseMalformed` runs in all six (`cpg_u1_data.mjs:366, 436, 491, 656, 763, 811`), and
`checkFrameRow` requires a non-blank `enumerated_by` (`lib/schema.mjs:124`) — so a **blank** value is refused
everywhere. But an **unregistered, wrong-role or fabricated** `enumerated_by` is refused **only if the
operator chose to run `frame --personnel`**. An operator who skips step 3 can take a frame naming
`'whoever-we-liked'` straight to `commitment-payload --stage development` and commit it on-chain. Nothing
refuses, and no artefact records the omission.

**Why this is structural, not cosmetic.** `cmdFrame` writes **no output file** — `cpg_u1_data.mjs:205-225`
only `console.log`s, ending at `:223`. There is no `writeOnce`, so there is no artefact that attests the
attribution check ran, and therefore nothing downstream *could* require it. Two contrasts in the same
codebase show this is a deviation from the tree's own pattern:

- **`scan` is mechanically bound.** It writes an artefact, and `contamination()` refuses a stale one:
  `cpg_u1_data.mjs:112` — `if (scan.frame_hash !== frameHash) fail('scan was produced for a different frame
  (frame_hash mismatch) — re-scan the exact frame')`. Every draw path needs `--scan`
  (`cpg_u1_data.mjs:109`), so scanning *this exact frame* is unskippable.
- **The rater assignment is mechanically bound.** `rater-assignment-fingerprint` emits a fingerprint
  (`cpg_u1_data.mjs:986`) that is embedded in each rater sheet (`lib/ratings.mjs:64`) and enforced downstream:
  `cpg_u1_data.mjs:1022` — `if (sheet.rated_by !== person || sheet.assignment_fingerprint !== fp) fail(…)`,
  guarded by mutants M310 and M351 (`test/mutate.mjs:347, 392`).

Enumeration attribution — which `CPG_U1_PROTOCOL_004.md:982` (limitation §20.18) names as the **sole**
guarantee of frame independence ("Cryptographic sampling integrity … is **not** independent candidate
selection … the latter rests on enumerator independence only") — is the one check of the three with **no
artefact and no downstream binding**.

**Summary verdict.** The *check* fails closed; the *pipeline* fails open. The documented pipeline does order
`frame` at step 3 before `commitment-payload` at step 4 (`README.md:41-42`, and `README.md:60` lists
`3b frame --personnel`), so a compliant operator is safe — but compliance is procedural, exactly the kind of
reliance the rest of this tree mechanises away. No mutant can detect this: a mutation suite cannot test a
call that was never written.

---

## 5. Hash and seal participation

**VERIFIED — `enumerated_by` participates in `frame_hash`, and `frame_hash` is committed on-chain. Changing a
person's id changes a committed hash.**

The chain, link by link:

1. **`enumerated_by` is a FRAME_COLUMN** — `lib/schema.mjs:32`, one of 22.
2. **`frame_hash` covers every column.** `cpg_u1_data.mjs:104` —
   `frameHash: hashRecords(frame, 'candidate_id')`; `lib/canonical.mjs:21` → `:16-19` `canonicalRecords`
   → `:7-13` `canonicalJson`, which serialises `Object.keys(value).sort()`, i.e. **all** keys, with no field
   allow-list anywhere. Asserted at `test/selftest.mjs:914`: "`frame_hash` already binds enumeration
   attribution: `enumerated_by` is a FRAME_COLUMN and re-attribution changes `frame_hash`" — the test
   re-attributes one row and checks the two hashes differ.
3. **`frame_hash` is a committed payload key** — `lib/commitment.mjs:11-12` `PAYLOAD_KEYS` includes
   `frame_hash`; `checkPayload` requires it 64-hex (`lib/commitment.mjs:31-32`); `sameKeys`
   (`:18-19, :24`) makes the key set **exact**, so nothing can be added or dropped.
4. **The payload digest goes into the Bitcoin OP_RETURN** — `cpg_u1_data.mjs:371-373` builds the development
   payload with `frame_hash: frameHash`; `:390-392` prints `payload_digest` and the exact OP_RETURN script.
5. **Downstream everything re-checks it.** `cpg_u1_data.mjs:441, :529`
   (`VERIFY_ABORT_HASH_MISMATCH`), `:497` (`FRAME_CHANGED`, held-out ≠ development), `:765`
   (`FRAME_CHANGED: supplied frame is not the sealed frame`), `lib/harness.mjs:50, :156`
   (`FRAME_MISMATCH`), `lib/execution.mjs:45-46`, `lib/evaluation.mjs:117` (`WRONG_FRAME`), `:218`, and
   `lib/sampling.mjs:151` → `STAGE_VOID_BINDING_MISMATCH`.
6. **The seal binds it too** — `cpg_u1_data.mjs:632-633` record `development.frame_hash` and
   `held_out.frame_hash`; `:641` `seal.seal_hash = sha256(canonicalJson(seal))`.
7. **The append-only proof binds it a second way** — `lib/commitment.mjs:15, :45-47, :69`
   (`development_frame_hash`, `held_out_frame_hash`, `proof`), rebuilt and checked at
   `cpg_u1_data.mjs:496, :535`.

**Concrete consequence.** Re-attributing a single row from Enumerator A to Enumerator B after the development
commitment changes `frame_hash`, so: `commitment-payload --stage held-out` fails
(`cpg_u1_data.mjs:497`), `authorize-execution` fails (`:765`), the harness refuses
(`lib/harness.mjs:50`), and a held-out commitment carrying the new hash returns
`STAGE_VOID_BINDING_MISMATCH` (`lib/sampling.mjs:151`). **Personnel attribution is immutable from the
development commitment onward.**

The evidence bundle (`lib/evidenceBundle.mjs`) carries no personnel field of its own — grep for
`frame`/`FRAME` in that file returns nothing. It carries the committed payloads, so it inherits the binding
transitively rather than duplicating it. Correct, and worth stating so the binding is not double-counted.

---

## 6. The `personnel.mjs:32` masking question

**VERIFIED — the masking is real, it loses diagnostics, and it CANNOT let a bad `enumerated_by` through.**

```
lib/personnel.mjs:32    if (!PERSON.test(a.person_id ?? '')) { errors.push(`${where}: person_id missing or malformed`); continue; }
```

The `continue` skips, for that one assignment only, the five checks at `lib/personnel.mjs:33-39`: operator
collision, cross-role collision (`holder`), all seven `DECLARATION_KEYS` must be `'no'`,
`study_fee_agreement_sha256` shape, and `organisation_confirmation_sha256` presence.

**Why it still fails closed:** line 32 itself pushes an error, and `checkEnumerationAttribution` propagates
**every** register error into its own return value —

```
lib/enumeration.mjs:34    const reg = checkPersonnelRegister(personnel);
lib/enumeration.mjs:35    errors.push(...reg.errors.map((e) => `personnel register: ${e}`));
```

— and `cpg_u1_data.mjs:222` fails on any non-empty result. Probe results (scratch copy of `lib/`,
read-only):

| probe | register mutation | frame row | errors returned |
|---|---|---|---|
| T1 | enumerator `person_id = 'BAD\|ID'` | `'BAD\|ID'` | 1 — `personnel register: assignment 0 (enumerator): person_id missing or malformed` |
| T2 | same **plus** `ran_or_saw_cpg_output = 'yes'` **plus** `organisation_confirmation_sha256` deleted | `'BAD\|ID'` | **1** — only the malformed-id error; the other two are masked |
| T3 | `person_id` deleted | `'undefined'` | 2 — malformed id, **and** "not an eligible enumerator … the register holds nobody" |
| T4 | operator `=` enumerator, both `'BAD\|ID'` | `'BAD\|ID'` | 2 — operator malformed, assignment malformed; **ROLE COLLISION masked** |
| T5 | operator `=` enumerator, well-formed `'OP-1'` | `'OP-1'` | 1 — `ROLE COLLISION — the operator may hold no independent role` (not masked) |
| T6 | `person_id` = 65 chars (over `PERSON` max) | same 65 chars | 1 — malformed id |

Every case is refused. **Answer to the directive's question: the masking cannot let a bad `enumerated_by`
through.**

Two things the probe did reveal, both worth recording:

**(a) Diagnostic loss — OWNER DECISION REQUIRED.** In T2 a register whose enumerator is **not independent**
(`ran_or_saw_cpg_output = 'yes'`, i.e. a §4A.1 disqualification) *and* has no organisation confirmation
reports **one** error about id formatting and says nothing about independence. The register is refused, so
nothing unsafe happens — but an operator reading the output would fix the id typo, re-run, and only then
discover the disqualification. The same masking hides `ROLE COLLISION` in T4. `test/mutate.mjs:231` (M176)
mutates the role-count line but no mutant targets the `continue`, and a mutant could not detect diagnostic
loss anyway, since the register is refused either way. Cost to fix: replace `continue` with a flag so the
remaining checks still run — a **one-line change to `lib/personnel.mjs`**, which per `lib/aggregate.mjs:8-23`
moves the tooling aggregate. Not proposed.

**(b) A one-link coupling — OWNER DECISION REQUIRED.** In T1/T2 the refusal came **solely** from the
register-structure error. The per-row membership check did **not** fire, because `registeredEnumerators`
(`lib/enumeration.mjs:15-17`) maps `a.person_id` **without applying `PERSON`**, so `eligible` legitimately
contained the malformed `'BAD|ID'` and the row "matched". The malformed value is thus accepted *as an
attribution* and rejected only *as a register entry*. `lib/enumeration.mjs:35` is the single line holding
this closed. It is mutation-guarded — `test/mutate.mjs:473` (M425) deletes exactly that line — so the
protection is certified. But the design would be more robust if `registeredEnumerators` filtered on `PERSON`,
or if `enumerated_by` were shape-checked independently. Recording as a latent coupling, **not** a live defect.

T3 also shows `registeredEnumerators` can return `[null]`: `new Set([null]).size === 1`, so the A≠B collision
check (`lib/enumeration.mjs:42`) does not fire, and `[null].join(',')` renders as "the register holds
nobody". Harmless here — the malformed-id error refuses anyway — and consistent with (b).

---

## 7. Joint-frame taint: either enumerator's false §4A.1 declaration taints the whole frame

**VERIFIED — it holds in the code as written, by two independent mechanisms.**

**Mechanism 1 — register errors are global, not per-row.** A §4A.1 violation by *either* enumerator is a
`checkPersonnelRegister` error (`lib/personnel.mjs:37`), propagated unconditionally at
`lib/enumeration.mjs:35`, and `cpg_u1_data.mjs:222` fails the **entire** `frame` command. Nothing scopes a
register error to the rows that person enumerated. Asserted at `test/selftest.mjs:892-893`: setting
`assignments[0].declaration.ran_or_saw_cpg_output = 'yes'` refuses rows attributed to A; by symmetry
(`test/selftest.mjs:884`, which registers B via `withEnumB()`) the same holds for B. Mutation-guarded by
M425 (`test/mutate.mjs:473`).

**Mechanism 2 — `frame_hash` is indivisible.** `hashRecords(frame, 'candidate_id')`
(`cpg_u1_data.mjs:104`) hashes **all** rows into **one** digest. There is no per-enumerator subset hash,
no grouping by `enumerated_by`, and no partition anywhere in the tree — the exhaustive `enumerated_by` grep
(22 hits, enumerated in the Method note above) contains no `group`, `partition`, `filter` or `reduce` over the field. So there
is no artefact that could represent "the A-rows of this frame". Since `frame_hash` is what the OP_RETURN
commits to (`lib/commitment.mjs:11-12`; `cpg_u1_data.mjs:372`), **excising B's rows changes `frame_hash`**
and therefore breaks the commitment (`cpg_u1_data.mjs:497, :765`; `lib/sampling.mjs:151`).

**Combined consequence — confirmed.** If Enumerator B's §4A.1 declaration is later found false:

- *before* the development commitment → the whole frame is refused; a new frame must be enumerated (A's rows
  may be reused as data, but the frame identity changes, so `frame_hash` changes);
- *after* the development commitment → the frame cannot be repaired at all. There is no partial-invalidation
  path. `lib/analysis.mjs:127` routes a declared protocol violation to `AD-7 = VOID`, and
  `lib/analysis.mjs:123-128` then reports **no endpoint**.

This is the already-established consequence of the 8-person model's joint frame, and it is faithfully
implemented. It is also the direct price of the design choice recorded in §8.

---

## 8. `SAMPLING_FIELDS` vs. `frame_hash` — is there a contradiction?

**VERIFIED — NO contradiction. The two facts hold at two different layers, and the layering is deliberate and
consistent. One under-documented residual follows.**

The two facts, each verified:

- **F1.** `SAMPLING_FIELDS = ['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256', 'network',
  'outpoints', 'checkpoint', 'parameters']` (`lib/registration.mjs:119`). No personnel field, and **no
  `frame_hash`**. `samplingView` (`:120`) is the comparison basis for `checkAuthority`
  (`:127-143`): a registry copy differing in these fields is non-authoritative (`:138`); a duplicate
  registration differing in these fields is `study VOID` (`:141`). So **no roster change can void a
  registration** — confirmed.
- **F2.** `enumerated_by` is inside `frame_hash` (§5, step 2), and `frame_hash` is a committed
  `PAYLOAD_KEYS` field (`lib/commitment.mjs:11-12`) in the on-chain OP_RETURN
  (`cpg_u1_data.mjs:372`). So **changing a person's id does change a committed hash** — confirmed.

**Why they do not collide.** The registration and the commitment are ordered, disjoint artefacts:

| | registration | development commitment |
|---|---|---|
| when | `README.md:38-39`, step 2 — before the frame exists | `README.md:42`, step 4 — after `frame`, step 3 |
| binds | protocol, tooling, registry, network, outpoints, checkpoint, parameters | +`frame_hash`, +`scan_sha256` |
| enforced by | `checkAuthority`, `lib/registration.mjs:127-143` | `checkPayload` + chain, `lib/commitment.mjs:22-47` |

At registration time the frame does not yet exist, so `frame_hash` **cannot** be a registration field. F1's
property is therefore not a concession to personnel churn — it is a consequence of ordering. The frame, and
with it the roster attribution, is frozen one layer later, by a mechanism designed to be unamendable. The
design reads as: *who you registered as* is amendable up to the commitment; *who enumerated this frame* is
not, from the commitment onward. `cpg_u1_data.mjs:497` states exactly this intent ("the single frame is
frozen before the development commitment").

Crucially, **the property F1 protects is preserved.** A roster change:
- does **not** change `samplingView`, so the registration stays authoritative
  (`lib/registration.mjs:136, 138`) and no `study VOID` fires (`:141`);
- **does** change `frame_hash`, so a *post-commitment* re-attribution is refused as `FRAME_CHANGED`
  (`cpg_u1_data.mjs:497, :765`) rather than voiding anything.

A refusal is not a void. The stated rationale — "no roster change can void a registration" — survives intact.
**Both facts are true; they are not in tension. NO CONTRADICTION.**

### The residual — OWNER DECISION REQUIRED

Two things are worth the owner's explicit acknowledgement, because the absence of a contradiction is not the
absence of a consequence:

1. **The "no roster change can void a registration" property does not extend past step 3, and nothing says
   so.** Between registration and the development commitment, a roster correction is free. After the
   commitment it is impossible — not void, but unamendable, which for an in-flight study is functionally
   just as terminal (§7). Anyone reading F1 alone could reasonably conclude roster changes are cheap
   throughout. `README.md:202` states `enumerated_by` is inside `frame_hash`, and
   `cpg_u1_data.mjs:217-219` and `lib/enumeration.mjs:8-9` note it too — but no document states the
   *deadline*. Recommended (documentation only, no code): record that personnel attribution is amendable
   until the development commitment and immutable after it.
2. **Nothing in the registration commits to the roster at all** — not the register hash, not the enumerator
   count, not a fingerprint. Contrast `rater-assignment-fingerprint` (`cpg_u1_data.mjs:986`), which exists
   precisely so the rater roster is publicly pinned *before* the held-out commitment
   (`cpg_u1_data.mjs:987`). There is no enumerator analogue. Combined with §4.3 (no artefact proves the
   attribution check ran), the result is that **an outsider following `CPG_U1_PROTOCOL_004.md:991`
   (§21, the outsider verification procedure) cannot confirm that the frame was attributed to registered
   independent enumerators at all** — they can only confirm that the frame CSV they were handed hashes to
   the committed `frame_hash`. Under limitation §20.18 (`CPG_U1_PROTOCOL_004.md:982`), enumerator
   independence is the *sole* basis for frame independence, so this is the least externally verifiable link
   in the chain. Closing it would mean publishing an enumerator-roster fingerprint before the development
   commitment — a change to `cpg_u1_data.mjs` and `lib/`, hence a new tooling aggregate
   (`lib/aggregate.mjs:8-23`). **Not proposed.**

---

## Not executed

- **The 404-mutant certification suite and the full selftest were NOT run** (firewall: a suite is running
  against `C:/tmp/dt009-merge/tooling`). All verdicts above are static, or rest on the read-only scratch
  probe of §4.1/§6.
- **NOT EXECUTED — that mutants M424–M430 are in fact killed by the present selftest.** Their existence and
  targets are verified by reading `test/mutate.mjs:471-478`; their kill status is a suite result.
  **What would verify it:** the 404-mutant run already in progress — read its report for M424–M430 rather
  than re-running anything.
- **NOT EXECUTED — an end-to-end demonstration of the §4.3 bypass**, i.e. that
  `commitment-payload --stage development` accepts a frame carrying an unregistered `enumerated_by` when
  `frame` was never run. The static argument is complete (one caller of
  `checkEnumerationAttribution` at `cpg_u1_data.mjs:220`; `--personnel` absent from
  `cmdCommitmentPayload`; `refuseMalformed` checks only non-blankness via `lib/schema.mjs:124`).
  **What would verify it:** on a scratch copy, take the existing synthetic frame fixture, set every
  `enumerated_by` to `'NOT-IN-REGISTER'`, and run `node cpg_u1_data.mjs commitment-payload --stage
  development …` with a synthetic registration and scan. Expected: it succeeds and prints a payload digest.
  Cost: one command, no mutation, no selftest. Deferred to stay inside the CPU firewall.
- **NOT EXECUTED — whether a CLI-level mutant of `cpg_u1_data.mjs:222` (`if (attribution.length) fail(` →
  `if (false) fail(`) would be killed.** No such mutant exists in `test/mutate.mjs`, but
  `test/selftest.mjs:1334` asserts `ENUMERATION_ATTRIBUTION_REFUSED` through the real CLI, so it very likely
  would be. Adding the mutant would make the enforcement line explicitly certified — and would move the
  aggregate (`lib/aggregate.mjs:8-23`). Not proposed.
