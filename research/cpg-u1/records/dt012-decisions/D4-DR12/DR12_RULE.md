# DR-12 — the complete UNASSIGNED sentinel-normalisation rule

**Stream:** DEEPTECH-PARALLEL-012, D-4.
**Status: DESIGN ONLY. Nothing was applied. No file was written under `C:/tmp/dt009-merge`.**
**Candidate:** `C:/tmp/dt009-merge/tooling`, aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files (read-only for this
stream). All measurement below was done on a throwaway copy of `lib/`, `cpg_u1_data.mjs`, `rules/`,
`templates/` and `node_modules/` in the session scratchpad, with every fixture written **outside** that
copy so the copy's own aggregate never moved. No mutation suite was started, no selftest was run, and
the in-flight 404-mutant run's output was not inspected.

Companion files: `DR12_MUTATIONS.md` (Task 2, the mutation design) and `DR12_EVIDENCE.md` (the raw
measured tables every claim here rests on).

---

## 0. Confirmation of the established facts

All four were re-verified independently before anything was built on them.

| fact | verified |
|---|---|
| `lib/registration.mjs:59` is `const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;` | yes — line 59 exactly; emptiness tested trimmed, sentinel tested untrimmed and case-sensitive |
| `test/mutate.mjs:120` M77's *from*-string is that verbatim line | yes. The pre-flight at `test/mutate.mjs:486` counts every anchor and `process.exit(1)`s before a single mutant runs, so patching `registration.mjs` alone breaks the harness at the gate |
| all six `UNASSIGNED` occurrences in `test/selftest.mjs` use the exact sentinel | yes — lines 420, 455 (×2), 1368, 1516, 1800; none is a whitespace or case variant |
| highest ID M430; 404 mutants; retired gaps M23–M26, M225, M244, M280–M299 | yes — parsed every `MUTATIONS` entry: 404 entries, max 430, missing set exactly `{23,24,25,26,225,244,280…299}` = 26 numbers, 430 − 26 = 404, zero duplicate IDs |

### 0.1 Two corrections to the premises I was given

These change the severity of DR-12 and must be recorded.

**(a) DR-12 reaches exit 0. It is a fail-open, not a mis-classification.** The directive states that
"DR-12's worst case is exit **4** and it **cannot** reach exit 0 (applied to all ten fields it yields exit
1 with format errors)". The parenthesis is true; the claim is not. Applied to *all ten* fields at once the
record fails the anchored shape validators and exits 1. Applied to **one** field that has no shape
validator, the whole record verifies clean. Measured end-to-end on the scratch copy with the **unpatched
candidate code**:

```
node cpg_u1_data.mjs verify-registration --registration <rec> --identity-registrations <list> \
     --protocol <p> --registry rules/development_only_registry.json --allow-synthetic
```

| record (everything else genuinely filled) | exit | first line of output |
|---|---|---|
| clean control | 0 | `registration … complete, public, unembargoed, authoritative; …` |
| `persistent_identifier.type = "unassigned"` | **0** | `registration … complete, public, unembargoed, authoritative; …` |
| `accountable_identity.value = "UNASSIGNED "` | **0** | `registration … complete, public, unembargoed, authoritative; …` |
| `accountable_identity.value = "SYNTHETIC-ACCOUNTABLE-IDENTITY "` (padded genuine) | **0** | as above |
| `persistent_identifier.type = "UNASSIGNED\u200B"` | **0** | as above |

So the candidate tooling prints *"complete, public, unembargoed, authoritative"* and exits 0 over a
registration whose accountable identity is the word `UNASSIGNED` with one trailing space. Nothing
downstream catches it: `checkAuthority()` compares `accountable_identity.value` for exact equality against
the registry list, and the operator generates the record and that list from the same JSON, so both sides
carry the same variant and agree. The earlier framing missed this because the wave-011 probe varied fields
inside the *pristine template*, where nine other blockers remain and pin the exit code at 4.

**(b) Five fields, not four, are protected by `assigned()` alone.** The directive says six of the ten fields
"already have anchored validators". The anchored validators are **five**: `ISO_UTC` (×2), `HEX64` (×1),
`parseOutpoint` (×2). `registration_id`'s only post-guard check is `.includes('|')`, a negative character
test, not a shape anchor. Measured: `registration_id = "UNASSIGNED "` yields `errors=0 blockers=0`. So the
at-risk set is the four `human()` fields **plus `registration_id`** — and `registration_id` is the one
at-risk field the prior stream's `human()`-scoped padding check does not reach.

