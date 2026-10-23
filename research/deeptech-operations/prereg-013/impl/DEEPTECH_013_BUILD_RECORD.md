# DEEPTECH-PARALLEL-013 — implementation stream build record

**Status: PROVISIONAL — PENDING DR-11. Nothing here is final.**

Scope: R28 (§3 identity/authority validation), R15 (§4 provider-configuration authority) and
DR-12 (§6 sentinel normalisation), implemented together into a **new** candidate tree because all
three touch the same files and share one mutant-ID allocation.

## 1. Firewall

The pre-existing 404-mutant run (PID 4092) was left strictly alone.

- **No file under `C:/tmp/dt009-merge` was created, modified or deleted.** That tree was read only:
  the copy out of it, plus `cat`/`grep`/`sed -n` reads.
- **No mutation suite was started.** The only invocation of `test/mutate.mjs` was
  `--anchors`, which exits after anchor counting and runs no mutant.
- The run was not restarted, killed, inspected or interpreted.

## 2. Candidate tree

| item | value |
| --- | --- |
| location | `C:/tmp/dt013-candidate/` |
| aggregate tree | `C:/tmp/dt013-candidate/tooling/` |
| protocol (outside the aggregate, one level up) | `C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md` |
| pre-edit aggregate | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` over **594** files |
| pre-edit match | **YES**, byte-for-byte, derived with the instrument's own `lib/aggregate.mjs` `toolingManifest()` |

The aggregate was derived through `toolingManifest()`, never with `xargs sha256sum | sha256sum`.

Not modified, as directed: the protocol, the treatment, the evaluation tree,
`rules/development_only_registry.json`.

## 3. What the frozen protocol mandates about identifier shape

**Nothing.** Verified by reading `CPG_U1_PROTOCOL_004.md` directly:

- §5.5.1 (line 296) requires "an **accountable identity** bound to the OSF account, with a
  **persistent identifier** (type and value recorded)", and that the tooling "refuses to proceed
  while either is UNASSIGNED (exit 4)".
- §19 (line 937) and §4A (line 957) repeat the requirement as a named human prerequisite.
- §21 step 1 (line 993) assigns *resolution* of the identifier to a human verifier acting on OSF,
  outside the tooling.
- The strings `ORCID` and `ROR` do not occur anywhere in the protocol. No PID type is enumerated,
  no syntax is given, no checksum is specified, and no resolution is defined for the tooling.

Consequence for §3: **every** PID type falls in the second branch ("where no PID type-specific
syntax is defined, require an explicit authoritative value rather than claiming syntactic validation
proves identity"). No ORCID/ROR regex was introduced, and no arbitrary universal identifier regex
was introduced.

## 4. R28 — design

New module `lib/identity.mjs`. Six classes, exactly as §3 requires:

`EMPTY` · `RESERVED_UNASSIGNED` · `SYNTHETIC_PLACEHOLDER` · `MALFORMED` ·
`PLAUSIBLE_BUT_UNVERIFIED` · `VALID_AUTHORITATIVE`.

`screenIdentityValue()` applies the local screens in a fixed order; each screen can only **refuse**.
In order: non-string → `MALFORMED_NOT_A_STRING`; empty/whitespace-only → `EMPTY`; reserved sentinel
(trimmed, case-insensitive) → `RESERVED_UNASSIGNED`; control/zero-width/soft-hyphen/bidi code point
→ `MALFORMED_INVISIBLE_CHARACTER`; surrounding whitespace on an otherwise legitimate value →
`MALFORMED_SURROUNDING_WHITESPACE`; `|` → `MALFORMED_DELIMITER`; the instrument's own `SYNTHETIC`
fixture marker → `SYNTHETIC_MARKER`; other synthetic markers (`FIXTURE`, `MOCK`, `FAKE`, `SPECIMEN`,
`DONOTUSE`, `DO-NOT-USE`, `SAMPLEDATA`, `LOREMIPSUM`) → `SYNTHETIC_FOREIGN_MARKER`; reserved
placeholder tokens (`TBD`, `PLACEHOLDER`, `N/A`, `NONE`, `UNKNOWN`, `TEST`, `CHANGEME`, … matched
case-insensitively and with punctuation squashed) → `PLACEHOLDER_TOKEN`; zero-pattern identifiers
(only `0`/`X` once group separators are removed) → `ZERO_PATTERN`.

Returning `null` from the screens means only *"nothing local refuses this"*. It never means the value
is real.

### What "require an explicit authoritative value" means mechanically

A value reaches `VALID_AUTHORITATIVE` **only** when an attestation, supplied **separately from the
record under check**, binds that exact value:

| attestation field | requirement |
| --- | --- |
| `schema` | `cpg-u1-identity-attestation/v1` |
| `resolved_value` | must equal the value under check — the binding is on the exact value, so an attestation is not transferable to another value |
| `authority` | the register of record; itself screened, so a placeholder authority confers nothing |
| `resolved_by` | who resolved it; itself screened |
| `method` | how it was resolved; itself screened |
| `resolved_at` | ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ` |

