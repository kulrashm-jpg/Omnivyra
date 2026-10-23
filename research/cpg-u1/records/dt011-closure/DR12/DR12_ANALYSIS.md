# DR-12 — UNASSIGNED sentinel normalisation: analysis

DEEPTECH-PARALLEL-011, DR-12 stream. **The fix is prepared, not applied.** No candidate tree was
modified. All work was done in a throwaway scratch copy of `C:/tmp/dt009-merge/tooling` under the
session scratchpad; nothing was written under `C:/tmp/dt009-merge`.

---

## 1. The defect, confirmed

`lib/registration.mjs:59` in the candidate:

```js
const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;
```

Two asymmetries in one expression:

- the emptiness test is `v.trim() !== ''` — **trimmed**;
- the sentinel test is `v !== UNASSIGNED` — **untrimmed and case-sensitive**.

So any casing or padding of the word walks straight through the guard as a "supplied value".

Reproduced on a scratch copy of the candidate, via the CLI, with the pristine template
(`registration-fields`) as the draft:

| record | blockers | errors | exit |
|---|---|---|---|
| draft (pristine template) | 10 | 0 | 4 |
| probe: `accountable_identity.value = "UNASSIGNED "`, `persistent_identifier.type = "unassigned"` | **8** | 0 | 4 |

Two named prerequisites vanish, silently, with no warning. The directive reports 9 → 7 on its own
probe record; the delta is the same **−2**, and the absolute base differs only because the
directive's record already had one prerequisite supplied while mine is a pristine template. The
defect and its magnitude are identical.

Confirmed alongside it:

- **No identifier-shape validation exists anywhere.** Case-insensitive
  `grep -riE 'orcid|\bror\b|isni|doi\.org'` across the candidate (excluding `node_modules`) returns
  exactly **one** hit, and it is a test fixture *value*, not validation:
  `test/selftest.mjs:443 → persistent_identifier: { type: 'SYNTHETIC-ORCID', value: 'SYNTHETIC-0000-0000-0000-0000' }`.
  The directive's lower-case grep returns zero. Either way: `assigned()` is the only guard there is
  for the four human fields.
- `checkAuthority()` compares `accountable_identity.value` for **exact equality** twice
  (`lib/registration.mjs:133` against every listed registration), so an accepted padded value
  propagates into the authority decision.

---

## 2. Every `assigned()` call site

`assigned` is a module-local `const` in `lib/registration.mjs`. It is **not exported**, and the
identifier appears nowhere else in the tree as this helper (the other `assigned*` hits are
`assignedPerson` in `lib/assignment.mjs` and prose in `lib/ratings.mjs`). Ten guarded fields across
six textual call sites:

| line | call site | fields guarded | what validates the value *after* the guard |
|---|---|---|---|
| 71 | inside `human(v, name, label)` | `bitcoin_key_custodian.value` (86), `accountable_identity.value` (93), `persistent_identifier.type` (94), `persistent_identifier.value` (95) | **nothing** — only the `SYNTHETIC` refusal. No shape check at all. |
| 96 | `registration_id` | `registration_id` | only `.includes('|')` — **no whitespace check** |
| 98 | `registration_timestamp` | `registration_timestamp` | `ISO_UTC` (anchored `^…$`) + `Date.parse` |
| 102 | `outpoints` | `outpoints.development`, `outpoints['held-out']` | `parseOutpoint` (anchored `^…$`) + distinctness |
| 110 | `as_of` | `as_of` | `ISO_UTC` (anchored) |
| 112 | `provider_configuration_sha256` | `provider_configuration_sha256` | `HEX64` (anchored) |

`checkpoint.height` / `checkpoint.hash` (108) do **not** go through `assigned()` — they compare
`=== UNASSIGNED` directly. That is the same class of bug (a padded or lower-cased checkpoint
sentinel would fall to the `else` branch), but it fails **loud**: `Number.isSafeInteger('unassigned')`
is false, so it raises an *error*, not a silent pass. It is therefore not a bypass and is left
untouched — see §6.

