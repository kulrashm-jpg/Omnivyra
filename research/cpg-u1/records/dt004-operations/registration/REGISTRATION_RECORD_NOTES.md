# REGISTRATION RECORD — NOTES ON `registration_record.DRAFT.json`

**CLASSIFICATION: PREPARATION.** `registration_record.DRAFT.json` is **not** a registered artefact and
**not** evidence. It becomes a REGISTERED ARTIFACT only when OSF Registries issues `registration_id` and
`registration_timestamp` and the accountable identity submits it. **Nothing has been registered.** No
value in the draft was invented: every filled field was recomputed read-only in this task, and every
other field is the literal string `UNASSIGNED`.

## 0. The two files and how they were produced

| File | sha256 | What it is | Class |
|---|---|---|---|
| `registration_fields.TEMPLATE.json` | `703e5b80b1fc9ee410d160e199cf7980435dcb388c50cee3c3f83c7fc3ce9f61` | The authoritative template exactly as the instrument emitted it. **Not hand-written.** | ENGINEERING ARTIFACT |
| `registration_record.DRAFT.json` | `48f5621d305b0de2b766588b199e80e2263c22da75b36f36a103014abc8daba6` | The template with the **one** machine-computable field that the template leaves blank now filled: `provider_configuration_sha256`. Byte-identical to the template otherwise (verified by `diff`: exactly one changed line). | PREPARATION |

The template was produced by running the instrument read-only, with its output directed into this
worktree — never into the instrument tree, which is write-once:

```
cd C:/tmp/dt002/research/cpg-u1/tooling
node cpg_u1_data.mjs registration-fields \
  --protocol C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md \
  --registry rules/development_only_registry.json \
  --out C:/tmp/dt4-reg/research/deeptech-operations/registration/registration_fields.TEMPLATE.json
```

Real output, exit **0**:

```
registration template written: identities, outpoints, checkpoint and registry-issued fields are UNASSIGNED
tooling_aggregate_sha256: <NEW_AGG>
```

The draft was then produced by substituting that single line, preserving the file's bytes and UTF-8
encoding everywhere else. `diff` between the two files shows exactly one hunk.

## 1. Human-dependency classes used here

| Class | Meaning |
|---|---|
| **H0** | Machine-computable from artefacts already on disk. No human input. Filled in the draft. |
| **H1** | An agent can compute, read or draft the value; a human reviews and signs it. |
| **H2** | The protocol or the tooling requires a human act — an agent is prohibited from performing it. |
| **H3** | The human's *independence* from the developing organisation is itself the evidence; substituting an agent destroys the claim, not merely the procedure. |

## 2. Fields filled with real verified values

All four are **H0**. None was typed from memory; each was recomputed read-only in this task.

