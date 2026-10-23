# CPG-U1 — `verify-registration` REHEARSAL (dry-run only, DEEPTECH-PARALLEL-010 stream E)

**CLASSIFICATION: MEASUREMENT.** Every exit code below was read from `$?` **on its own line, immediately after
the command, with stdout and stderr redirected to separate files and no pipe anywhere between the command and
its status**. A pipe replaces the exit status with the last pipeline element's status and has misled a prior
session; that is why no `| head`, `| grep` or `| tee` appears between any command and its `rc=$?`. Counting was
done afterwards, from the saved files.

**Nothing was registered, submitted, published, broadcast, funded or committed.** The instrument
`C:/tmp/dt009-merge/tooling` was run **read-only** and nothing was written into it. The on-disk draft
`C:/tmp/dt004-operations/registration/registration_record.DRAFT.json` was **never modified**: sha256
`48f5621d305b0de2b766588b199e80e2263c22da75b36f36a103014abc8daba6` before the first command and identical after
the last. Each rehearsal variant is a **scratch copy** in the session scratchpad, outside every worktree.

## 0. Instrument identity at the moment of measurement

Recomputed with `toolingManifest()` (`lib/aggregate.mjs`) immediately **before** and **after** the runs, both
times identical:

```
594 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
```

So all measurements are against the **candidate** instrument (594 files), with the protocol at the integrated
location `C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md` (sha256 `c50fc680...00b719`) and the registry at
`tooling/rules/development_only_registry.json` (sha256 `a1392952...a70814`). The worktree's own 587-file
`research/cpg-u1/tooling` (`640510...`) was **not** read.

Exit codes, from `cpg_u1_data.mjs:52`: `{ REFUSED: 1, POOL: 2, HALT: 3, BLOCKED: 4, WAITING: 5, VOID: 6 }`.
`fail(msg, code = 1)` prints `ERROR: <msg>` to stderr and exits with `code`.

---

## 1. RUN 1 — the existing on-disk draft, unmodified

```
cd C:/tmp/dt009-merge/tooling
node cpg_u1_data.mjs verify-registration \
  --registration C:/tmp/dt004-operations/registration/registration_record.DRAFT.json \
  > <scratch>/run1.stdout.txt 2> <scratch>/run1.stderr.txt
rc=$?
```

### REAL EXIT CODE: **4** (`EXIT.BLOCKED`)

**stdout: 0 bytes — completely empty.**

**stderr, verbatim** (captured file sha256 `607eafc04e7a1db369ab6ae3c420ad48b7c5151b9b543b6e208e082bddea5437`):

```
  BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)
  BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)
  BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)
  BLOCKED Persistent identifier is UNASSIGNED (persistent_identifier.value)
  BLOCKED registration_id is UNASSIGNED (issued by the registry at registration)
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
ERROR: BLOCKED — 9 named prerequisite(s) missing; the tooling will not invent them
```

**Counts, measured with anchored patterns:**

| Pattern | Count |
|---|---|
| `^  BLOCKED ` | **9** |
| `^  ERROR   ` | **0** |
| unanchored `BLOCKED ` | **10** — wrong; see `VERIFIER_MESSAGING_NOTES.md` §1 |

**NINE BLOCKED, ZERO ERRORS.** The stderr file is **byte-identical** to the one recorded in
`C:/tmp/dt009-closure/G-registration/VERIFIER_STATE.md` RUN 1 (same sha256 `607eafc0...`), even though that run
used the **pre-wave 593-file** instrument and this one used the **candidate 594-file** instrument. The message
set is therefore stable across the DR-1 / DR-10 wave — and, less comfortably, **completely insensitive to which
instrument is running**: see §5.

**It needed no `--protocol`, no `--registry` and no `--identity-registrations`, and therefore no fabricated OSF
or Bitcoin value of any kind.** `registered()` calls `reportRegistrationCheck()` *before* it reaches
`need(o, 'protocol')`, so the blockers terminate the process first. The rehearsal is fully performable with
nothing but the record itself.

---

## 2. VARIANT A — every external leaf still unassigned (a fresh template)

Produced by the instrument itself, into the scratchpad, so it is a genuine `registration-fields` output and not
a hand-edited file:

```
node cpg_u1_data.mjs registration-fields \
  --protocol C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md \
  --registry C:/tmp/dt009-merge/tooling/rules/development_only_registry.json \
  --out <scratch>/variantA.json
```

exit **0**, stdout:

