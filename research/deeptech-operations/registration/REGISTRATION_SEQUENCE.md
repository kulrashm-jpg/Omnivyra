# REGISTRATION SEQUENCE — the minimal ordered operator session, "decisions made" → "registered"

**CLASSIFICATION: PREPARATION.** No step below has been performed. This is the shortest correct path;
`OPERATOR_CHECKLIST.md` remains the fuller reference and everything after step **R14** belongs to it.
Steps **R7** and **R11** are irreversible human acts and an agent must not perform them.

**Entry condition.** This sequence begins only when **all** of the following are true:
- DR-1 is decided (see `DR1_DRAND_RELAY_FLOOR_MEMO.md` §7) — option (a), (b) or (c).
- DR-2 is decided (see `DR2_CERTENV_WORDING_MEMO.md` §6) — option (a), (b) or (c).
- AD-1..AD-9 are recorded. **They already are** — verified in this task; see
  `REGISTRATION_RECORD_NOTES.md` §5.1. `rules/analysis_decisions.json` =
  `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`, 0 undecided.

**Exit condition.** "Registered" means exactly one thing: `verify-registration` exits **0**
(step **R14**). Nothing less counts.

All commands run from `C:/tmp/dt002/research/cpg-u1/tooling` unless stated otherwise. `PROTO` denotes
`C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md`, `REGISTRY` denotes
`rules/development_only_registry.json`. Every output file is **write-once**; a refused command writes
nothing, and an existing output is not overwritten.

---

## The sequence

### R1 — Confirm the protocol states every pinned parameter

```
node cpg_u1_data.mjs verify-protocol --protocol PROTO
```

**Expected exit 0**, printing `protocol states every pinned parameter; protocol_sha256: c50fc680…`.
A non-zero exit names the missing normative markers — **investigate, do not edit the protocol.**
**Keep:** the printed `protocol_sha256`.
**Human:** H1 (agent may run and report). **Reversible.**

If DR-2 resolved to option (b), run this against the **new** protocol file instead, and expect its new
SHA. See `DR2_CERTENV_WORDING_MEMO.md` option (b) for the `PROTOCOL_VERSION` trap.

### R2 — Freeze the tooling. **LAST CHANCE.**

Apply any instrument change now, or never. If DR-1 resolved to option (b), the patch, the full self-test,
the full 391-mutant run and adapter conformance all belong **here**.

```
node test/mutate.mjs --anchors
CPG_U1_RESOLVER_CLONE=<clean clone at f01a7eb4199be4e04d4fee7fc0116303949dc553> node test/selftest.mjs
CPG_U1_ADAPTER_CLONE=<same clone, deps installed> CPG_U1_RESOLVER_CLONE=<same> node test/mutate.mjs --jobs 4
CPG_U1_RESOLVER_CLONE=<same> node test/adapter_conformance.mjs
```

**Expected exit 0 from each.** The anchor line reads `anchors: 389/389 occur exactly once` today
(**VERIFIED in this task**); under DR-1 option (b) it must read `391/391`. Every mutant must be KILLED.
**Keep:** the four transcripts, and the recomputed aggregate.
**Human:** H1. **Reversible — and it is the last reversible point for the instrument.**

> **IRREVERSIBLE BOUNDARY 1 — the tooling aggregate must be final before R4.**
> `registration-fields` does not accept an aggregate as input; it recomputes it from the tree at run
> time (`cpg_u1_data.mjs:269`). Every later sampling command re-derives it and aborts
> `VERIFY_ABORT_HASH_MISMATCH` on any difference (`cpg_u1_data.mjs:178-179`; `lib/harness.mjs:44`).
> Because the aggregate is also inside the on-chain commitment payload (`lib/commitment.mjs:11`), after
> R7/R11 there is no lawful edit, and re-registering to fix one is **study VOID**
> (`lib/registration.mjs:119, :140-141`). **After R4, one byte anywhere under the tooling tree ends the
> study.**

### R3 — Name the key custodian; fix `as_of`

No command. Three values must exist on paper before R5:
- `bitcoin_key_custodian.value` — **H3**, the human principal names the study operator. `role` stays
  pinned to `STUDY_OPERATOR`.
