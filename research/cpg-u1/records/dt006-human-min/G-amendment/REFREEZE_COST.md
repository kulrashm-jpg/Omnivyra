# RE-FREEZE COST — what changes identity if the protocol file changes

**CLASSIFICATION: MEASUREMENT. Nothing here is frozen, registered or applied.**
`C:/tmp/dt002` was **never written to**. Every experiment ran on a copy of the tooling in the session
scratchpad (`.../scratchpad/G/tooling`) which reproduced the frozen aggregate byte-for-byte before any edit.
No network call, no credential, no commit.

---

## 1. Baselines, recomputed in this task

| Identity | Value | Status |
|---|---|---|
| `protocol_sha256` of `research/cpg-u1/CPG_U1_PROTOCOL_004.md` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | **VERIFIED** — matches the value in the task brief |
| Tooling aggregate, `C:/tmp/dt002/research/cpg-u1/tooling`, 593 files | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | **VERIFIED** |
| Scratch copy of the tooling, before any edit, 593 files | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | **VERIFIED — the copy is a faithful instrument** |
| Protocol file line count | 1098 | — |

```
$ sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md
c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719 *research/cpg-u1/CPG_U1_PROTOCOL_004.md

$ node -e "import('./lib/aggregate.mjs').then(m=>{const r=m.toolingManifest(process.cwd());console.log('files',r.files.length,'aggregate',r.aggregate)})"
files 593 aggregate f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
```

Baseline verifier behaviour, real output:

```
$ node cpg_u1_data.mjs verify-protocol --protocol .../CPG_U1_PROTOCOL_004.md
protocol states every pinned parameter; protocol_sha256: c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
exit=0

$ node cpg_u1_data.mjs registration-fields --protocol .../CPG_U1_PROTOCOL_004.md --registry rules/development_only_registry.json --out reg_baseline.json
registration template written: identities, outpoints, checkpoint and registry-issued fields are UNASSIGNED
tooling_aggregate_sha256: f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
exit=0
  "protocol_version": "CPG_U1_PROTOCOL_004",
  "protocol_sha256": "c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719",
  "tooling_aggregate_sha256": "f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd",
```

Baseline selftest, with the frozen resolver clone (`C:/tmp/cpg049_integration/treatment` at
`f01a7eb4199be4e04d4fee7fc0116303949dc553`, clean):

```
$ CPG_U1_RESOLVER_CLONE=/c/tmp/cpg049_integration/treatment node test/selftest.mjs
evaluation tree: declared commit f01a7eb4199be4e04d4fee7fc0116303949dc553, tree 3b4811fc88e9fbb64ee42c37c4aacca2e76c67af, aggregate ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5 (11552 files) — verified
selftest: 1022 passed, 0 failed
exit=0
```

---

## 2. Every pin of the version, the protocol sha, a role name or an adjudicator

Searched the whole tooling tree (`grep -rn`, `node_modules` excluded).

### 2.1 The protocol SHA is pinned NOWHERE in the tooling — verified

`grep -rn 'c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719'` over the tooling tree returns
**zero** hits. The protocol sha is computed at run time from the `--protocol` file
(`cpg_u1_data.mjs:177`, `:292`) and stored only in the registration record and in both commitment payloads.
**Consequence:** editing the protocol text alone does not move the aggregate. This refines the recorded
dt004 finding; see §6.

### 2.2 `PROTOCOL_VERSION` — one functional pin, one fixture, 28 documentation mentions

