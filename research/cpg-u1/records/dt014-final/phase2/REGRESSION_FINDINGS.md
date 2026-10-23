# DEEPTECH-PARALLEL-014 · PHASE 2 · REGRESSION FINDINGS

Six probes were asked for. Five surfaced something; one found nothing and says so with the method.
Nothing here is a false green: every probe was run against the unmodified candidate, read-only, and every
claim below is backed by quoted output or by a grep whose *content* (never its exit status) is the evidence.

Severity key — **S1** a wrong answer can be produced; **S2** a correct refusal is issued but with the wrong
code, class or message, or a legitimate input is refused; **S3** documentation or latent inconsistency.

---

## F1 — DR-12 was applied to ten fields and **not** to `checkpoint`. **S2.**

**Probe.** `p1_fields.mjs` set each of the twelve fields the template leaves `UNASSIGNED` to each of
`UNASSIGNED`, `" UNASSIGNED "`, `"unassigned"`, `"  UnAssigned "`, ran
`checkRegistration(..., { phase: 'registered', allowSynthetic: true })` on a baseline record that produces
`errors=0 blockers=0`, and compared each variant's new blocker/error text against the exact-sentinel case.

**Result.** `SUMMARY: normalised=10 notNormalised=2 of 12`.

The ten normalised fields are exactly the five intended (`accountable_identity.value`,
`persistent_identifier.type`, `persistent_identifier.value`, `bitcoin_key_custodian.value` via `human()`,
plus `registration_id`) **and five more that the implementing stream's five-field account does not mention**:
`registration_timestamp`, `outpoints.development`, `outpoints.held-out`, `as_of`,
`provider_configuration_sha256`. For all five the behaviour genuinely changed: before DR-12 a padded or
lowercase sentinel read as *assigned* and fell through to a format error; now it is the named prerequisite
blocker. That direction is an improvement and three of the five are asserted (DR-12 g, h, i cover `as_of`,
`registration_id`, `provider_configuration_sha256`); `registration_timestamp` and the two outpoints changed
behaviour with **no assertion naming them**.

The two that were missed are `checkpoint.height` and `checkpoint.hash`, which still use raw strict equality
at `lib/registration.mjs`:

```js
if (cp.height === UNASSIGNED || cp.hash === UNASSIGNED) blockers.push('checkpoint is UNASSIGNED (…)');
else if (!Number.isSafeInteger(cp.height) || cp.height < 0 || !HEX64.test(cp.hash ?? '')) errors.push('checkpoint must be {height: integer, hash: 64 hex}');
```

Probe output:

```
checkpoint.hash: DR-12 NORMALISED = NO
    "UNASSIGNED"     -> blockers:1 errors:0 | B="checkpoint is UNASSIGNED (a block at or after both funding confirmations)"
    " UNASSIGNED "   -> blockers:0 errors:1 | E="checkpoint must be {height: integer, hash: 64 hex}"
    "unassigned"     -> blockers:0 errors:1 | E="checkpoint must be {height: integer, hash: 64 hex}"
    "  UnAssigned "  -> blockers:0 errors:1 | E="checkpoint must be {height: integer, hash: 64 hex}"
```

**Confirmed at the CLI with real exit codes**, which is where it bites:

```
D1  checkpoint.hash = "UNASSIGNED"    -> exit 4   "BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)"
D2  checkpoint.hash = " UNASSIGNED "  -> exit 1   "ERROR   checkpoint must be {height: integer, hash: 64 hex}"
```

**Why it matters.** The record is refused either way, so this is not a false green. But §5.5.1's contract is
that an UNASSIGNED value is exit **4** — a named human prerequisite the tooling refuses to invent — and a
malformed value is exit **1**. A whitespace-padded sentinel in `checkpoint` is semantically the first and is
reported as the second. That is exactly the misrouting DR-12 was resolved to remove, and the selftest's own
comment states the reason: *"the DR-12 defect does not make these records pass outright — it routes them to a
DIFFERENT refusal … only the exact message distinguishes the two."* The rule was then applied everywhere
except here.