---

## 1. The rule

### 1.1 Predicates

```js
const isUnassignedSentinel = (v) => v.trim().toUpperCase() === UNASSIGNED;   // sentinel, normalised
const padded    = (v) => v !== v.trim();                                     // used in human() only
const invisible = (v) => /\p{Cf}/u.test(v);                                   // used in human() only
const assigned  = (v) => typeof v === 'string' && v.trim() !== '' && !isUnassignedSentinel(v);
```

and inside `human(v, name, label)`, in this order:

```js
if (!assigned(v)) blockers.push(`${label} is UNASSIGNED (${name})`);
else if (padded(v)) errors.push(`${name} has leading or trailing whitespace — supply the exact value (it is compared for exact equality at verification)`);
else if (invisible(v)) errors.push(`${name} contains a zero-width or formatting character — supply the exact visible value`);
else if (synthetic(v) && !allowSynthetic) errors.push(…);   // unchanged
```

The normalisation domain is **`String.prototype.trim`**: Unicode White_Space plus line terminators.
Verified that this includes U+00A0 NBSP, U+3000 ideographic space and U+FEFF, so `"\u00A0UNASSIGNED\u00A0"`
is caught by the same clause. It does **not** include U+200B and the other format (`Cf`) code points —
hence `invisible()`, case 10, §5.

### 1.2 The complete case table — decided

`B` = blocker (a named human prerequisite is missing; CLI exit **4**).
`E` = error (the human supplied something malformed or forbidden; CLI exit **1**).
Every row was measured at CLI level on the scratch copy under the rule as written (`DR12_EVIDENCE.md` §3).

| # | input | `assigned()` | verdict | class | exit | message emitted |
|---|---|---|---|---|---|---|
| 1 | `UNASSIGNED` | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 2 | `unassigned` (any casing) | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 3 | `UNASSIGNED␠` (trailing) | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 4 | `␠UNASSIGNED` (leading) | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 5 | `␠␠UNASSIGNED␉` (both) | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 6 | `UN ASSIGNED` (internal space) | true | **ACCEPTED** | — | 0 | — (it registers; §3) |
| 7 | `""` (empty) | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 8 | `"   "` (whitespace-only) | false | **rejected** | **B** | 4 | `<label> is UNASSIGNED (<name>)` |
| 9 | legitimate assigned string, unpadded, visible | true | **accepted** | — | 0 | — |
| 9a | legitimate assigned string **with leading/trailing whitespace** | true | **rejected** | **E** | 1 | `<name> has leading or trailing whitespace — supply the exact value …` |
| 10 | any value containing a `Cf` code point (U+200B, U+200C/D, U+200E/F, U+2060, U+00AD, interior U+FEFF) | true | **rejected** | **E** | 1 | `<name> contains a zero-width or formatting character — supply the exact visible value` |

Rows 9a and 10 are enforced in `human()` only — see §4.1. Rows 1, 7, 8 are unchanged from today; rows
2–5 are the behaviour change; 9a and 10 are new refusals.

### 1.3 Why the blocker/error split falls where it does

The module docstring is the contract: *"errors = malformed/forbidden; blockers = named human prerequisites
missing"*, and `reportRegistrationCheck` turns that into exit 1 vs exit 4 (`EXIT.BLOCKED`, commented in
`cpg_u1_data.mjs:52` as "BLOCKED (human prerequisite)"). Errors are printed and terminate first; blockers
exit 4. The split is therefore not cosmetic: it is the channel that tells the operator *whether there is
something to fix or something still to obtain*.

- **Every spelling of the sentinel is a blocker.** Whatever the casing or padding, `UNASSIGNED` is the
  template's own declaration that *nothing was supplied*. Calling it an error would tell the operator
  "what you gave me is malformed" when the truth is "you gave me nothing", and would turn exit 4 (BLOCKED
  — the resumable state the whole registration workflow is built on) into exit 1 (refused). Empty and
  whitespace-only are the same statement and are blockers today; the rule preserves that.
- **Padding and invisible characters on a non-sentinel value are errors.** The human *did* supply
  something. It is malformed. "Error" is the contract's own word for that.