| File:line | Kind | Text |
|---|---|---|
| `lib/registration.mjs:9` | **THE PIN** | `export const PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_004';` |
| `lib/registration.mjs:37` | derived | `protocol_version: PROTOCOL_VERSION,` (registration template field) |
| `lib/registration.mjs:55` | derived, string-embedded | `verification_procedure: ${PROTOCOL_VERSION} §21 (cpg_u1_data.mjs verify-sampling)` |
| `lib/registration.mjs:77` | derived, enforced | `if (reg.protocol_version !== PROTOCOL_VERSION) errors.push(...)` |
| `cpg_u1_data.mjs:283` | **MARKER PIN** | `const PROTOCOL_MARKERS = [PROTOCOL_VERSION, STUDY_ID, 'D = 6', ...]` |
| `cpg_u1_data.mjs:289` | enforced | `const missing = PROTOCOL_MARKERS.filter((m) => !text.includes(m));` |
| `test/selftest.mjs:1422` | **FIXTURE PIN** | literal `'CPG_U1_PROTOCOL_004'` written into `protocol_markers.md` |
| `test/selftest.mjs:1217` | **FILENAME PIN** | `join(HERE, '..', '..', 'CPG_U1_PROTOCOL_004.md')` |
| `rules/analysis_decisions.json:3` | data | `"governed_by": "CPG_U1_PROTOCOL_004.md"` — inside the aggregate, so editing it moves the aggregate |
| `README.md:3, 121, 122, 124` | documentation | usage examples naming the file |
| `cpg_u1_data.mjs:2`, `harness/cpgAdapter.ts`, and header comments in `lib/aggregate.mjs`, `analysis.mjs`, `archive.mjs`, `assignment.mjs`, `bitcoin.mjs`, `commitment.mjs`, `drand.mjs`, `evaluation.mjs`, `evaluationTree.mjs`, `eventlog.mjs`, `evidenceBundle.mjs`, `execution.mjs`, `frame.mjs`, `harness.mjs`, `packets.mjs`, `personnel.mjs`, `raterOrder.mjs`, `raterPackets.mjs`, `ratings.mjs`, `registration.mjs`, `sampling.mjs` | documentation | `// ... (CPG_U1_PROTOCOL_004 §nn)` header lines |

**Total: 30 occurrences across 26 files.** Two are functionally load-bearing outside the pin itself
(`test/selftest.mjs:1422`, `:1217`); one is data (`rules/analysis_decisions.json:3`); the rest are comments —
but **every file whose bytes change contributes a changed line to the 593-line manifest text**, so a rename
discipline applied to all 26 files moves the aggregate exactly as much as changing one of them.

### 2.3 The full `PROTOCOL_MARKERS` set (`cpg_u1_data.mjs:283-285`) — protocol text pinned by the tooling

```js
const PROTOCOL_MARKERS = [PROTOCOL_VERSION, STUDY_ID, 'D = 6', 'K = 12', '180 days', 'Δ = 3 h', '30 days', QUICKNET.hash,
  'bls-unchained-g1-rfc9380', SEED_DOMAIN, 'cpg-u1-commitment-digest/v1', PAYLOAD_SCHEMA, 'OSF Registries', 'STUDY_OPERATOR', 'UNASSIGNED',
  'cpg-u1-rater-order/v1', 'cpg-u1-execution-authorization/v1', 'E ≥ 126 / 52 / 32', CITED_URL_RULE, EVALUATION_TREE_DOMAIN];
```

Twenty strings the amended protocol must still contain verbatim. `verify-protocol` fails on any one missing.
**None of them is a role name or a headcount**, so the two-human amendment does not have to break any marker —
provided it leaves `cpg-u1-rater-order/v1` (C18) and `E ≥ 126 / 52 / 32` alone.

### 2.4 Role names and adjudicators pinned in code