Attestations are read **only** from `--identity-attestations`, never from `reg`. A record carrying
`identity_attestations` is refused outright (`SELF_ATTESTATION_REFUSED`) — a record cannot attest to
its own identities, which is the identity form of the very defect R15 removes for the provider hash.

Screening therefore only ever demotes; the single promotion path is an explicit external attestation.

### The critical invariant

`"not obviously synthetic" != "authoritative"`. A value that survives every screen lands in
`PLAUSIBLE_BUT_UNVERIFIED`, a class distinct from `VALID_AUTHORITATIVE`, and `isAuthoritative()` is
true only for the latter. This is asserted directly over a list of fifteen values (blank, whitespace,
sentinel and its variants, `TBD`, `PLACEHOLDER`, zero-pattern, synthetic markers, a plausible value,
a padded value, a zero-width value, a number and `null`): **none** of them reaches
`VALID_AUTHORITATIVE`.

### Wiring

`checkRegistration(reg, { phase, allowSynthetic, attestations })` now classifies each identity leaf
through `classifyIdentityValue` and returns the per-field classes as `identity`. The five leaves that
previously rested on `assigned()` alone are all covered: `accountable_identity.value`,
`persistent_identifier.type`, `persistent_identifier.value`, `bitcoin_key_custodian.value` and
`registration_id`. Mapping: `EMPTY`/`RESERVED` → blocker (exit 4, the protocol's stated behaviour);
`MALFORMED` → record error; a reserved placeholder → record error **even in test mode** (a
placeholder is not a test identity, it is the absence of one); the instrument's own `SYNTHETIC`
marker → the pre-existing `allowSynthetic` gate, left load-bearing so mutant M81 stays killable.

## 5. The exit-0 wording change

`verify-registration` previously ended with:

```
registration <id> complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match
```

Three of those four adjectives were not established by the verifier. It now prints what was
established and, separately and explicitly, what was not:

```
registration <id>: ESTABLISHED — the record is complete and well-formed; --protocol, this tooling
aggregate and --registry hash to the values the record registers; the record is the EARLIEST entry
for CPG-U1-2026-01 in the supplied --identity-registrations list.
  identity accountable_identity.value: <CLASS> (<CODE>)
  ... one line per screened identity leaf ...
  provider_configuration_sha256: <VERDICT> (<CODE>)
NOT ESTABLISHED by this verifier:
  - PUBLIC / UNEMBARGOED: read from registry.public and registry.embargo INSIDE this record. They
    are assertions made by the submitter; this tooling never contacts the registry, so neither is
    checked.
  - REGISTRY AUTHORITY: "earliest" is authority only over the supplied --identity-registrations
    file. The verifier does not enumerate the registry, so a registration absent from that file is
    invisible to it (§20.13).
  - IDENTITY: no persistent identifier was resolved against any issuing authority. Values classified
    PLAUSIBLE_BUT_UNVERIFIED passed local screens only — surviving a screen is not evidence that a
    value identifies anyone (§3).
  - PROVIDER CONFIGURATION: <only when the comparison could not be made, with the reason>
```

The claim is corrected as well as the validation: a validation fix alone would have left a narrower
false claim standing.

## 6. R15 — design, placement and the no-clone case

`lib/harness.mjs` gains `checkProviderConfiguration({ recorded, cloneDir, protocolText })`.

The derivation chain touches the submitted record exactly once — to read the value under test:

```
registered protocol_sha256  (already compared against the --protocol file by the caller)
  -> protocol text
  -> §7.1 declaration (declaredIdentity: commit, tree object id, content manifest aggregate)
  -> the supplied clone verified against that declaration (verifyEvaluationTree)
  -> providerConfigurationSha(clone)
```

So the value compared against is pinned by the protocol, not asserted by the submitter. A
syntactically valid 64-hex value is never sufficient; only equality with the derived hash is.

### Where the comparison went, and why

Inside `registered()` in `cpg_u1_data.mjs`, **after** `reportRegistrationCheck`, **after** the
protocol-hash comparison, and **before** `checkAuthority`:

- **after `reportRegistrationCheck`** — `registered()` reports blockers and errors before hash
  comparisons are reachable. That ordering is kept deliberately, not worked around: a missing value
  stays the existing **exit 4** named prerequisite and a malformed one the existing **exit 1** record
  error. The comparison owns only what a comparison can see. Forcing malformed to exit 4 would have
  fought the instrument's own error/blocker taxonomy for no gain in what is refused.
- **after the protocol-hash comparison** — the derivation reads §7.1 out of the protocol. Comparing
  against a clone pinned by an *unverified* protocol would be a hash of nothing.
- **before `checkAuthority`** — a record naming the wrong provider configuration must be refused
  whether or not it happens to be the earliest one listed.

`checkProviderConfiguration` itself implements all five outcomes, so it is correct when called
directly (which is how the §14 matrix exercises it).

### Stale versus wrong

The verifier does not distinguish them, and does not need to: neither equals the derived hash, so
both are `PROVIDER_CONFIG_MISMATCH` → BLOCKED. The matrix proves this with a *genuinely* stale value
— the real provider-configuration hash of a real earlier state of the two §13.1 files — not a random
string.

### The no-clone case, stated honestly

**When no resolver clone is available the comparison is unachievable.** The registered hash's
referent is the pinned tree; with no tree there is no independent value, and a wrong or stale but
well-formed value cannot be detected by any offline means. This is not worked around.

What is done instead:

1. The verdict is `NOT_COMPARED` (`PROVIDER_CONFIG_NOT_COMPARED`) — a third verdict, never
   `ACCEPTABLE`. A mutant that reports it as `ACCEPTABLE` is M465 and is killed.
2. The output states it in the `NOT ESTABLISHED` block, naming the consequence in words: *"A WRONG or
   STALE but well-formed value would not be detected here."*
3. `--require-provider-config` turns `NOT_COMPARED` into a blocker (**exit 4**), so the directive's
   BLOCKED-for-wrong/stale requirement is reachable by an operator who wants it enforced.

The default is `NOT_COMPARED` rather than BLOCKED because making it a blocker by default would make
every offline verification command exit 4 whenever a clone is absent. The honest trade is an explicit
non-establishment statement plus an opt-in blocker — never a silent pass.

A fourth verdict covers a related honest gap: if the supplied protocol text pins no evaluation tree,
there is nothing to derive from, so the result is `NOT_COMPARED` with code
`PROVIDER_CONFIG_NO_PINNED_TREE` — again never `ACCEPTABLE`.

### Re-derivation of the current value

`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` was **re-derived, not
transcribed**, three independent ways, all agreeing:

1. `git show f01a7eb4…:<path>` for each of the two §13.1 files out of `C:/virality`, hashed with the
   instrument's own `providerConfigurationSha()`;
2. the pre-existing clone `C:/tmp/cpg041_resolver_jest` at the pinned commit;
3. a fresh detached worktree `C:/tmp/dt013-resolver` at the pinned commit (11552 tracked files,
   clean, `verifyEvaluationTree` → ok, 0 refusals, 0 notes).

The commit `f01a7eb4199be4e04d4fee7fc0116303949dc553` was obtained by parsing §7.1 out of the
protocol, whose `protocol_sha256` is registered and compared — not by assumption.

## 7. DR-12 — the rule as implemented

In `lib/identity.mjs`, one clause per line so each has its own mutation anchor:

```js
export const trimmedFor        = (v) => (typeof v === 'string' ? v.trim() : '');
export const isReservedSentinel = (v) => trimmedFor(v).toUpperCase() === UNASSIGNED;
export const isEmptyValue       = (v) => trimmedFor(v) === '';
export const assignedValue      = (v) => typeof v === 'string' && !isEmptyValue(v) && !isReservedSentinel(v);
```

- surrounding whitespace is trimmed before comparison — `" UNASSIGNED "` is the sentinel;
- the sentinel is compared case-insensitively — `"unassigned"`, `"UnAssigned"` are the sentinel;
- empty and whitespace-only stay unassigned;
- **internal `"UN ASSIGNED"` stays ASSIGNED** — whitespace is removed from the ends only, never the
  middle, and `UNASSIGNED` is deliberately **absent** from `PLACEHOLDER_TOKENS` so the squashing
  placeholder screen cannot undo the owner's ruling. Asserted directly (DR-12 d);
- legitimate values stay assigned, and the sentinel is matched whole — `"UNASSIGNEDX"` and
  `"XUNASSIGNED"` stay assigned.

`PROTOCOL_MARKERS` still contains the literal token `'UNASSIGNED'`; it was not removed.

`lib/registration.mjs` keeps a one-line `assigned` that routes through the DR-12 predicate:

```js
const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isReservedSentinel(v);
```

## 8. M77 anchor repair

`test/mutate.mjs:120` anchored M77 on the pre-DR-12 definition of `assigned`. DR-12 replaced that
line, so — exactly as predicted — the first `--anchors` run on the edited tree printed
`ANCHOR? M77 UNASSIGNED treated as assigned (0x in lib/registration.mjs)` and `anchors: 440/441`,
exit 1. The pre-flight would have exited 1 before any mutant ran.

Repair: M77's `from` is re-pointed at the **new** line; its **`to`-string is unchanged**.

```
from: const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isReservedSentinel(v);
to:   const assigned = (v) => typeof v === 'string' && v.trim() !== '';
```

The mutation still deletes the sentinel check and keeps the emptiness check, so it is the same
mutant, same ID, same name, same semantics. M436 anchors on the same line with a different `to` (it
restores the DR-12 defect rather than deleting the check) — two mutants sharing one `from` is the
existing M14/M15 pattern and each still counts exactly once.

## 9. DR-11 — untouched, with a clean insertion point

DR-11 has **no owner ruling**: the `OWNER DECISION:` line at
`dt012-decisions/D3-D5/DR11_RESOLUTION.md:361` sits under `### EXACT WORDING TO RECORD` inside a
blockquote and is *proposed wording*. §5's stop condition therefore holds.

- `cpg_u1_data.mjs` `const byId = new Map(scan.results.map(...))` was **not touched**.
- **Mutant IDs M468–M471 are reserved** for DR-11: contiguous, above every allocated ID, with no
  entries emitted. The later one-line DR-11 fix and its mutants land there without renumbering
  anything.

**The aggregate produced by this stream is PROVISIONAL — PENDING DR-11. It is not final.**
