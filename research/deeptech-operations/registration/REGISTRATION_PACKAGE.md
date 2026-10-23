# CPG-U1 REGISTRATION PACKAGE

**CLASSIFICATION: PREPARATION.** This document is not evidence. Nothing here has been registered,
funded, broadcast or executed. It describes, field by field, the record that a human operator must
submit to OSF Registries, and it names every value that this document cannot supply.

**Study:** `CPG-U1-2026-01` · **Protocol:** `CPG_U1_PROTOCOL_004` · **Schema:** `cpg-u1-registration/v1`
**Prepared for:** DEEPTECH-PARALLEL-004 stream A · **Status: NOT REGISTERED.**

---

## 1. Identity table (verbatim frozen hashes)

These are the values handed to this stream as authoritative. They are reproduced verbatim; the
VALIDATION column states exactly what this stream did and did not recompute.

| Object | SHA-256 / identifier | VALIDATION in this stream |
|---|---|---|
| Protocol document `research/cpg-u1/CPG_U1_PROTOCOL_004.md` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | VERIFIED (recomputed read-only in worktree `C:/tmp/dt4-reg`; matches) |
| Tooling aggregate (verified instrument, 593 files, `C:/tmp/dt002/research/cpg-u1/tooling`) | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | **VERIFIED** (recomputed read-only by replicating `lib/aggregate.mjs`: 593 regular files, no symbolic links, one `<sha256>  <path>` LF-terminated line per file sorted by path under `LC_ALL=C`; aggregate matches exactly) |
| Methodological decisions `rules/analysis_decisions.json` | `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be` | VERIFIED (recomputed read-only; matches) |
| Development-only registry `rules/development_only_registry.json` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | VERIFIED (recomputed read-only; matches) |
| Treatment / evaluation tree commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | UNVERIFIED here |
| Treatment / evaluation git tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | UNVERIFIED here |
| Treatment / evaluation content aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` | UNVERIFIED here |

### 1.1 The tooling aggregate that gets registered is computed at registration time

`registration-fields` does not accept an aggregate as input. It calls `toolingManifest(ROOT)`
(`lib/aggregate.mjs`) and writes whatever the tooling tree hashes to **at the moment the command
runs**. The aggregate is `sha256` of the UTF-8 text holding one `<sha256>  <path>` line per file,
LF-terminated, sorted by path, over **every** file of the tooling tree, vendored dependencies
included.

Therefore:

- The value `f7699f05...4e5cc5dd` above is the aggregate of the instrument **as it stands on disk on
  2026-09-24**, independently recomputed by this stream. It is the value to expect from the command,
  not a value to type in. (Two files — `rules/analysis_decisions.json` and `test/selftest.mjs` —
  carry 2026-09-23 modification times, later than the rest of the tree; the recomputation confirms
  those edits are already inside the declared aggregate, so there is no drift.)
- **Any** byte change anywhere under the tooling tree changes it. This explicitly includes
  `rules/analysis_decisions.json`: the nine AD-1..AD-9 methodological decisions are all
  `UNDECIDED` today, and `analyze` refuses to run until every one is decided. **Deciding them
  rewrites the decisions file, which changes the tooling aggregate.**
- Consequence for ordering: if AD-1..AD-9 are to be decided at all, they must be decided **before**
  `registration-fields` is run. Deciding them after registration makes the registered
  `tooling_aggregate_sha256` unreachable — every sampling command re-derives the aggregate through
  `registered()` and aborts with
  `VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate ...) is not the registered tooling`.
- The same applies to adding, removing or renaming any file, and to line-ending changes. The
  manifest walk refuses symbolic links and non-regular entries outright.
- **UNASSIGNED — the study operator must decide, before registration, whether AD-1..AD-9 are
  decided, and therefore whether the registered aggregate is `f7699f05...` or a new value.**

---

## 2. The registration record, field by field

Source of truth: `lib/registration.mjs` (`registrationTemplate()`, `checkRegistration()`),
cross-read against Protocol-004 §19.1 and §5.5.1. The record has exactly these top-level keys.

### 2.1 Computable now (the tooling fills these; do not hand-type them)

| Field | Value | Source |
|---|---|---|
| `schema` | `cpg-u1-registration/v1` | `REGISTRATION_SCHEMA` |
| `study_id` | `CPG-U1-2026-01` | `STUDY_ID` (`lib/commitment.mjs`) |
| `protocol_version` | `CPG_U1_PROTOCOL_004` | `PROTOCOL_VERSION` |
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | hash of `--protocol` |
| `tooling_aggregate_sha256` | expected `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` — recomputed at run time, see §1.1 | `toolingManifest(ROOT).aggregate` |
| `registry_sha256` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | hash of `--registry` |
| `registry.name` | `OSF Registries` | pinned; any other value is an ERROR |
| `registry.public` | `true` | pinned (U1: public) |
| `registry.embargo` | `false` | pinned (U1: no embargo) |
| `network` | `bitcoin-mainnet` | pinned `MAINNET.name`; `synthetic-test` only under `--allow-synthetic` |
| `authority_rule` | fixed sentence, §2.4 | constant |
| `verification_procedure` | `CPG_U1_PROTOCOL_004 §21 (cpg_u1_data.mjs verify-sampling)` | constant |

### 2.2 Pinned parameter set — all twelve keys, exactly

`checkRegistration` compares the key **count** and every key's value against `PARAMETERS`. A
missing, extra or altered key is an ERROR (exit 1), not a blocker.

| `parameters.<key>` | Value |
|---|---|
| `confirmations_D` | `6` |
| `randomness_offset_K` | `12` |
| `abandonment_days` | `180` |
| `randomness_model` | `B` |
| `drand_chain_hash` | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` |
| `drand_delta_seconds` | `10800` |
| `drand_missing_round_expiry_days` | `30` |
| `commitment_opreturn` | `CPGU1\|01\|44(D)/48(H)\|sha256 digest` |
| `digest_domain` | `cpg-u1-commitment-digest/v1` |
| `seed_derivation` | `cpg-u1-chain-drand-seed/v1` |
| `rank_key` | `sha256("<seed>\|<scheme>:<identifier>")` |
| `bls_implementation` | `@noble/curves@1.9.7 + @noble/hashes@1.8.0 (vendored)` |