| File:line | Pin |
|---|---|
| `lib/personnel.mjs:6` | `INDEPENDENT_ROLES = Object.freeze(['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator', 'rater-1', 'rater-2', 'rating-adjudicator'])` — the **seven-role** list |
| `lib/personnel.mjs:23-25` | every role must be filled, else a BLOCKED |
| `lib/personnel.mjs:26` | non-enumerator roles must be held by exactly one person |
| `lib/personnel.mjs:33` | operator may hold no independent role |
| `lib/personnel.mjs:34` | `ROLE COLLISION — ... already holds ...; all independent roles are mutually exclusive` |
| `lib/personnel.mjs:2` | comment: "seven roles mutually exclusive" |
| `lib/assignment.mjs:13` | `ASSIGNED_LABELS = Object.freeze(['rater-1', 'rater-2', 'rating-adjudicator'])` |
| `lib/assignment.mjs:33` | `ROLE COLLISION: rater-1, rater-2 and the rating adjudicator must be three different people (§4A.3)` |
| `lib/raterOrder.mjs:9, 11` | `ORDER_LABELS` (4) and `ASSIGNMENT_LABELS` (2) — include both adjudicators |
| `lib/raterOrder.mjs:49, 51` | `authorIsRecord1`, `rater1IsLabelA` |
| `lib/raterPackets.mjs:17` | `RATER_LABELS = Object.freeze(['rater-1', 'rater-2'])` |
| `lib/reconcile.mjs:52` | `author and confirmer must be different people (§9.4)` |
| `lib/reconcile.mjs:58` | `author and confirmer disagree (...) — independent adjudication required` |
| `lib/reconcile.mjs:59-60` | `adjudicator must differ from both author and confirmer` |
| `lib/reconcile.mjs:56` | `adjudication supplied for an AGREED record — an adjudicator may not override agreement` |
| `lib/ratings.mjs:97` | `the two sheets were rated by the same person — ≥ 2 independent raters are required` |
| `lib/ratings.mjs:136` | `RATING_ADJUDICATION_MISSING: <n> disagreement(s) need the rating adjudicator's resolution` — **no fall-through** |
| `lib/packets.mjs:41, 86` | packets built under labels `reference-adjudicator`, `rating-adjudicator` |
| `lib/analysis.mjs:181, 199-200` | α over exactly `[rater_1_label, rater_2_label]`; `'2 raters'` in the detail string |
| `cpg_u1_data.mjs:641` | `--label must be one of rater-1\|rater-2\|rating-adjudicator` |
| `cpg_u1_data.mjs:717` | `personnel register: seven independent roles filled, ...` |
| `cpg_u1_data.mjs:953, 977, 986, 1005, 1029` | `rater-1` / `rater-2` / `rating-adjudicator` lookups in the rating CLI path |
| `test/selftest.mjs:817, 830, 831, 751-765, 799, 1010-1031, 1132-1138, 1567-1583` | role and label assertions |
| `test/mutate.mjs:198, 205` | mutants M148, M154 on the assignment labels |

**Every one of these files is inside the aggregate.** A two-human amendment touches, at minimum:
`lib/personnel.mjs`, `lib/assignment.mjs`, `lib/reconcile.mjs`, `lib/ratings.mjs`, `lib/packets.mjs`,
`lib/analysis.mjs`, `lib/registration.mjs`, `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs`,
`rules/analysis_decisions.json` (a new decision for the resolution rule) and `README.md` — **twelve files**.

---

## 3. The complete identity closure — what changes if the protocol file changes

