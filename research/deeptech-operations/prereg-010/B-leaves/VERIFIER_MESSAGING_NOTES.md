# CPG-U1 — VERIFIER MESSAGING NOTES (documentation correction, rehearsal package only)

**SCOPE AND STANDING.** This is a **documentation correction inside this rehearsal package**. **No instrument
file was modified, and none should be modified to satisfy anything written here.** The candidate instrument is
under an aggregate freeze discipline: every byte changed moves `toolingManifest()` and therefore
`tooling_aggregate_sha256`, so a comment fix, a typo fix or a reworded message would each require the whole
re-verification and double-clean-rebuild cycle again. **The correct response to every item below is to read the
verifier's output the way this note says to read it — not to change the verifier.**

Every claim here was measured in this session against `C:/tmp/dt009-merge/tooling` (594 files, aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`), read-only. The runs and their verbatim
output are in `VERIFIER_REHEARSAL.md`.

---

## 1. The anchored-grep trap — the summary line is counted as a blocker

`fail()`'s own summary line is

```
ERROR: BLOCKED — 9 named prerequisite(s) missing; the tooling will not invent them
```

It contains the substring `BLOCKED ` and it is **not** a check-level blocker. Measured on RUN 1:

| Pattern | Count | Correct? |
|---|---|---|
| `grep -c 'BLOCKED '` | **10** | **no** |
| `grep -c '^  BLOCKED '` | **9** | **yes** |
| `grep -c '^  ERROR   '` | **0** | yes |

`reportRegistrationCheck()` prints check-level lines with a **two-space indent and a fixed-width tag** —
`  ERROR   ` (three trailing spaces) and `  BLOCKED ` (one) — while `fail()` prints an unindented
`ERROR: <msg>`. **Always anchor, and never count either from an unanchored pattern.** The same trap has already
produced one wrong count in this programme's history.

**Reading rule.** Trust the number inside the summary line (`N named prerequisite(s) missing`) or an anchored
count. Never an unanchored one.

**A second instance of the same family, for the record:** `rules/analysis_decisions.json` has
`"status": "DECIDED — ... `analyze` refuses to run while any value is UNDECIDED."` — the word `UNDECIDED`
appears **once**, inside the prose that explains the refusal rule. `grep -c UNDECIDED` returns 1 and a reader
concludes decisions are open. They are not: status is DECIDED, AD-1..AD-9 all carry recorded values
(`ERRATA.md` E-1; file sha256 `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`, identical in
the candidate tree). The instrument's own `README.md` still says the nine are "all set `UNDECIDED`", which is
**now false** — a documentation defect in the instrument that must be left in place, because fixing it moves
the aggregate.

---

## 2. A blocker is defeatable by a trailing space, silently — the most consequential item here

`assigned()` (`lib/registration.mjs`) is

```js
const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;
```

It trims **only** for the emptiness test, and compares the **untrimmed, case-sensitive** string against
`'UNASSIGNED'`. Therefore `"UNASSIGNED "`, `" UNASSIGNED"` and `"unassigned"` are all treated as **assigned
values**.

Measured (probe D, `VERIFIER_REHEARSAL.md` §6): setting `accountable_identity.value` to `"UNASSIGNED "` and
`persistent_identifier.type` to `"unassigned"` dropped the count from **9 BLOCKED to 7 BLOCKED**, with **zero
errors and no warning of any kind**. The verifier then regards the accountable identity as named.

**Why it matters more than it looks.** These are exactly the fields a person copy-pastes from a document, a
spreadsheet cell or a terminal — all of which can carry trailing whitespace invisibly. And
`accountable_identity.value` is compared by `checkAuthority()` for **exact string equality** against the
registry's copy of every registration under that identity; a mismatch there returns a VOID reason, not a
warning. A trailing space is therefore a silent path to both a false "assigned" and a later authority
mismatch.

**Reading rule for the owner.** Before submitting, print the five `human()`-checked strings with delimiters —
e.g. `node -e "const r=require('./reg.json');for(const v of [r.accountable_identity.value,
r.persistent_identifier.type, r.persistent_identifier.value, r.bitcoin_key_custodian.value])
console.log('['+v+']')"` — and confirm no bracket has a space or newline next to it, and that none of them is
a re-cased `unassigned`. The verifier will not do this for you.