```
registration template written: identities, outpoints, checkpoint and registry-issued fields are UNASSIGNED
tooling_aggregate_sha256: 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
```

Then `verify-registration --registration <scratch>/variantA.json`:

### EXIT CODE: **4** (`EXIT.BLOCKED`) — it refuses

stdout 0 bytes. stderr, verbatim (sha256 `0c346552a77e7deeb6401cae1b9742d288b6c4e80706c0000732b4ea908c5e61`):

```
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
```

```
ERROR: BLOCKED — 10 named prerequisite(s) missing; the tooling will not invent them
```

Anchored `^  BLOCKED ` = **10**, anchored `^  ERROR   ` = **0**.

**This is the 9-vs-10 arithmetic settled by measurement**, not by reading: the one extra line is exactly the
provider-configuration one, and the draft shows nine only because `provider_configuration_sha256` is already
filled there (`ERRATA.md` E-2). Eleven unresolved leaves in the draft, twelve in the template; nine and ten
blocker lines respectively, because `outpoints` and `checkpoint` each produce one line for two leaves.

**No fabricated value was needed.** The variant is what the tooling itself writes, with every identity,
outpoint, checkpoint and registry-issued field left as the literal `UNASSIGNED`.

---

## 3. VARIANT B — the provisional-aggregate placeholder

A scratch copy of the draft with one field replaced by the literal marker used throughout this programme:

```
"tooling_aggregate_sha256": "<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>"
```

### EXIT CODE: **1** (`fail()` default, "refused") — it refuses, and it refuses *louder*

stdout 0 bytes. stderr, verbatim (sha256 `d5d2db512f3ab78a81478627fb7860ee77d49fbd09a6aa9439200f9ddc27c75c`):

```
  ERROR   tooling_aggregate_sha256 must be 64 lowercase hex characters
  BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)
  BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)
  BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)
  BLOCKED Persistent identifier is UNASSIGNED (persistent_identifier.value)
  BLOCKED registration_id is UNASSIGNED (issued by the registry at registration)
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
ERROR: registration record refused (1 error(s))
```

Anchored `^  ERROR   ` = **1**, anchored `^  BLOCKED ` = **9**.

**It fails closed.** The marker cannot survive as a value: `HEX64.test()` rejects it, `errors.length` is
non-zero, and `reportRegistrationCheck()` runs `if (errors.length) fail(...)` **before** the BLOCKED branch, so
the exit code degrades from 4 to **1** and the summary line changes from "BLOCKED — N named prerequisite(s)
missing" to "registration record refused (1 error(s))".

This is the desired behaviour and it is the reason the marker is used rather than any candidate digest: **an
unmistakable placeholder fails louder than nine missing prerequisites, while a plausible 64-hex digest would
not fail at all** (§5).

**No fabricated value was needed** — the marker is the opposite of a fabricated value.

---

## 4. VARIANT C — the candidate aggregate `638d68e6...` filled in

A scratch copy of the draft with `tooling_aggregate_sha256` set to the aggregate this stream recomputed from the
candidate tree, `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`. **This value is a computed
instrument identity, not an external value and not an authorised one** — it is provisional under
`PROVISIONAL_AGGREGATE_HANDLING.md` §3 until two independent clean rebuilds agree and the owner authorises it.
It was written **only** into a scratch file, never into the draft, never into a payload, never anywhere that
could be mistaken for a registration.

### EXIT CODE: **4** (`EXIT.BLOCKED`) — it refuses, for the nine human prerequisites only

stdout 0 bytes. stderr sha256 `607eafc04e7a1db369ab6ae3c420ad48b7c5151b9b543b6e208e082bddea5437` —
**byte-identical to RUN 1**, verified with `cmp`. Anchored `^  BLOCKED ` = **9**, anchored `^  ERROR   ` = **0**.

**Confirmed: the verifier recognises the well-formed digest without endorsing it.** It says nothing about the
aggregate at all — not that it matches, not that it differs, not that it is provisional. The only thing it
established is `HEX64.test()`.

---

## 5. The unreachable comparison, demonstrated rather than asserted

RUN 1 and VARIANT C differ in `tooling_aggregate_sha256`: the draft carries the **superseded pre-wave**
`f7699f05...4e5cc5dd` (593 files) and variant C carries the **candidate** `638d68e6...3fa278fd2` (594 files).
Both were verified **by the candidate 594-file instrument**, so RUN 1 is a genuine
registered-value-vs-running-instrument mismatch — the exact failure `registered()` exists to catch:

