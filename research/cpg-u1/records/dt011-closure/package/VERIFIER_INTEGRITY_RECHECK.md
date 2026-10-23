# VERIFIER_INTEGRITY_RECHECK — DEEPTECH-PARALLEL-011, registration-package stream

Directive §12. Re-verification of the registration verifier itself against the candidate
instrument, after DR-1, DR-10 and `enumerated_by` landed.

**Nothing was registered. No network call, no credential, no OSF action, no Bitcoin action.**
**Nothing was written under `C:/tmp/dt009-merge`** (see *Isolation* below).

## 0. What was tested, and against what

| | |
|---|---|
| Candidate instrument | `C:/tmp/dt009-merge/tooling` |
| Aggregate (recomputed, not transcribed) | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| File count (recomputed) | 594 |
| Verifier under test | `cpg_u1_data.mjs verify-registration` → `registered()` → `lib/registration.mjs checkRegistration()` / `checkAuthority()` |
| Scratch copy actually executed | `<scratchpad>/vi/tooling`, aggregate recomputed as `638d68e6…78fd2`, 594 files — **byte-identical to the candidate** |
| Protocol | `CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Development-only registry | `rules/development_only_registry.json`, sha256 `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` |

All outputs were written **outside** the tooling tree, so the aggregate of the scratch copy is
unchanged after every run (re-checked: `638d68e6…78fd2`, 594 files).

### Isolation

- `dt009-merge/tooling` aggregate re-measured after all work: `638d68e6…78fd2`, 594 files — unchanged.
- `find C:/tmp/dt009-merge -newermt '-120 minutes' -type f` → **empty**.
- `git status --short` in `C:/tmp/dt009-merge` shows only the pre-existing `?? CPG_U1_PROTOCOL_004.md`.

### The two validators use different environment variables

This was checked rather than assumed. Neither variable occurs anywhere in the candidate
(a recursive grep for `CPG_U1_TOOLING` / `CPG_U1_INSTRUMENT` over `C:/tmp/dt009-merge` returns no
hits). They belong to the two *packet* validators outside the instrument:

- `D-reference/REFERENCE_PACKET_VALIDATOR.mjs` reads **`CPG_U1_INSTRUMENT`** (optional: unset → it
  runs on inlined constants and says so, *not cross-checked*).
- `E-rating/RATING_PACKET_VALIDATOR.mjs` and `H-automation/tools/instrument.mjs` read
  **`CPG_U1_TOOLING`** (required: unset → refuses).

Consequence for this package: a reader who sets only one of the two gets a *silently
un-cross-checked* reference-packet validation. `RATING_PACKET_VALIDATOR.mjs` additionally still
names the **old** registered tooling (593 files, aggregate `f7699f05…e5cc5dd`) in its own error
text — it has not been updated to the 594-file candidate.

## 1. The eight properties, each with the state under which it actually holds

Summary first. "Holds" means *unconditionally*; "conditional" means the property is real but only
reachable in a particular record state; "does not hold" means a real bypass was demonstrated.

| # | Property | Verdict |
|---|---|---|
| 1 | Cannot pass while a required field is UNASSIGNED | **HOLDS for the exact sentinel `UNASSIGNED`. DOES NOT HOLD for whitespace/case variants of it (DR-12 still open).** Bounded: the bypass can never reach exit 0. |
| 2 | Cannot pass with a synthetic/test value outside test mode | **HOLDS only against the instrument's own `SYNTHETIC` token.** A non-`SYNTHETIC` placeholder passes with **exit 0**. |
| 3 | Cannot pass with a wrong protocol SHA | **CONDITIONAL — holds only once all blockers are cleared.** Masked at exit 4 while any blocker remains. |
| 4 | Cannot pass with a wrong tooling aggregate | **CONDITIONAL — holds only once all blockers are cleared.** Masked at exit 4 while any blocker remains. |
| 5 | Cannot pass with a wrong registry or evaluation-tree identity | **Registry: partly unconditional, partly conditional — holds. Evaluation tree: DOES NOT HOLD — `verify-registration` never checks it.** |
| 6 | Cannot pass with an inconsistent provider configuration hash | **DOES NOT HOLD.** Only UNASSIGNED and malformed are caught; a plausible wrong 64-hex value passes with **exit 0**. |
| 7 | Exit codes distinct and meaningful | **HOLDS with two defects:** code 3 (HALT) is declared but unreachable anywhere; code 1 conflates "record refused" with "input unreadable". |
| 8 | Fails closed on malformed input | **HOLDS** (every malformed input is non-zero). Two paths fail via an *uncaught Node exception with a stack trace* rather than a controlled `ERROR:` line. |

---

### Property 1 — cannot pass while any required field is UNASSIGNED

**State under which it holds: unconditionally, for the literal sentinel `UNASSIGNED`.**
**State under which it fails: whitespace- or case-variant sentinels (DR-12), which suppress
blockers without raising an error.**

Run **R1** — the template exactly as `registration-fields` writes it:

```
$ node cpg_u1_data.mjs verify-registration --registration reg_template.json \
    --registry rules/development_only_registry.json --protocol CPG_U1_PROTOCOL_004.md \
    --identity-registrations idreg_empty.json
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
EXIT=4
```

**Ten blockers, zero errors, exit 4.** Note the count: the established baseline for this check was
**9**; the candidate reports **10**, because the §19.1 freeze set now also carries `as_of` and
`provider_configuration_sha256`. The verifier invents nothing.

**DR-12 reproduced on the candidate — it is NOT fixed.** `assigned()` in
`lib/registration.mjs:98` is an exact, case-sensitive, untrimmed comparison against the sentinel,
so `' UNASSIGNED '`, `'unassigned'`, `'Unassigned'` and `'UNASSIGNED<TAB>'` are all treated as
*assigned values*.

Run **R16** — two fields carrying variant sentinels: **8** blockers, 0 errors, **EXIT=4**.

Run **R17** — all five format-unvalidated string fields carrying variant sentinels:

```
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
  BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)