### 2.3 Requires a real-world value — the prerequisites that make `verify-registration` exit 4

Every one of these is `UNASSIGNED` today. `checkRegistration` reports them as **BLOCKED** (exit 4,
"named human prerequisite missing"), never as an error, and the library's own header states that
the tooling "refuses to proceed until a human supplies them". A value containing the substring
`SYNTHETIC` in any case is refused outright outside `--allow-synthetic`.

| # | Field path | Required value | Supplied by |
|---|---|---|---|
| 1 | `accountable_identity.value` | The accountable identity bound to the OSF account | **UNASSIGNED — human principal / study sponsor** |
| 2 | `persistent_identifier.type` | Identifier scheme, recorded as a type (§5.5.1) | **UNASSIGNED — human principal** |
| 3 | `persistent_identifier.value` | The persistent identifier itself | **UNASSIGNED — issuing authority, via the human principal** |
| 4 | `bitcoin_key_custodian.value` | The named person holding the wallet keys; `role` pinned to `STUDY_OPERATOR` | **UNASSIGNED — human principal (CPG-040 §3.2)** |
| 5 | `outpoints.development` (`O_dev`) | `<64 hex txid>:<vout>`; single-signature P2WPKH; ≥ 6 confirmations at the checkpoint | **UNASSIGNED — key custodian, by an external funding act** |
| 6 | `outpoints['held-out']` (`O_ho`) | as above, and **distinct** from `O_dev` | **UNASSIGNED — key custodian** |
| 7 | `checkpoint.height` | safe integer ≥ 0, at or after both funding confirmations | **UNASSIGNED — operator, read from the chain** |
| 8 | `checkpoint.hash` | 64 lowercase hex, the block hash at that height | **UNASSIGNED — operator, read from the chain** |
| 9 | `as_of` | one frozen `YYYY-MM-DDTHH:MM:SSZ` for the whole held-out run (§7, §19.1) | **UNASSIGNED — operator, chosen before registration** |
| 10 | `provider_configuration_sha256` | 64 lowercase hex over the resolver provider configuration (`registry/builtins.ts` + `coverageInventory.ts`, §13.1) | **UNASSIGNED — operator, computed before registration** |
| 11 | `registration_id` | The registry's persistent identifier for the record; must not contain `\|` | **UNASSIGNED — issued by OSF; never asserted by the operator** |
| 12 | `registration_timestamp` | `YYYY-MM-DDTHH:MM:SSZ` | **UNASSIGNED — issued by OSF; never asserted by the operator** |