**Coverage.** No entry in M431–M436 touches the `checkpoint` comparison, and no selftest assertion pins its
padded or lowercase behaviour (`grep 'checkpoint is UNASSIGNED'` in `selftest.mjs` yields only exact-sentinel
uses). So the gap is invisible to the mutation population as allocated.

**Recommendation** (not applied — the candidate is read-only for this stream): route `checkpoint` through the
same `assigned()` helper and add one DR-12 mutant for it. Both change the aggregate, so both belong to the
implementing stream, not here.

---

## F2 — The exit-0 wording change is complete in the code and **stale in the README**. **S3.**

**Probe.** Grepped the whole candidate, all file types, `node_modules` excluded, for the old wording
`complete, public, unembargoed`. Four hits plus the mutant definition:

```
tooling/cpg_u1_data.mjs:367   * The previous exit-0 line read "complete, public, unembargoed, authoritative". Three of those four
tooling/README.md:39           2  verify-registration            complete, public, unembargoed, authoritative, hashes match
tooling/test/mutate.mjs:511   ["M456 the exit-0 line claims public, unembargoed and authoritative again", CLI, …]
tooling/test/selftest.mjs:1574  ok(!/complete, public, unembargoed, authoritative/.test(vr),
```

**No assertion keys on the old string in the positive direction.** `selftest.mjs:1574` asserts the old string
is *absent* from the CLI output — the correct direction — and `1572`/`1576` assert the new
`ESTABLISHED — the record is complete and well-formed` and `NOT ESTABLISHED by this verifier:` lines. The
`PROTOCOL_MARKERS` list in `cpg_u1_data.mjs` does not contain the phrase. Nothing broke; the full selftest
passed 1147/0.

**What is wrong.** `tooling/README.md` line 39, inside the pipeline table, still documents step 2 of the
instrument as producing *"complete, public, unembargoed, authoritative, hashes match"* — the precise claim
R28 concluded the verifier does not establish, and which the code now explicitly lists under
`NOT ESTABLISHED by this verifier:`. The instrument's own documentation therefore re-asserts the three
adjectives the change removed. `README.md` is a member of the tooling aggregate
(`toolingManifest` walks every file), so this is a defect inside the frozen instrument, not an external note.

**Class.** C — documentation only; verified for text and reference consistency, no functional test owed.

---

## F3 — R15's `NOT_COMPARED` default is reachable on a path that should have blocked: an explicitly supplied clone that does not exist is silently treated as "no clone supplied". **S1.**

**Probe.** Built a SYNTHETIC registration carrying a **stale but well-formed** provider hash and ran
`verify-registration` twice, changing only `--resolver-clone`. `CPG_U1_RESOLVER_CLONE` was cleared from the
environment in both runs so the flag was the only source.

```
CASE C  --resolver-clone C:/tmp/dt013-resolver            -> exit 1
        ERROR: PROVIDER_CONFIG_REFUSED: registered provider_configuration_sha256 f2af85d7… is not the value
        derived from the §7.1 evaluation tree (c9a7e9aa…) — the registered configuration is wrong or stale

CASE B  --resolver-clone C:/tmp/NO-SUCH-RESOLVER-CLONE    -> exit 0
        registration SYNTHETIC-REG-PROBE3: ESTABLISHED — the record is complete and well-formed; …
          provider_configuration_sha256: NOT_COMPARED (PROVIDER_CONFIG_NOT_COMPARED)
          - PROVIDER CONFIGURATION: provider_configuration_sha256 was NOT compared: no resolver clone was
            supplied, so no independent value exists. …
```

**Mechanism.** `cpg_u1_data.mjs`:

```js
const resolverCloneFor = (o) => {
  const c = (o['resolver-clone'] && o['resolver-clone'] !== true ? o['resolver-clone'] : null) ?? process.env.CPG_U1_RESOLVER_CLONE ?? null;
  return c && existsSync(c) ? c : null;
};
```