- **Ordering is sentinel-first, and it is load-bearing.** With `padded` first, `"UNASSIGNED "` would be
  reported as a whitespace error at exit 1: an operator who left the template default in place and whose
  editor added a trailing space would be told their *formatting* is wrong rather than that a prerequisite
  is missing, and the BLOCKED state would be lost. I adopt the prior stream's ordering and its reason, and
  add the measured consequence: under sentinel-first the wave-011 whitespace probe reports **identically
  to the pristine template** — 10 blockers, 0 errors, exit 4 — so the bypass delta returns to exactly 0,
  which is the property the fix has to have.

The prior stream's proposal on the split — padding an **error**, sentinel a **blocker**, sentinel-first —
is **adopted unchanged**. I could not improve on it, and I found one argument for it that was not recorded
(the exit-4 workflow state, above).

---

## 2. Decision 1 — case-fold, not trim-only

**DECIDED: case-fold, with `toUpperCase()`, compared against the exported `UNASSIGNED` constant.**

The prior stream reached the same answer. I do **not** adopt its argument, because the argument does not
support the decision. I replace it.

**The "collision risk is zero in eight of ten fields by construction" argument is true and irrelevant.**
In those eight fields the choice has no acceptance consequence at all: `provider_configuration_sha256 =
"unassigned"` is refused by `HEX64` whether or not we fold; `as_of = "UNASSIGNED "` is refused by `ISO_UTC`
either way. Measured — each of the five anchored fields produces an *error* for every sentinel variant,
before and after the change. The eight-field survey shows only that folding does no harm there. The
decision turns **entirely** on the five unshaped fields (the four `human()` fields and `registration_id`),
which is exactly where the prior argument was thinnest.

**The thin-looking argument is in fact the decisive one, and it is stronger than a probability claim.** The
prior stream wrote that a party literally named "Unassigned" "is indistinguishable from the sentinel to any
outside verifier". That is not a statement about how unlikely such a party is. It is a statement that the
resulting record is **undecidable**. DR-12 exists so that a third party reading the public OSF record can
tell *"a human supplied this"* from *"this is the template default"*. Any value whose visible rendering is
the word "unassigned" destroys that distinction no matter what the tooling stored. So this is not a trade
between a small false-rejection risk and a small false-acceptance risk: folding **removes an undecidable
state**, and fail-closed is mandatory for a value that cannot be verified by inspection. Refusing a party
genuinely named "Unassigned" is the correct outcome, not a regression — such a party cannot have a
verifiable preregistration under this protocol and needs the identifier the field is actually for (an OSF
handle, ORCID or ROR).

**Direction: `toUpperCase`, and this is not arbitrary.** Three measured reasons.

1. `toLowerCase()` compared against the uppercase constant `UNASSIGNED` matches **nothing** — it makes even
   the exact sentinel `"UNASSIGNED"` read as *assigned*. (Measured: the `M436_lower` column of the
   predicate probe returns `true` for all seventeen inputs including the bare sentinel; and at CLI level
   the `exacttype` fixture flips from exit 4 to exit 0 under that mutation.) Any downward fold must
   therefore compare against a second literal `'unassigned'`, introducing a string that can drift from the
   exported constant. `toUpperCase` compares against the exported constant itself and cannot drift.
2. `toUpperCase` is the fail-closed direction: it folds *more* inputs onto the sentinel, and every extra
   fold produces a **blocker**, never an acceptance. Measured: `"unassıgned"` (Turkish dotless i)
   uppercases to `UNASSIGNED` and is blocked. JS `toUpperCase` is locale-independent, so this is stable.
3. It is the module's existing convention — the sibling guard two lines down already folds:
   `synthetic = (v) => v.toUpperCase().includes(SYNTHETIC_PREFIX)`. A case-sensitive `UNASSIGNED` beside a
   case-insensitive `SYNTHETIC` was the anomaly. (Corroboration, not ground.)

**Trim-only is rejected on measured evidence, not taste.** It leaves case 2 accepted, and case 2 is an
**exit 0** route: `persistent_identifier.type = "unassigned"` verifies clean and prints "authoritative". A
fix that leaves an exit-0 route open is not a fix.

---

## 3. Decision 2 — `UN ASSIGNED` is ASSIGNED, and it registers

**DECIDED: `UN ASSIGNED` (internal space) is accepted. The boundary the prior stream drew is right.**
Measured under the rule: `persistent_identifier.type = "UN ASSIGNED"` → exit 0, `registration … complete,
public, unembargoed, authoritative`.

