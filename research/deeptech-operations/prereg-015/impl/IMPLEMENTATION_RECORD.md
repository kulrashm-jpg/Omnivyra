# PREREG-015 — approved batch applied as ONE change set to the CPG-U1 tooling candidate

Candidate tree: `C:/tmp/dt013-candidate/tooling`
Status: IMPLEMENTED · NOT REGISTERED · NOT FUNDED · NOT EXECUTED · NOT COMMITTED · DISPOSABLE

| | value |
|---|---|
| Pre-edit aggregate (verified before any edit) | `b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` · 595 files |
| **Post-edit aggregate** | **`7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` · 595 files** |
| Protocol `CPG_U1_PROTOCOL_004.md` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (unchanged) |
| `rules/development_only_registry.json` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` (unchanged) |
| Evaluation tree (§7.1) | commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`, tree `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`, aggregate `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5`, 11552 files (unchanged) |
| Provider configuration (§13.1) | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` (unchanged) |
| Mutant population | 441 -> **458**; max allocated M467 -> **M484** |
| Selftest | **1253 passed, 0 failed, exit 0** |
| `test/mutate.mjs --anchors` | **458/458 occur exactly once**, exit 0 |

The aggregate was re-derived with the tree's own `lib/aggregate.mjs` `toolingManifest()` (never
`xargs sha256sum | sha256sum`). The file count is unchanged at 595: no file was added or removed.

Changed files (5):

- `cpg_u1_data.mjs` — DR-11, F3
- `lib/registration.mjs` — F1, F4b
- `lib/identity.mjs` — F4 (a) and (b), the narrowed token list, the demotion-only contract
- `README.md` — F2
- `test/mutate.mjs`, `test/selftest.mjs` — mutants and assertions (6 files in total with the tests)

Nothing outside the candidate tree was touched. `CPG_U1_PROTOCOL_004.md`, the frozen treatment, the
evaluation tree, `rules/development_only_registry.json` and `C:/tmp/dt4-legal` are untouched.

---

## 1. DR-11 — duplicate `scan.results` refusal (ADOPT)

`cpg_u1_data.mjs` `contamination()`, inserted **after** the `frame_hash` and `registry_sha256` checks
and **immediately before** `const byId = new Map(scan.results.map(...))`.

The `new Map(scan.results.map(...))` keeps only the LAST result for a repeated `candidate_id`. An
earlier occurrence — and every contamination reason it carried — vanished silently, while the
artefact's `frame_hash` (checked one line above) still attested to the whole frame. DR-10 closed the
same collapse on the FRAME inside the `scan` command; the scan ARTEFACT is a separate input, read by
all four sampling commands, and a hand-edited, concatenated or reordered artefact can repeat an id
without any frame ever doing so.

The guard tallies occurrences over **`scan.results`** (not `frame`, which is already guarded at the
`frame_hash` comparison), and on any count > 1 prints, for **each** occurrence: its ordinal, its own
`held_out_ineligible_by_scan`, its own `repository_hits` as `CPG-C1(1) repository <scope> <file>:<line>`
and its own `registry_matches` as `CPG-C1(6) development-only registry <entry_id> (<matched>)` — so the
occurrence the old code dropped stays attributable. It then `fail(...)`s at exit 1 (`EXIT.REFUSED`)
naming `scanPath`, writing no artefact. One guard, all four call sites.

The message is `SCAN_RESULT_DUPLICATE_REFUSED: ...`, textually disjoint from the neighbouring
`scan was produced for a different frame (frame_hash mismatch)` and `scan has no result for ...`, and
the selftest asserts the other two are **absent** from the output, so a test can prove which guard fired.

**Deliberately excluded, and asserted absent**: no `results.length === frame.length` cardinality check
and no refusal of unknown ids. A scan with an extra result for an id the frame does not contain is
still accepted (selftest: `DR-11 scope control`).

## 2. F3 — supplied-but-missing resolver clone

`cpg_u1_data.mjs` `resolverCloneFor`. `return c && existsSync(c) ? c : null` converted an **explicitly
supplied but nonexistent** path into "no clone supplied". `checkProviderConfiguration` then returned
NOT_COMPARED, so a **wrong or stale** but well-formed `provider_configuration_sha256` exited **0 as
ESTABLISHED** — violating R15's required outcome *stale -> BLOCKED* — and the printed reason
("no resolver clone was supplied") was factually false, because one was.

Three states are now distinguished:

| state | outcome |
|---|---|
| supplied and readable | compared, exactly as before |
| **supplied and missing** | **`RESOLVER_CLONE_NOT_FOUND`, exit 1**, naming the flag or the env var it came from and the exact path |
| genuinely not supplied | `null`, and the existing honest `NOT_COMPARED` verdict at exit 0, unchanged |

An empty `CPG_U1_RESOLVER_CLONE` still means "not set" (`||`, not `??`), so the selftest's
`env: { CPG_U1_RESOLVER_CLONE: '' }` runs keep exercising genuine absence. A valueless
`--resolver-clone` (flag with no path) keeps its existing fall-through to the environment variable:
that is an argument-parsing question, not the missed refusal F3 names.

Real output:

```
ERROR: RESOLVER_CLONE_NOT_FOUND: --resolver-clone names "C:/tmp/no-such-clone", which does not exist. ...
exit=1
```

## 3. F1 — `checkpoint` routed through the normalised sentinel test

`lib/registration.mjs`. `cp.height === UNASSIGNED || cp.hash === UNASSIGNED` was the last untrimmed,
case-sensitive sentinel comparison in the tooling. An exact sentinel reached the blocker (exit 4); a
padded or mis-cased one (`" UNASSIGNED "`, `"unassigned"`) fell through to the format error and became
exit 1 "malformed" — the misrouting DR-12 removed everywhere else. It now goes through
`isReservedSentinel`, which is false for a numeric height and for `undefined`, so a genuine checkpoint
and a missing or wrongly typed one keep the exact routes they had.

Real output (`checkpoint: { height: "  unassigned ", hash: "  UnAssigned  " }`):

```
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
ERROR: BLOCKED — 1 named prerequisite(s) missing; the tooling will not invent them
exit=4
```

## 4. F4b — `registration_id` pipe guard no longer short-circuits classification

`lib/registration.mjs`. The `else if (reg.registration_id.includes('|'))` ran ahead of the
classification, so a piped id was refused without ever being classified and `identity.registration_id`
was simply absent — the one identity leaf the caller could not see. Classification now runs first for
every ASSIGNED value; the `|` refusal is unchanged, unweakened and additional. Both findings are
reported:

```
  ERROR   registration_id is malformed — value contains "|", the instrument's field separator in hashed and logged constructions
  ERROR   registration_id must not contain "|"