ERROR: BLOCKED — 5 named prerequisite(s) missing; the tooling will not invent them
EXIT=4
```

**10 → 8 → 5 blockers, exit 4, zero errors throughout.** The reported prerequisite count is
understatable by up to five, and every one of the five suppressible fields is a human identity
leaf: `bitcoin_key_custodian.value`, `accountable_identity.value`, `persistent_identifier.type`,
`persistent_identifier.value`, `registration_id`.

**Severity bound — run R18**, the bypass applied to all ten blocked fields at once:

```
  ERROR   registration_timestamp must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ
  ERROR   outpoint must be "<64 lowercase hex txid>:<vout>" (got unassigned)
  ERROR   checkpoint must be {height: integer, hash: 64 hex}
  ERROR   as_of must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ
  ERROR   provider_configuration_sha256 must be 64 lowercase hex characters
ERROR: registration record refused (5 error(s))
EXIT=1
```

So DR-12 **cannot drive the verifier to exit 0**: the five format-validated fields still refuse.
DR-12 is a *reporting-integrity* defect — it understates how many prerequisites remain, and it
removes the named-blocker guarantee for exactly the five human identity leaves — not an
authorisation bypass.

### Property 2 — cannot pass with a synthetic/test value outside test mode

**State under which it holds: unconditionally, for any value whose upper-cased form contains the
token `SYNTHETIC`.**
**State under which it fails: any other placeholder token. Those pass with exit 0.**

Run **R2** (complete record, `--allow-synthetic`) then **R3** (same record, flag removed):

```
R2: registration SYNTHETIC-REG-10.00000/SYNTHETIC complete, public, unembargoed, authoritative;
    protocol, tooling and registry hashes match
    EXIT=0