Three reasons, in order of weight.

1. **The principle is invisibility, and this is visible.** Cases 1–5, 7, 8 and 10 are rejected because a
   human reading the public record cannot tell them from the untouched template. `UN ASSIGNED` is a
   *different visible string*; the undecidability that justifies the other rejections does not arise. The
   verifier can see what was written and judge it.
2. **Rejecting it requires a similarity judgement with no principled stopping point.** Collapse internal
   whitespace and `UN ASSIGNED` matches — but then what of `U N A S S I G N E D`, `UNASSIGNED.`,
   `UNASSIGNED (TBD)`, `not yet assigned`? Each demands another rule and the tooling has no basis to
   choose. That is the *arbitrary-placeholder* problem, which is R28's, not DR-12's (§6).
3. **Here fail-closed carries a cost the other cases do not.** Whitespace-collapse matching could refuse a
   *real* value, and these fields have no shape validation by design (`EVIDENCE_SCHEMA` unresolved), so the
   tooling cannot tell a real internally-spaced identifier from a look-alike. Rejecting on suspicion would
   be the tooling inventing identity semantics, which the module's opening comment forbids.

**The consequence, stated plainly and to be recorded:** a human who writes `UN ASSIGNED` into any of the
five unshaped fields produces a registration this tooling certifies at exit 0. **DR-12 does not make the
record proof against a human who wants to fake completeness. It makes the record proof against a human who
accidentally leaves the sentinel in place, mis-cases it, or pads it invisibly.** Anyone deliberately writing
a look-alike placeholder is a different threat, owned elsewhere. Any later reader who takes "DR-12 resolved"
to mean "the sentinel cannot be faked" will be wrong, so the wording in §7 says so in terms.

---

## 4. The ten fields, the six sites, and what changes for each

Enumeration **confirmed**: `assigned` is a module-local `const`, not exported, appearing at six textual
sites covering ten fields.

| # | field | site | validator *after* the guard | what the rule changes |
|---|---|---|---|---|
| 1 | `bitcoin_key_custodian.value` | `:71` in `human()` | none (only the SYNTHETIC refusal) | **real**: cases 2–5 flip accepted → **blocker**; 9a/10 flip accepted → **error**. Closes an exit-0 route. |
| 2 | `accountable_identity.value` | `:71` in `human()` | none | **real**, as above. Also removes the path by which a padded value propagates into `checkAuthority()`'s exact-equality comparison. |
| 3 | `persistent_identifier.type` | `:71` in `human()` | none | **real**, as above. |
| 4 | `persistent_identifier.value` | `:71` in `human()` | none | **real**, as above. |
| 5 | `registration_id` | `:96` | `.includes('|')` only — **not a shape anchor** | **real for the sentinel**: cases 2–5 flip accepted → blocker, closing an exit-0 route. **Not** covered for 9a/10 (padding of a genuine id) — residual R-b. |
| 6 | `registration_timestamp` | `:98` | `ISO_UTC` + `Date.parse` | **classification only**: error → blocker. No acceptance change. |
| 7 | `outpoints.development` | `:102` | `parseOutpoint` | classification only |
| 8 | `outpoints['held-out']` | `:102` | `parseOutpoint` | classification only |
| 9 | `as_of` | `:110` | `ISO_UTC` | classification only |
| 10 | `provider_configuration_sha256` | `:112` | `HEX64` | classification only |

Eleventh surface, deliberately untouched: `checkpoint.height` / `checkpoint.hash` (`:108`) compare
`=== UNASSIGNED` **directly**, bypassing `assigned()`. Measured: every sentinel variant there produces an
*error* (`checkpoint must be {height: integer, hash: 64 hex}`) because `Number.isSafeInteger` and `HEX64`
reject it. There is no acceptance route, so changing it would buy nothing and widen the diff.

The change to `assigned()` is **monotone-tightening**: the new predicate is true on a strict subset of the
inputs the old one accepted (verified across seventeen inputs). Nothing previously refused can become
accepted.

### 4.1 Judgement on placing the padding check in `human()` rather than `assigned()`

**Adopted, with one correction to the reason given.**

Adopted because:

- `assigned()` returns a boolean and has no channel to push an error. Moving padding into it means either
  returning `false` — which misclassifies a supplied-but-padded value as a *missing prerequisite* — or
  restructuring it into a result object, a much larger diff across six call sites for no gain.
