# PREREG-015 — mutant allocation and killing assertions

## Arithmetic

| | |
|---|---|
| Population before | **441** |
| Max allocated before | **M467** |
| Retired, never reused | M23-M26 (4), M225 (1), M244 (1), M280-M299 (20) = **26** |
| Check, before | 467 - 26 = **441** ✓ |
| Newly allocated | M468-M471 (4, DR-11, into the reserved block) + M472-M474 (3, F3) + M475-M476 (2, F1) + M477-M478 (2, F4b) + M479-M484 (6, F4) = **17** |
| Max allocated after | **M484** |
| **Population after** | **441 + 17 = 458** |
| Check, after | 484 - 26 = **458** ✓ |
| `--anchors` printed | **`anchors: 458/458 occur exactly once`** ✓ |

M468-M471 landed in the block that was reserved and empty for exactly this fix. **Nothing was
renumbered.** No retired id was reused. Two existing mutants were **re-pointed**, keeping their ids and
their intent, on the M77 precedent (their anchor lines were changed by this batch):

- **M444** — its anchor was the FOREIGN synthetic-marker list, which F4 removes. Substring matching still
  exists for the instrument's OWN fixture marker, so the anchor moves there and the mutation is unchanged
  in kind: `raw.toUpperCase().includes(TEST_FIXTURE_MARKER)` -> `raw.toUpperCase() === TEST_FIXTURE_MARKER`.
  Killed by `R28 §14-9` (`X-SYNTHETIC-1` and `x-synthetic-1` must be `SYNTHETIC_PLACEHOLDER` /
  `SYNTHETIC_MARKER`).
- **M457** — F4b lifted the classification out of the `else if` chain, removing the leading `else `. The
  anchor follows the line; the mutation still deletes the classification and nothing else. Killed by
  `R28 CLI-4` (the printed line `identity registration_id: SYNTHETIC_PLACEHOLDER (SYNTHETIC_MARKER)`),
  by `R28 reg-3`, and by the new `F4b` assertions.

## Killing assertions

Every kill pins the **exact exit code AND the specific message**. Where the assertion is a CLI run, the
`run()` helper records a failure on any exit code other than the one named, and the `ok()` pins the text.
The kills are **reasoned, not measured** — running a mutant is prohibited in this stream.

### DR-11 — M468-M471 (`cpg_u1_data.mjs`)

| id | mutation | killing assertion | pinned exit | pinned message |
|---|---|---|---|---|
| M468 | `if (repeatedResults.length) {` -> `if (false) {` | `DR-11: a scan artefact repeating a candidate_id is REFUSED at exit 1 with its own message, naming the scan file` | 1 | `SCAN_RESULT_DUPLICATE_REFUSED: 1 candidate_id(s) occur more than once in the results of <scanPath>` |
| M469 | `list.length !== 1` -> `list.length > 2` | same as M468 | 1 | same |
| M470 | `why.length ? why.join(' ; ') : 'no contamination recorded in this occurrence'` -> `''` | `DR-11: the occurrence the old code dropped is reported with its ORDINAL, ... its own repository hit ... and its own registry match` and the benign-occurrence assertion | 1 | `result N-1: held_out_ineligible_by_scan=true — CPG-C1(1) repository TEST backend/tests/dr11.test.ts:7 ; CPG-C1(6) development-only registry SYN-REG-1 (name)` and `result N: ... — no contamination recorded in this occurrence` |
| M471 | `held_out_ineligible_by_scan=${x.held_out_ineligible_by_scan}` -> `held_out_ineligible_by_scan=(not reported)` | both per-occurrence assertions above | 1 | as above (the `=true` / `=false` are inside the pinned strings) |

Note on M468/M469: with the guard gone the collapse happens and `check-frame-sufficiency` reaches exit 0
("frame sufficient"), so the exit-code mismatch and all four message assertions fail together.

### F3 — M472-M474 (`cpg_u1_data.mjs`)

| id | mutation | killing assertion | pinned exit | pinned message |
|---|---|---|---|---|
| M472 | `if (!existsSync(supplied)) fail(` -> `if (false) fail(` | `F3 a` | 1 | `RESOLVER_CLONE_NOT_FOUND: --resolver-clone names "<path>", which does not exist` |
| M473 | `if (!supplied) return null;` -> `if (false) return null;` (POSITIVE CONTROL) | `F3 control: GENUINE absence keeps its honest NOT_COMPARED verdict at exit 0`, and `R15 CLI-5` | 0 | `NOT_COMPARED (PROVIDER_CONFIG_NOT_COMPARED)` |
| M474 | `${flag ? '--resolver-clone' : 'CPG_U1_RESOLVER_CLONE'} names` -> `a resolver clone path names` | `F3 a` and `F3 d` | 1 | the flag name and the env-var name respectively, inside the `RESOLVER_CLONE_NOT_FOUND` line |

M472 is the exact trap the brief names: with the guard removed the run is **still refused** — the clone
path is passed on and `verifyEvaluationTree` throws `PROVIDER_CONFIG_TREE_UNREADABLE` at exit 1 — so a
bare "refused" assertion would survive. Only the message kills it.

### F1 — M475-M476 (`lib/registration.mjs`)