R3:   ERROR   network must be bitcoin-mainnet
      ERROR   bitcoin_key_custodian.value is a SYNTHETIC test value — refused outside test mode
      ERROR   accountable_identity.value is a SYNTHETIC test value — refused outside test mode
      ERROR   persistent_identifier.type is a SYNTHETIC test value — refused outside test mode
      ERROR   persistent_identifier.value is a SYNTHETIC test value — refused outside test mode
    ERROR: registration record refused (5 error(s))
    EXIT=1
```

The synthetic gate and the mainnet pin both engage. But the detector is an
upper-cased substring test for `SYNTHETIC` (`lib/registration.mjs:106`) — a naming convention, not
a fake-value detector.

Run **R28** — the same record with non-`SYNTHETIC` placeholders and `network: bitcoin-mainnet`,
**no** `--allow-synthetic`:

```
accountable_identity.value    = "TBD"
persistent_identifier.type    = "PLACEHOLDER"
persistent_identifier.value   = "0000-0000-0000-0000"
bitcoin_key_custodian.value   = "TBD"
registration_id               = "TBD-REG"

registration TBD-REG complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match
EXIT=0
```

**Exit 0.** There is no ORCID/ROR syntax check, no registry-resolvability check, and no
placeholder vocabulary beyond `UNASSIGNED` and `SYNTHETIC`. An operator who filled the five
identity leaves with `TBD` would get a clean pass. This is the same class of defect as DR-12
approached from the other side, and it is **not** covered by DR-12's fix.

### Property 3 — cannot pass with a wrong protocol SHA

**State under which it holds: only once every blocker is cleared.**

Run **R4** — complete record, `protocol_sha256` set to a plausible wrong 64-hex value:

```
ERROR: VERIFY_ABORT_HASH_MISMATCH: --protocol does not hash to the registered protocol_sha256
EXIT=1
```

Run **R30** — the *same* wrong `protocol_sha256` on the UNASSIGNED template:

```
  … 10 BLOCKED lines …
ERROR: BLOCKED — 10 named prerequisite(s) missing; the tooling will not invent them
EXIT=4
```

The mismatch is never mentioned. Cause: `registered()` (`cpg_u1_data.mjs:174-184`) calls
`reportRegistrationCheck(...)` **first**, which exits 4 on blockers, and only then compares the
protocol hash. The command still fails (exit 4 ≠ 0), so nothing is *authorised*, but a reader
working down the blocker list has no indication that the protocol hash is also wrong.

### Property 4 — cannot pass with a wrong tooling aggregate

**State under which it holds: only once every blocker is cleared.** This confirms the established
finding, with the precise mechanism.

Run **R5** — complete record, `tooling_aggregate_sha256` = a plausible wrong 64-hex value:

```
ERROR: VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2) is not the registered tooling
EXIT=1
```

Once blockers are clear the comparison **is** reached, it fails, and the message names the real
aggregate. Run **R6** — the same wrong aggregate on the UNASSIGNED template:

```
  … 10 BLOCKED lines …
ERROR: BLOCKED — 10 named prerequisite(s) missing; the tooling will not invent them
EXIT=4
```

Precise restatement of the established fact: it is **not** that a wrong aggregate "passes" — the
command exits 4. It is that the wrong aggregate is **never reported** while any blocker remains,
because `registered()` reports blockers before the comparison is reachable. Property 4 therefore
**holds only in the all-blockers-cleared state**, which is exactly the state a real registration
would be in. At registration time the property is sound; during preparation it is silent.

### Property 5 — cannot pass with a wrong registry or evaluation-tree identity

Three distinct sub-properties, three different verdicts.

**5a Registry *settings* (name, public, embargo) — HOLDS unconditionally.** Errors are reported and
failed *before* the blocker check, so they surface even on the UNASSIGNED template.

```
R8  (complete record, registry.name = "AsPredicted"):
      ERROR   registry.name must be OSF Registries (U1)
    ERROR: registration record refused (1 error(s))
    EXIT=1
R29 (UNASSIGNED template, registry.name = "AsPredicted"):
      … 10 BLOCKED lines, then …
    ERROR: registration record refused (1 error(s))
    EXIT=1
