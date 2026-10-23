# DR-12 — measured evidence

**Stream:** DEEPTECH-PARALLEL-012, D-4. Everything here is a measurement, not a projection.

## 1. Method, and the firewall

- The candidate `C:/tmp/dt009-merge/tooling` was **read only**. **No file was created, modified or deleted
  under `C:/tmp/dt009-merge`.** A 404-mutant run is live there; its output file was not opened, no partial
  verdict was inspected, no suite was started, and `test/selftest.mjs` was never executed — not even on a copy.
- A throwaway scratch tree was made in the session scratchpad by copying `lib/`, `cpg_u1_data.mjs`, `rules/`,
  `templates/` and `node_modules/` out of the candidate. Every fixture (`reg_*.json`, `ids_*.json`,
  `protocol.md`) was written **outside** that tree, so the tree's own aggregate never moved between the
  aggregate read and the CLI run.
- Because `registered()` aborts unless `toolingManifest(ROOT).aggregate` equals the record's
  `tooling_aggregate_sha256`, the fixture generator recomputes the scratch tree's aggregate and writes it into
  each record. It is therefore regenerated for every mutation. The scratch tree's own aggregate
  (`53dc71ed…` unmutated) is an artefact of a partial copy and has no relation to any candidate aggregate; it
  is used only for self-consistency.
- Fixture shape follows `test/selftest.mjs:439` `filledRegistration` exactly: `'SYNTHETIC-REG-10.00000/SYNTHETIC'`,
  `'SYNTHETIC-ACCOUNTABLE-IDENTITY'`, `'SYNTHETIC-ORCID'`, `'SYNTHETIC-0000-0000-0000-0000'`,
  `'SYNTHETIC-STUDY-OPERATOR'`, `network: 'synthetic-test'`, `--allow-synthetic`.
- Command used throughout:
  `node cpg_u1_data.mjs verify-registration --registration <reg> --identity-registrations <ids> --protocol <p> --registry rules/development_only_registry.json --allow-synthetic`
- Three code states are compared. **CANDIDATE** = unmodified `lib/registration.mjs:59`. **PATCH-core** = the
  prior stream's rule (trim + `toUpperCase` in the sentinel test; `padded` error in `human()`). **PATCH-full** =
  PATCH-core plus the `Cf` refusal (Case 10).

## 2. Predicate probe — 17 inputs × 6 predicate variants

Pure semantics, no tooling. `T` = the predicate returns "assigned".

| input | CANDIDATE | trim-only | **rule** | M431 (no trim) | M432 (no fold) | M436 (fold down) | `padded` | `v!==trimEnd` | has `Cf` |
|---|---|---|---|---|---|---|---|---|---|
| `UNASSIGNED` | F | F | **F** | F | F | **T** | F | F | F |
| `unassigned` | **T** | **T** | **F** | F | **T** | T | F | F | F |
| `UnAssigned` | **T** | **T** | **F** | F | **T** | T | F | F | F |
| `UNASSIGNED␠` | **T** | F | **F** | **T** | F | T | T | T | F |
| `␠UNASSIGNED` | **T** | F | **F** | **T** | F | T | T | F | F |
| `␠␠UNASSIGNED␉` | **T** | F | **F** | **T** | F | T | T | T | F |
| `unassigned␠` | **T** | **T** | **F** | **T** | **T** | T | T | T | F |
| `UN ASSIGNED` | T | T | **T** | T | T | T | F | F | F |
| `""` | F | F | **F** | F | F | F | F | F | F |
| `"␠␉\n"` | F | F | **F** | F | F | F | T | T | F |
| `\u00A0UNASSIGNED\u00A0` (NBSP) | **T** | F | **F** | **T** | F | T | T | T | F |
| `UNASSIGNED\u200B` (ZWSP) | **T** | **T** | **T** ⚠ | **T** | **T** | T | F | F | **T** |
| `\u200BUNASSIGNED` | **T** | **T** | **T** ⚠ | **T** | **T** | T | F | F | **T** |
| `unassıgned` (Turkish ı) | T | T | **F** | F | T | T | F | F | F |
| `ORCID` | T | T | **T** | T | T | T | F | F | F |
| `ORCID␠` | T | T | **T** | T | T | T | **T** | **T** | F |
| `␠ORCID` | T | T | **T** | T | T | T | **T** | F | F |