| id | mutation | killing assertion | pinned message |
|---|---|---|---|
| M475 | `isReservedSentinel(cp.height) \|\| isReservedSentinel(cp.hash)` -> `cp.height === UNASSIGNED \|\| cp.hash === UNASSIGNED` | `F1 a` / `F1 b` for the `surrounding whitespace`, `lowercase` and `mixed case with whitespace` variants | blocker **is** `checkpoint is UNASSIGNED (a block at or after both funding confirmations)` **and** error `checkpoint must be {height: integer, hash: 64 hex}` is **absent** |
| M476 | same anchor -> `if (false) blockers.push(` | `F1 a` / `F1 b` for the `exact sentinel` variant, and `template: registration BLOCKED by every named prerequisite` | same blocker text |

This is the measured DR-12 trap: under M475 a padded sentinel is still refused, just at exit 1 with the
format error instead of exit 4 with the named prerequisite. Both the presence of the blocker and the
**absence** of the format error are asserted.

### F4b — M477-M478 (`lib/registration.mjs`)

| id | mutation | killing assertion | pinned message |
|---|---|---|---|
| M477 | `human(reg.registration_id, ...)` -> `if (!reg.registration_id.includes('\|')) human(...)` | `F4b: a piped registration_id is CLASSIFIED (MALFORMED_DELIMITER) instead of being skipped` | `identity.registration_id` present, class `MALFORMED`, code `MALFORMED_DELIMITER` |
| M478 | `if (reg.registration_id.includes('\|')) errors.push(` -> `if (false) errors.push(` | `F4b: the "\|" refusal is unweakened and still stated in the instrument's own words` | `errors` contains exactly `registration_id must not contain "\|"` |

M478 is the second instance of the trap: with the pipe refusal gone the record is **still refused**,
because the classification now reports `MALFORMED_DELIMITER`. Only the exact string kills it.

### F4 — M479-M484 (`lib/identity.mjs`)

| id | mutation | killing assertion | pinned message |
|---|---|---|---|
| M479 | `[0x200b, 0x200b], [0x200e, 0x200f]` -> `[0x200b, 0x200f]` (POSITIVE CONTROL) | the four `F4 ZWNJ/ZWJ: a ... is PLAUSIBLE_BUT_UNVERIFIED, NOT MALFORMED_INVISIBLE_CHARACTER` assertions and the four `hasInvisibleCharacter is false` assertions | class `PLAUSIBLE_BUT_UNVERIFIED`, code `NO_AUTHORITY_ATTESTATION` |
| M480 | same anchor -> `[0x200e, 0x200f]` | `F4 ZWNJ/ZWJ: U+200B zero-width space is STILL MALFORMED_INVISIBLE_CHARACTER`, and `R28 §14-13` | class `MALFORMED`, code `MALFORMED_INVISIBLE_CHARACTER`, message contains `cannot be read` |
| M481 | `...ATTESTATION_PROSE_FIELDS.map((k) => [k, screenProseValue(att[k])]),` -> `... screenIdentityValue(att[k])),` | `F4 prose: a method naming the instrument's own SYNTHETIC marker ... confers authority` and `... ending in a space, as prose may ...` | class `VALID_AUTHORITATIVE`, code `ATTESTED` |
| M482 | same anchor -> `...ATTESTATION_PROSE_FIELDS.map((k) => [k, null]),` | the five `F4 prose: a method that is ... still confers no authority` assertions, and `R28 §14-11b` (`no method`) | class `PLAUSIBLE`, code `ATTESTATION_INSUFFICIENT`, message contains e.g. `attestation.method is not an explicit value (EMPTY)` |
| M483 | `PLACEHOLDER_TOKENS = Object.freeze(['TBD', 'PLACEHOLDER'])` -> `+ 'NA', 'NONE', 'TEST', 'MOCK'` | the `F4 NOT refused: "Na" / "None" / "Test" / "Mock" ...` assertions | class `PLAUSIBLE_BUT_UNVERIFIED`, code `NO_AUTHORITY_ATTESTATION` |
| M484 | `...ATTESTATION_IDENTIFIER_FIELDS.map((k) => [k, screenIdentityValue(att[k])]),` -> `... screenProseValue(att[k])),` (POSITIVE CONTROL) | `F4 prose: attestation.authority keeps the IDENTIFIER screen — "TBD" confers no authority (PLACEHOLDER_TOKEN)` and `R28 §14-11b` (`placeholder authority`) | class `PLAUSIBLE`, code `ATTESTATION_INSUFFICIENT`, message contains `attestation.authority is not an explicit value (PLACEHOLDER_TOKEN)` |

Note on M481: after the token narrowing, the originally reported sentence
*"...no mock or specimen records used"* passes **both** screens and therefore cannot by itself prove
which screen ran. The cases that still distinguish them are asserted instead — a method sentence naming
the instrument's own `SYNTHETIC` marker, and one with a trailing space (`MALFORMED_SURROUNDING_WHITESPACE`
as an identifier, ordinary prose otherwise). The originally reported sentence is still asserted as
accepted and echoed, as the regression record of the reported defect.

## Positive controls in this batch

M473 (genuine clone absence must stay `NOT_COMPARED` at exit 0), M479 (ZWNJ/ZWJ names must stay
acceptable) and M484 (a placeholder authority must stay insufficient) each break an **acceptance** the
fix is required to preserve, not a refusal.