| Identity | Moves? | Mechanism |
|---|---|---|
| `protocol_sha256` | **YES, always** | It is the file hash |
| `protocol_version` string | **YES if the version is renamed**, which §6.2 (line 446) and §7.1 (line 534) require for a substantive change | "except by a new protocol version **as a new file**" / "A study of a later resolver is a new protocol version and a new registration" |
| Tooling aggregate | **YES** — twice over | (a) the renamed version literal at `lib/registration.mjs:9`; (b) the twelve substantive files of §2.4 |
| `registry_sha256` | **NO** | No registry change is implied |
| Registration record `protocol_version` | YES | `lib/registration.mjs:37`, enforced at `:77` |
| Registration record `protocol_sha256`, `tooling_aggregate_sha256` | YES | `registrationTemplate()` computes both |
| Registration record `verification_procedure` | YES (string embeds the version) | `lib/registration.mjs:55` |
| **Development commitment payload digest** | YES | `PAYLOAD_KEYS` (`lib/commitment.mjs:11`) contains `protocol_sha256` and `tooling_aggregate_sha256`; the digest is what goes in the OP_RETURN |
| **Held-out commitment payload digest** | YES | Same, plus its `binding` names the development digest |
| `verify-protocol` | **FAILS** until the tooling and the file agree | `PROTOCOL_MARKERS[0]` |
| `verify-registration` | **FAILS** on `protocol_version` | `lib/registration.mjs:77` |
| `verify-sampling`, `derive-seed`, `draw-development`, `draw-held-out`, `commitment-payload`, `check-funding-prerequisites` | **ALL FAIL** post-registration | `cpg_u1_data.mjs:177-179` recomputes both hashes on every sampling command |
| `harness-*` (`verify-evaluation` path) | **ALL FAIL** post-registration | `lib/harness.mjs:43-44`: `PROTOCOL_MISMATCH`, `TOOLING_MISMATCH` |
| Registration **authority** | **STUDY VOID** if a second registration is filed to fix it | `SAMPLING_FIELDS` (`lib/registration.mjs:119`) contains both `protocol_sha256` and `tooling_aggregate_sha256`; `checkAuthority` makes a differing duplicate a VOID and the earliest registration authoritative |
| The five prior dt004 documents quoting `f7699f05...` | must be rebuilt | `REGISTRATION_PACKAGE.md`, `OPERATOR_CHECKLIST.md`, `REMAINING_FIELDS.md`, `HEADER_AND_RELAY_SOURCES.md`, `BITCOIN_RANDOMNESS_RUNBOOK.md` (per DR-1 §229), plus `registration_record.DRAFT.json`, `DR1_...md` and `DR2_...md` |

---

## 4. The experiments — real commands, real exit codes, real hashes

### EXPERIMENT A — amend the protocol TEXT, keep the version literal

One comment line appended to a copy of the protocol; the tooling untouched.

```
$ sha256sum EXP_A_text_only.md
db612f04487366bdc0030068b22ffc9a562a26e6bc4b3f195271c428533995a3 *EXP_A_text_only.md

$ node cpg_u1_data.mjs verify-protocol --protocol .../EXP_A_text_only.md
protocol states every pinned parameter; protocol_sha256: db612f04487366bdc0030068b22ffc9a562a26e6bc4b3f195271c428533995a3
exit=0

$ node -e "...toolingManifest..."
aggregate unchanged? f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
```

**Result: ONE sha moves.** The aggregate does not. The protocol sha `c50fc680...` → `db612f04...`.

### EXPERIMENT B — rename the version in the protocol file, tooling untouched

```
$ sed 's/CPG_U1_PROTOCOL_004/CPG_U1_PROTOCOL_005/g' CPG_U1_PROTOCOL_004.md > EXP_B_v005.md
$ sha256sum EXP_B_v005.md
a6e4033335f66096217d20977941405ad45fedf5c45c2ee5a8c6ccdc161f0ef6 *EXP_B_v005.md

$ node cpg_u1_data.mjs verify-protocol --protocol .../EXP_B_v005.md
ERROR: protocol does not state: CPG_U1_PROTOCOL_004
exit=1

$ node cpg_u1_data.mjs verify-protocol --protocol .../EXP_A_text_only.md --registration reg_baseline.json
ERROR: VERIFY_ABORT_HASH_MISMATCH: protocol differs from the registered protocol_sha256
exit=1
```

**Result: a renamed protocol is REFUSED by the unchanged tooling.** This is the coupling that forces the
second sha.

### EXPERIMENT C — the minimal tooling change: one line, one file

```
$ sed -i "s/...PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_004';/...PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_005';/" lib/registration.mjs
$ sed -n '9p' lib/registration.mjs
export const PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_005';

$ node -e "...toolingManifest..."
files 593 aggregate ca976f1a0d0b66ac377d26dd8bbf33f65b79ce6e6e4aa59d2241b6ed8b9fa9fe
```

**One character class changed in one line of one file moves the aggregate:**
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` →
`ca976f1a0d0b66ac377d26dd8bbf33f65b79ce6e6e4aa59d2241b6ed8b9fa9fe`. There is no such thing as a small change.

```
$ node cpg_u1_data.mjs verify-protocol --protocol .../EXP_B_v005.md
protocol states every pinned parameter; protocol_sha256: a6e4033335f66096217d20977941405ad45fedf5c45c2ee5a8c6ccdc161f0ef6
exit=0