---

## 3. "9 named prerequisite(s) missing" is a count of **lines**, not of fields

`outpoints` is one blocker line covering `outpoints.development` and `outpoints['held-out']`; `checkpoint` is
one line covering `checkpoint.height` and `checkpoint.hash`. So **11 unresolved leaves print as 9 lines** in the
draft, and **12 unresolved leaves print as 10 lines** in a fresh template (measured: variant A). A reader who
treats the number as a field count will think two fewer values are needed than actually are.

**Reading rule.** The blocker count is a to-do-item count. The field count is 11 (draft) / 12 (fresh template);
use `OWNER_INPUT_SHEET.md` §6 for the arithmetic.

---

## 4. The silent pass on `tooling_aggregate_sha256` — the verifier's most misleading silence

Measured (RUN 1 vs VARIANT C): a record naming the **superseded** aggregate `f7699f05...` and a record naming
the **candidate** `638d68e6...`, both verified by the **candidate** instrument, produce **byte-identical**
output and the same exit 4. The mismatch check

```js
if (aggregate !== reg.tooling_aggregate_sha256) fail(`VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate ${aggregate}) is not the registered tooling`);
```

sits **after** `reportRegistrationCheck()`, which calls `process.exit()`. So while any blocker remains, the
comparison is **unreachable**, and:

- a correct aggregate, a superseded one, and a plausible wrong 64-hex digest are **indistinguishable** in the
  output;
- the only aggregate check that can fire early is the **form** check (`must be 64 lowercase hex characters`),
  which is why the literal placeholder `<<PROVISIONAL: ...>>` fails **louder** (exit 1) than nine missing
  prerequisites (exit 4) — measured in variant B;
- `VERIFY_ABORT_HASH_MISMATCH` cannot appear until every human prerequisite is filled, i.e. **after** OSF
  submission and **after** Bitcoin funding — by which point a wrong aggregate is already registered and, per
  `PROVISIONAL_AGGREGATE_HANDLING.md` §4, unrepairable.

**Reading rule.** A clean `exit 4` with nine blockers is **not** evidence that the aggregate in the record is
right. It is evidence that the verifier has not looked. Verify the aggregate the only way that works:
recompute `toolingManifest()` in the tree you are about to freeze and compare by eye to the owner-authorised
value.

---

## 5. `exit 4` is a *good* result here, and the word `ERROR` on that line is misleading

On a correctly prepared pre-registration record the last line of output is

```
ERROR: BLOCKED — 9 named prerequisite(s) missing; the tooling will not invent them
```

Nothing is wrong. This is the tool working exactly as designed: it is refusing to invent human values. But it is
printed with the `ERROR:` prefix (because `fail()` has one prefix for all exits) and to **stderr**, while
**stdout is empty (0 bytes, measured)** — so in any CI view, log aggregator or wrapper that surfaces stderr as
failure, a perfectly healthy pre-registration state reads as an error.

**Reading rule.** Distinguish by **exit code, not by the word ERROR**: `4` = named human prerequisites missing,
work to do, nothing wrong with the record; `1` = the record itself is malformed or forbidden; `6` = VOID. And
do not build a check that greps stderr for `ERROR`.

---

## 6. `SYNTHETIC` is an unanchored, case-insensitive **substring** test on human values

```js
const synthetic = (v) => typeof v === 'string' && v.toUpperCase().includes(SYNTHETIC_PREFIX);
```

`SYNTHETIC_PREFIX` is `'SYNTHETIC'`, but the test is `includes`, not a prefix test, and it is applied to
`accountable_identity.value`, `persistent_identifier.type`, `persistent_identifier.value` and
`bitcoin_key_custodian.value`. So any real name or identifier containing that substring in any case — an
organisation whose name contains "synthetic", a scheme label mentioning it, a person's affiliation string — is
refused with