| Field | Value | How verified |
|---|---|---|
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md` in `C:/tmp/dt4-reg`; the same file in `C:/tmp/dt002` hashes identically. Written by the instrument itself from `--protocol` (`cpg_u1_data.mjs:269`). **VERIFIED** |
| `tooling_aggregate_sha256` | `<NEW_AGG>` | Independently recomputed by replicating `lib/aggregate.mjs` `toolingManifest()` read-only: <NEW_N> regular files, no symbolic links, one `<sha256>  <path>` LF-terminated line per file sorted by path, `sha256` of the whole text. **VERIFIED** — and it matches what `registration-fields` printed. |
| `registry_sha256` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | `sha256sum rules/development_only_registry.json`. **VERIFIED** |
| `provider_configuration_sha256` | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | Recomputed by replicating `providerConfigurationSha()` (`lib/harness.mjs:20-23`) against `C:/tmp/cpg049_integration/treatment` (HEAD `f01a7eb4199be4e04d4fee7fc0116303949dc553`, clean tree). **VERIFIED** — see §3. |

### 2.1 `provider_configuration_sha256` is machine-computable — the derivation in full

`lib/harness.mjs:17-23`:

```js
17  const PROVIDER_CONFIG_FILES = Object.freeze(['backend/services/companyProfile/grounding/registry/builtins.ts', 'backend/services/companyProfile/grounding/registry/coverageInventory.ts']);
19  /** §13.1 provider configuration hash: domain-separated hash over the two named files' hashes, in order. */
20  export function providerConfigurationSha(cloneDir) {
21    const parts = PROVIDER_CONFIG_FILES.map((f) => sha256(readFileSync(join(cloneDir, f))));
22    return sha256(['cpg-u1-provider-config/v1', ...PROVIDER_CONFIG_FILES.flatMap((f, i) => [f, parts[i]])].join('|'));
23  }
```

Component hashes, recomputed read-only against the frozen clone:

| File | sha256 |
|---|---|
| `backend/services/companyProfile/grounding/registry/builtins.ts` | `ab9b944318add9af97642bda7d03003ac5ba74817704a57e8064039b46db85bb` |
| `backend/services/companyProfile/grounding/registry/coverageInventory.ts` | `07506ff2cb569bc781a8d437562eaf130a6beb7c2ba939a1d3181834e3319fc1` |

Pre-image (exact, `|`-joined):

```
cpg-u1-provider-config/v1|backend/services/companyProfile/grounding/registry/builtins.ts|ab9b944318add9af97642bda7d03003ac5ba74817704a57e8064039b46db85bb|backend/services/companyProfile/grounding/registry/coverageInventory.ts|07506ff2cb569bc781a8d437562eaf130a6beb7c2ba939a1d3181834e3319fc1
```

`sha256` of that pre-image = `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`.
**VERIFIED — matches the value handed to this task.**

**This field is therefore H0, not H1.** The previous wave classified it as H1 ("operator / agent,
computed … not computed here") in `REMAINING_FIELDS.md` §1 and as an operator step in
`OPERATOR_CHECKLIST.md` A3. That classification is now **superseded**: the value is a pure function of
two files in the frozen clone, and it is filled in the draft. The remaining human element is only the
*choice of which clone is the frozen resolver*, and that choice is already made — `f01a7eb4…` is the
treatment identity carried through the whole programme, and the harness independently re-derives this
hash from the clone at run time (`cpg_u1_data.mjs:757`) and refuses any mismatch against the registered
value (`lib/harness.mjs:54`, `PROVIDER_CONFIG_MISMATCH`).

## 3. Fields left as the literal string `UNASSIGNED` — who supplies each, and its class

Nine blockers remain (§4). The table lists all twelve template placeholders, including the three whose
sub-fields collapse into one blocker string.

| Field path | Draft value | Who supplies it | Class |
|---|---|---|---|
| `accountable_identity.value` | `UNASSIGNED` | The accountable identity itself — a real person or organisation with an OSF account, independent per §4A.1. An agent cannot be, or name, this party. | **H3** |
| `persistent_identifier.type` | `UNASSIGNED` | The human principal, choosing the identifier scheme (§5.5.1). | **H2** |
| `persistent_identifier.value` | `UNASSIGNED` | The external issuing authority of the chosen scheme, via the principal. | **H2** |
| `bitcoin_key_custodian.value` | `UNASSIGNED` | The human principal, naming the study operator. `role` is pinned to `STUDY_OPERATOR` in the template and must not be changed (`lib/registration.mjs:85`). | **H3** |
| `outpoints.development` | `UNASSIGNED` | The key custodian, by an external funding act: a single-use, single-signature P2WPKH output on `bitcoin-mainnet`, `<64 hex txid>:<vout>`. | **H2** |
| `outpoints['held-out']` | `UNASSIGNED` | The key custodian, same act, a **distinct** output (`lib/registration.mjs:105`). | **H2** |
| `checkpoint.height` | `UNASSIGNED` | The operator, read from the chain at or after both funding confirmations. | **H1** |
| `checkpoint.hash` | `UNASSIGNED` | The operator, read from the chain and cross-checked against both header sources. Reports as **one** blocker together with `checkpoint.height` (`lib/registration.mjs:108`). | **H1** |
| `as_of` | `UNASSIGNED` | The operator, choosing **one** frozen `YYYY-MM-DDTHH:MM:SSZ` for the whole held-out run (§7, §19.1). A methodological choice, not a clock reading, and it cannot be changed later. | **H1** |
| `provider_configuration_sha256` | **FILLED** — `c9a7e9aa…` | — (see §2.1) | **H0** |
| `registration_id` | `UNASSIGNED` | **OSF Registries**, at registration. Structurally unfillable before submission; must never be asserted by the operator. Must not contain `\|` (`lib/registration.mjs:97`). | **H2** |
| `registration_timestamp` | `UNASSIGNED` | **OSF Registries**, at registration. Must be `YYYY-MM-DDTHH:MM:SSZ` (`lib/registration.mjs:99`). | **H2** |

Two constraints the operator must respect when filling these in:

- **No value may contain the substring `SYNTHETIC` in any case.** `checkRegistration` promotes it from a
  blocker to an **ERROR** outside `--allow-synthetic` (`lib/registration.mjs:69, 72`).
- **`registration_id` and `registration_timestamp` are written back after submission.** The record that is
  submitted lacks them; the record that is later *verified* is the submitted record with the two
  registry-issued fields written in.

## 4. `verify-registration` against the draft — real runs, real exit codes

Both runs below were executed. Neither needed `--identity-registrations`, because `registered()`
(`cpg_u1_data.mjs:173-184`) calls `reportRegistrationCheck` at line **176** and exits there; the identity
list is only read at line **181**. This is itself worth recording: **the blocker report is reached before
any identity list is required**, so the operator can iterate on the record without the OSF listing.

### 4.1 Baseline — the template, with `provider_configuration_sha256` still `UNASSIGNED`

```
node cpg_u1_data.mjs verify-registration \
  --registration .../registration_fields.TEMPLATE.json \
  --protocol C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md \
  --registry rules/development_only_registry.json
```

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
ERROR: BLOCKED — 10 named prerequisite(s) missing; the tooling will not invent them
```

Exit code **4**. **VERIFIED.**

### 4.2 The draft, with the provider hash filled