```js
const aggregate = toolingManifest(ROOT).aggregate;
if (aggregate !== reg.tooling_aggregate_sha256) fail(`VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate ${aggregate}) is not the registered tooling`);
```

**That line was never reached, and the two outputs are byte-identical.** `reportRegistrationCheck()` runs first
and `fail()` calls `process.exit()`, so while any blocker remains:

- a **correct** aggregate, a **superseded** aggregate and a **plausible wrong** 64-hex digest are
  indistinguishable in the verifier's output;
- `VERIFY_ABORT_HASH_MISMATCH` cannot appear before every one of the nine human prerequisites is satisfied —
  i.e. not until after OSF submission and after the Bitcoin funding;
- **only the placeholder form fails early**, because the 64-hex check is an ERROR rather than a comparison.

This is why `tooling_aggregate_sha256` is marked **BLOCKED** rather than DERIVABLE in
`OWNER_INPUT_SHEET.md` D5, and why the discipline around it is procedural: **the instrument cannot protect it
during the window in which it matters.** No additional wrong digest was invented to show this — the two
legitimate values already in play were sufficient.

---

## 6. Auxiliary probe D — is a blocker defeatable by whitespace?

Not one of the three required variants; recorded because it changes what the owner sheet has to tell a person.
Scratch copy of the draft with two fields changed to **padded / re-cased forms of the marker itself** (no
identity, name or external value was invented):

```
"accountable_identity": { "value": "UNASSIGNED " }        // one trailing space
"persistent_identifier": { "type": "unassigned" }         // lower case
```

### EXIT CODE: **4**, but with **7** BLOCKED lines, not 9 — and **0** errors

```
  BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)
  BLOCKED Persistent identifier is UNASSIGNED (persistent_identifier.value)
  BLOCKED registration_id is UNASSIGNED (issued by the registry at registration)
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
ERROR: BLOCKED — 7 named prerequisite(s) missing; the tooling will not invent them
```

Both fields were accepted as **assigned**, silently, with no warning. `assigned()` is

```js
typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED
```

— it trims only for the emptiness test and compares the **untrimmed, case-sensitive** value against
`'UNASSIGNED'`. So `"UNASSIGNED "`, `" UNASSIGNED"` and `"unassigned"` all pass. See
`VERIFIER_MESSAGING_NOTES.md` §2.

---

## 7. Summary

| Run | Record | Exit | `^  BLOCKED ` | `^  ERROR   ` | Refuses? |
|---|---|---|---|---|---|
| RUN 1 | the on-disk draft, unmodified | **4** BLOCKED | 9 | 0 | yes — nine human prerequisites |
| VARIANT A | fresh `registration-fields` template, all external leaves unassigned | **4** BLOCKED | 10 | 0 | yes — ten, the extra one being `provider_configuration_sha256` |
| VARIANT B | provisional-aggregate placeholder | **1** REFUSED | 9 | 1 | yes — `tooling_aggregate_sha256 must be 64 lowercase hex characters`, louder and earlier |
| VARIANT C | candidate aggregate `638d68e6...` | **4** BLOCKED | 9 | 0 | yes — but says **nothing** about the aggregate; output byte-identical to RUN 1 |
| PROBE D | padded / re-cased marker in two fields | **4** BLOCKED | **7** | 0 | yes, but two blockers were silently satisfied by whitespace and case |

**Fabricated values needed: NONE.** No OSF identifier, no identity, no persistent identifier, no custodian, no
outpoint, no txid, no block height, no block hash, no timestamp, no relay, no header source and no aggregate was
invented. The only non-template values used anywhere were: the marker `<<PROVISIONAL: ...>>`, the aggregate
recomputed read-only from the candidate tree, and whitespace variants of the word `UNASSIGNED`.

**Nothing expensive ran.** No selftest, no mutation run, no clean rebuild, no build, no install, no network.
Work performed: five `verify-registration` invocations, one `registration-fields` invocation into the
scratchpad, and three `toolingManifest()` computations — all sub-second. The 404-mutant certification suite kept
exclusive priority on expensive compute throughout.

**Nothing was modified.** Candidate instrument aggregate identical before and after
(`638d68e6...3fa278fd2`, 594 files); draft record sha256 identical before and after
(`48f5621d305b0de2b766588b199e80e2263c22da75b36f36a103014abc8daba6`); the protocol, treatment, evaluation tree
and registry were read-only. All variant files live in the session scratchpad, not in any worktree.