**Blast radius of changing `assigned()` itself.** The change is *monotone-tightening*: the new
predicate returns `true` on a strict subset of the inputs the old one did. Nothing that was
previously refused can become accepted; only values that trim-and-fold to `UNASSIGNED` flip from
accepted to blocked. Six of the ten fields already reject padding through their own anchored
validators (verified in `DR12_TESTS.mjs` R5), so for them the change adds a blocker where there was
a silent pass, and changes nothing else. This is why changing the shared helper is safe *and* is the
minimum: the bug is one bug in one expression that all ten fields share, and a narrower per-field
helper would have to be written ten times to close the same hole.

---

## 3. Design choice 1 — case-fold, not merely trim

**Decision: case-fold (`toUpperCase`) as well as trim.**

`UNASSIGNED` is a *sentinel*, not data. The module's own first comment says the tooling "writes a
template whose identities are UNASSIGNED and refuses to proceed until a human supplies them". A
human who types `unassigned` into that field has, by any reading, not supplied an identity. Treating
that as a genuine value accepts a registration record that names no accountable party — precisely
the harm the guard exists to prevent. So the sentinel is logically case-insensitive and requirement 2
applies.

The stated cost is that a *genuine* value equal to "unassigned" in some casing becomes unusable.
Checked against all ten call sites:

| field | value space | can it be the bare word? |
|---|---|---|
| `accountable_identity.value` | an OSF account identity / ORCID | no — 5-char OSF id or `0000-0000-0000-0000` |
| `persistent_identifier.type` | a scheme name (ORCID / ROR / ISNI / DOI) | no |
| `persistent_identifier.value` | an ORCID / ROR / DOI string | no — digits, dashes, `https://…` |
| `bitcoin_key_custodian.value` | the STUDY_OPERATOR key-holder | see below |
| `registration_id` | registry-issued short id | no |
| `registration_timestamp`, `as_of` | ISO-8601 UTC | no |
| `outpoints.*` | `<64 hex>:<vout>` | no |
| `provider_configuration_sha256` | 64 lowercase hex | no — `u`,`n`,`s`,`i`,`g` are not hex |

So the collision risk is **zero in eight of the ten fields by construction**. For the two human
name-bearing fields, a party literally named "Unassigned" would be indistinguishable from the
sentinel to every outside verifier reading the public OSF record — the value would be unusable
regardless of what the tooling did, and refusing it is the correct outcome, not a regression.

Two supporting points:

- **It is the existing local convention.** The sibling guard on the very next lines already folds
  case: `synthetic = (v) => v.toUpperCase().includes(SYNTHETIC_PREFIX)`. Case-folding a sentinel is
  established in this module; a case-sensitive `UNASSIGNED` next to a case-insensitive `SYNTHETIC`
  is the anomaly.
- **`toUpperCase` is the fail-closed direction, `toLowerCase` is not.** `toUpperCase` folds *more*
  inputs onto the sentinel — e.g. the Turkish dotless `unassıgned` uppercases to `UNASSIGNED` and is
  caught — and every extra fold produces a *blocker*, never an acceptance. `toLowerCase` has the
  opposite failure mode (`İ` lowercases to `i` + combining dot and would *miss*). Tested.

**Rejected alternative: trim only.** It closes the trailing-space probe and leaves the
lower-case probe wide open. The directive's own probe used both in one record; half a fix here is
not a fix.

## 4. Design choice 2 — a padded genuine value is rejected outright, not trimmed

**Decision: trimming affects only the *sentinel comparison*. A value that is genuinely supplied but
carries leading/trailing whitespace is refused as an `error` — not normalised, not accepted.**

Three options were on the table.

1. **Accept it as-is** (status quo). Unacceptable: `checkAuthority()` compares
   `accountable_identity.value` for exact equality against the registry's copy. Either the padding is
   absent from the registry copy, and verification throws `is under a different identity` at the
   worst possible moment; or the padding is present in both, and the canonical identity of record
   differs from the identity any human reads by an invisible character. Neither is a defensible
   public preregistration.
2. **Silently trim and store the trimmed value.** Rejected on the module's own stated contract: "the
   tooling never creates, publishes or names anything". Rewriting a human-supplied accountable
   identity is exactly the tooling naming something. It also hides the operator error instead of
   surfacing it, in the one record that cannot be amended after registration.
