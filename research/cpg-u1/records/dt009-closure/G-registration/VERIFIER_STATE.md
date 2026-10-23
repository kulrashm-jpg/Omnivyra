# CPG-U1 — VERIFIER STATE, MEASURED (DEEPTECH-PARALLEL-009)

**CLASSIFICATION: MEASUREMENT.** Every exit code below was read from `$?` immediately after the command, with
**stdout and stderr redirected to files**, never through a pipe. A pipe replaces the exit status with the last
element's status and has misled a prior session; that is why no `| head`, `| grep` or `| tee` appears between a
command and its status here. Nothing was registered, submitted, published or broadcast; the instrument was run
read-only from `C:/tmp/dt002/research/cpg-u1/tooling` and nothing was written to it.

## 0. Instrument identity at the moment of measurement

Recomputed with `toolingManifest()` (`lib/aggregate.mjs`) immediately **before** and **after** the runs below,
both times giving the same result:

```
593 f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
```

So the measurements are against the pre-wave instrument, 593 files, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`. The worktree's own 587-file
`research/cpg-u1/tooling` (`640510...`) was **not** read; it would run cleanly and produce a self-consistent
wrong aggregate, which is exactly the failure mode `verify-registration` cannot detect before registration.

Exit codes, from `cpg_u1_data.mjs:52`:
`{ REFUSED: 1, POOL: 2, HALT: 3, BLOCKED: 4, WAITING: 5, VOID: 6 }`.

---

## 1. RUN 1 — the draft record, minimal invocation

Working directory `C:/tmp/dt002/research/cpg-u1/tooling`.

```
node cpg_u1_data.mjs verify-registration \
  --registration C:/tmp/dt004-operations/registration/registration_record.DRAFT.json \
  > <scratchpad>/verifyreg.stdout.txt 2> <scratchpad>/verifyreg.stderr.txt
rc=$?
```

### REAL EXIT CODE: **4** (`EXIT.BLOCKED`)

**stdout: 0 bytes — completely empty.**

**stderr, verbatim** (`sha256` of the captured stderr file:
`607eafc04e7a1db369ab6ae3c420ad48b7c5151b9b543b6e208e082bddea5437`):

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

**Counts, measured with anchored patterns rather than eyeballed:**

| Pattern | Count |
|---|---|
| lines matching `^  BLOCKED ` | **9** |
| lines matching `^  ERROR   ` | **0** |

The trailing `ERROR: BLOCKED — 9 named prerequisite(s) missing` line is `fail()`'s own summary, not a
check-level error; it contains the substring `BLOCKED `, so an unanchored `grep -c 'BLOCKED '` returns **10**
and is wrong. Use the anchored form.

**NINE BLOCKED. ZERO ERRORS.** The zero is the significant number: every field an agent is permitted to fill
is filled and valid, so nothing remains that is not genuinely external.

## 2. RUN 2 — the draft record, full invocation with all four inputs

The same record with `--registry`, `--protocol` and `--identity-registrations` supplied, to confirm the result
is not an artefact of a missing argument:

```
node cpg_u1_data.mjs verify-registration \
  --registration C:/tmp/dt004-operations/registration/registration_record.DRAFT.json \
  --registry rules/development_only_registry.json \
  --protocol C:/tmp/dt4-uncert/research/cpg-u1/CPG_U1_PROTOCOL_004.md \
  --identity-registrations /dev/null \
  > <scratchpad>/full.stdout.txt 2> <scratchpad>/full.stderr.txt
rc=$?
```

### REAL EXIT CODE: **4**. stdout 0 bytes. stderr byte-identical to RUN 1 — the same nine lines and the same
summary, 9 BLOCKED, 0 ERROR.

**Why identical:** `cmdVerifyRegistration` calls `registered(o)`, whose **first** act is
`reportRegistrationCheck(checkRegistration(reg, { phase: 'registered' }))`. That refuses and exits before the
registry hash comparison, the protocol hash comparison, the tooling-aggregate comparison and
`checkAuthority()` are ever reached. **Those four comparisons are therefore still unexercised** and will
remain so until the nine blockers clear. In particular, the aggregate comparison
(`aggregate !== reg.tooling_aggregate_sha256` → `VERIFY_ABORT_HASH_MISMATCH`) has **never yet run against a
real registered value**, because there is no registered value.

## 3. RUN 3 — counterfactual, confirming `ERRATA.md` E-2

The same command against `registration_fields.TEMPLATE.json`, which differs from the draft in exactly one
leaf (`provider_configuration_sha256` is `UNASSIGNED` rather than `c9a7e9aa...627561`):

### REAL EXIT CODE: **4**. **10** lines matching `^  BLOCKED `, and the extra line is exactly:

```
  BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)