A path the operator explicitly named but mistyped, moved or failed to mount collapses to `null`, which
`checkProviderConfiguration` reads as *no clone was supplied*. R15's own list of required outcomes is
"missing → BLOCKED; malformed → BLOCKED; wrong valid sha256 → BLOCKED; stale valid sha256 → BLOCKED" — and
here a **stale valid sha256 exits 0**.

**Two distinct defects in one line.**

1. *Silent downgrade.* An operator who typed `--resolver-clone` asked for the comparison. Failing to find the
   directory is an input error and should be refused, not reinterpreted as a decision not to compare.
   `--require-provider-config` converts it to exit 4, but that flag is opt-in and the default path is
   exit 0.
2. *The message is factually false and misdirects the fix.* It says *"no resolver clone was supplied"* when
   one was. An operator reading it will re-add a flag that is already there rather than check the path.

**Ordering is otherwise correct, and I checked it.** `PROVIDER_CONFIG_MISSING` and
`PROVIDER_CONFIG_MALFORMED` are both tested *before* the `!cloneDir` return, so an UNASSIGNED or non-hex
value still blocks with no clone; and the execution path is independently protected —
`commonVerification` compares `ctx.resolver.providerConfigurationSha` against the registered hash
(`PROVIDER_CONFIG_MISMATCH`) and never consults `checkProviderConfiguration`. So `run-pilot` and
`run-held-out` cannot be reached through this hole. The exposure is the five other commands that go through
`registered()` — `verify-registration`, `verify-sampling`, `draw-development`, `draw-held-out` and the
reconcile/seal path — each of which can complete at exit 0 against a stale provider configuration.

**Coverage.** `resolverCloneFor` has **no mutant**. The two R15 CLI assertions closest to it,
`selftest.mjs:1613` (`--require-provider-config`, `expectCode: 4`) and `1615`
(default run reports NOT_COMPARED), both set `env: { CPG_U1_RESOLVER_CLONE: '' }` — i.e. they exercise the
*absent* case and never the *supplied-but-nonexistent* case. Mutating
`return c && existsSync(c) ? c : null;` to `return c ?? null;` would currently be a **survivor**.

**Recommendation.** Refuse an explicitly supplied clone path that does not exist, with its own code, and
reserve `PROVIDER_CONFIG_NOT_COMPARED` for the genuinely absent case; add the mutant. Not applied here.

---

## F4 — The new `lib/identity.mjs` screens **do** refuse legitimate values, and the caller turns the refusal into a hard record error, contradicting the module's own stated invariant. **S2, and the placeholder list is the weakest part of the change.**

**Probe.** `p2_screens.mjs` ran `screenIdentityValue` over 32 values chosen to be legitimate instances of the
things these fields actually hold — persistent-identifier types, real ORCID/ROR/DOI/QID forms, real personal
and organisational names, and free-prose `attestation.method` strings (which `attestationErrors` also puts
through `screenIdentityValue`).

**Result: `17 of 32 legitimate-candidate values are REFUSED`.** The identifier forms are all clean — every
ORCID, ROR, DOI, OSF id and QID passed, as did `Universidad Nacional Autónoma de México`, so the module's
refusal to invent a PID regex is holding. The refusals are concentrated in three places:

**(a) `PLACEHOLDER_TOKENS` matched against `squash(raw)`, which strips all punctuation and case.** Every one
of these is a real name:

```
X PLACEHOLDER_TOKEN  "Na"      <- a real Korean/Chinese surname
X PLACEHOLDER_TOKEN  "Foo"     <- a real Hokkien surname romanisation
X PLACEHOLDER_TOKEN  "Bar"     <- a real Hebrew given name
X PLACEHOLDER_TOKEN  "Nil"     <- a real Catalan/Turkish given name
X PLACEHOLDER_TOKEN  "None"    <- the English surname None/Nonne
X PLACEHOLDER_TOKEN  "Sample"  <- a real English surname
X PLACEHOLDER_TOKEN  "Test"    <- a real Estonian/Dutch surname
```

`NA`, `NONE`, `NULL`, `NIL`, `FOO`, `BAR`, `TEST`, `SAMPLE`, `EXAMPLE`, `ANONYMOUS` are the short,
collision-prone entries. `TBD`, `PLACEHOLDER`, `CHANGEME`, `YOURIDHERE` are not. The list is, as the brief
says, a judgement call, and it is not protocol-derived: §5.5.1 constrains nothing about shape.