```

Note R29's exit code: **1, not 4** — the error wins over the blockers.

**5b Registry *content* hash — CONDITIONAL, holds once blockers are cleared.**

```
R7: ERROR: VERIFY_ABORT_HASH_MISMATCH: development-only registry differs from the registered registry_sha256
    EXIT=1
```

Same masking as properties 3 and 4: this comparison sits in `cmdVerifyRegistration` *after*
`registered()`.

**5c Registry *authority* (the identity's registration listing) — CONDITIONAL, holds once blockers
are cleared, and the exit code is correctly distinct (6 = VOID).**

```
R9  earlier registration exists:
    ERROR: STUDY_VOID_REGISTRATION: an earlier registration (SYNTHETIC-REG-EARLIER) exists for CPG-U1-2026-01 — this record is not authoritative
    EXIT=6
R10 duplicate with different sampling fields:
    ERROR: STUDY_VOID_REGISTRATION: duplicate registration SYNTHETIC-REG-DUP names different sampling fields — study VOID
    EXIT=6
R11 withdrawn registration in the listing:
    ERROR: STUDY_VOID_REGISTRATION: a registration for this study was withdrawn — study VOID
    EXIT=6
R12 record absent from the listing:
    ERROR: identity registration list refused: the registration is not in the identity registration list
    EXIT=1
```

**5d Evaluation-tree identity — DOES NOT HOLD. `verify-registration` never checks it.**

The registration record has **no evaluation-tree field at all**: `registrationTemplate()` emits
`protocol_sha256`, `tooling_aggregate_sha256` and `registry_sha256` and nothing about the resolver.
The evaluation tree is bound only *through* the protocol document (§7.1), and is verified by a
**separate command**, `verify-evaluation-tree`, which `verify-registration` does not invoke.

So a registration can pass `verify-registration` with exit 0 while the clone that will actually be
run is a different resolver. The binding is real but indirect: §7.1's three values sit in the
protocol text, whose sha256 *is* registered — so substituting the evaluation tree requires editing
the protocol, which changes `protocol_sha256` and is then caught by property 3. That is an adequate
chain, but it is a **transitive** guarantee through the protocol document, not a check the
registration verifier performs. Deriving the declared identity from the protocol (real, recomputed
here, not transcribed):

```
commit    f01a7eb4199be4e04d4fee7fc0116303949dc553
tree      3b4811fc88e9fbb64ee42c37c4aacca2e76c67af
aggregate ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5  (11552 files)
domain    cpg-u1-evaluation-tree/v1
```

### Property 6 — cannot pass with an inconsistent provider configuration hash

**State under which it holds: only for the sentinel and for a malformed value.**
**State under which it fails: a plausible wrong 64-hex value passes with exit 0.**

```
R14 provider_configuration_sha256 = "UNASSIGNED":
      BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)
    ERROR: BLOCKED — 1 named prerequisite(s) missing; the tooling will not invent them
    EXIT=4

R13 provider_configuration_sha256 = "abc":
      ERROR   provider_configuration_sha256 must be 64 lowercase hex characters
    ERROR: registration record refused (1 error(s))
    EXIT=1

R15 provider_configuration_sha256 = "ffff…ffff" (plausible, wrong):
    registration SYNTHETIC-REG-10.00000/SYNTHETIC complete, public, unembargoed, authoritative;
    protocol, tooling and registry hashes match
    EXIT=0