```
node cpg_u1_data.mjs verify-registration \
  --registration .../registration_record.DRAFT.json \
  --protocol C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md \
  --registry rules/development_only_registry.json
```

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

Exit code **4**. **VERIFIED.**

### 4.3 Reading of the two runs

- **It still exits 4**, as required. The draft is not, and cannot be, a complete registration.
- **The count dropped from 10 to 9, and the line that disappeared is exactly
  `provider_configuration_sha256`.** Every other blocker string is byte-identical between the two runs.
  That is the confirmation asked for: the drop is attributable to the provider hash and to nothing else.
- **No error was reported in either run.** `checkRegistration` distinguishes errors (malformed or
  forbidden — exit 1) from blockers (named human prerequisites — exit 4). Zero errors means the twelve
  pinned parameters, the schema, the study id, the protocol version, `registry.{name,public,embargo}`,
  the network and the custodian role are all **correct as emitted**, and the filled provider hash passed
  the `HEX64` format check at `lib/registration.mjs:113`.
- **The nine that remain are the irreducible human set.** Six are H2/H3 (identity, identifier type and
  value, custodian, both outpoints, and the two registry-issued fields), three are H1 (checkpoint,
  `as_of`). No further agent work can reduce the count; only the accountable identity, the key custodian
  and OSF can.

## 5. What is NOT in this record — do not confuse these with registration fields

- **The frame `F`, its `frame_hash`, and the scan.** Constructed **after** registration (§5.5.1 ordering)
  and bound only indirectly, inside the commitment payload digest.
- **The seed.** No `--seed` argument exists anywhere in the instrument; only `seed_fingerprint` is ever
  printed.
- **The evaluation-tree identity** (`f01a7eb4199be4e04d4fee7fc0116303949dc553` /
  `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` / `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5`).
  Treatment identity under §7.1, bound at the evaluation and seal stages, not in
  `cpg-u1-registration/v1`.
- **`rules/analysis_decisions.json`** (`a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`).
  Bound **transitively**, through the tooling aggregate.

### 5.1 Correction to the previous wave: AD-1..AD-9 are RECORDED, not UNDECIDED

`REGISTRATION_PACKAGE.md` §1.1, `REMAINING_FIELDS.md` §2 and `OPERATOR_CHECKLIST.md` A1 all state that
the nine methodological decisions are "all `UNDECIDED` today" and that deciding them will change the
tooling aggregate. **That is no longer the state of the file and must not be carried forward.**

`rules/analysis_decisions.json` at `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`
carries `"status": "DECIDED — the values below are owner-approved methodological decisions, recorded
before registration"` and nine recorded values:

| | | | | |
|---|---|---|---|---|
| AD-1 `EXCLUDE_INVALID_CONFLICT_AND_STALE` | AD-2 `INCONCLUSIVE` | AD-3 `URL_WITHOUT_FRAGMENT` | AD-4 `ENTRY_FOR_DECISIVE_IDENTIFIER` | AD-5 `CALENDAR_MONTHS` |
| AD-6 `STATED_REFERENCE_VALUES_ONLY` | AD-7 `VOID` | AD-8 `INCONCLUSIVE` | AD-9 `ANY_UNAVAILABLE_ENTRY` | **0 undecided** |

Enumerated read-only from the file. The single remaining occurrence of the string `UNDECIDED` in that
file is inside the `status` prose, not in any `value`. **Consequences:**

- Operator-checklist step **A1 is already done.** It is not a blocker on `registration-fields`.
- The aggregate `<NEW_AGG>` **already contains** these decided values — the decisions file is inside the
  manifest, and the aggregate recomputed in this task from the tree as it stands matches. There is no
  pending aggregate change from this source.
- `analyze` will **not** exit 4 with `ANALYSIS_BLOCKED` at the end of the study on this account
  (`cpg_u1_data.mjs:1040`; `lib/analysis.mjs:49`).

## 6. Artefact classification

| Artefact | Class |
|---|---|
| `registration_fields.TEMPLATE.json` | **ENGINEERING ARTIFACT** — the instrument's own output, reproducible by re-running the command |
| `registration_record.DRAFT.json` | **PREPARATION** — becomes a REGISTERED ARTIFACT only when OSF issues the identifiers and the accountable identity submits it |
| The nine `UNASSIGNED` fields | **HUMAN-REQUIRED INPUT** |
| The two `verify-registration` transcripts in §4 | **EXECUTION EVIDENCE** of the preparation check only — **not** study evidence, since nothing is registered |
| This notes file and the two DR memos | **PREPARATION** |

## 7. Explicitly refused

No identity, organisation name, custodian name, persistent identifier, outpoint, txid, address, key,
checkpoint height, block hash, `as_of` timestamp, registration id or registration timestamp was
invented, generated, fetched or guessed. No network call, no OSF interaction, no transaction, no
credential and no production access. The instrument tree and the treatment clone were read only; nothing
was written outside `research/deeptech-operations/registration/` in `C:/tmp/dt4-reg` and the session
scratchpad.

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