- `accountable_identity.value` and `persistent_identifier.{type,value}` — **H3/H2**.
- `as_of` — **H1**, one frozen `YYYY-MM-DDTHH:MM:SSZ` for the whole held-out run (§7, §19.1). A
  methodological choice, not a clock reading; it cannot be changed later.

`provider_configuration_sha256` is **already computed**:
`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` (**H0**, VERIFIED — see
`REGISTRATION_RECORD_NOTES.md` §2.1). Do not recompute it by hand.
**Keep:** the written record of who supplied each value.
**Reversible.**

### R4 — Produce the registration record

```
node cpg_u1_data.mjs registration-fields --protocol PROTO --registry REGISTRY --out reg.json
```

**Expected exit 0**, printing
`registration template written: identities, outpoints, checkpoint and registry-issued fields are UNASSIGNED`
and `tooling_aggregate_sha256: <aggregate>`.
**Check the printed aggregate against R2's recomputation.** If they differ, stop: the tree changed between
the two steps.
**Keep:** `reg.json` and the printed aggregate.
**Human:** H1. **Reversible** only by deliberately moving `reg.json` aside and re-running — record that
you did.

A ready-made reference for this step already exists in this directory:
`registration_fields.TEMPLATE.json` (`703e5b80…`) is the exact output of this command today, and
`registration_record.DRAFT.json` (`48f5621d…`) is that output with the provider hash filled. Diff your
`reg.json` against the template to confirm nothing unexpected changed.

### R5 — Fill the pre-funding human fields into `reg.json`

Fill `bitcoin_key_custodian.value`, `accountable_identity.value`, `persistent_identifier.type`,
`persistent_identifier.value`, `as_of`, `provider_configuration_sha256`. Leave `outpoints`, `checkpoint`,
`registration_id` and `registration_timestamp` as `UNASSIGNED`.
**Never write a value containing `SYNTHETIC`** — it is an ERROR, not a blocker
(`lib/registration.mjs:69, 72`).
**Keep:** `reg.json`.
**Human:** H2/H3 for the values, H1 for the transcription. **Reversible.**

### R6 — Gate funding

```
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
```

**Expected exit 0**, printing
`funding prerequisites present: key custodian assigned (role STUDY_OPERATOR); parameters match the pinned values.`
Exit **4** = the custodian is still `UNASSIGNED`. Exit **1** = a pinned parameter was altered — restart
from R4 with a clean `reg.json`.
**Do not fund before this command exits 0.**
**Keep:** the transcript.
**Human:** H1. **Reversible.**

### R7 — **IRREVERSIBLE.** Fund `O_dev` and `O_ho`

Two **distinct**, single-use, single-signature **P2WPKH** outputs on `bitcoin-mainnet`. The tooling
creates no wallet, no key and no transaction. Isolate both outputs in a wallet that will not touch them;
a wallet that auto-selects either as a change input destroys the study.
**Keep:** both outpoints as `<64 hex txid>:<vout>`, and the custody arrangement in writing.
**Human:** **H2 — the key custodian. An agent is prohibited.** **IRREVERSIBLE: money is spent, and each
outpoint may be spent exactly once. A spend at or before the checkpoint is
`STUDY_VOID_PRE_REGISTRATION_SPEND` with no recovery.**

### R8 — Wait for ≥ 6 confirmations on both; choose the checkpoint

Choose a block `(height, hash)` at or after both funding confirmations satisfying
`funding_height + 6 − 1 ≤ checkpoint_height`. Record the hash as 64 lowercase hex in display (RPC) order.
Choose it deep enough that a reorg will not orphan it — there is no reorg-tolerance parameter.
**Keep:** `(height, hash)`.
**Human:** H1. **Reversible** (a different checkpoint may be chosen until R11).

### R9 — Verify two independently sourced header archives

```
node cpg_u1_data.mjs verify-archive --network bitcoin-mainnet \
  --checkpoint-height <N> --checkpoint-hash <H> --archive a.json --crosscheck b.json
```

**Expected exit 0**, printing `archive valid <start>..<tip>; crosscheck valid …; agree over <from>..<to>`.
Exit **1** = `archive refused: <reason>`. If the two sources disagree at a height: **wait and re-verify;
never pick one.**
**Keep:** `a.json`, `b.json`, the printed ranges, and the written basis for believing the two sources are
independent (**H1**: an agent may draft it, a human signs).
**Human:** H1 (H2 if an own node is run). **Reversible.**