ERROR: registration record refused (2 error(s))
exit=1
```

## 5. F2 — the README claim inside the aggregate

`tooling/README.md`, pipeline step 2, previously *"complete, public, unembargoed, authoritative, hashes
match"* — the exact claim R28 moved into the verifier's `NOT ESTABLISHED by this verifier:` block.
README.md is inside the tooling aggregate, so that was a false claim in the frozen instrument. It now
reads what the verifier actually establishes (record complete and well-formed; `--protocol`, this
tooling and `--registry` hash to the registered values; earliest entry in the SUPPLIED
`--identity-registrations` list) and states explicitly that it does NOT establish public, unembargoed,
registry authority or any identity. The aggregate is not stated in the README (it is inside it) and the
v3-v6 changelog headings are not renumbered.

## 6. F4 — the owner's ruling

### (a) ZWNJ / ZWJ

`lib/identity.mjs` `INVISIBLE_RANGES`: `[0x200b, 0x200f]` swallowed U+200C ZWNJ and U+200D ZWJ.
Neither is decoration: ZWNJ is orthographically required in Persian and other Arabic-script languages
(it is what stops two letters joining into a different word) and both are required in Indic scripts to
select conjunct versus half-form spellings, so legitimate names were classified `MALFORMED` with no
override. The single range is replaced by `[0x200b, 0x200b], [0x200e, 0x200f]`. Everything else stays
refused: U+200B, U+200E, U+200F, U+202A-202E, U+2060-2064, U+206A-206F, U+FEFF, U+FFF9-FFFB, U+00AD,
U+061C, U+180E and C0/C1. Thirteen of those are asserted individually as still `MALFORMED`.

Every character in the new tests is built from code points, so neither the source nor the tests carry a
raw zero-width byte or any bidirectional text.

### (b) Prose screening

`attestationErrors` screened `attestation.method` as an identifier, so the truthful method
*"ROR REST API v2 lookup; no mock or specimen records used"* was refused for containing "mock" — the
honest answer rejected, with the incentive to write a vaguer one. The fields are now screened **by
kind**: `ATTESTATION_IDENTIFIER_FIELDS = ['authority', 'resolved_by']` keep the full identifier screen;
`ATTESTATION_PROSE_FIELDS = ['method']` get `screenProseValue`, which checks only what prose must be to
be readable and unambiguous (a non-empty string, not the reserved sentinel, no control / zero-width /
bidi characters) and never matches tokens. Any future prose-valued field belongs in that list.

### The distinction, exactly as implemented: why `TBD` is refused and `Test` is not

A hard refusal is a claim about the world — "no identity can be this string". Only a written rule can
support it, so the refusal list is exactly the tokens a governing document explicitly defines:

| token | rule |
|---|---|
| `UNASSIGNED` | protocol §5.5.1 defines it as the reserved not-yet-supplied value and requires refusal; it is a `PROTOCOL_MARKERS` entry. Handled as the sentinel, not as a token. |
| `TBD` | Wave-013 §3, explicitly |
| `PLACEHOLDER` | Wave-013 §3, explicitly |
| zero-pattern identifiers | Wave-013 §3, explicitly (`isZeroPattern`) |

`PLACEHOLDER_TOKENS` is therefore `['TBD', 'PLACEHOLDER']` (still squashed, so case and punctuation do
not evade), and the foreign synthetic-marker list (`FIXTURE`, `MOCK`, `FAKE`, `SPECIMEN`, `DONOTUSE`,
`DO-NOT-USE`, `SAMPLEDATA`, `LOREMIPSUM`) is gone.

`TBD` is refused because a document says that string is not an identity, so the instrument only repeats
what the document asserts. `Test`, `Na`, `None` and `Mock` are refused by no document: each is a real
surname or a real organisation name, so refusing them asserted something the instrument cannot know.
Matched as **substrings** it was worse — `MOCK` refused *Mocksville Chamber of Commerce* and `FAKE`
refused *Fakenham Medical Practice* over four letters of an unrelated word. Those values are not
thereby accepted as authoritative: they are not refused **here**, and they continue through the
existing identity-resolution and admissibility logic, where an unattested value comes out
`PLAUSIBLE_BUT_UNVERIFIED` and says so. The distinction is **refusal versus resolution**, and the
selftest asserts it both ways: five refusal cases with exact class, code and message fragment, and
twenty-three not-refused cases each pinned to `PLAUSIBLE_BUT_UNVERIFIED` /
`NO_AUTHORITY_ATTESTATION`, plus an assertion that not refusing them does not make them authoritative.

The instrument's **own** fixture marker `SYNTHETIC` is kept, still matched as a substring in any case,
because `--allow-synthetic`, `lib/schema.mjs` and every synthetic fixture depend on detecting it. It is
not a universal refusal: `lib/registration.mjs` exempts code `SYNTHETIC_MARKER` and lets
`--allow-synthetic` govern it.

### The demotion-only contradiction: I changed the CONTRACT, not the wiring

`lib/identity.mjs` documented screening as "can only ever DEMOTE a value", while
`lib/registration.mjs` pushes `MALFORMED` / `PLACEHOLDER_TOKEN` into `errors` — an exit-1 refusal.

I corrected the **contract**. The invariant the module actually holds, and the only one it can hold, is
about **promotion**: no screen and no number of passed screens raises a value above
`PLAUSIBLE_BUT_UNVERIFIED`; only a separately supplied attestation can. The doc overstated that as a
promise that a screen never refuses a record. The module header now states the promotion invariant
precisely and then names each class's actual disposition:

- `EMPTY`, `RESERVED_UNASSIGNED` -> `blockers`, exit 4, discharged by supplying the value (appealable);
- `MALFORMED_*` -> `errors`, exit 1;
- `PLACEHOLDER_TOKEN`, `ZERO_PATTERN` -> `errors`, exit 1;
- `SYNTHETIC_MARKER` -> governed by `--allow-synthetic`, refused only outside test mode;
- `PLAUSIBLE_BUT_UNVERIFIED`, `VALID_AUTHORITATIVE` -> accepted, reported with their class.

**Why the contract and not the wiring.** Each disposition is individually right: an unreadable identity
is a defective record with nothing to resolve, and an unsupplied one is a named prerequisite. The
alternative I considered and rejected was routing `PLACEHOLDER_TOKEN` / `ZERO_PATTERN` to `blockers`
(exit 4) on the argument that "TBD" means "not yet supplied", which is the UNASSIGNED state. I rejected
it because the owner's ruling is to **keep** rejecting the tokens Wave-013 §3 names, and changing their
exit code changes the disposition the ruling preserves. Prose was the dishonest part, so prose is what
changed — and seven `F4 disposition` assertions now pin every disposition above against what
`lib/registration.mjs` actually does, so the contract and the wiring cannot drift apart silently again.

---

## Verification (real output, each command owning its own exit status)

No `grep` exit status was used as a result and no diagnostic was appended to a verification command.

1. **Aggregate re-derived twice, cleanly** (two separate `node` processes, one relative and one absolute
   root): both printed
   `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6 595`. **They agree.** A third
   derivation at the end of the run printed the same value.
2. **`node test/mutate.mjs --anchors`** -> printed `anchors: 458/458 occur exactly once`, exit 0.
   **458/458 = N/N.** No mutant was run.
3. **`node test/selftest.mjs`**, once, with `CPG_U1_RESOLVER_CLONE=C:/tmp/dt013-resolver` and
   `CPG_U1_ADAPTER_CLONE=C:/tmp/dt015-adapter` -> `selftest: 1253 passed, 0 failed`, **exit 0**
   (1249 + 4 fixed assertions on the first pass; the four were my own new assertions matching phrases my
   own refusal message quotes, corrected to target the lines the verifier would actually have printed).
4. `verify-protocol --protocol ../CPG_U1_PROTOCOL_004.md` ->
   `protocol states every pinned parameter; protocol_sha256: c50fc680...df00b719`, exit 0.
   `verify-evaluation-tree --protocol ... --repo C:/tmp/dt013-resolver` ->
   `evaluation tree verified: the clone IS the declared U1 treatment content`, exit 0, declared and
   clone identities identical.
   `verify-registration` on a representative synthetic record (real protocol, real registry, real
   resolver clone) -> `registration SYNTHETIC-REG-DEMO-015: ESTABLISHED — ...`,
   `provider_configuration_sha256: ACCEPTABLE (PROVIDER_CONFIG_VERIFIED)`, five identity leaves printed
   including `registration_id`, exit 0.
5. Frozen identities re-confirmed **unchanged**: protocol `c50fc680...`, registry `a1392952...`,
   evaluation tree commit/tree/aggregate as above, provider configuration `c9a7e9aa...`.
6. `C:/tmp/dt013-resolver`: **no `node_modules`** (`ls` reports no such directory), HEAD
   `f01a7eb4199be4e04d4fee7fc0116303949dc553`, `git status --porcelain` line count **0**.

## Residual risks

- **The new mutants' kills are reasoned, not executed.** Running any mutant is prohibited in this
  stream, so each of the 17 has a named killing assertion (see `MUTANT_KILL_MATRIX.md`) but no measured
  KILLED line. Exhaustive certification must confirm them.
- `screenProseValue`'s four internal guards have no individual mutants: M482 removes the prose screen
  wholesale. A mutant deleting exactly one prose guard would survive the current population, though the
  five prose-refusal assertions would fail it.
- The instrument's own `SYNTHETIC` marker is still a substring match, so a real organisation whose name
  contains "synthetic" would be refused outside test mode. That behaviour predates this batch, is relied
  on by `--allow-synthetic` and `lib/schema.mjs`, and was left alone deliberately.
- Narrowing the token list is a real widening of what the verifier accepts. Nothing reaches
  `VALID_AUTHORITATIVE` without a separately supplied attestation, so the widening moves values from
  "refused" to "explicitly unverified", never to "verified".
- The aggregate changed, so any record registering `b9250356...` no longer names this tooling. Nothing
  is registered, so nothing is invalidated.