```

with the summary reading `10 named prerequisite(s) missing`. The reduction from 10 to 9 is attributable to the
provider-configuration hash and to nothing else. **E-2 re-confirmed in this wave.**

## 4. RUN 4 — the provisional-aggregate placeholder is REFUSED, not silently accepted

This is a property worth having on the record, because `DECISION_DISCLOSURES.md` and
`PROVISIONAL_AGGREGATE_HANDLING.md` both carry the literal marker
`<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>` where a digest will
eventually go. A copy of the draft record was made **in the scratchpad** with `tooling_aggregate_sha256` set
to that marker and nothing else changed:

### REAL EXIT CODE: **1** (`EXIT.REFUSED`), stderr verbatim:

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

**The placeholder cannot be registered by accident.** The `HEX64` check
(`lib/registration.mjs`, `for (const k of ['protocol_sha256','tooling_aggregate_sha256','registry_sha256'])`)
makes it a hard ERROR and downgrades the exit code from BLOCKED(4) to REFUSED(1), which is a *louder* failure.
The **draft on disk at `C:/tmp/dt004-operations/registration/registration_record.DRAFT.json` was not
modified** — the placeholder copy lives only in this session's scratchpad and is disposable.

---

## 5. Does the verifier still refuse? **YES.**

**`verify-registration` currently refuses the draft registration record with exit code 4, nine named blockers
and zero errors, and that is the correct and intended state.** Nothing in DEEPTECH-PARALLEL-009 changed it,
and nothing in this wave attempted to change it.

**It must keep refusing until the real external values exist.** Stated plainly, because it is the property
most at risk of being "fixed":

- The nine blockers are not defects and not an incomplete document. They are the nine facts about the world
  that do not yet exist: who is accountable, under which persistent-identifier scheme and with which issued
  identifier, who holds the Bitcoin keys, what OSF issues at submission (two values), which two Bitcoin
  outputs were funded, which block is the checkpoint, and which single instant is `as_of`.
- `checkRegistration`'s `human()` helper accepts **any** non-blank string that does not contain `SYNTHETIC`.
  There is no ORCID checksum, no ROR pattern, no DOI resolution, no block-hash lookup, no OSF query — the
  module's own header comment says "It cannot see the registry; outsiders confirm the record there." **A
  plausible invention would therefore turn exit 4 into exit 0 and the verifier would not object.** That is the
  precise reason an agent is forbidden to fill any of them, and the reason exit 4 is the honest state rather
  than an unfinished one.
- Exit 0 from this command would **not** mean the study is sound. Section 9 of
  `C:/tmp/dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md` enumerates ten registration-relevant
  properties that no command in the instrument validates, including whether any independence declaration is
  true, whether `enumerated_by` corresponds to a registered person, whether the checkpoint is a real block,
  and whether the instrument being run is the one described.
- **Turning exit 4 into exit 0 is therefore a measure of the world catching up with the record, not of work
  done on the record.** The record is, as far as any agent may take it, complete: zero errors.

**Expected trajectory, from `OPERATOR_REGISTRATION_SEQUENCE.md`:** the count falls from 9 as the owner
supplies the five owner-input values and the custodian creates the outputs and chooses the checkpoint; the
last two (`registration_id`, `registration_timestamp`) can only clear **after** submission, so the final
pass to exit 0 necessarily happens post-submission. A single exit-0 run before submission is impossible by
construction, and anyone reporting one has fabricated two values.

## 6. What this measurement does NOT establish

1. **That the registered aggregate will be right.** The aggregate comparison never ran (section 2). Before
   registration there is no registered value to compare against, and `toolingManifest(ROOT)` hashes whatever
   tree it is invoked in — so a swapped tree is self-consistent. See `PROVISIONAL_AGGREGATE_HANDLING.md`.
2. **That the post-DR-1/DR-10 instrument passes anything.** These runs measured the **pre-wave** instrument.
   The post-merge tree must be re-measured in full — self-test, anchor count, a full mutation run with every
   mutant KILLED, adapter conformance — in a separate act, and this document makes no claim about it.
3. **That the registry, protocol and authority checks pass.** They were not reached. `--identity-registrations
   /dev/null` in RUN 2 was never parsed; had execution reached `checkAuthority`, an empty list would have been
   refused as "the registration is not in the identity registration list".
4. **Anything about personnel.** `checkRegistration` never mentions personnel, so no run above says anything
   about the roster. See `ENUMERATOR_B_IN_REGISTRATION.md`.

## 7. Reproduction discipline, for whoever repeats this

```
cd C:/tmp/dt002/research/cpg-u1/tooling
node cpg_u1_data.mjs verify-registration --registration <record> > out.txt 2> err.txt
echo "exit=$?"            # read it here, and nowhere else
grep -c '^  BLOCKED ' err.txt
grep -c '^  ERROR   ' err.txt
```

Three rules: **(1)** never pipe the command — read `$?` on the next line; **(2)** anchor the count patterns to
`^  `, or the summary line inflates the BLOCKED count by one; **(3)** recompute the aggregate before and after,
so the run is attributable to a known tree.