$ node cpg_u1_data.mjs verify-protocol --protocol .../CPG_U1_PROTOCOL_004.md
ERROR: protocol does not state: CPG_U1_PROTOCOL_005
exit=1
```

The pin is **symmetric**: after the tooling moves, the frozen protocol-004 file is itself refused.

```
$ node cpg_u1_data.mjs verify-registration --registration reg_baseline.json --registry rules/development_only_registry.json --identity-registrations /dev/null
  ERROR   protocol_version must be CPG_U1_PROTOCOL_005
  BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)
  BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)
  BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)
  BLOCKED Persistent identifier is UNASSIGNED (persistent_identifier.value)
  BLOCKED registration_id is UNASSIGNED (issued by the registry at registration)
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
  BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)
ERROR: registration record refused (1 error(s))
exit=1
```

Note which line is an **ERROR** and which are **BLOCKED**: an unassigned prerequisite is a wait
(`EXIT.BLOCKED = 4`); a stale `protocol_version` is a refusal (`EXIT.REFUSED = 1`). Exit codes are
`{ REFUSED: 1, POOL: 2, HALT: 3, BLOCKED: 4, WAITING: 5, VOID: 6 }` (`cpg_u1_data.mjs:52`).

### EXPERIMENT C, selftest — what actually broke

```
$ CPG_U1_RESOLVER_CLONE=/c/tmp/cpg049_integration/treatment node test/selftest.mjs
selftest: 1021 passed, 2 failed
  FAIL: exit 1 != 0: verify-protocol :: ERROR: protocol does not state: CPG_U1_PROTOCOL_005

  FAIL: CLI verify-protocol accepts a file stating every pinned parameter
exit=1
```

**Two failures, both from one cause I had not predicted from the pin alone:** `test/selftest.mjs:1422`
hand-writes a `protocol_markers.md` fixture containing the literal `'CPG_U1_PROTOCOL_004'`. The test that
asserts "`verify-protocol` accepts a file stating every pinned parameter" therefore fails, and its
`ok(run([...]))` helper also emits a separate exit-code failure line. **The pin is duplicated in the test
fixture, so the version cannot be changed in one place.**

### EXPERIMENT C2 — the functional minimum

Three edits: `lib/registration.mjs:9`, `test/selftest.mjs:1422` (fixture literal),
`test/selftest.mjs:1217` (the real-protocol filename) — two files.

```
$ node -e "...toolingManifest..."
d4cb0522913abfa81ba9097b0ea3bb3c022f1eeb7da2c1ffbac8c319314eb243

$ CPG_U1_RESOLVER_CLONE=/c/tmp/cpg049_integration/treatment node test/selftest.mjs
evaluation tree: declared commit f01a7eb4199be4e04d4fee7fc0116303949dc553, tree 3b4811fc88e9fbb64ee42c37c4aacca2e76c67af, aggregate ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5 (11552 files) — verified
selftest: 1022 passed, 0 failed
exit=0
```

**Measured aggregate ladder for a pure version rename:**

| State | Files changed | Aggregate |
|---|--:|---|
| frozen | 0 | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` |
| the pin only (selftest RED) | 1 | `ca976f1a0d0b66ac377d26dd8bbf33f65b79ce6e6e4aa59d2241b6ed8b9fa9fe` |
| functional minimum (selftest GREEN, 1022/0) | 2 | `d4cb0522913abfa81ba9097b0ea3bb3c022f1eeb7da2c1ffbac8c319314eb243` |

The two-human amendment of §2.4 would move it a third time, to a value not computed here because the
amendment is a draft and was not implemented.

---

## 5. What the tooling does to a two-human personnel register — real output

Best-case mapping (H-A: enumerator + reference-author + rater-1; H-B: reference-confirmer +
reference-adjudicator + rater-2; rating-adjudicator: H-A):