The brief names ten prerequisites; the checker emits twelve distinct blocker strings because
`persistent_identifier` splits into type and value, `checkpoint` reports as one blocker for both
subfields, and `registration_id` / `registration_timestamp` report separately. The set is the same
set.

Fields 11 and 12 are structurally unfillable before submission: the record is submitted without
them, and OSF issues them. The record that is later *verified* is the submitted record with the two
registry-issued fields written back into it.

### 2.4 Fixed text carried in the record

- `authority_rule`: "The earliest registration under the accountable identity with this study_id is
  authoritative; a second registration with different sampling fields, or a withdrawal, voids the
  study."
- `verification_procedure`: "CPG_U1_PROTOCOL_004 §21 (cpg_u1_data.mjs verify-sampling)"

---

## 3. Sampling fields — what a second registration may not differ in

`checkAuthority` compares exactly these fields between the supplied record and the registry copy,
and between the record and every other registration under the same identity for this `study_id`:

`protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`, `network`, `outpoints`,
`checkpoint`, `parameters`.

- The earliest registration under the accountable identity wins.
- A differing duplicate → **study VOID**. An identical duplicate is ignored.
- Any withdrawal of any registration for this `study_id` → **study VOID** (tombstone reported).
- The verifier must supply the identity's full registration listing (`--identity-registrations`); a
  record absent from that listing is refused.

This is why registration must be made **once**, correct. A re-registration to fix an aggregate
typo voids the study — see §1.1.

---

## 4. What is NOT in the registration record

Listed because these are easy to conflate with registered fields:

- The frame `F`, its `frame_hash`, and the scan. These are constructed **after** registration
  (§5.5 step 3) and enter the record only indirectly, inside the commitment payload digest.
- The seed. There is no `--seed` argument anywhere in the tooling; seeds are derived inside the
  draw commands and only `seed_fingerprint` is recorded.
- The evaluation-tree commit / tree / content aggregate. These are treatment identity (§7.1), bound
  at the evaluation and seal stages, not in `cpg-u1-registration/v1`. They appear in §1 because
  this stream was given them as frozen state, not because they are registration fields.
- The methodological decisions file hash. It is bound **transitively**, through the tooling
  aggregate (§1.1).

---

## 5. Disclosure: the protocol text says "tooling v4"

Protocol-004 states that it "governs the dataset tooling **v4**" and closes with "IMPLEMENTED
(tooling v4)". The verified instrument reports `TOOL_VERSION = 'cpg-u1-data-tooling-6'`.

This is a naming divergence only. Identity in this protocol is carried by
`tooling_aggregate_sha256`: the protocol's own governed-tooling row says the aggregate "is bound in
the registration record ..., **not in this file**", and §19.1 lists the aggregate as the computed
identity. The protocol is frozen at `c50fc680...` and **must not be edited** — editing it changes
`protocol_sha256` and invalidates the identity table above, and `verify-protocol` would then refuse
the registration. The divergence is therefore disclosed, here and in `OPERATOR_CHECKLIST.md`, and
not fixed.

---

## 6. Submission content checklist for the operator

The OSF registration must publicly state, at minimum:

1. The full `cpg-u1-registration/v1` record as `registration-fields` produced it, with the human
   values of §2.3 filled in — public, **no embargo**.
2. The protocol document at `protocol_sha256` `c50fc680...`, or a resolvable reference to it.
3. The verification procedure (§21), so an outsider can reproduce it.
4. The authority rule, verbatim.

**Nothing in this package may be submitted by an agent.** Submission is a human act by the
accountable identity.