### R10 — Write the chain-derived fields into `reg.json`

`outpoints.development`, `outpoints['held-out']`, `checkpoint.height`, `checkpoint.hash`.
At this point `verify-registration` should report exactly **two** blockers — `registration_id` and
`registration_timestamp` — which are structurally unfillable before R11. Run it to confirm:

```
node cpg_u1_data.mjs verify-registration --registration reg.json --protocol PROTO --registry REGISTRY
```

**Expected exit 4 with exactly 2 blockers.** Any other count means a field was missed; any **ERROR**
means a value is malformed and must be fixed **before** R11.
**Keep:** the transcript. This is the last cheap check before the irreversible submission.
**Human:** H1. **Reversible.**

### R11 — **IRREVERSIBLE.** Submit to OSF Registries

Public, **no embargo**, under the accountable identity, with `study_id` `CPG-U1-2026-01`. The submission
must publicly state the full `cpg-u1-registration/v1` record as R4 produced it with the human values
filled, the protocol at its `protocol_sha256` (or a resolvable reference to it), the §21 verification
procedure, the authority rule verbatim, and the DR-1 / DR-2 disclosures chosen at the entry condition
plus the already-prepared "tooling v4" naming disclosure (`REGISTRATION_PACKAGE.md` §5).
**Keep:** the public URL, the record exactly as submitted, and the submission confirmation.
**Human:** **H2 for the act, H3 for the independence of the accountable identity. An agent must not
submit.** **IRREVERSIBLE: the earliest registration under the identity for this `study_id` is
authoritative; a second registration differing in any sampling field, or any withdrawal, is study VOID
(`lib/registration.mjs:127-142`). There is no correction, only a VOID.**

### R12 — Write back the two registry-issued fields

`registration_id` and `registration_timestamp` (`YYYY-MM-DDTHH:MM:SSZ`), **as OSF issued them**. Never
assert either value.
**Keep:** `reg.json`.
**Human:** H1 transcription of an H2 value. **Reversible** as a transcription only.

### R13 — Export the identity's full registration listing

Export every registration under the accountable identity for `CPG-U1-2026-01` as `identity_regs.json`
(§21 step 1). A record absent from that listing is refused (`lib/registration.mjs:130`).
**Keep:** `identity_regs.json`.
**Human:** H1. **Reversible.**

### R14 — **This is "registered".**

```
node cpg_u1_data.mjs verify-registration --registration reg.json \
  --identity-registrations identity_regs.json --protocol PROTO --registry REGISTRY
```

**Expected exit 0**, printing
`registration <id> complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match`.
- Exit **4** = a named prerequisite is still `UNASSIGNED`; the command lists each.
- Exit **1** = an ERROR (a pinned value altered) or `VERIFY_ABORT_HASH_MISMATCH` (the protocol, tooling
  aggregate or registry file in use is not the registered one).
- Exit **6** = `STUDY_VOID_REGISTRATION` from the authority check — an earlier or differing duplicate, or
  a withdrawal.

**Keep:** the full stdout/stderr as the registration verification record. **Getting exit 0 here is the
definition of registered.**
**Human:** H1. Not reversible in the sense that matters — it reports a fact about an irreversible act.

### R15 — Re-run R14 with `--evidence` once the bundle exists

Cannot be done yet: it needs `ev.json` from the evidence-bundle step, which belongs to the next phase.
Adding `--evidence ev.json` additionally prints `funding outputs verified against the registered
checkpoint`, and exits **6** if an outpoint is not P2WPKH, if funding has fewer than 6 confirmations at
the checkpoint, or if an outpoint was spent at or before the checkpoint.
**Status: DEFERRED** to `OPERATOR_CHECKLIST.md` Phase D.

---

## The four irreversible ordering points, stated once