```
  ERROR   <field> is a SYNTHETIC test value — refused outside test mode
```

and exit **1**. The variable name says `_PREFIX`; the behaviour is substring. The message asserts the value *is*
a test value, when all that was observed is a substring.

**Reading rule.** If this fires on a value you believe is genuine, the value is not wrong in any protocol
sense — but it **cannot be used in this field**, because `--allow-synthetic` is not available for a mainnet
registration. Choose a different form of the name (a legal name variant, an identifier rather than a label) and
record why in the OSF narrative. Do **not** patch the instrument to relax the test.

---

## 7. The success line claims more than it verified

On exit 0 the command prints

```
registration <id> complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match
```

"**authoritative**" is established by `checkAuthority(reg, readJson(need(o, 'identity-registrations')))` — i.e.
against a **local JSON file the operator supplies**. The instrument has no network and never contacts OSF; the
header comment in `lib/registration.mjs` says so plainly ("It cannot see the registry; outsiders confirm the
record there"). So the word means "authoritative **relative to the list you handed me**". If that list is
incomplete — an earlier registration omitted, a withdrawal omitted — the tool will call a non-authoritative
record authoritative, and `checkAuthority()` will not know.

**Reading rule.** Treat the success line as "internally consistent with the supplied registration list".
Independent confirmation of authority is an outsider's act at the registry, not something this command can do.
The same applies to `--registry`: it is documented in the instrument's own pipeline as the **development-only**
registry, and the mismatch message says so (`development-only registry differs from the registered
registry_sha256`).

---

## 8. Not a defect, recorded so nobody reports it as one

- **`verify-registration` runs with `--registration` alone.** `registered()` reaches
  `reportRegistrationCheck()` before `need(o, 'protocol')`, so the blockers terminate the run and the other
  three arguments are never demanded. This is what makes the rehearsal possible with no fabricated value, and
  it is the correct ordering — the record is checked before anything is hashed against it. Once the blockers
  clear, `--protocol`, `--registry` and `--identity-registrations` all become mandatory, each with its own
  `--<k> is required` refusal at exit 1. The instrument's `README.md` line 123 already bundles all three into
  `$REG`; follow it.
- **`registration-fields` prints the aggregate of whatever tree it runs in**, with no caveat:
  `tooling_aggregate_sha256: 638d68e6...`. That is `toolingManifest()` behaving correctly, but the printed line
  reads like an authorised value. It is not. During this window it is a **candidate**. The stale 587-file tree
  in this worktree would print `640510...` with equal confidence.
- **Outputs are write-once.** `writeOnce()` refuses an existing path: `... already exists — outputs are
  write-once (no re-roll). Use a new output path.` Expected and deliberate; not an error to work around.
- **No personnel messaging exists at all.** `registrationTemplate()` emits no personnel key,
  `checkRegistration()` never mentions personnel, and `SAMPLING_FIELDS` contains none — so a record with no
  roster whatsoever verifies to exit 0 and **no roster change can void a registration**. The absence is
  correct, but it means the verifier gives **zero** signal on §19.3 item 3. Recruitment must be tracked
  entirely outside this tool (`check-personnel`, and `OWNER_INPUT_SHEET.md` A13).
- **No identifier-shape validation exists.** Grepping the entire candidate `lib/` and `cpg_u1_data.mjs` for
  `orcid`, `ror`, `doi`, `isni`, `ringgold` returns **zero** matches. `persistent_identifier.type` and
  `.value` accept any non-blank strings. This is deliberate scheme-neutrality, not an oversight — but it means
  the verifier cannot catch a mistyped or mismatched identifier, and only the OSF narrative tells a reader how
  to resolve it.

---

## 9. What this note did not do

No instrument file, protocol, treatment, evaluation tree or registry was modified or written. No message was
reworded in code. No registration, no OSF submission, no Bitcoin, no network, no credentials. No commit, push
or pull request. Every measurement was read-only and sub-second; no selftest, mutation run or rebuild was
started.