```
$ node cpg_u1_data.mjs check-personnel --personnel personnel_2human.json
  ERROR   assignment 1 (reference-author): ROLE COLLISION — H-A already holds enumerator; all independent roles are mutually exclusive
  ERROR   assignment 3 (reference-adjudicator): ROLE COLLISION — H-B already holds reference-confirmer; all independent roles are mutually exclusive
  ERROR   assignment 4 (rater-1): ROLE COLLISION — H-A already holds enumerator; all independent roles are mutually exclusive
  ERROR   assignment 5 (rater-2): ROLE COLLISION — H-B already holds reference-confirmer; all independent roles are mutually exclusive
  ERROR   assignment 6 (rating-adjudicator): ROLE COLLISION — H-A already holds enumerator; all independent roles are mutually exclusive
ERROR: personnel register refused (5 error(s))
exit=1
```

Adjudicator-less variant (the design this analysis actually proposes):

```
$ node cpg_u1_data.mjs check-personnel --personnel personnel_2human_no_adj.json
  ERROR   assignment 1 (reference-author): ROLE COLLISION — H-A already holds enumerator; all independent roles are mutually exclusive
  ERROR   assignment 3 (rater-1): ROLE COLLISION — H-A already holds enumerator; all independent roles are mutually exclusive
  ERROR   assignment 4 (rater-2): ROLE COLLISION — H-B already holds reference-confirmer; all independent roles are mutually exclusive
  BLOCKED role reference-adjudicator is UNFILLED
  BLOCKED role rating-adjudicator is UNFILLED
ERROR: personnel register refused (3 error(s))
exit=1
```

**Read the two line kinds carefully.** An unfilled role is `BLOCKED` — a wait state the protocol has an idiom
for. A fused role is an `ERROR` — a refusal the protocol has **no** idiom for. That asymmetry is the
mechanical evidence behind class-D rows D1–D4 and D7.

Reconciliation and rater assignment, exercised directly through the libraries:

```
--- 2 humans, adjudicator = the Confirmer (H-B) ---
[ "adjudication row 2 (SYN-0101|founded_year): decision must be one of AUTHOR|CONFIRMER|REFERENCE-CONFLICT",
  "adjudication row 2 (SYN-0101|founded_year): rationale is required",
  "SYN-0101|founded_year: adjudicator must differ from both author and confirmer", ... ]

--- 2 humans, NO adjudication row supplied at all ---
[ "SYN-0101|founded_year: author and confirmer disagree (STATED|1999 vs STATED|2001) — independent adjudication required", ... ]

--- rater assignment with only 2 humans for 3 labels ---
[ "ROLE COLLISION: rater-1, rater-2 and the rating adjudicator must be three different people (§4A.3)" ]
```

`lib/reconcile.mjs:58` proves the C5 finding directly: **a disagreement does not fall through to
`REFERENCE_CONFLICT`.** The disposition exists, but nothing routes to it without an adjudicator, so the
protocol text must say so.

For the rating side, `lib/ratings.mjs:135-136`:

```js
if (packet.items.length) {
  if (!resolution) throw new Error(`RATING_ADJUDICATION_MISSING: ${packet.items.length} disagreement(s) need the rating adjudicator's resolution`);
