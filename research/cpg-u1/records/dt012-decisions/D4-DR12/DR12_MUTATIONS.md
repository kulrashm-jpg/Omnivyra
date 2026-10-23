# DR-12 §6 — the mutation design

**Stream:** DEEPTECH-PARALLEL-012, D-4. **DESIGN ONLY — not inserted, not applied, nothing written under
`C:/tmp/dt009-merge`.** No mutation suite was started and no selftest was run. Every "measured" figure
below comes from single `node cpg_u1_data.mjs verify-registration` invocations against a throwaway scratch
copy of the candidate's `lib/`+CLI, with fixtures written outside that copy. Raw output:
`DR12_EVIDENCE.md` §4.

Rule being tested: `DR12_RULE.md` §1.

---

## 1. Which candidates are mutants, and which are tests

A mutation must (a) have a unique anchor in the source, (b) change instrument *behaviour*, and (c) be
killed by an assertion that observes that change. A case that merely documents behaviour no source line
uniquely controls is a **test**, not a mutant — putting it in `MUTATIONS` either duplicates another mutant
or produces an anchor that cannot be mutated at all. Mapping the nine cases the directive lists:

| directive case | mutant or test? | why |
|---|---|---|
| **exact sentinel accepted/rejected** | **test** (already asserted) | The behaviour is controlled by the `!isUnassignedSentinel(v)` conjunct, which existing **M77** already removes wholesale. A second mutant on the same conjunct is a duplicate. The assertion already exists at `test/selftest.mjs:1368`. |
| **lowercase variant** | **MUTANT — M432** | uniquely controlled by `.toUpperCase()` inside `isUnassignedSentinel`; removing it restores acceptance |
| **uppercase variant** | **test only** | "uppercase" *is* the exact sentinel. No separate source control, so nothing to mutate. |
| **leading whitespace** | **MUTANT — M431** | uniquely controlled by `.trim()` inside `isUnassignedSentinel` |
| **trailing whitespace** | **test against M431** | the *same* source control as leading. Two mutants cannot both be anchored on one `.trim()`. The leading/trailing distinction is an assertion pair, and it earns its place against **M435**, not M431 — measured: M435 breaks the *leading* case only. |
| **both leading and trailing** | **test against M431** | same control again; it adds coverage of the tab/multi-space form, not a new mutant |
| **internal-space variant** | **test** (characterisation / boundary) | It documents **accepted** behaviour (`DR12_RULE.md` §3). There is no guard to remove, so no mutation can flip it. The assertion is still essential: it pins the decided boundary so a later stream cannot quietly widen the rule. But it kills nothing, and saying so is the honest §6 answer. |
| **empty** | **test** (regression) | controlled by `v.trim() !== ''`, which is pre-existing and **not** part of DR-12. A mutant there would be a new mutant for old behaviour, outside this scope. Assert it so the rule provably does not change it. |
| **whitespace-only** | **test** (regression) | same conjunct as empty |

So of the nine listed cases, **two are mutants** (lowercase, leading whitespace), **five are assertions
against those mutants or against the new `human()` refusals**, and **two (empty, whitespace-only) are pure
regression tests that kill nothing.** The remaining mutants in the set below cover the parts of the rule
that are *new code* and therefore mutable, which the directive's nine cases do not enumerate: the padding
refusal, its half-form, the whole-predicate regression, the fold direction, and the `Cf` refusal.

---

## 2. The mutation set

To be appended to the `// ── CPG-041: registration ──` group in `MUTATIONS`, after `M85`. `REG` is already
defined as `'lib/registration.mjs'` (`test/mutate.mjs:30`).

```js
  // ── DR-12: UNASSIGNED sentinel normalisation ──
  ['M431 sentinel compared without trimming', REG, 'const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;', 'const isUnassignedSentinel = (v) => v.toUpperCase() === UNASSIGNED;'],
  ['M432 sentinel compared case-sensitively', REG, 'const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;', 'const isUnassignedSentinel = (v) => v.trim() === UNASSIGNED;'],
  ['M433 pre-DR-12 sentinel comparison restored', REG, "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isUnassignedSentinel(v);", "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;"],
  ['M434 padded human value accepted', REG, 'else if (padded(v)) errors.push(', 'else if (false) errors.push('],
  ['M435 padding detected on the trailing side only', REG, 'const padded = (v) => v !== v.trim();', 'const padded = (v) => v !== v.trimEnd();'],
  ['M436 POSITIVE CONTROL: sentinel folded the wrong way (matches nothing)', REG, 'const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;', 'const isUnassignedSentinel = (v) => v.trim().toLowerCase() === UNASSIGNED;'],
  ['M437 zero-width / formatting character accepted in a human value', REG, 'else if (invisible(v)) errors.push(', 'else if (false) errors.push('],
```