- The `human()` set is where padding is simultaneously undetectable (no shape validator) and consequential
  (`checkAuthority()` exact equality).
- For the five anchored fields, padding already yields an error from the regex. A second, differently
  worded error for the same malformation is noise.

Corrected: the prior stream described `human()`'s four fields as "the four fields with no shape
validation". They are four of **five** — `registration_id` also has none and is not in `human()`. So this
placement leaves padding of a genuine `registration_id` uncovered. I judge that acceptable (it is
registry-issued, it is not the accountability anchor, and a mismatch surfaces at the registry) but it must
be **recorded as a residual, not implied closed**. The prior stream's stated reason for dismissing it — that
it "fails loud in `checkAuthority()`: the registration is not in the identity registration list" — is wrong
in the realistic case: the operator generates the record and the identity list from one JSON, both carry the
same padding, the lookup matches, and it exits 0. Same disposition, corrected reason.

---

## 5. Case 10 — the residual the prior stream did not find, and what I do about it

`String.prototype.trim` strips Unicode White_Space. It does **not** strip format (`Cf`) code points: U+200B
ZERO WIDTH SPACE, U+200C/D, U+200E/F (LRM/RLM), U+2060 WORD JOINER, U+00AD SOFT HYPHEN, and U+FEFF when
interior. Measured on the scratch copy with the prior stream's patch applied exactly as written:

| record | PATCH-core (prior stream's rule) | PATCH-full (with `invisible()`) |
|---|---|---|
| `persistent_identifier.type = "UNASSIGNED\u200B"` | **exit 0** — `registration … complete, public, unembargoed, authoritative` | **exit 1** — `ERROR persistent_identifier.type contains a zero-width or formatting character …` |

So the prepared patch leaves an exit-0 route open for a value *exactly* as invisible as the one it closes.
By the rule's own stated principle — reject what is invisible to a human reader — this case must be
rejected, or the principle must be narrowed in the wording to "whitespace as `trim()` defines it".

**DECIDED: adopt Case 10 as part of the recommended rule**, as an **error** in `human()`, via `/\p{Cf}/u`.
Reasons: (i) it is one total, decidable predicate over a closed Unicode general category — no list to
curate and no similarity judgement; (ii) it closes an exit-0 route of identical severity to DR-12's own;
(iii) `Cf` matches nothing in any legitimate value of these fields (OSF handle, ORCID, ROR, DOI, URL) and
nothing in the existing selftest fixtures, which are plain ASCII.

**The honest cost.** U+200E/U+200F are legitimately used to force correct display of bidirectional text, so
a party whose *name* is in Arabic or Hebrew could carry a directional mark. These four fields are identifier
fields, not display-name fields, so the mark is not needed; and the refusal is an actionable error naming
the field, not a silent state. I judge the cost acceptable — but an owner who weighs it differently has a
clean severance point.

**SEVERABLE.** Strike Case 10 and the rule is exactly the prior stream's, the arithmetic is exactly the
directive's 404 → 410, and the ZWSP route stays open as named residual R-e. §7 gives the wording for both.

---

## 6. R28 — the boundary, stated plainly

**This rule does not close R28 and does not claim to.** R28 is a separate finding, owned by another stream,
in which `TBD` / `PLACEHOLDER` reach exit 0.

- **DR-12 is about the sentinel `UNASSIGNED` and its invisible variants.** It closes the exact sentinel
  (already closed) and every casing, padding and — if Case 10 is adopted — zero-width variant of that one
  word, across all ten guarded fields.
- **R28 is about arbitrary placeholder tokens that are not the sentinel**: `TBD`, `PLACEHOLDER`, `N/A`,
  `none`, and — by my own §3 decision — `UN ASSIGNED`. No amount of normalising `UNASSIGNED` touches any of
  them, because they are different words. `TBD` still registers after this rule, at exit 0.
- **The two findings share a root cause** — four, in truth five, fields with no shape validation at all —
  but they are different fixes. DR-12 is a comparison rule over one known constant. R28 needs either a
  deny-list of placeholder tokens (arbitrary, and an arms race) or positive identifier shape validation,
  which is the unresolved `EVIDENCE_SCHEMA` question.
- **What my correction in §0.1(a) does and does not change.** It shows that DR-12, like R28, reaches exit 0
  — so the two are of the same severity class, which the earlier framing obscured. It does **not** merge
  them, and it transfers no part of R28 to this stream. R28's route stays open after DR-12 is applied.
  Whoever closes R28 should be told that DR-12 has already normalised `UNASSIGNED` for them, so their
  deny-list need not include it.

---

## 7. The nine-field return

### DECISION

Resolve DR-12 by normalising the `UNASSIGNED` sentinel comparison — **trim + `toUpperCase`** — inside the
single shared `assigned()` helper in `lib/registration.mjs`, and by adding two refusals in `human()` for
values that are supplied but invisibly malformed (leading/trailing whitespace; zero-width or formatting
characters). Repair M77's anchor in the same edit, add **seven** new mutants `M431`–`M437`, and add the
selftest assertions without which those mutants would survive. **Design only. Nothing applied.**

### RECOMMENDED RULE

Reject, as a **blocker**, any string whose `trim().toUpperCase()` equals `UNASSIGNED`, and any string that is
empty or whitespace-only, at all ten `assigned()`-guarded fields. Accept any other non-empty string,
**except** that in the four `human()` fields a value with leading/trailing whitespace, or containing a
Unicode format (`Cf`) code point, is refused as an **error**. The sentinel test runs **first**, so
`"UNASSIGNED "` reports as the honest "is UNASSIGNED" blocker at exit 4. Internal whitespace (`UN ASSIGNED`)
remains **assigned** and registers. Case 10 (the `Cf` clause) is **severable**: struck, the rule is the prior
stream's exactly and the mutation arithmetic is 404 → 410.

### ALTERNATIVES CONSIDERED

1. **Trim only, no case-fold** — rejected: leaves `"unassigned"` at exit 0 (measured).
2. **`toLowerCase` fold** — rejected: against the uppercase constant it matches nothing at all, so even the
   bare sentinel would read as assigned (measured); it also needs a second literal that can drift.
3. **Silently trim and store the trimmed value** — rejected on the module's own contract, "the tooling never
   creates, publishes or names anything". Rewriting a human-supplied accountable identity is the tooling
   naming something, and it hides the operator's error in the one record that cannot be amended afterwards.
4. **Padding as a blocker rather than an error** — rejected: the human did supply something; the docstring
   reserves "blocker" for what is missing, and exit 1 vs exit 4 carries that meaning to the operator.
5. **Padding check inside `assigned()` instead of `human()`** — rejected: `assigned()` is a boolean predicate
   with no error channel; it would either misclassify or force a six-site refactor.
6. **Rejecting `UN ASSIGNED` by collapsing internal whitespace** — rejected: a similarity judgement with no
   principled stopping point, and it is R28's territory.
7. **Widening the guard to a placeholder deny-list (`TBD`, `N/A`, …)** — rejected: that *is* R28, owned by
   another stream; doing it here would duplicate and pre-empt their decision.
8. **Fixing `checkpoint`'s direct `=== UNASSIGNED` comparisons** — rejected: measured to produce errors on
   every variant, so no acceptance route exists; the edit would widen the diff for no gain.
9. **Leaving Case 10 out** (the prior stream's scope) — retained as the explicit severable option, with the
   open exit-0 route named rather than left to be rediscovered.
10. **Adding a shape validator for the five unshaped fields** — rejected as out of scope: it is the
    unresolved `EVIDENCE_SCHEMA` question and it would have the tooling invent identity semantics.

### SCIENTIFIC / INTEGRITY EFFECT

Without this, the instrument can certify a public preregistration as *"complete, public, unembargoed,
authoritative"* at exit **0** while the accountable identity of record is the word `UNASSIGNED` with a
trailing space, or `unassigned` in lower case, or a zero-width-padded sentinel — all three measured. That is
a record no outside verifier can distinguish from an untouched template, which defeats the one property
public preregistration exists to provide: that the accountable party is fixed and readable before the data
are seen. With the rule, every invisible variant yields the same exit-4 BLOCKED state as the pristine
template — the wave-011 probe's blocker count returns from 8 to 10 and its bypass delta to 0 (measured).
What remains open is deliberate look-alike placeholders (§3, §6) — an honesty gap, not an invisibility gap,
and it is stated in the wording so the record does not over-claim.

### REGISTRATION EFFECT

- The change is monotone-tightening: **no record refused today can become accepted.** Verified across
  seventeen predicate inputs and nine CLI fixtures.
- Records that today pass while carrying a sentinel variant in one of the five unshaped fields move from exit
  0 to exit **4** (BLOCKED, resumable — the operator supplies the value and re-runs). Records carrying
  invisibly-padded *genuine* values in the four `human()` fields move from exit 0 to exit **1** (refused —
  the operator retypes the value). Both are pre-registration states; neither voids anything.
- **Correction to the directive's premise:** DR-12's worst case is **not** exit 4, and it **does** reach exit
  0 — §0.1(a), measured end-to-end. This raises DR-12 from mis-classification to fail-open and is the
  strongest reason to resolve it before registration rather than after.
- **The rule does not close R28** (`TBD` / `PLACEHOLDER` still reach exit 0) and must not be recorded as
  doing so. §6.
- No registration was performed, no frame touched, no Bitcoin, network or credential used.

### MUTATION EFFECT

Anchors **404 → 411** with Case 10 adopted (`M431`–`M437`); **404 → 410** with Case 10 severed
(`M431`–`M436`, the directive's figure). No renumbering; no retired ID reused; M77's *from*-string is
repaired in place (404 → 404 on its own) and is **mandatory** — without it the pre-flight at
`test/mutate.mjs:486` exits 1 and no mutant runs. `test/selftest.mjs` must gain the assertions in
`DR12_MUTATIONS.md` §4 in the **same** edit: inserted without them, six of the seven mutants **survive** and
the run reports 405/411 rather than 411/411 (M436 alone is killed by the existing assertion at
`selftest.mjs:1368`). Every mutant in the set replaces one total expression with another total expression, so
**none of them can throw** — the "a removed guard still TypeErrors, so the test passes" failure mode is
structurally impossible for this set, not merely guarded against. Kill assertions and exact message
substrings: `DR12_MUTATIONS.md`.

### PROTOCOL EFFECT

**None.** `CPG_U1_PROTOCOL_004` is unchanged, no §-text is amended, and no `PROTOCOL_MARKERS` entry moves:
that list already contains the bare string `'UNASSIGNED'`, and the constant, its value and the template's use
of it are untouched. The rule tightens how the *tooling* reads a value the protocol already requires to be
replaced before registration; it introduces no new protocol obligation and removes none. Two
tooling-internal notes: the diagnostic vocabulary gains two operator-facing error sentences (guidance, not
protocol text), and the tooling aggregate moves, so the aggregate recorded in any registration draft must be
recomputed after the edit.

### OWNER APPROVAL REQUIRED?

**YES.** Three separable approvals, none of which this stream may infer, assume or grant:

1. **the rule** — that the sentinel is matched trimmed and case-folded, and that invisibly-padded genuine
   values are refused as errors;
2. **Case 10** — adopt (404 → 411) or sever (404 → 410, ZWSP route left open as named residual R-e);
3. **the edit window** — this moves the aggregate, so it must land in one session with DR-11 and
   `EVIDENCE_SCHEMA` and be certified once from scratch, and the in-flight 404-mutant run at `638d68e6…`
   must finish and be recorded first.

No approval has been sought or obtained. Nothing was applied.

### EXACT WORDING TO RECORD

> **DR-12 (UNASSIGNED sentinel normalisation) — RESOLVED IN DESIGN, NOT APPLIED.**
> `lib/registration.mjs`'s `assigned()` helper tested emptiness after trimming but tested the `UNASSIGNED`
> sentinel untrimmed and case-sensitively. Any casing or whitespace padding of the word therefore passed as a
> supplied value at all ten guarded fields. Measured on a scratch copy of the candidate
> (`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`): the defect reaches exit **0** —
> `verify-registration` prints "complete, public, unembargoed, authoritative" for a record whose
> `accountable_identity.value` is `"UNASSIGNED "` — because five of the ten fields (the four `human()` fields
> and `registration_id`) have no shape validation and `checkAuthority()` compares the record against an
> identity list generated from the same JSON. The earlier assessment that DR-12's worst case is exit 4 is
> **superseded**; it holds only when the variant is applied to all ten fields at once.
> **The rule:** a value is UNASSIGNED — a **blocker**, exit 4, reported as "`<label>` is UNASSIGNED
> (`<name>`)" — when it is empty, whitespace-only, or when `trim().toUpperCase()` equals `UNASSIGNED`. Any
> other non-empty value is assigned. In the four `human()` fields a value that is assigned but carries leading
> or trailing whitespace, or contains a Unicode format (`Cf`) code point, is refused as an **error**, exit 1,
> and is never silently trimmed: `checkAuthority()` compares these values for exact equality, and the tooling
> does not rewrite what a human supplied. The sentinel test runs first, so `"UNASSIGNED "` is reported as the
> honest missing-prerequisite blocker rather than as a formatting error.
> **The boundary:** internal whitespace is *visible*, so `UN ASSIGNED` remains **assigned and registers**.
> DR-12 makes the record proof against a sentinel left in place, mis-cased, or invisibly padded. It does
> **not** make the record proof against a human who deliberately writes a look-alike placeholder. **DR-12 does
> not close R28** — `TBD` and `PLACEHOLDER` still reach exit 0, another stream owns that, and this rule must
> not be recorded as closing it.
> **Cost:** `lib/registration.mjs` (the rule), `test/mutate.mjs` (M77's anchor repaired in place plus seven
> new mutants `M431`–`M437`, anchors 404 → 411), `test/selftest.mjs` (the assertions without which six of the
> seven survive). Three files, one session, certified once from scratch. Any projected aggregate is
> **projected, not certified**. Zero-width/format-character refusal (Case 10, mutant `M437`) is **severable**:
> struck, the arithmetic is 404 → 410 and the zero-width exit-0 route remains open as a named residual.
> **Owner approval is required** for the rule, for Case 10, and for the edit window. None has been sought.

---

## 8. Residuals, named not fixed

- **R-a. `UN ASSIGNED` and every other look-alike placeholder register.** By decision, §3. R28's territory.
- **R-b. Padding of a genuine `registration_id` is not refused.** Its only check is `.includes('|')` and it is
  not in `human()`. Not a silent *sentinel* bypass after this rule. The prior stream's reason for dismissing
  it is corrected in §4.1.
- **R-c. No identifier shape validation for the five unshaped fields.** Unchanged and out of scope by design;
  the `EVIDENCE_SCHEMA` question, and the shared root cause of DR-12 and R28.
- **R-d. `checkpoint`'s direct `=== UNASSIGNED` comparisons.** Measured loud (errors) on every variant;
  deliberately untouched, §4.
- **R-e. If Case 10 is severed, `"UNASSIGNED\u200B"` reaches exit 0.** Measured. Named here so severance is a
  decision on the record rather than an omission.

## 9. Risks

- **Aggregate movement.** Three files change. The 404-mutant certification in flight against
  `C:/tmp/dt009-merge/tooling` is anchored at 404 and would be invalidated. This is why nothing was applied.
- **Six of the seven mutants survive if the selftest assertions are omitted.** The largest execution risk, and
  the reason the three edits cannot be split across sessions.
- **The prior stream's projected aggregate
  `e3109e66eb583b2724caab0ae6444f9b88796284876369be7787fdf4c3783aad` is a projection of its two-file patch
  only.** It does not include the seven mutants, the selftest assertions, or Case 10. **It certifies nothing
  and must not be quoted as an expected result.** I did not reproduce it and did not attempt to.
- **Selftest exposure is unmeasured.** Static inspection says nil — `filledRegistration`
  (`test/selftest.mjs:439–447`) supplies `'SYNTHETIC-ACCOUNTABLE-IDENTITY'`, `'SYNTHETIC-ORCID'`,
  `'SYNTHETIC-0000-0000-0000-0000'`, `'SYNTHETIC-STUDY-OPERATOR'`, all plain ASCII, unpadded and `Cf`-free —
  but the selftest was not run here.
- **`Cf` false rejection for bidirectional names** (U+200E/F). Stated and accepted in §5; the severance point
  exists for an owner who weighs it differently.
- **M77's repaired anchor names `isUnassignedSentinel`.** Renaming that helper later breaks the anchor. The
  failure mode is loud (the pre-flight catches it), but it is a new coupling.
- **CRLF.** `core.autocrlf=true` is set in this environment's system git config; a plain `git apply` rewrites
  the whole file and moves the aggregate meaninglessly. Any application must use
  `git -c core.autocrlf=false -c core.eol=lf apply`. Inherited from the prior stream's finding; not
  re-verified here, because verifying it means applying a patch.