Notes established here:
- `trim()` **does** strip U+00A0 and U+FEFF; it does **not** strip U+200B. Verified directly:
  `'\u00A0x\u00A0'.trim() === 'x'`, `'\uFEFFx\uFEFF'.trim() === 'x'`, `'\u200Bx\u200B'.trim()` is unchanged.
- `⚠` marks the two rows that motivate Case 10: the sentinel rule alone leaves them assigned.
- `/\p{Cf}/u` matches U+200B, U+200C, U+200F, U+2060 and U+FEFF, and does not match `A`, space, `é` or `—`.
- `toLowerCase` against the uppercase constant matches nothing — it returns "assigned" for **all 17 inputs**,
  including the bare sentinel. This is the measured basis for choosing `toUpperCase`.

## 3. Module-level `checkRegistration` — the exit-0 routes in the CANDIDATE

`checkRegistration(record, { phase: 'registered', allowSynthetic: true })` on a fully filled record, varying
one field at a time. `E`/`B` = error/blocker counts.

| field varied | `UNASSIGNED` | `unassigned` | `UNASSIGNED␠` | `␠UNASSIGNED` | `UN ASSIGNED` | `""` | `"␠␠␠"` | `UNASSIGNED\u200B` |
|---|---|---|---|---|---|---|---|---|
| `persistent_identifier.type` | 0E **1B** | **0E 0B** | **0E 0B** | **0E 0B** | 0E 0B | 0E 1B | 0E 1B | **0E 0B** |
| `accountable_identity.value` | 0E **1B** | **0E 0B** | **0E 0B** | **0E 0B** | 0E 0B | 0E 1B | 0E 1B | **0E 0B** |
| `registration_id` | 0E **1B** | **0E 0B** | **0E 0B** | **0E 0B** | 0E 0B | 0E 1B | 0E 1B | **0E 0B** |

Bold `0E 0B` = the record verifies clean. Every shaped field, by contrast, is loud:

| field | value | result |
|---|---|---|
| `as_of` | `"UNASSIGNED "` | 1E — `as_of must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ` |
| `provider_configuration_sha256` | `"unassigned"` | 1E — `provider_configuration_sha256 must be 64 lowercase hex characters` |
| `outpoints.development` | `"UNASSIGNED "` | 1E — `outpoint must be "<64 lowercase hex txid>:<vout>" (got UNASSIGNED )` |
| `checkpoint.hash` | `"unassigned"` | 1E — `checkpoint must be {height: integer, hash: 64 hex}` |
| `checkpoint.height` | `"UNASSIGNED "` | 1E — same |

Padded **genuine** values in the `human()` fields: `accountable_identity.value =
"SYNTHETIC-ACCOUNTABLE-IDENTITY "` → `0E 0B`; `bitcoin_key_custodian.value = " SYNTHETIC-STUDY-OPERATOR"` →
`0E 0B`.

Wave-011 probe reproduced: pristine template → `0E 10B`; template with
`accountable_identity.value = "UNASSIGNED "` and `persistent_identifier.type = "unassigned"` → `0E` **`8B`**.
The two named prerequisites vanish silently. Under the rule it returns to `0E 10B`.

## 4. CLI grid — all three code states and all seven mutants

Nine fixtures, each a complete record paired with a matching one-element identity list (§2.4 of
`DR12_MUTATIONS.md` explains why the list must match). `AUTH` = exit 0 printing
`registration SYNTHETIC-REG-10.00000/SYNTHETIC complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match`.
`BLK-a` = `BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)`.
`BLK-p` = `BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)`.
`WS` = `ERROR accountable_identity.value has leading or trailing whitespace — supply the exact value (it is compared for exact equality at verification)`.
`ZW` = `ERROR persistent_identifier.type contains a zero-width or formatting character — supply the exact visible value`.

| fixture | the record's one difference | CANDIDATE | PATCH-core | **PATCH-full** |
|---|---|---|---|---|
| `clean` | — | 0 `AUTH` | 0 `AUTH` | 0 `AUTH` |
| `lowtype` | `persistent_identifier.type = "unassigned"` | **0 `AUTH`** | 4 `BLK-p` | 4 `BLK-p` |
| `padacct` | `accountable_identity.value = "UNASSIGNED "` | **0 `AUTH`** | 4 `BLK-a` | 4 `BLK-a` |
| `padgenuine` | `accountable_identity.value = "<genuine> "` | **0 `AUTH`** | 1 `WS` | 1 `WS` |
| `leadgenuine` | `accountable_identity.value = " <genuine>"` | **0 `AUTH`** | 1 `WS` | 1 `WS` |
| `zwsp` | `persistent_identifier.type = "UNASSIGNED\u200B"` | **0 `AUTH`** | **0 `AUTH`** | 1 `ZW` |