`M437` belongs to Case 10 and is dropped if Case 10 is severed (`DR12_RULE.md` §5).

**Anchor uniqueness verified** on the patched scratch copy: each of the five distinct *from*-strings occurs
exactly once (`isUnassignedSentinel` line ×1, `assigned` line ×1, `padded` line ×1, `else if (padded(v))
errors.push(` ×1, `else if (invisible(v)) errors.push(` ×1).

**Three mutants share one anchor** (`M431`, `M432`, `M436` all anchor the `isUnassignedSentinel` line).
That is safe and precedented: the pre-flight counts occurrences per mutation independently
(`readFileSync(file).split(from).length - 1`, `test/mutate.mjs:483`), and the existing suite already does it
— `M426` and `M429` both anchor `.filter((a) => a?.role === ENUMERATOR_ROLE)`.

### 2.1 Judgement on M433 — legitimate but diagnostic, not detective

`M433` is the conjunction of `M431` and `M432`, so any assertion that kills either kills it. It adds **no
detection power**. I keep it for one reason: its *from*-string is the rule as patched and its *to*-string is
the **verbatim candidate line**, so if a future refactor reintroduces `v !== UNASSIGNED`, the run output
names that specific historical regression instead of leaving an operator to infer it from two other mutants
surviving together. That is diagnostic value and I say so rather than overstating it. **The owner may drop
M433 with no loss of detection**, giving 410 (or 409 with Case 10 severed).

### 2.2 Each mutant, its killing assertion, and its message — all measured

Baseline = the rule as written. "Mutant" = the same fixture with that one mutation applied. Nine fixtures
were run against the baseline and against each of the seven mutants (63 + 9 invocations); the full grid is
in `DR12_EVIDENCE.md` §4. Only the rows that differ from baseline are kills.

