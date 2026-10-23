# CPG-U1 OPERATOR REGISTRATION SEQUENCE

**Agent:** DEEPTECH-PARALLEL-008 / AGENT 6. **Date:** 2026-09-24.

This is the document the task brief called `OPERATOR_REGISTRATION_RUNBOOK.md`. That filename is **git-ignored**
by `.gitignore:58` `*_RUNBOOK*.md`, so it is written here under a name `git check-ignore` reports as **TRACKED**.
See `OSF_METADATA_PREPARED.md` §9 for the full ignore audit.

**It supersedes Phase A of `C:/tmp/dt004-operations/registration/OPERATOR_CHECKLIST.md`** and reorders it around a
single constraint the earlier version did not enforce: *the tooling aggregate must move at most once, and only
before registration.* Phases B, C and D of that document, and
`C:/tmp/dt004-operations/registration/BITCOIN_RANDOMNESS_RUNBOOK.md`, still apply unchanged and are referenced
rather than restated.

**PROHIBITION.** This document registers nothing, submits nothing, funds nothing and names no external value.

---

## 0. The ordering constraint, stated once

`registration-fields` does not accept an aggregate as input. It calls `toolingManifest(ROOT).aggregate` at run
time (`cpg_u1_data.mjs:269`) and registers whatever the instrument tree hashes to at that moment. Consequences,
each verified against the instrument:

- **Before registration** the instrument may still change. The aggregate simply becomes a new registered value.
  This is the **only** window in which any instrument edit is lawful.
- **After registration** `registered()` recomputes the aggregate on every sampling command and aborts with
  `VERIFY_ABORT_HASH_MISMATCH` (`cpg_u1_data.mjs:178-179`); `lib/harness.mjs:44` refuses identically with
  `TOOLING_MISMATCH`. Re-registering to repair it **voids the study**: `tooling_aggregate_sha256` is in
  `SAMPLING_FIELDS` (`lib/registration.mjs:119`) and `checkAuthority` treats a duplicate registration naming
  different sampling fields as VOID, with the earliest registration winning.
- **After the development commitment** the aggregate is inside the commitment payload
  (`lib/commitment.mjs` `PAYLOAD_KEYS`) and its digest is in an OP_RETURN on the Bitcoin blockchain. No lawful
  edit exists from that point.

Therefore every decision that could touch the instrument tree is in Stage 1 below, and Stage 1 ends with one
aggregate freeze that is never revisited.

---

## STAGE 0 — Corrections to carry forward (read before anything else)

| Item | Correction |
|---|---|
| **Step A1 of the old checklist is already complete.** | It says AD-1..AD-9 are "all `UNDECIDED`". They are **RECORDED**. `rules/analysis_decisions.json` (sha256 `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`) has status `DECIDED` and **0 undecided**; the nine values are listed in `OSF_METADATA_PREPARED.md` §6 and in `ERRATA.md` E-1. They are already inside `<NEW_AGG>`. **Do not edit that file.** `analyze` will not stop with `ANALYSIS_BLOCKED` for this reason. |
| **`provider_configuration_sha256` is not a human field.** | It is machine-computed and equals `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`. Re-confirmed in this session by running `providerConfigurationSha()` from the frozen `lib/harness.mjs` against the clean treatment clone at `f01a7eb4...`. Already filled in `registration_record.DRAFT.json`. |
| **The eight-person model needs no amendment.** | Verified three ways: §4A.3 line 186 — "Several enumerators are permitted; each holds no other role."; `lib/personnel.mjs:26` — `else if (role !== 'enumerator' && n > 1) errors.push(...)`, i.e. the "exactly one" rule is applied to every role **except** `enumerator`; and `test/selftest.mjs:829` is a **passing** assertion named `'multiple distinct enumerators permitted'` that appends a second enumerator and requires `errors.length === 0`. Do not raise a protocol amendment. |
| **Read the instrument only from `C:/tmp/dt002`.** | The worktree's own `research/cpg-u1/tooling` is a stale 587-file tree hashing to `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`. It runs fine and produces a perfectly self-consistent wrong aggregate. Never write to `C:/tmp/dt002`. |

---

## STAGE 1 — Everything that can still move the aggregate (do all of it, then freeze)

The aggregate moves at most once, here, or not at all.

### S1. Settle DR-1 in writing.
`DR1_DRAND_RELAY_FLOOR_MEMO.md` in `C:/tmp/dt004-operations/registration/`. Route A (declare the relay floor in
the registration narrative) leaves the aggregate at `<NEW_AGG>` — the memo states at `:215` "**Aggregate
impact: None.**" Route B patches five files and the memo states at `:229` that the aggregate "**moves off
`<NEW_AGG>`**". Route B also forces a second decision the memo declines to make: whether to bump
`EVIDENCE_SCHEMA` from `cpg-u1-sampling-evidence/v1` to `/v2`, which is itself another aggregate-moving edit.
**Owner decision. Record the chosen route and the reason.**