**(b) `SYNTHETIC_MARKERS` matched as a *substring* of the whole value** (`raw.toUpperCase().includes(m)`),
which is much broader than the token list:

```
X SYNTHETIC_FOREIGN_MARKER  "Mock"                                         <- a real German/English surname
X SYNTHETIC_FOREIGN_MARKER  "Anna Mock"
X SYNTHETIC_FOREIGN_MARKER  "Fakenham Medical Practice"                    <- a real Norfolk organisation
X SYNTHETIC_FOREIGN_MARKER  "Mocksville Research Unit"
X SYNTHETIC_FOREIGN_MARKER  "Specimen Curation Unit, Natural History Museum"
X SYNTHETIC_FOREIGN_MARKER  "Naval Fixture Laboratory"
X SYNTHETIC_FOREIGN_MARKER  "ROR REST API v2 lookup; no mock or specimen records used"   <- attestation.method prose
```

The last one is the sharpest: `attestationErrors` screens `authority`, `resolved_by` **and `method`**, and
`method` is free prose describing how a value was resolved. A method that *disclaims* mock data is refused
for containing the word. M444 exists precisely to stop the substring match being weakened to equality, so
the substring behaviour is deliberate — but nothing bounds its collateral, and prose is the wrong input for a
substring blacklist.

**(c) `INVISIBLE_RANGES` includes `0x200b–0x200f`, which contains ZWNJ (U+200C) and ZWJ (U+200D).** These are
orthographically *required* in Persian, Arabic and Indic scripts, not homoglyph attacks:

```
X MALFORMED_INVISIBLE_CHARACTER  "محمد‌رضا"   <- a Persian given name that REQUIRES U+200C
X MALFORMED_INVISIBLE_CHARACTER  "क‍्ष"        <- a Devanagari cluster that REQUIRES U+200D
```

The module's justification — *"a bidi override can make two different strings look identical to a human
reader"* — is sound for `0x202a–0x202e` and `0x061c`. It does not carry over to ZWNJ/ZWJ, which change
rendering rather than hide it. A legitimate accountable identity written in Persian or Hindi is refused.

**The invariant violation, which is the real finding.** `lib/identity.mjs` states its own contract twice:
*"Local screening can only ever DEMOTE a value"* and *"the invariant: 'not obviously synthetic' is NOT
'authoritative'."* Demotion means `PLAUSIBLE_BUT_UNVERIFIED`. But its caller does not demote:

```js
else if (c.class === IDENTITY_CLASS.MALFORMED) errors.push(`${name} is malformed — ${c.message}`);
else if (c.class === IDENTITY_CLASS.SYNTHETIC && c.code !== 'SYNTHETIC_MARKER') errors.push(`${name} is a reserved placeholder, not an identity — ${c.message}`);
```

`errors` is a hard record refusal — `registration record refused (N error(s))`, exit 1 — and it is **not
relaxable**: `allowSynthetic` gates only the `SYNTHETIC_MARKER` and `synthetic(v)` branches, never
`PLACEHOLDER_TOKEN` or `MALFORMED`. The module's comment is explicit that this is intended
(*"Refused in every mode, test mode included"*). So a screen the module describes as demotion-only is wired
by its caller into an unappealable refusal of the whole registration, on the strength of a token list the
protocol does not authorise. Verified end to end in `p1_fields.mjs` and `p4_pipe.mjs`:
`accountable_identity.value = "TBD"` and `registration_id = "PLACEHOLDER"` both produce
`is a reserved placeholder, not an identity` in `errors`, with no override.