3. **Refuse it, and say so.** Chosen. Fails closed (requirement 4), invents nothing, and puts the
   correction where it belongs — with the human who typed it, before registration.

Two secondary decisions inside that choice:

- **`error`, not `blocker`.** The docstring pins the contract: "errors = malformed/forbidden;
  blockers = named human prerequisites missing". The human *did* supply something; it is malformed,
  not missing. `reportRegistrationCheck` exits 1 on errors and 4 on blockers, so the distinction is
  load-bearing.
- **Ordering: sentinel first, padding second.** `if (!assigned(v)) → blocker; else if (padded(v)) →
  error`. So `"UNASSIGNED "` reports as the honest "is UNASSIGNED (accountable_identity.value)"
  blocker rather than a confusing whitespace error, and the probe record comes out at 0 errors.

**Scope: the padding check goes in `human()`, not in `assigned()`.** This is the narrower helper the
directive asks me to consider, and yes — it is the right one. `human()` is exactly the set of four
fields that have *no* shape validation and that are compared for exact equality downstream. The other
six fields are already protected by anchored regexes (`ISO_UTC`, `HEX64`, `parseOutpoint`), so pushing
the padding check into `assigned()` would add nothing for them except a second, differently-worded
diagnostic for the same malformation — noise, and a behaviour change on fields the defect never
touched. Requirement 5 is satisfied by keeping the shared helper limited to the one thing that was
genuinely wrong everywhere (the sentinel comparison) and putting the new refusal only where the gap is.

---

## 5. The patch, and the mandatory second file

`DR12_PATCH.diff` touches **two** files:

1. `lib/registration.mjs` — three added helper lines replacing one, plus one added `else if`, plus a
   four-line comment. No other line changes.
2. `test/mutate.mjs` — **one** string. `M77 UNASSIGNED treated as assigned` anchors on the *verbatim*
   old `assigned` line. Patching `lib/registration.mjs` without repairing that anchor makes
   `node test/mutate.mjs --anchors` fail, i.e. it breaks the mutation harness before a single mutant
   runs. M77's *to*-string is untouched, so the mutant is semantically the same mutant and is still
   killed by the same tests.
   **This repair changes no count: anchors verified 404/404 after the patch.**

Both edits are inside the tooling tree, so both move the aggregate. `DR12_TESTS.mjs` is deliberately
kept **outside** the tree — it takes the tree as an argument — so it adds no file and no further
aggregate movement.

**Application hazard.** `core.autocrlf=true` is set in this environment's *system* git config. A
plain `git apply` therefore rewrote the entire file to CRLF, which changes every byte of every line
and moves the aggregate to a value that has nothing to do with the patch. Apply with:

```
git -c core.autocrlf=false -c core.eol=lf apply -p1 DR12_PATCH.diff
```

Verified: applied that way, the result is byte-identical to the proven scratch copy.

---

## 6. Verification performed (lightweight only — no selftest, no mutation run)

`node test/mutate.mjs --anchors` was used. That flag exits immediately after anchor counting and
runs **no** mutant; it is not a mutation run.

### Targeted tests — real counts

`node DR12_TESTS.mjs <tree>`, 36 assertions:

| tree | passed | failed | exit |
|---|---|---|---|
| pristine scratch copy of the candidate (unpatched) | 16 | **20** | 1 |
| scratch copy with `DR12_PATCH.diff` applied | **36** | 0 | 0 |

The 20 pristine failures are the defect: 6 whitespace variants, 5 case variants, the two-field probe
record, 4 padded-genuine-value cases, and 3 propagation cases on other fields.

### `verify-registration` — before and after, real exit codes

```
node cpg_u1_data.mjs verify-registration --registration <rec> \
  --protocol ../CPG_U1_PROTOCOL_004.md --registry rules/development_only_registry.json \
  --identity-registrations <rec>
```

| record | unpatched | patched |
|---|---|---|
| draft (pristine template) | 10 blockers, 0 errors, exit 4 | 10 blockers, 0 errors, exit 4 |
| whitespace probe (`"UNASSIGNED "` + `"unassigned"`) | **8** blockers, 0 errors, exit 4 | **10** blockers, 0 errors, exit 4 |