| # | Constraint | Why, mechanically |
|---|---|---|
| **1** | **The tooling aggregate must be final before `registration-fields` (R4).** | `registration-fields` recomputes it at run time (`cpg_u1_data.mjs:269`) and it becomes a **sampling field** (`lib/registration.mjs:119`). Afterwards every command re-derives it and aborts on a mismatch (`cpg_u1_data.mjs:178-179`; `lib/harness.mjs:44`), and it is carried in both stage manifests (`lib/harness.mjs:49, :155`), the authorization (`lib/execution.mjs:65`) and the **on-chain** commitment payload (`lib/commitment.mjs:11`). Re-registering to fix it is VOID. |
| **2** | **Registration precedes frame construction.** | §5.5.1 ordering: funding confirmed → registration → frame construction → development commitment. §5.5 step 3 enumerates the complete frame *after* the freeze, with **no later additions**. The frame hash is inside the on-chain digest before the randomness block exists. **Do not construct, enumerate, extend or reclassify any frame before R14 returns 0.** A further hard gate: `registration_timestamp` must be strictly before the scheduled time of `R_dev`, or `verify-sampling` returns `STUDY_VOID_REGISTRATION` (`lib/sampling.mjs:175-176`). |
| **3** | **The rater-assignment fingerprint must be published before the held-out commitment.** | `cpg_u1_data.mjs:5` places `rater-assignment-fingerprint` before `commitment-payload --stage held-out` per §4A.3, and `lib/assignment.mjs:52` refuses any assignment that does not hash to the **published** fingerprint (`RATER_ASSIGNMENT_REFUSED`). Publishing after the held-out commitment would let the assignment be chosen with knowledge of the draw. |
| **4** | **The seal must be published before execution.** | `authorize-execution` requires `--seal-publication`, and `lib/execution.mjs:55-57` demands that the published record name the same `seal_hash` and carry a registry `record_id` and `registry_timestamp`; `lib/execution.mjs:74` sets `window_opens_at` to that timestamp. No authorization exists, and therefore no `harness-held-out` run is permitted, until the seal is publicly recorded. |

Points 3 and 4 are outside this sequence's exit condition but are stated here because they are the two
ordering constraints most easily lost once the study is in motion.

## Ongoing rules that apply from R4 onward

- **Write-once outputs.** A refused command writes nothing; an existing output is never overwritten. To
  redo a step, move the old output aside deliberately and record that you did.
- **Chain clocks only.** Every window — depth, finality, the 180-day abandonment, the 30-day missing-round
  expiry — is measured by Bitcoin median-time-past, never by the operator's wall clock.
- **`--prior-final`.** Once a stage is FINAL, pass that published record as `--prior-final` on every later
  verification, so a contradiction reports `STUDY_VOID_POST_FINALITY_REORG` instead of silently
  re-deriving.
- **Never `--allow-synthetic`** outside a deliberate rehearsal on the `synthetic-test` network. It is the
  flag that disables mainnet pinning and the `SYNTHETIC` value refusal.
- **Exit codes:** `0` ok · `1` refused / abort · `2` pool below minimum · `3` HALT · `4` BLOCKED (named
  human prerequisite missing) · `5` WAITING / NOT_STARTED · `6` VOID / ABANDONED.

## Validation status of this sequence

| Step | Status in this task |
|---|---|
| R2 `node test/mutate.mjs --anchors` | **VERIFIED** — `anchors: 389/389 occur exactly once`, exit 0 |
| R4 `registration-fields` | **VERIFIED** — run read-only into this worktree, exit 0, printed aggregate `f7699f05…` |
| R10 / R14 `verify-registration` | **VERIFIED as exit 4** against both the template (10 blockers) and the draft (9 blockers). Exit 0 is **NOT RUN** and cannot be run: nine human prerequisites are `UNASSIGNED`. |
| R1 `verify-protocol` | **NOT RUN** |
| R2 self-test / full mutation run / adapter conformance | **NOT RUN** — require `CPG_U1_RESOLVER_CLONE` / `CPG_U1_ADAPTER_CLONE` |
| R6 `check-funding-prerequisites` | **NOT RUN** — would report BLOCKED on the unassigned custodian |
| R7, R11 | **NOT DONE — PROHIBITED.** No key, no transaction, no funding, no OSF submission. |
| R9 `verify-archive` | **NOT RUN** — no archive was fetched; no network access was used |
| R15 | **DEFERRED** |