**Consequence and likelihood.** Direction of failure is safe — over-refusal, never over-acceptance, so no
false green and no threat to a U1 result. Operational likelihood for this study is low, because the
accountable identity and custodian are known operators whose names are unlikely to squash to `NA` or contain
`MOCK`. The residual risk is (i) a real name collision producing an unappealable exit 1 with a message
accusing the operator of supplying a placeholder, and (ii) an `attestation.method` prose string being refused
for describing the method, which pushes a genuine attestation to
`ATTESTATION_INSUFFICIENT`/`PLAUSIBLE_BUT_UNVERIFIED` and so silently *loses* an authority that was in fact
established. (ii) is the one worth fixing: it degrades authority for a wording reason.

**Recommendation.** Do not screen `method` as an identifier — check only that it is a non-empty, non-sentinel
string. Drop the two- and three-letter placeholder tokens or require an exact-length match. Narrow
`INVISIBLE_RANGES` to exclude U+200C/U+200D. And align the caller with the module's contract: demote to
`PLAUSIBLE_BUT_UNVERIFIED` and report it in the NOT ESTABLISHED list rather than refusing the record. All
change the aggregate; none applied here.

---

## F5 — `M77` and `M436` sharing a `from` line is genuinely safe; the M14/M15 precedent is real. **Verified, no defect.**

**How I probed it.** Read the applier rather than trusting the claim. `mutate.mjs` counts anchors *per mutant
inside that mutant's own file* and requires exactly one occurrence:

```js
for (const [name, file, from] of MUTATIONS) {
  const count = readFileSync(join(ROOT, file), 'utf8').split(from).length - 1;
  if (count !== 1) { failedAnchors++; … }
}
```

and applies each mutant to its own throwaway copy:

```js
const work = mkdtempSync(join(tmpdir(), 'cpg044-mut-'));
cpSync(ROOT, work, { recursive: true });
writeFileSync(target, readFileSync(target, 'utf8').replace(from, to));
```

Two entries sharing a `from` are therefore structurally invisible to the mechanism: neither the count nor the
replacement is global across entries.

**The precedent is real, not asserted.** `mutate.mjs:54–55`, file tag `SEL`:

```
M14 held-out admits ineligible companies      from: admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id))
M15 held-out may reuse development companies  from: admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id))
```

Byte-identical `from`, different `to`. Exactly the M77/M436 shape, and both pairs are inside the
441/441 anchor pass.

**Not equivalent mutants, either.** `M77.to` removes `!isReservedSentinel(v)` entirely; `M436.to` replaces it
with `v !== UNASSIGNED`. They agree only on the exact lowercase `unassigned` input and differ on
` UNASSIGNED `, and both are killed by DR-12 g/h/i, which pin exact blocker strings for padded, lowercase and
mixed-case variants. Note the one masking effect, recorded for completeness: for `registration_id`
specifically, both mutants are masked by the subsequent `human()` call, which re-detects the sentinel through
the unmutated `identity.mjs`. Their observability rests entirely on `as_of`,
`provider_configuration_sha256` and the pristine-template blocker list — all of which are asserted.

---

## F6 — No pre-existing mutant was found to have been made dead. **Probe found nothing; here is how I probed.**

Four mechanisms were checked; the full reasoning is in TARGETED_VERIFICATION.md §C.

1. **Anchor loss** — excluded by the 441/441 pass: a mutant whose `from` line had been deleted or rewritten
   would count 0 and be reported.
2. **Newly unreachable guards.** The only new *earlier* guards are inside `screenIdentityValue` (entirely new
   code, so nothing pre-existing can sit behind it) and the `human()` chain in `registration.mjs`.
   `human()` contains exactly one pre-existing guard, M81, the final branch — the case the implementing
   stream caught. Verified reachable: probe `p4_pipe.mjs` shows `SYNTHETIC-…` values classify as
   `SYNTHETIC_PLACEHOLDER/SYNTHETIC_MARKER`, which the R28 branch deliberately excludes via
   `c.code !== 'SYNTHETIC_MARKER'`, so control reaches M81's line; and its two kill paths
   (`selftest.mjs:460`, `selftest.mjs:1565`) both use such values.
3. **New code shadowing an old kill path.** Checked the two candidates. `M191` compares
   `ctx.resolver.providerConfigurationSha` inside `commonVerification` and is killed at `selftest.mjs:2049`;
   `commonVerification` never calls `checkProviderConfiguration`, so R15 cannot shadow it. `M464` and the
   `assignedValue` import touch only the new function.