The probe now reports **identically to the draft**. The two evaded blockers are back, with their
correct field names, and the bypass delta is 0.

### Blocker count for the probe record

The directive's probe record went from 9 (draft) to 7 (probe) with the bypass. With this patch the
probe record's count **becomes 9** — the two evaded prerequisites return, with 0 errors and exit 4,
so the probe is indistinguishable from the draft. In my own reproduction, which starts from a
pristine template rather than a partly-filled draft, the same numbers read 10 → 8 → **10**. Delta
restored to 0 in both framings.

### Projected aggregate — *projected, not certified*

| | value |
|---|---|
| candidate base aggregate | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| **projected** with DR-12 applied | `e3109e66eb583b2724caab0ae6444f9b88796284876369be7787fdf4c3783aad` |

This is the aggregate of a **throwaway scratch copy**. It is a *projection* of what the candidate's
aggregate would become, computed by `lib/aggregate.mjs` over the patched scratch tree. **It certifies
nothing.** No selftest and no mutation suite was run against it. It will only be real once the patch
is applied in the single final edit session together with whatever DR-11 and `EVIDENCE_SCHEMA`
resolve to, and re-certified from scratch.

---

## 7. Residuals deliberately left out of scope

Named, not fixed, because each is a separate decision and every extra edit is another 18-hour cycle:

1. **`registration_id` accepts padding.** Its only check is `.includes('|')`. A padded id fails
   *loud* in `checkAuthority()` ("the registration is not in the identity registration list"), so it
   is not a silent bypass. Worth a follow-up, not worth widening DR-12.
2. **`checkpoint.height` / `checkpoint.hash` compare `=== UNASSIGNED` directly**, bypassing
   `assigned()` entirely. A folded/padded checkpoint sentinel falls through to the `else` and is
   caught as an *error* by `Number.isSafeInteger` / `HEX64`. Loud, not silent. Same reasoning.
3. **No identifier-shape validation for the four human fields.** Still true after this patch, by
   design. DR-12 closes what is *invisible to a human reader* (padding, casing); it does not attempt
   to decide what a valid ORCID/ROR/OSF identity looks like. That is squarely an `EVIDENCE_SCHEMA`
   question and is still unresolved. `DR12_TESTS.mjs` pins the boundary explicitly: internal
   whitespace (`"UN ASSIGNED"`) remains *assigned*, because it is a distinct, human-visible string
   and rejecting it would require the shape validation DR-12 declines to invent.

## 8. Risks

- **Aggregate movement.** Two files change, so the aggregate moves. This is why the patch is not
  applied: the 404-mutant certification against `C:/tmp/dt009-merge/tooling` is in flight, and
  applying now invalidates it. Bundle DR-12 into the single final edit session.
- **Selftest exposure — small but unmeasured.** `test/selftest.mjs` was not run (prohibited here). Any
  existing fixture supplying a padded or oddly-cased human value would now be refused. Static
  inspection says there is none: `filledRegistration` (`test/selftest.mjs:439–447`) supplies
  `'SYNTHETIC-ACCOUNTABLE-IDENTITY'`, `'SYNTHETIC-ORCID'`, `'SYNTHETIC-0000-0000-0000-0000'`,
  `'SYNTHETIC-STUDY-OPERATOR'` — all clean, unpadded, and untouched by the new predicate; and the
  template assertions at `test/selftest.mjs:451–453` check the 9 named prerequisites with
  `errors.length === 0`, which the patch preserves (verified equivalently in `DR12_TESTS.mjs` R3/R5).
  Exposure therefore looks nil — but it is *unmeasured*, and the final edit session must run the full
  selftest.
- **M77 depends on the new helper name.** The repaired anchor names `isUnassignedSentinel`. Renaming
  that helper later silently breaks the anchor again. The anchor check catches it, so the failure
  mode is loud.
- **CRLF.** See §5. Applying this patch with a default `git apply` in this environment corrupts the
  file's line endings and produces a meaningless aggregate.