```

There is no fall-through **and no disposition to fall through to** — hence the asymmetry in C9.

---

## 6. Verdict on the recorded dt004 claim

> "changing the protocol file forces **two** SHAs to re-freeze (protocol sha + tooling aggregate) because the
> version is a pinned literal"

**CONFIRMED, with one refinement that matters operationally.**

- The protocol sha is **not** pinned in the tooling (§2.1), so a change to the protocol *text alone* moves
  **one** sha. Measured in Experiment A: aggregate unchanged.
- But §6.2 (line 446) permits a change to a rule "only ... by a new protocol version **as a new file**", and
  §7.1 (line 534) repeats it. A substantive amendment is therefore **necessarily** a version rename, and the
  rename moves `lib/registration.mjs:9`, hence the aggregate. Measured in Experiments B and C: two shas.
- Independently, the two-human amendment touches twelve tooling files (§2.4), so the aggregate would move
  **even if the version name were kept** — which it cannot be.

So: **two SHAs, always, for this amendment.** And the version literal is duplicated in `test/selftest.mjs`,
so it cannot be changed in one place (Experiment C, two real failures).

---

## 7. Interaction with DR-1 and DR-2 — the aggregate can move once or three times

| Pending decision | Protocol sha | Tooling aggregate | Source |
|---|---|---|---|
| **DR-1** option (a) accept as procedural | none | **none** | `DR1_DRAND_RELAY_FLOOR_MEMO.md` §215 |
| **DR-1** option (b) add a relay-count floor | none | **moves** — 5 files: `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `README.md`; mutation anchors 389 → 391 | DR-1 §229, §231 |
| **DR-2** option (a) register as-is, disclose | none | none | `DR2_CERTENV_WORDING_MEMO.md` §194 |
| **DR-2** option (b) new protocol version as a new file | **moves** | **moves iff the version literal is renamed** | DR-2 §226 |
| **Two-human amendment** (this analysis) | **moves** | **moves** — 12 files (§2.4) plus the version literal | measured here |

**Sequencing consequence.** DR-1(b), DR-2(b) and the two-human amendment all land on the *same* two
identities. Done together, the aggregate moves **once** and one full re-verification pays for all three.
Done separately, it moves **three** times and the full re-verification set is paid three times. DR-2(b)
already requires a new protocol file, which is exactly the vehicle a two-human version needs — so if the
owner is going to do both, doing them in one file is nearly free relative to doing either alone.

**And the window is finite.** DR-1 §243-245: after registration every sampling command recomputes the
aggregate and aborts (`cpg_u1_data.mjs:178-179`); re-registering to fix it is **study VOID** because both
hashes are in `SAMPLING_FIELDS` (`lib/registration.mjs:119, 140-145`); after the development commitment the
aggregate is on the Bitcoin blockchain inside the OP_RETURN digest (`lib/commitment.mjs:11`) and no lawful
edit exists. **Nothing is registered yet. This is the only window.**

---

## 8. Re-verification set a re-freeze forces (from DR-1 §231, unchanged by this analysis)

1. `CPG_U1_RESOLVER_CLONE=<clean clone at f01a7eb4...> node test/selftest.mjs` — must exit 0.
   Baseline measured here: **1022 passed, 0 failed, exit 0**.
2. `node test/mutate.mjs --anchors` — every anchor must occur exactly once; the anchor count is **389** at
   `f7699f05...` and rises with every new guard (DR-1(b) alone takes it to 391; a two-human amendment adds
   more).
3. The full mutation run, `CPG_U1_ADAPTER_CLONE=... CPG_U1_RESOLVER_CLONE=... node test/mutate.mjs --jobs 4` —
   every mutant KILLED. **NOT RUN IN THIS TASK** (expensive, and this is an analysis, not a re-freeze). Its
   cost is real and must not be discounted: new personnel/reconciliation guards are worthless unkilled.
4. `CPG_U1_RESOLVER_CLONE=... node test/adapter_conformance.mjs`. **NOT RUN IN THIS TASK.**
5. Recompute the aggregate and rebuild the identity table in the five dt004 documents that quote
   `f7699f05...`, plus `registration_record.DRAFT.json`, `DR1_...md` and `DR2_...md`.

## 9. Anything that broke unexpectedly

One thing, and it is worth recording: **the version literal is duplicated in the test fixture at
`test/selftest.mjs:1422`.** Changing only the declared pin at `lib/registration.mjs:9` leaves the instrument
RED (1021/2, exit 1) with a message — "protocol does not state: CPG_U1_PROTOCOL_005" — that reads like a
protocol defect when it is a test-fixture defect. An operator following a one-line-change instruction would
see a failure that points at the wrong file. Two files, not one, is the true functional minimum.

Nothing else broke. In particular the evaluation-tree verification, the Bitcoin/drand fixtures, the frame
sufficiency proof over all 4096 pilot outcomes, and the cited-URL and packet machinery were all indifferent to
the version rename — consistent with §7.1's statement (line 532) that the tooling identity and the resolver
identity are separate pins.