The `CANDIDATE` column is the measured refutation of "DR-12 cannot reach exit 0". The `zwsp` row is the
measured basis for Case 10.

### 4.1 Mutant grid against PATCH-full

One process at a time, the rule restored from a golden copy before each mutation, fixtures regenerated for
each mutated aggregate. Cells that differ from the baseline row are the kills.

| fixture | baseline | M431 | M432 | M433 | M434 | M435 | M436 | M437 |
|---|---|---|---|---|---|---|---|---|
| `clean` | 0 `AUTH` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `exacttype` (`type = "UNASSIGNED"`) | 4 `BLK-p` | 4 | 4 | 4 | 4 | 4 | **0 `AUTH`** | 4 |
| `lowtype` (`"unassigned"`) | 4 `BLK-p` | 4 | **0 `AUTH`** | **0 `AUTH`** | 4 | 4 | **0 `AUTH`** | 4 |
| `padacct` (`"UNASSIGNED "`) | 4 `BLK-a` | **1 `WS`** | 4 | **1 `WS`** | 4 | 4 | **1 `WS`** | 4 |
| `leadacct` (`" UNASSIGNED"`) | 4 `BLK-a` | **1 `WS`** | 4 | **1 `WS`** | 4 | 4 | **1 `WS`** | 4 |
| `padgenuine` (`"<genuine> "`) | 1 `WS` | 1 | 1 | 1 | **0 `AUTH`** | 1 | 1 | 1 |
| `leadgenuine` (`" <genuine>"`) | 1 `WS` | 1 | 1 | 1 | **0 `AUTH`** | **0 `AUTH`** | 1 | 1 |
| `zwsp` (`"UNASSIGNED\u200B"`) | 1 `ZW` | 1 | 1 | 1 | 1 | 1 | 1 | **0 `AUTH`** |
| `internal` (`"UN ASSIGNED"`) | 0 `AUTH` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Readings:

- Every mutant differs from baseline on at least one fixture, in **both** exit code and message.
- **M435 is killed only by `leadgenuine`.** `padgenuine` stays at exit 1 under M435, because `trimEnd`
  still detects trailing whitespace. This is the measured justification for asserting the leading and the
  trailing case separately.
- **M431's kill needs exit 4 *and* the blocker message.** Under M431, `padacct` and `leadacct` are still
  refused, at exit 1 with the whitespace error. `expectCode: 1` or a bare "refused" assertion **passes** and
  the mutant survives.
- **M436 flips `exacttype` from 4 to 0**, so the pre-existing assertion at `test/selftest.mjs:1368` already
  kills it; it is the only one of the seven that does not need a new assertion.
- The `internal` row is constant across every state: the decided boundary is stable under all seven
  mutations, which is exactly why it is a characterisation test and not a mutant.
- All 72 invocations terminated with one of the tooling's own diagnostics (exit 0, 1 or 4). No mutant
  produced a stack trace or any exit code outside that set.

## 5. Suite arithmetic, verified

Parsed every `MUTATIONS` entry in `test/mutate.mjs`:

```
count 404   max 430   duplicate IDs 0
missing 23,24,25,26,225,244,280,281,282,283,284,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299
```

26 retired numbers; 430 − 26 = 404. First free ID **M431**. `M426` and `M429` already share one anchor
string, so the three-mutants-on-one-anchor design in `DR12_MUTATIONS.md` §2 is precedented.

Anchor uniqueness on the patched scratch copy: `isUnassignedSentinel` line ×1, `assigned` line ×1, `padded`
line ×1, `else if (padded(v)) errors.push(` ×1, `else if (invisible(v)) errors.push(` ×1.

## 6. What was NOT measured

- `test/selftest.mjs` — never run, on any tree. The assertion block in `DR12_MUTATIONS.md` §4 is therefore
  **unexecuted**; the CLI behaviour each of its lines asserts *is* measured, in §4 above.
- `test/mutate.mjs` — never run, not even with `--anchors`, on any tree.
- Any real post-fix tooling aggregate. None is stated. The prior stream's `e3109e66…` was not reproduced and
  is not relied on anywhere in this stream's deliverables.
- The CRLF/`core.autocrlf` hazard, which is inherited from the prior stream unverified, because verifying it
  means applying a patch.