```

`checkRegistration` validates **shape only** (a 64-lowercase-hex test). Nothing in the registration
path recomputes the hash. The consistency binding exists, but entirely **downstream**:

| Where | Check |
|---|---|
| `lib/harness.mjs:54` | `PROVIDER_CONFIG_MISMATCH` — the resolver clone's recomputed hash vs the registered one, at run start |
| `lib/execution.mjs:69` | the execution authorisation carries the registered hash forward |
| `lib/evaluation.mjs:130` | `WRONG_TREATMENT` — the run's hash vs the authorised one |

This is the *same* structural shape as the property-4 finding, with one difference that matters: a
wrong `tooling_aggregate_sha256` **is** compared once blockers clear (R5), whereas a wrong
`provider_configuration_sha256` is **never** compared by `verify-registration` in any state. The
value must therefore be **derived** before registration and checked by hand against the resolver;
the verifier will not catch a transcription error. The correct value, derived here from the pinned
evaluation tree rather than transcribed:

```
domain  cpg-u1-provider-config/v1
files   backend/services/companyProfile/grounding/registry/builtins.ts          ab9b944318add9af97642bda7d03003ac5ba74817704a57e8064039b46db85bb
        backend/services/companyProfile/grounding/registry/coverageInventory.ts 07506ff2cb569bc781a8d437562eaf130a6beb7c2ba939a1d3181834e3319fc1
