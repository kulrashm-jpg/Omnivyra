# DR-12 — mutants written, NOT inserted

**These are written out here and deliberately NOT inserted into `test/mutate.mjs`.** Adding them
changes the harness's anchor count from **404 to 410**, which is an aggregate-moving edit and
therefore belongs in the single final edit session alongside DR-11 and `EVIDENCE_SCHEMA`, not today.
The certification currently running against `C:/tmp/dt009-merge/tooling` is anchored at 404 and must
not be disturbed.

Nothing has been renumbered. The M77 anchor *repair* in `DR12_PATCH.diff` is a separate matter: it
edits one existing string in place and leaves the count at **404 → 404** (verified:
`node test/mutate.mjs --anchors` reports `anchors: 404/404 occur exactly once` on the patched scratch
copy). It is mandatory and ships with the patch; the six mutants below do not.

## ID availability

- **Highest ID in use: `M430`.** `M431` onwards are free. The six below take **M431–M436**.
- **Do not reuse the gaps.** 404 mutants occupy 430 numbers; these IDs are retired and must stay
  retired, because prior certification records refer to them:
  `M23`–`M26` (retired in CPG-037A: "code removed or moved"), `M225`, `M244`, `M280`–`M299`.
- `M416`–`M430` are taken, as the directive states (EBU/SAM/CLI/ENU groups).

## The six mutants

To be appended to the `// ── CPG-041: registration ──` group in `MUTATIONS`, after `M85`
(`REG` is already defined as `'lib/registration.mjs'`, line 30):

```js
  // ── DR-12: UNASSIGNED sentinel normalisation ──
  ['M431 sentinel compared without trimming', REG, 'const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;', 'const isUnassignedSentinel = (v) => v.toUpperCase() === UNASSIGNED;'],
  ['M432 sentinel compared case-sensitively', REG, 'const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;', 'const isUnassignedSentinel = (v) => v.trim() === UNASSIGNED;'],
  ['M433 pre-DR-12 sentinel comparison restored', REG, "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isUnassignedSentinel(v);", "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;"],
  ['M434 padded human value accepted', REG, 'else if (padded(v)) errors.push(', 'else if (false) errors.push('],
  ['M435 padding detected on one side only', REG, 'const padded = (v) => v !== v.trim();', 'const padded = (v) => v !== v.trimEnd();'],
  ['M436 POSITIVE CONTROL: sentinel folded the wrong way (never matches)', REG, 'const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;', 'const isUnassignedSentinel = (v) => v.trim().toLowerCase() === UNASSIGNED;'],
```

Three of them share an anchor string (`M431`, `M432`, `M436`). That is fine: the harness counts
occurrences per mutation independently (`readFileSync(file).split(from).length - 1`), so each is
checked and reported on its own.

## What each one proves

| ID | guard removed | the bypass it re-opens |
|---|---|---|
| M431 | trimming in the sentinel comparison | `"UNASSIGNED "` passes as a supplied value again — the exact defect DR-12 fixes |
| M432 | case-folding in the sentinel comparison | `"unassigned"` / `"UnAssigned"` pass again — the second half of the directive's probe |
| M433 | both at once | full regression to `lib/registration.mjs:59` as it stands in the candidate |
| M434 | the padding refusal in `human()` | a genuine value with invisible padding is accepted and then silently mismatches `checkAuthority()`'s exact equality |
| M435 | one side of the padding test | leading whitespace slips through while trailing whitespace is caught — the half-fix |
| M436 | folds to lower case instead of upper | the sentinel then never matches *anything*, so every UNASSIGNED field reads as supplied. A positive control: it must fail loudly and immediately, and if it ever survives, the whole `assigned()` guard is dead. |

## Verified detectable — with an important caveat

Each mutant was applied to a scratch copy and checked against `DR12_TESTS.mjs`. Anchor uniqueness was
confirmed for all six (`anchor x1`). Every one is detected:

| ID | targeted-test result | exit |
|---|---|---|
| unmutated patched tree | 36 passed, 0 failed | 0 |
| M431 | 25 passed, **11 failed** | 1 |
| M432 | 28 passed, **8 failed** | 1 |
| M433 | 20 passed, **16 failed** | 1 |
| M434 | 32 passed, **4 failed** | 1 |
| M435 | 35 passed, **1 failed** | 1 |
| M436 | 11 passed, **25 failed** | 1 |

No mutation run and no selftest was executed. Each check was one `node DR12_TESTS.mjs <dir>`
invocation against a copied tree.

### CAVEAT — the final edit session needs a THIRD file

`test/mutate.mjs` kills a mutant by running **`test/selftest.mjs`** against the mutated copy and
requiring it to fail. `DR12_TESTS.mjs` is not `selftest.mjs`. `test/selftest.mjs` contains **no**
assertion today that a whitespace- or case-varied sentinel is refused — it cannot, since the defect
is live in the candidate and the selftest passes. **Inserted as-is, all six mutants would SURVIVE a
mutation run**, taking the kill rate from 404/404 to 404/410.

So the final edit session must add the corresponding assertions to `test/selftest.mjs` as well. The
natural insertion point already exists: `test/selftest.mjs:1368`, immediately after

```js
  wj('reg_noid.json', { ...reg, persistent_identifier: { type: 'UNASSIGNED', value: 'UNASSIGNED' } });
  ok(run(['verify-registration', ...withReg(regArgs, P('registration.json'), P('reg_noid.json')), '--registry', regPath], { expectCode: 4 }).includes('Persistent identifier'), 'CLI missing persistent identifier: BLOCKED exit 4');
```

Four assertions in that same idiom are enough to kill all six — sentinel-with-trailing-space blocked
(kills M431/M433/M436), lower-case sentinel blocked (M432/M433/M436), a padded genuine identity
refused as an error (M434), and the same with *leading* whitespace (M435):

```js
  wj('reg_padsentinel.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: 'UNASSIGNED ' } });
  ok(run(['verify-registration', ...withReg(regArgs, P('registration.json'), P('reg_padsentinel.json')), '--registry', regPath], { expectCode: 4 }).includes('Accountable OSF identity'), 'CLI padded UNASSIGNED sentinel does not pass as a supplied identity: BLOCKED exit 4');
  wj('reg_lowsentinel.json', { ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'unassigned' } });
  ok(run(['verify-registration', ...withReg(regArgs, P('registration.json'), P('reg_lowsentinel.json')), '--registry', regPath], { expectCode: 4 }).includes('Persistent identifier type'), 'CLI lower-case UNASSIGNED sentinel does not pass as a supplied type: BLOCKED exit 4');
  wj('reg_padvalue.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: `${reg.accountable_identity.value} ` } });
  ok(run(['verify-registration', ...withReg(regArgs, P('registration.json'), P('reg_padvalue.json')), '--registry', regPath], { expectCode: 1 }).includes('leading or trailing whitespace'), 'CLI a supplied identity with trailing whitespace is refused, not trimmed');
  wj('reg_leadvalue.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: ` ${reg.accountable_identity.value}` } });
  ok(run(['verify-registration', ...withReg(regArgs, P('registration.json'), P('reg_leadvalue.json')), '--registry', regPath], { expectCode: 1 }).includes('leading or trailing whitespace'), 'CLI a supplied identity with leading whitespace is refused, not trimmed');
```

These are **sketches, deliberately unverified** — running them means running the selftest, which this
stream is prohibited from doing. They are offered so the final edit session does not have to
rediscover the insertion point. Treat the exact `expectCode` and substring in each as needing
confirmation there.

## Cost summary for the final edit session

| edit | files touched | anchor count | moves the aggregate |
|---|---|---|---|
| `DR12_PATCH.diff` (the fix + M77 anchor repair) | `lib/registration.mjs`, `test/mutate.mjs` | 404 → 404 | yes — projected `e3109e66…` |
| M431–M436 insertion | `test/mutate.mjs` | **404 → 410** | yes |
| selftest assertions to kill them | `test/selftest.mjs` | unchanged | yes |

All three should land in one session and be certified once, from scratch.