| ID | fixture (the assertion's record) | baseline: exit + message | mutant: exit + message | what the assertion must pin |
|---|---|---|---|---|
| **M431** | `accountable_identity.value = "UNASSIGNED "` (`padacct`) | **4** · `BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)` | **1** · `ERROR accountable_identity.value has leading or trailing whitespace …` | `expectCode: 4` **and** substring `Accountable OSF identity is UNASSIGNED` |
| **M431** (2nd) | `accountable_identity.value = " UNASSIGNED"` (`leadacct`) | **4** · same blocker | **1** · same whitespace error | as above |
| **M432** | `persistent_identifier.type = "unassigned"` (`lowtype`) | **4** · `BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)` | **0** · `registration … complete, public, unembargoed, authoritative` | `expectCode: 4` **and** substring `Persistent identifier type is UNASSIGNED` |
| **M433** | `lowtype` (4→0) and `padacct` / `leadacct` (4→1) | as above | as above | killed by either of M431's or M432's assertions |
| **M434** | `accountable_identity.value = "<genuine> "` (`padgenuine`) | **1** · `ERROR accountable_identity.value has leading or trailing whitespace …` | **0** · `… authoritative` | `expectCode: 1` **and** substring `has leading or trailing whitespace` |
| **M434** (2nd) | `" <genuine>"` (`leadgenuine`) | **1** · same | **0** · `… authoritative` | as above |
| **M435** | `" <genuine>"` (`leadgenuine`) — **leading only** | **1** · same whitespace error | **0** · `… authoritative` | `expectCode: 1` **and** substring `has leading or trailing whitespace`. Measured: `padgenuine` stays at exit 1 under M435, so the **trailing** fixture does *not* kill it. This is why the pair exists. |
| **M436** | `persistent_identifier.type = "UNASSIGNED"` (`exacttype`, = the existing `reg_noid` fixture) | **4** · `BLOCKED Persistent identifier type is UNASSIGNED …` | **0** · `… authoritative` | already pinned by the **existing** assertion at `test/selftest.mjs:1368` (`expectCode: 4`, substring `Persistent identifier`). Also flips `lowtype` 4→0, `padacct` 4→1, `leadacct` 4→1. |
| **M437** | `persistent_identifier.type = "UNASSIGNED\u200B"` (`zwsp`) | **1** · `ERROR persistent_identifier.type contains a zero-width or formatting character …` | **0** · `… authoritative` | `expectCode: 1` **and** substring `contains a zero-width or formatting character` |

Every mutant has at least one fixture whose **exit code and message both change**, so each is killed on two
independent channels.

### 2.3 Why a removed-guard TypeError cannot produce the same pass

The recorded precedent is real and this set is designed against it. Three layers, strongest first.

1. **No mutant in this set can throw.** Each replaces one *total* expression with another total expression:
   `M431`/`M432`/`M436` alter a string comparison; `M433` replaces one boolean conjunct with another;
   `M434`/`M437` replace a guard expression with `false`; `M435` swaps `trim` for `trimEnd`. There is no
   dereference, no new call on a possibly-absent value, and no path that can raise a `TypeError`. So for
   this set the failure mode is **structurally impossible**, not merely mitigated. Measured: all 63
   mutant invocations terminated with the tooling's own diagnostics — exit 0, 1 or 4 — never a stack trace.
2. **Exit 0 is unreachable by any throw, and five of the eight kill rows land on exit 0.** A `TypeError`
   inside `checkRegistration` is not caught (`registered()` wraps only `checkAuthority`), so it propagates
   and Node exits **1** with a stack trace on stderr. It can never produce exit 0 and can never print
   `registration … complete, public, unembargoed, authoritative`. An assertion of the form "exit 4 (or 1)
   **and** this exact tooling sentence" therefore cannot be satisfied by a crash: a crash gives exit 1 with
   no such sentence, so the assertion fails and the mutant is killed — for the right reason.
3. **The concrete "refused" trap, measured.** Under `M431` the record `accountable_identity.value =
   "UNASSIGNED "` is *still refused* — by the padding guard, as exit 1 with a whitespace error. An assertion
   written as "the run is refused", or even one written as `expectCode: 1`, **passes under M431 and the
   mutant survives.** Only `expectCode: 4` plus the substring `Accountable OSF identity is UNASSIGNED`
   distinguishes the two. This is the "green that lies" problem in its exact form for DR-12, and it is why
   §2.2 states a message for every row rather than a verdict.
4. **The harness itself discriminates, but not reliably enough to rely on.** `runMutant` classifies
   `KILLED` only when the selftest exits 1 *and* prints `selftest: N passed, M failed` with `M > 0`
   (`test/mutate.mjs:515`); a hard crash is reported as `ERROR`. But `test/selftest.mjs:80` has a crash guard
   that still prints the counts line and exits 1, flagging `SELFTEST CRASHED`, and `runMutant` surfaces that
   only as a parenthetical `includes a selftest crash`. So a crash *can* be recorded as a kill if nobody
   reads the flag. Layer 1 removes the possibility at source, which is the right place for it.

### 2.4 Improvement over the prior stream's assertion sketches

The prior stream's `DR12_MUTANTS.md` sketches swap only the `--registration` argument
(`withReg(regArgs, P('registration.json'), P('reg_padvalue.json'))`), leaving `--identity-registrations`
pointing at the unmodified `identity_regs.json`. Under `M434` the record then fails in `checkAuthority()`
with `listed registration … is under a different identity` and the CLI exits **1** — the very code the
sketch expects. The kill survives only on the message substring, one channel deep.

Writing a matching `ids_*.json` and swapping **both** arguments makes the mutant reach **exit 0**, so exit
code and message both change. Measured: with the record and the identity list carrying the same padded
value, the unpatched/M434 run exits 0 and prints `authoritative`. **Every fixture in §2.2 and §4 pairs
`reg_X.json` with `ids_X.json`.** This is a strict improvement and the assertions below reflect it.

---

## 3. Why the current 404-mutant suite cannot detect DR-12

M77 replaces `assigned()` with a version that drops the sentinel conjunct entirely, and it is killed on
every run — by `test/selftest.mjs:1368`, whose fixture sets `persistent_identifier` to the **exact** string
`'UNASSIGNED'` and demands exit 4. That proves the clause is *load-bearing for the exact sentinel* and
nothing more. Mutation testing measures whether **asserted** behaviour is protected by at least one
assertion; it cannot measure behaviour that was never asserted. All six `UNASSIGNED` occurrences in the
selftest are the exact sentinel, so no assertion anywhere in the suite observes how a *variant* is treated —
and a mutant that degrades only the normalisation (M431, M432) leaves every existing assertion green. The
hole is in the assertion set, and the kill rate is a property of the assertion set, so the kill rate is
blind to it by construction.

**Consequence for how 404/404 must be read.** A 404/404 result certifies that each of 404 named behaviours is
protected by at least one assertion. It is **not**, and must never be recorded as, a statement that the
instrument's behaviour is correct or its guards complete. The in-flight 404/404 run at aggregate
`638d68e6…` remains valid **as reported** and is not invalidated by DR-12; what is invalidated is any
inference from it about sentinel handling. The same caution applies to the post-fix figure: 411/411 will mean
the seven new behaviours are asserted, not that the sentinel can no longer be faked — `UN ASSIGNED` still
registers (`DR12_RULE.md` §3).

---

## 4. The selftest assertions, without which every new mutant survives

`test/mutate.mjs` kills a mutant by running **`test/selftest.mjs`** against the mutated copy and requiring it
to fail. Inserted without these, **six of the seven mutants survive** (M436 alone is caught by the existing
`:1368` assertion) and the run reports **405/411**.

Insertion point: immediately after `test/selftest.mjs:1368–1369`, in the established idiom. `reg`, `wj`, `P`,
`run`, `regArgs`, `withReg` and `regPath` are all already in scope there.

```js
  // DR-12: the UNASSIGNED sentinel is matched trimmed and case-folded; a supplied value is never silently trimmed.
  const withBoth = (r, i) => withReg(withReg(regArgs, P('registration.json'), P(r)), P('identity_regs.json'), P(i));
  const A = reg.accountable_identity.value;
  wj('reg_padacct.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: 'UNASSIGNED ' } });
  wj('ids_padacct.json', [{ ...reg, accountable_identity: { ...reg.accountable_identity, value: 'UNASSIGNED ' } }]);
  ok(run(['verify-registration', ...withBoth('reg_padacct.json', 'ids_padacct.json'), '--registry', regPath], { expectCode: 4 }).includes('Accountable OSF identity is UNASSIGNED'), 'CLI trailing-padded UNASSIGNED is the UNASSIGNED blocker, not a supplied identity: exit 4');   // kills M431, M433
  wj('reg_leadacct.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: ' UNASSIGNED' } });
  wj('ids_leadacct.json', [{ ...reg, accountable_identity: { ...reg.accountable_identity, value: ' UNASSIGNED' } }]);
  ok(run(['verify-registration', ...withBoth('reg_leadacct.json', 'ids_leadacct.json'), '--registry', regPath], { expectCode: 4 }).includes('Accountable OSF identity is UNASSIGNED'), 'CLI leading-padded UNASSIGNED is the UNASSIGNED blocker: exit 4');   // kills M431, M433
  wj('reg_lowtype.json', { ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'unassigned' } });
  wj('ids_lowtype.json', [{ ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'unassigned' } }]);
  ok(run(['verify-registration', ...withBoth('reg_lowtype.json', 'ids_lowtype.json'), '--registry', regPath], { expectCode: 4 }).includes('Persistent identifier type is UNASSIGNED'), 'CLI lower-case UNASSIGNED is the UNASSIGNED blocker: exit 4');   // kills M432, M433
  wj('reg_padgen.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: `${A} ` } });
  wj('ids_padgen.json', [{ ...reg, accountable_identity: { ...reg.accountable_identity, value: `${A} ` } }]);
  ok(run(['verify-registration', ...withBoth('reg_padgen.json', 'ids_padgen.json'), '--registry', regPath], { expectCode: 1 }).includes('has leading or trailing whitespace'), 'CLI a supplied identity with trailing whitespace is refused, not trimmed: exit 1');   // kills M434
  wj('reg_leadgen.json', { ...reg, accountable_identity: { ...reg.accountable_identity, value: ` ${A}` } });
  wj('ids_leadgen.json', [{ ...reg, accountable_identity: { ...reg.accountable_identity, value: ` ${A}` } }]);
  ok(run(['verify-registration', ...withBoth('reg_leadgen.json', 'ids_leadgen.json'), '--registry', regPath], { expectCode: 1 }).includes('has leading or trailing whitespace'), 'CLI a supplied identity with leading whitespace is refused, not trimmed: exit 1');   // kills M434, M435
  wj('reg_zwsp.json', { ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'UNASSIGNED\u200B' } });
  wj('ids_zwsp.json', [{ ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'UNASSIGNED\u200B' } }]);
  ok(run(['verify-registration', ...withBoth('reg_zwsp.json', 'ids_zwsp.json'), '--registry', regPath], { expectCode: 1 }).includes('contains a zero-width or formatting character'), 'CLI a zero-width-padded sentinel is refused, not accepted as a supplied type: exit 1');   // kills M437 (Case 10 only)
  // Boundary and regression assertions — these kill no mutant; they pin the decided rule.
  wj('reg_internal.json', { ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'UN ASSIGNED' } });
  wj('ids_internal.json', [{ ...reg, persistent_identifier: { ...reg.persistent_identifier, type: 'UN ASSIGNED' } }]);
  ok(run(['verify-registration', ...withBoth('reg_internal.json', 'ids_internal.json'), '--registry', regPath]).includes('authoritative'), 'CLI DR-12 boundary: internal whitespace is visible, so "UN ASSIGNED" is an assigned value and registers');
  ok(CHK({ ...reg, persistent_identifier: { ...reg.persistent_identifier, type: '' } }).blockers.some((b) => b.includes('Persistent identifier type is UNASSIGNED')), 'an empty human value is still the UNASSIGNED blocker');
  ok(CHK({ ...reg, persistent_identifier: { ...reg.persistent_identifier, type: '   ' } }).blockers.some((b) => b.includes('Persistent identifier type is UNASSIGNED')), 'a whitespace-only human value is still the UNASSIGNED blocker');
```

Nine assertions: six kill mutants, three pin the boundary and the two unchanged cases. The last two use the
library form (`CHK` = `checkRegistration(reg, { phase: 'registered', allowSynthetic: true })`) because they
assert classification, not an exit code; if no such helper is in scope at that point they should be written
in the `lib`-section idiom instead of the CLI one.

**Status of this block: the CLI behaviour each line asserts is measured (§2.2, `DR12_EVIDENCE.md` §4); the
block itself was NOT executed, because running it means running `test/selftest.mjs`, which this stream is
prohibited from doing.** Treat the exact `expectCode`/substring pairs as measured and the surrounding
plumbing (`withBoth`, `CHK`, fixture-name collisions with later `wj` calls) as needing confirmation in the
edit session.

---

## 5. Anchor arithmetic

| | value |
|---|---|
| current `MUTATIONS.length` | **404** (verified by parsing every entry: 404 entries, max ID M430, 26 gaps, no duplicates) |
| retired IDs — **not reused** | M23, M24, M25, M26, M225, M244, M280–M299 (26 numbers; 430 − 26 = 404) |
| first free ID | **M431** |
| new mutants, Case 10 adopted | **M431 – M437** (7) → **411** |
| new mutants, Case 10 severed | **M431 – M436** (6) → **410** *(the directive's figure)* |
| if M433 is also dropped (§2.1) | 410 / 409 respectively |
| **renumbering** | **none.** Every addition appends. No existing ID, group, *from*-string or *to*-string changes, with the single exception below. |
| M77 anchor repair | **mandatory, and 404 → 404 by itself.** Its *from*-string is the verbatim candidate `assigned` line; patching `lib/registration.mjs` without repairing it makes the anchor occur zero times and `test/mutate.mjs` exits 1 at the pre-flight (`:486`) before any mutant runs. Its *to*-string is unchanged, so it remains the same mutant killed by the same assertion. New *from*-string: `"const assigned = (v) => typeof v === 'string' && v.trim() !== '' && !isUnassignedSentinel(v);"` |

Expected pre-flight line after the edit: `anchors: 411/411 occur exactly once` (or `410/410` with Case 10
severed).

**The three edits are one atomic unit.** `lib/registration.mjs` without `test/mutate.mjs` breaks the
pre-flight; `test/mutate.mjs` without `test/selftest.mjs` gives 405/411. Splitting them across sessions
produces a tree that is worse than either endpoint, and each session is a full re-certification.