4. **Equivalent mutants** among the shared-anchor pair — addressed in F5.

**Nothing dead was found.** What the same search *did* find is the inverse: guards the changes left
**uncovered**. Reported as F1 (no DR-12 mutant for `checkpoint`), F3 (no mutant for `resolverCloneFor` —
`return c ?? null;` would survive today), and:

### F4b — a pre-existing guard with neither a mutant nor an assertion, now shadowing R28. **S3.**

`lib/registration.mjs`:

```js
if (!assigned(reg.registration_id)) blockers.push(…);
else if (reg.registration_id.includes('|')) errors.push('registration_id must not contain "|"');
else human(reg.registration_id, 'registration_id', 'registration_id');
```

The pipe check short-circuits ahead of `human()`, so a `registration_id` containing `|` is never classified.
Probe `p4_pipe.mjs`:

```
registration_id="SYN|PIPE"
   errors: ["registration_id must not contain \"|\""]
   identity keys: ["bitcoin_key_custodian.value","accountable_identity.value","persistent_identifier.type","persistent_identifier.value"]
   identity.registration_id: ABSENT — never classified
```

So `reportRegistrationStanding` would print four identity lines instead of five. The record is refused
(exit 1), so no false green. But `grep 'must not contain'` returns **no** hit in `mutate.mjs` and **no** hit
in `selftest.mjs` — this guard has neither a mutant nor an assertion — and the R28 assertion that would have
caught the dropped leaf, `selftest.mjs` reg-4, is written `Object.keys(identity).length >= 5` against a clean
base, so it cannot. Pre-existing hole; the change made it interact with R28 rather than created it.

### F4c — `checkRegistration` returns a different shape per phase. **S3, latent only.**

`phase: 'funding'` returns early with `{ errors, blockers }` while the full path returns
`{ errors, blockers, identity }`. Probe output: `phase 'funding' return keys: ["errors","blockers"]
(identity present: false)`. No caller reads `identity` after a funding-phase check today —
`cmdCheckFundingPrerequisites` passes the result straight to `reportRegistrationCheck`, which destructures
only `{ errors, blockers }` — so this is latent, not a defect. It becomes one the moment a caller destructures
`identity` from a funding check, where it would read `undefined` and an
`Object.entries(identity)` loop would throw.

---

## Summary table

| id | finding | class | severity | covered by a mutant today? |
|---|---|---|---|---|
| F1 | DR-12 not applied to `checkpoint.height`/`.hash`; exit 1 where §5.5.1 wants exit 4 | behavioural | S2 | **no** |
| F2 | `README.md:39` still states the wording R28 removed | documentation (C) | S3 | n/a |
| F3 | explicitly supplied but nonexistent `--resolver-clone` silently becomes NOT_COMPARED; a stale provider hash exits 0; the message says "no resolver clone was supplied" when one was | behavioural | **S1** | **no** |
| F4 | new screens refuse 17/32 legitimate-candidate values; caller converts a demotion-only screen into an unappealable record error; `attestation.method` prose is screened as an identifier | behavioural | S2 | partly (M444–M447 pin the screens, nothing bounds them) |
| F4b | `registration_id` pipe guard shadows the R28 classification; no mutant, no assertion | behavioural | S3 | **no** |
| F4c | `checkRegistration` phase-dependent return shape | latent | S3 | n/a |
| F5 | M77/M436 shared anchor — verified safe, M14/M15 precedent confirmed | — | none | yes (441/441) |
| F6 | no newly dead pre-existing mutant | — | none | — |

**Nothing found here produces a wrong U1 answer.** F3 is the only S1 and it is a *missed refusal*: a stale or
wrong provider configuration can pass `verify-registration` at exit 0 when the operator names a clone path
that does not resolve. Everything else is a correct refusal carrying the wrong code, or a legitimate value
refused. All of F1, F3, F4, F4b and F4c would change the tooling aggregate to fix, so all are handed back
rather than applied: this stream wrote nothing to the candidate.