### S2. Settle DR-2 in writing.
`DR2_CERTENV_WORDING_MEMO.md`. Routes 1-3 leave the aggregate unchanged (`:194` "**Tooling aggregate impact:
None.**"). Route 4 — modifying the harness to permit an env file — is a tooling edit: `:257` "aggregate moves,
full re-verification". A new file also moves the aggregate if the version constant is renamed (`:226`).
**Owner decision. Record the chosen route and the reason.**

### S3. If and only if S1 or S2 chose an aggregate-moving route, re-verify the instrument in full.
Do not skip a step; the changed guards are worthless unkilled.

1. `CPG_U1_RESOLVER_CLONE=<clean clone at f01a7eb4...> node test/selftest.mjs` — expect exit **0**.
2. `node test/mutate.mjs --anchors` — for DR-1 route B the anchor count rises **389 to 391**; every anchor must
   occur exactly once.
3. `CPG_U1_ADAPTER_CLONE=... CPG_U1_RESOLVER_CLONE=... node test/mutate.mjs --jobs 4` — **every** mutant KILLED.
   This is the expensive step and it is not optional.
4. `CPG_U1_RESOLVER_CLONE=... node test/adapter_conformance.mjs`.
5. Recompute the aggregate and rebuild the identity table in all five documents that quote `<NEW_AGG>`:
   `REGISTRATION_PACKAGE.md`, `OPERATOR_CHECKLIST.md`, `REMAINING_FIELDS.md`, `HEADER_AND_RELAY_SOURCES.md`,
   `BITCOIN_RANDOMNESS_RUNBOOK.md` — plus `REGISTRATION_READINESS_TABLE.md` and `OSF_METADATA_PREPARED.md` in
   this directory.

### S4. Confirm the protocol still states every pinned parameter.
```
node cpg_u1_data.mjs verify-protocol --protocol <path>/CPG_U1_PROTOCOL_004.md
```
Expect exit **0** and `protocol_sha256: c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. A
non-zero exit means the protocol text lacks a normative marker — investigate; do **not** edit the protocol.

### S5. FREEZE. Recompute and record the aggregate; touch the instrument tree never again.
Expect `<NEW_AGG>` over **<NEW_N> files** if S1 and S2 both
chose a no-change route. Whatever value this prints is the registered aggregate.

> **From S5 onward, any change to `C:/tmp/dt002/research/cpg-u1/tooling` breaks the study.**

---

## STAGE 2 — Owner inputs that touch no hash (parallelise freely with Stage 1)

None of these can move the aggregate, so none of them has to wait for Stage 1.

### S6. Start recruiting the seven independent persons. **Start this first — it is the critical path.**
Enumerator(s), reference Author, Confirmer, reference adjudicator, at least 2 raters, rating adjudicator. Per
person collect three artifacts: the signed §4A.3 declaration answering items 1-4 and 6 and §4A.2(a)-(b) with
**"no"** ("unknown" is not "no"); the fee agreement's SHA-256, agreed in writing **before** any role material is
released and not contingent on any result, or `null`; and the developing organisation's written confirmation of
no item 1-4 relationship, with its SHA-256. Recruitment blocks no registration field and is measured in weeks.

### S7. Name the Bitcoin wallet-key custodian.
Do this **before** S6 completes: `lib/personnel.mjs` refuses an operator who also holds any §4A.3 independent
role, so a late custodian naming can force re-recruitment. Leave `role` as `STUDY_OPERATOR`.

### S8. Establish the accountable OSF identity and its persistent identifier.
Create or sign in to the identity's own OSF account at <https://osf.io> under that person's or organisation's own
email — not the developing organisation's. Choose the persistent-identifier scheme, register with that scheme's
issuer (for example <https://orcid.org/register> for an ORCID iD, or <https://ror.org> for a ROR ID), and copy the
issued identifier back verbatim.

### S9. Choose `as_of` and write down why.
One instant, as `YYYY-MM-DDTHH:MM:SSZ`. It is a methodological choice, not a clock reading; it governs the whole
held-out run and cannot be changed afterwards.

### S10. Name two independent Bitcoin header sources, or start a full node's initial block download now.
An own node's initial sync takes **days**. See `HEADER_AND_RELAY_SOURCES.md`.

### S11. Name the drand relays, applying the floor chosen in S1.

---

## STAGE 3 — Produce and fill the record

### S12. Produce the template.
```
node cpg_u1_data.mjs registration-fields \
  --protocol <path>/CPG_U1_PROTOCOL_004.md \
  --registry rules/development_only_registry.json \
  --out reg.json
```
Expect exit **0**. Check the printed `tooling_aggregate_sha256` equals the value frozen at S5. The output is
write-once: a refused command writes nothing, and an existing output is not overwritten.

### S13. Fill every non-external field.
`provider_configuration_sha256` = `c9a7e9aa...` (S0). Then from Stage 2: `bitcoin_key_custodian.value`,
`accountable_identity.value`, `persistent_identifier.type`, `persistent_identifier.value`, `as_of`. Leave
`outpoints`, `checkpoint`, `registration_id` and `registration_timestamp` as `UNASSIGNED`. Never write a value
containing `SYNTHETIC` — it is refused outside `--allow-synthetic`.

### S14. Gate funding.
```
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
```
Expect exit **0**. Exit **4** means the custodian is still `UNASSIGNED`. Exit **1** means a pinned parameter was
altered — restart from S12 with a clean `reg.json`. **Do not fund before this exits 0.**

---

## STAGE 4 — Bitcoin activity (external; `BITCOIN_RANDOMNESS_RUNBOOK.md` Phase B)

### S15. Fund the two single-use P2WPKH outputs and wait for 6 confirmations each.
They may be two outputs of one transaction, which halves the waiting. Roughly an hour at typical block intervals;
the tail is unbounded.

### S16. Write both outpoints as `<txid>:<vout>`.
They must be distinct — `checkRegistration` refuses two identical outpoints.

### S17. Choose the checkpoint and cross-check it against both header sources from S10.
A block at or after both funding confirmations. `checkpoint.height` is a JSON **number**; `checkpoint.hash` is 64
lowercase hex. The verifier has no network and cannot tell a real block hash from a plausible one — the
cross-check against two independent sources is the only protection.

---

## STAGE 5 — Register (human act; §5.5.1)

### S18. Dry-run the verifier before submitting.
```
node cpg_u1_data.mjs verify-registration \
  --registration reg.json \
  --registry rules/development_only_registry.json \
  --protocol <path>/CPG_U1_PROTOCOL_004.md \
  --identity-registrations <list>
```
Redirect stdout and stderr to **files** and read the exit code from `$?`. **Do not pipe:** a pipe reports the
last command's status and a prior session was misled by exactly that. Expect exactly **two** remaining blockers
at this point — `registration_id` and `registration_timestamp` — and **zero** ERRORs. Any ERROR line means a
malformed or forbidden value; fix it before submitting.

### S19. Submit the OSF registration.
Public, **no embargo**, under the identity from S8. Transcribe the narrative from `OSF_METADATA_PREPARED.md` §2-§7
and search the submitted text for `<<<UNFILLED` first — if the search matches anything, you are not ready.

### S20. Fill `registration_id` and `registration_timestamp` from what OSF issued.
The id must not contain `|`. The timestamp must be UTC in exactly `YYYY-MM-DDTHH:MM:SSZ` form — do not substitute
your own clock.

### S21. Re-run S18. Expect exit **0**.
Exit 0 prints `registration <id> complete, public, unembargoed, authoritative; protocol, tooling and registry
hashes match`. Read §9 of `REGISTRATION_READINESS_TABLE.md` before you treat exit 0 as certification: ten
registration-relevant properties are checked by no command at all.

---

## STAGE 6 — Before the held-out commitment is broadcast

### S22. Record and publish the rater assignment fingerprint. **This is a hard ordering rule.**
Once the raters and the rating adjudicator are named (S6), record which individual holds `rater-1`, `rater-2` and
`rating-adjudicator` in the personnel register, run `rater-assignment-fingerprint`, and **publish the SHA-256
before the held-out commitment transaction is broadcast** — §4A.3, protocol line 189, cross-referencing §12.1.
Publishing it afterwards destroys the guarantee and there is no repair. Nothing in the instrument checks this
timing (`REGISTRATION_READINESS_TABLE.md` §9 item 9), so it is on the operator alone.

### S23. Continue with Phase D of `OPERATOR_CHECKLIST.md`.
Frame construction (which §5.5.1 requires to follow registration, not precede it), the evidence bundle, and the
development commitment. Note that after step D4 the registered aggregate is on the blockchain.

---

## Ordering summary

| Stage | Can move the aggregate? | Can run in parallel with recruitment? |
|---|---|---|
| S0 corrections | No | — |
| S1-S5 DR-1, DR-2, re-verify, freeze | **Yes — the only window** | Yes |
| S6-S11 owner inputs | No | This *is* the recruitment |
| S12-S14 produce and fill the record | No | Yes |
| S15-S17 Bitcoin | No | Yes |
| S18-S21 register | No | No — needs S1-S17 |
| S22-S23 fingerprint, then frame | No | No |

**Exact next owner action: settle DR-1 and DR-2 in writing (S1, S2), and start recruitment (S6) the same day.**

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