result  c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561
```

### Property 7 — exit codes distinct and meaningful

**State under which it holds: unconditionally, with two defects.**

Declared set (`cpg_u1_data.mjs:53`, with the meaning comment at line 52) — every exit code the
instrument can return:

| Code | Name | Meaning | Reachable from `verify-registration`? | Evidence |
|---|---|---|---|---|
| **0** | — | OK: complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match | **yes** | R2, R15, R28 |
| **1** | `REFUSED` | Refused / abort: a malformed or forbidden record field; `VERIFY_ABORT_HASH_MISMATCH`; identity-list refused; a missing required `--flag`; an unreadable input file | **yes** | R3, R4, R5, R7, R8, R12, R13, R18, R19–R27 |
| **2** | `POOL` | Held-out pool below the §5.7 minimum | no — `draw-development` / `pool-check` / `draw-held-out` only (lines 452, 518, 547) | n/a |
| **3** | `HALT` | §18 halt condition | **no — unreachable from anywhere.** `EXIT.HALT` is declared at line 53 and referenced **nowhere** in the instrument (recursive grep for `EXIT.HALT` → no hits) | dead code |
| **4** | `BLOCKED` | A named human prerequisite is missing; the tooling will not invent it | **yes** | R1, R6, R14, R16, R17, R30 |
| **5** | `WAITING` | A sampling state that is neither FINAL nor VOID (awaiting depth / drand) | no — only via `stateExit()` from `verify-sampling` / `verify-commitment` (lines 409, 420) | n/a |
| **6** | `VOID` | `STUDY_VOID_*` / `STAGE_VOID_*`: the study or stage is void | **yes** | R9, R10, R11 |

Two defects:

1. **Code 3 (HALT) is declared but unreachable.** The §18 halt rules are enforced by other means
   (VOID states, refusals); no code path returns 3. The enumeration is *distinct* but not
   *complete*: an outsider told "exit 3 means HALT" will never observe it.
2. **Code 1 conflates two very different situations.** A *refused record* (R3: five substantive
   errors) and an *unreadable input* (R19 malformed JSON, R24 file not found) both exit 1. The first
   means "this registration is wrong"; the second means "the verifier could not read your file". An
   outsider scripting §21 step 2 on exit codes alone cannot tell them apart.

Additionally, R29 shows a record with **both** errors and blockers exits **1**, not 4 — errors take
precedence. Defensible, but worth stating plainly: exit 4 means "blockers **and no errors**".

### Property 8 — fails closed on malformed input

**State under which it holds: unconditionally. Every malformed input produced a non-zero exit.**

| Run | Input | Result | Exit |
|---|---|---|---|
| R19 | registration file is invalid JSON | `SyntaxError: Expected property name or '}' …` + **stack trace** | 1 |
| R20 | registration is a JSON string | `ERROR registration record missing` | 1 |
| R21 | registration is `null` | `ERROR registration record missing` | 1 |
| R22 | registration is `[]` | 6 structural errors (schema, study_id, protocol_version, three hashes) | 1 |
| R23 | identity-registrations file is invalid JSON | `ERROR: identity registration list refused: Expected property name or '}' …` | 1 |
| R24 | registration file does not exist | `Error: ENOENT: no such file or directory` + **stack trace** | 1 |
| R25 | `--registration` omitted | `ERROR: --registration is required` | 1 |
| R26 | `--registry` omitted | `ERROR: --registry is required` | 1 |
| R27 | `--identity-registrations` omitted | `ERROR: --identity-registrations is required` | 1 |

It fails closed. Two presentation defects:

- **R19 and R24 fail via an uncaught Node exception**, not a controlled `ERROR:` line. The JSON and
  file reads are unguarded inside `cmdVerifyRegistration`, and the top-level
  `Promise.resolve(COMMANDS[cmd](o)).catch(...)` (line 1139) cannot catch a **synchronous** throw
  from `COMMANDS[cmd](o)` — the argument is evaluated before `Promise.resolve` sees it. The exit
  code is still 1, so the *security* property holds; the *diagnostic* property does not.
- **The handling is asymmetric.** The identity-registrations parse **is** wrapped (R23 gives a clean
  message), the registration parse is not. Same file class, two different behaviours.

## 2. What DR-1, DR-10 and `enumerated_by` changed, as observed

| Item | Observed state in the candidate |
|---|---|
| DR-1 — drand relay floor | **landed and enforced.** `lib/evidenceBundle.mjs` (lines 18, 41, 50) refuses any round attested by fewer than `MIN_DRAND_RELAYS` differently named relays, and keeps the relay names in the bundle so the claim is auditable. `verify-sampling` now prints `drand_relays`. Protocol §19.3 states "≥ 2 drand relays for verification" and "certenv with a fixture tenant". |
| DR-10 — analysis decisions | **landed.** `rules/analysis_decisions.json` status is now `DECIDED`; all **9** of AD-1…AD-9 carry values, none UNDECIDED. `analyze` refuses at exit 4 while any is UNDECIDED, so this being decided is a registration prerequisite now met. The file is inside the tooling tree, so the nine values are frozen by the aggregate. |
| `enumerated_by` | **landed.** A `FRAME_COLUMNS` member (`lib/schema.mjs:32`), required non-blank (line 124), and resolved against the restricted personnel register by `lib/enumeration.mjs`. Because it is a frame column, re-attribution changes `frame_hash` — enumeration attribution is bound by the committed frame, not by a side file. |
| §19.1 blocker set | grew from **9 to 10** (`as_of`, `provider_configuration_sha256`). |
| DR-12 | **NOT landed.** Reproduced above (R16, R17, R18). |

## 3. Residual verifier defects, ordered by consequence

1. **DR-12 open** (property 1). Blocker counts are understatable by up to five; all five are human
   identity leaves. Fix: compare against the sentinel case-insensitively after trimming, and treat a
   trimmed-empty or sentinel-like value as UNASSIGNED.
2. **No placeholder-vocabulary or identifier-syntax check** (property 2, R28). `TBD`, `PLACEHOLDER`
   and a bare `0000-0000-0000-0000` all pass with exit 0 outside test mode.
3. **`provider_configuration_sha256` is never compared at the registration boundary** (property 6,
   R15). A transcription error survives to run time.
4. **Blocker-before-comparison ordering** (properties 3, 4, 5b). Hash mismatches are invisible while
   any blocker remains. Fix: collect hash mismatches as *errors* alongside the blocker list instead
   of exiting first.
5. **Evaluation-tree identity is not checked by `verify-registration`** (property 5d). It is only
   transitively bound through `protocol_sha256`; `verify-evaluation-tree` must be run separately.
6. **Exit code 3 (HALT) is dead**; exit code 1 conflates refusal with unreadable input (property 7).
7. **Unguarded JSON/file reads** produce stack traces (property 8, R19/R24).
8. **`RATING_PACKET_VALIDATOR.mjs` still names 593 files / `f7699f05…e5cc5dd`** as the registered
   tooling — stale against the 594-file candidate.

None of 1–8 lets a wrong registration reach exit 0 *once the record is complete and correct*.
Items 2, 3 and 5 do let a **substantively wrong** complete record reach exit 0.
