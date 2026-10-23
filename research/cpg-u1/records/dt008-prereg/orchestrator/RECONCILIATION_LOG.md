# DEEPTECH-PARALLEL-008 — reconciliation log

VERIFIED = I reproduced it myself. CORRECTED = wrong or overstated, with the corrected form.
ACCEPTED-AS-ARGUMENT = a reasoned position I did not independently re-derive.

Nothing registered, committed, pushed or executed. No frozen byte modified.

## Baseline, verified by me at task start (all seven identities)

| Item | Value | Result |
|---|---|---|
| `origin/main` | `33bceb1f919113c622587fa7c6403a0d4596bbad` | moved last wave (PR #271, PI integration) |
| `origin/main:research/cpg-u1` | `2d66f68088e6f230d8ae92b180b6db53c49502b4` | **unchanged** at both commits |
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | matches |
| Instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | 593 files, matches |
| Treatment commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | matches, clean |
| Evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | confirmed = the treatment's **root tree** |
| Treatment content aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` | 11552 files, matches |
| Development registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | matches |

---

## Agent 1 — DR-7 / DR-8 / DR-9

Preserved to `C:/tmp/dt008-prereg/A-decisions/` (4 files, hashes match its report).

### VERIFIED by me

**1. A worktree trap worth propagating.** Agent 1 warned that the disposable worktrees' local `main` ref is stale.
Confirmed exactly:

```
worktree HEAD        : af2fb6e99ce461894bf16f18c2251f75088eba18
worktree 'main' ref  : fef341785dffcbaf4c3a5ac715a6ce63b58e58c2   (PR #232)
is 33bceb1f an ancestor of that main?  NO
is af2fb6e9 an ancestor of 33bceb1f?   yes
```

So **anyone running `git rev-parse main` inside a worktree gets a wrong answer**, while the working base
`af2fb6e9` is a genuine ancestor of the real tip and carries an identical `research/cpg-u1` tree. The base is valid;
the ref is not. This is the second instance of a worktree-versus-canonical trap in this programme, the first being the
stale 587-file `research/cpg-u1/tooling` tree.

**2. `checkPersonnelRegister` tolerates unknown keys — and the 8-person register passes.** Agent 1's Rule A5 step 4
depends on being able to add a `pairwise_item6_check` field without moving the aggregate. I tested it directly by
constructing registers myself:

```
baseline 7 roles                                          -> errors 0  blockers 0
+ unknown ROOT key + unknown PER-ASSIGNMENT key            -> errors 0  blockers 0
8 persons (2 enumerators)                                  -> errors 0  blockers 0
```

The third line is a **direct confirmation stronger than reading the self-test**: I built an eight-person register and
the frozen checker accepted it with zero errors and zero blockers. The first two lines confirm that a new restricted-
register field costs no instrument change and no aggregate change.

**3. The fee-ordering argument's decisive ground.** Agent 1 argues Reading S ("any role material" = material to
*anyone*) taken literally across all roles contradicts §19.3(3), which requires personnel "**before the respective
stage** (or a recorded absence of raters with the §12 ceiling)" — expressly staged recruitment, with raters arriving far
after the enumerators' packets. I confirmed that §19.3(3) wording. The argument holds: under a literal Reading S no
enumerator could receive a packet until the rating adjudicator's fee was signed, which the protocol's own staging
contemplates as unnecessary.

Its adopted **Rule A4** is the right shape: synchronise *within* a cohort (both enumerators complete before either
receives material), per-person *across* cohorts. Cheap, because both enumerators receive the same packet at the same
§5.5 step.

### ACCEPTED-AS-ARGUMENT

- The DR-7 recommendation (minimum, not cap) and the exact disposal text. Agent 1 confirmed by inspection that
  `checkRegistration` never mentions personnel and that `SAMPLING_FIELDS` is unaffected — consistent with the prior
  wave's independent finding that no mechanism anywhere implements a headcount cap.
- Its answer to "which registration field does the narrative sentence land in?" — **none, and that is correct**: the
  `cpg-u1-registration/v1` record has no narrative field, a key *could* be added because only `parameters` is
  exact-key, but adding one would break the requirement to publish the record "as `registration-fields` produced it".
  The sentence belongs in the OSF free-text narrative beside two disclosures already prepared for that place.
- The DR-9 classification table and its recommendation of **option (c)**, scope plus a batch size that is not any
  function of 210 / 126 / 52 / 32. Two points in it are genuinely sharp: **"remaining count" is forbidden under every
  option including the permissive one**, because given a permitted own-count the remainder *is* the threshold minus a
  known quantity; and **option (b)'s window closes at OSF registration**, not at enumeration, because §5.5 puts
  registration at step 2 and enumeration at step 3 — so if the submission goes out before the ruling, (b) is forfeited
  by default.
- Its resolution of a disagreement between two prior agents about whether one enumerator may see the other's rows:
  both were right about different things, because §4A.2's receive-list governs **what the study releases**, while
  nothing governs what two enumerators say to each other — the first is forbidden, the second is design space needing
  an operational rule.
- Its verification of the enumerator instruction text: it extracted every digit run in the block and found the complete
  set to be {1…11}, all section numbers or citation parts, so **no protocol-derived quantity appears**. Good practice;
  I did not repeat the extraction.

### Confirms a prior finding

`ENUMERATOR_WORKSPACE.md` says "23 template columns" where `FRAME_COLUMNS` has **22** — independently re-found here,
matching what a wave-007 agent reported. Enumerator-facing, so worth correcting before release.

### New risk it raised that I judge material

Adding `pairwise_item6_check` **after** the §4A.3 register fingerprint is computed would change that fingerprint. §4A.3
requires the `rater-1`/`rater-2`/`rating-adjudicator` assignment fingerprint to be published **before the held-out
commitment is broadcast**, so the field must be added before fingerprinting. Sequencing item, not a defect.

---

## Agent 6 — registration readiness

Preserved to `C:/tmp/dt008-prereg/F-registration/` (3 files, hashes match its report).

### VERIFIED by me — I re-ran the verifier and re-derived the field counts

`verify-registration` against `registration_record.DRAFT.json`, stdout/stderr to files, exit read from `$?`
(no pipe, which has misled a prior session):

```
EXIT=4
  BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)
  BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)
  BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)
  BLOCKED Persistent identifier is UNASSIGNED (persistent_identifier.value)
  BLOCKED registration_id is UNASSIGNED (issued by the registry at registration)
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
ERROR: BLOCKED — 9 named prerequisite(s) missing; the tooling will not invent them
```

**Nine blockers and ZERO errors.** The zero is the headline, and it is mine, not relayed: every field an agent may
legitimately fill is filled and valid.

Field counts, re-derived by importing `registrationTemplate()` myself: **20 top-level keys, 39 leaf paths, 12
`parameters.*`, 27 non-parameter** — matching Agent 6 exactly. A *fresh* template has **12 UNASSIGNED** leaves; the
draft has 11, the difference being `provider_configuration_sha256`. Eleven leaves reconcile to nine reported lines
because `outpoints` and `checkpoint` each cover two leaves. The arithmetic closes.

**Provider configuration hash re-verified:** `providerConfigurationSha('C:/tmp/cpg049_integration/treatment')` =
`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` — unchanged.

### CORRECTED — Agent 6 misread the baseline, and my brief was right

Agent 6 reports a "BASELINE DISCREPANCY the brief did not state", claiming main is **not** `33bceb1f` and that
"`main` in `C:/virality` is now `fef341785d…`", listing "the brief's stated main SHA is wrong/stale" as risk 2.

**That is wrong.** It read the **local** `main` ref, not `origin/main`:

```
origin/main : 33bceb1f919113c622587fa7c6403a0d4596bbad     <- as my brief stated
local main  : fef341785dffcbaf4c3a5ac715a6ce63b58e58c2     <- stale
```

So the finding is real but inverted: **the local `main` ref is stale, not the brief.** Agent 1 diagnosed this correctly
and independently. Agent 6's risk 2 should be struck and replaced with "anyone re-verifying must use `origin/main`, because
the local `main` ref is stale at `fef341785d`". Agent 6's own conclusion — that the discrepancy has no consequence for
registration because `research/cpg-u1` is byte-identical and the protocol hashes correctly — stands and is right.

(Agent 6 is also right that `33bceb1f` is not an *ancestor* of the worktree HEAD `af2fb6e9`; the relation runs the other
way, `af2fb6e9` is an ancestor of `33bceb1f`, which I verified.)

### A FOURTH gitignore trap, verified

The pattern that swallows the wave's central deliverable was not one I warned about. `git check-ignore -v` confirms:

```
.gitignore:51:*_READINESS*.md   research/.../F-registration/REGISTRATION_READINESS_TABLE.md   -> IGNORED
OSF_METADATA_PREPARED.md          -> tracked
OPERATOR_REGISTRATION_SEQUENCE.md -> tracked
```

Running count of patterns in `.gitignore` that have silently swallowed a deliverable in this programme: `*_CHECKLIST.md`
(:50), **`*_READINESS*.md` (:51)**, `*_RUNBOOK*.md` (:58), `ROLE_*.md` (:77). Neighbouring patterns not yet hit but
equally dangerous: `ALERT_*.md`, `*_COMPLETION*.md`, `*_PLAN.md`, `*_QUICK_*.md`. Agent 6 did the right thing by
renaming its runbook to the verified-trackable `OPERATOR_REGISTRATION_SEQUENCE.md`. **Recommendation: any document that
must survive a commit should be `git check-ignore`-tested at creation, not at commit time.**

### ACCEPTED-AS-ARGUMENT

- The ten-item list of what no command can check. Two entries are worth carrying into the final report because they
  bear directly on this programme's claims: **`enumerated_by` is never cross-referenced to the personnel register** —
  and the instrument's own fixture at `selftest.mjs:2260` uses `enumerated_by: 'cpg-implementer-NOT-INDEPENDENT'`,
  which is a neat demonstration that the field is unchecked; and **the assignment-fingerprint *timing* is unverifiable**
  — the value can be checked, the "published before the commitment broadcast" cannot.
- Its DR-1/DR-2 ordering rationale, verified in code by the agent: `registration-fields` reads the aggregate at run
  time, `registered()` aborts post-registration, and `tooling_aggregate_sha256` ∈ `SAMPLING_FIELDS` makes a repair
  re-registration a VOID. So the window for anything that moves the aggregate closes permanently at registration.
- Its "next owner action": settle DR-1 and DR-2 in writing, and start recruiting the same day, since recruitment is the
  longest lead time and blocks no registration field.

---

## Reference + rating completion stream (relaunched after the rate limit)

### VERIFIED by me — both suites re-run

```
reference: assertions run: 146   pass: 146   fail: 0    RESULT: PASS   exit 0
rating   : assertions run:  64   pass:  64   fail: 0                   exit 0
```

Both suites end with a self-check that the instrument tree is **byte-unchanged after the run** (reference `Z1`,
rating `T28`), and both print `instrument: 593 files, aggregate f7699f05…`. Good discipline: the suite proves it did
not disturb what it measured.

### A CORRECTION TO MY OWN BRIEF, which the agent caught

I told it that **both** validators require `CPG_U1_TOOLING` and refuse without it. Only one does:

```
rating    validator -> CPG_U1_TOOLING
reference validator -> CPG_U1_INSTRUMENT
```

The reference validator also *deliberately* runs on inlined constants when its variable is unset, documented in its own
header — so it does not refuse. The agent correctly declined to change it (a substantive existing deliverable, and
making the tree mandatory would be a behaviour change rather than a gap-closure) and instead gated its **new test
suite** to accept either variable and refuse without a registered tree. That is the right call.

**Open item:** the two streams disagree on both the variable name and whether the registered tree is mandatory. Either
alias the variable in the reference validator or record the divergence in the release gate — a deliberate decision
either way.

### A FIFTH gitignore casualty — and the worst kind

Confirmed by me:

```
.gitignore:77:ROLE_*.md   research/.../E-rating/ROLE_DESCRIPTIONS.md      -> IGNORED
RATING_PACKET_VALIDATOR.mjs REQUIRED_FILES includes 'ROLE_DESCRIPTIONS.md'  (line 55)
```

So a **mandatory** package file is swallowed by `.gitignore`. It does not exist yet, so nothing is lost today — but the
moment a release package is assembled the file vanishes from version control silently, **and the validator then refuses
the package for a file that is present on disk.** A failure that looks like a validator bug and is actually a
`.gitignore` pattern.

Running tally of patterns that have swallowed or will swallow a deliverable here: `*_CHECKLIST.md` (:50),
`*_READINESS*.md` (:51), `*_RUNBOOK*.md` (:58), **`ROLE_*.md` (:77)** — the last now twice, once for a wave-007
deliverable and once prospectively for a required package file. Neighbours still unhit: `ALERT_*.md`,
`*_COMPLETION*.md`, `*_PLAN.md`, `*_QUICK_*.md`.

**Recommendation, now with five instances behind it: `git check-ignore` every deliverable at creation, and either rename
`ROLE_DESCRIPTIONS.md` in the validator's manifest or narrow the `.gitignore` pattern before any package is assembled.**

### A finding it handled the right way

Its first reference run was 140/146 with one failure: a numeric `person_id: 7` was not refused. Rather than assume a
validator defect, it checked the frozen instrument and found `PERSON.test(x)` **coerces to string**, so
`lib/personnel.mjs:32` accepts `7` and `true` (though `{}`/`[]` are refused). **The validator was faithful; the
assertion was wrong.** It rewrote the case to assert the real behaviour on both sides, so a future divergence between
validator and instrument breaks the test instead of passing silently, and recorded it in-file as "RECORDED LAXITY, NOT A
DEFECT". That is the correct handling, and it surfaces a genuine instrument property: **a JSON-typo register can pass
the shape check.**

### ACCEPTED-AS-ARGUMENT

- Its four confirmed rating-integrity facts, with a useful addition on fact 1: `ratings.mjs:97` is reached **only** if
  the raters disagreed somewhere (`:136`), so if they agreed everywhere that check never runs and
  `analysis.mjs:199` is the one that cannot be avoided — and it is an `||`, so it triggers independently of α.
- Its extension of fact 3: α could in principle be moved by changing *population membership*, so it checked `alphaPop`
  (`analysis.mjs:179-180`) and found it excludes only `INVALID`/`REFERENCE-CONFLICT`/`REFERENCE-STALE`, all decided
  before `f.final` is consulted — and the adjudicator can only select between `REFERENCE-AMBIGUOUS` and `VALID`,
  neither excluded. **So α is closed to adjudication under either AD-1 setting.** That is a stronger result than the
  fact as I stated it.
- Both workload claims confirmed with re-derived arithmetic: reference **90–330** per recorder (10 development
  companies + 20–100 held-out, × 3 fields), rating **60–300** held-out only.
- Its 13 corrected line citations, verified by grep rather than counted.

### A trap worth adding to the standing list

A naive `xargs sha256sum | sha256sum` over the same 593 files yields `b5f63446…`, **not** the registered aggregate —
which only reproduces via the instrument's own `toolingManifest()`. Anyone "verifying" the tree with a shell one-liner
will get a wrong answer and may conclude the instrument has drifted.

---

## Randomness preflight stream (relaunched; the first attempt wrote nothing)

Preserved to `C:/tmp/dt008-prereg/G-randomness/` (5 files, hashes match its report).

### VERIFIED by me, re-running its tools and the frozen instrument

```
frozen mutate.mjs --anchors        -> anchors: 389/389 occur exactly once        exit 0
event_log_chain_demo.mjs           -> RESULT: 17 passed, 0 failed
sampling_delay_derivation.mjs      -> WHICH CONSTRAINT BINDS: drand DELTA rule
                                      TOTAL 59.667 h; assumed registry latency 48 h = 80.4%
gitignore: RANDOMNESS_READINESS.md       -> IGNORED (.gitignore:51)
           RANDOMNESS_PREFLIGHT_STATE.md -> trackable
```

The agent **predicted the gitignore collision from my warning and renamed pre-emptively**, then documented the swap
inside the file so nobody renames it back. That is the first time in this programme the trap was avoided rather than
discovered afterwards.

### DR-1 — a material escalation of the cost, and a correction to the prior record

Both halves of the defect quoted from frozen code and consistent with what I had: `lib/evidenceBundle.mjs:31-41`
dedupes by round and refuses disagreement but has **no floor**, and line 35 rebuilds each entry from exactly
`{round, randomness, signature}`, so **relay identity is discarded — a ten-relay and a one-relay bundle are
byte-identical**. `lib/sampling.mjs:180` uses `.find(b => b.round === round)`, so one beacon suffices. §19.3 asks for
"≥ 2 drand relays for verification".

**The prior record said enforcing a floor would "invert two selftest assertions". That badly understates it.** Applied
to two disposable scratch copies (each first verified byte-identical to the frozen tree):

| Variant | Aggregate | Selftest |
|---|---|---|
| A — evidenceBundle + sampling + mutate | `5c69aa3f9599f2fb78bb95d31854954a604a158bb2d924c926293bcf41a71e28` | **284 passed, 1 failed, then CRASHES** at `selftest.mjs:523` (`EvidenceError: drand round 1 is attested by 0 named relay(s)`) — **737 assertions never run** |
| B — bundle floor only | `a50a4c751e464e3aa20a47e1d227f2b35727eec7a46eff836685e1aa661cd07d` | **661 passed, 3 failed**, crashes in the end-to-end section — **358 never run** |

Three consequences:

1. **The anchors claim 389 → 391 is CONFIRMED** — and I independently verified the frozen baseline is exactly
   `389/389 occur exactly once`, so the contrast is real.
2. **Neither measured aggregate is registrable**, because neither variant contains the `selftest.mjs`/`README.md`
   changes the patch requires. **The registrable aggregate is not knowable until that rewrite is green.** So DR-1's
   cost is a test-suite rewrite, not a three-file patch, and the "new aggregate" cannot be quoted in advance.
3. **The prior memo's list of beacon sites is incomplete: 13, not 12** — line 1692 was missed.

The window still closes at registration, and harder than I had recorded: `tooling_aggregate_sha256` is a registered
field, is one of the 11 `PAYLOAD_KEYS` inside the on-chain digest, and is re-checked at `lib/sampling.mjs:142`
(→ `STAGE_VOID_MALFORMED_COMMITMENT`) and by the harness's `TOOLING_MISMATCH`. **Adopting it after registration voids
the study.** Nothing was applied; no relay was contacted.

### Serial delay — 5.17 h per stage CONFIRMED, total CORRECTED

`5.167 h per stage from H_commit` confirms the prior 5.17 h, and the **drand Δ = 3 h rule binds rather than block
depth**, robustly across a 300–1800 s block-rate sweep. But the total is **59.667 h, not ~61.5 h**: mechanical
**11.667 h (19.6%)** plus an **ASSUMED** 48 h of registry publication latency (**80.4%**, so the prior "78%" becomes
80.4%). Both figures agree on the identical dominant 48 h term; the ~1.83 h difference is in the prior wave's
mechanical accounting, which this agent could not reproduce. Worth stressing: **registry latency is not a protocol
constant and is not in the instrument** — it is a parameter (`--registry-hours`), correctly labelled ASSUMED, and it
dominates everything.

### ACCEPTED-AS-ARGUMENT (not independently re-derived)

- Preflight from the relocated copy with `--protocol` passed explicitly:
  `VERDICT: OFFLINE PRECONDITIONS SATISFIED (0 failed, 0 not run, 10 checks)`, exit 0, adapter conformance 18/18.
- `check-funding-prerequisites` → `BLOCKED Bitcoin wallet-key custodian is UNASSIGNED`, exit 4.
- The event-log truncation caveat, demonstrated: a **truncated tail is ACCEPTED** (published head `bb6c8479…` vs
  truncated `f061a8e6…`), so only a **published head hash plus event count** detects it — and **nobody is currently
  assigned to publish that head.**
- §19.3's "two independent header sources" and "≥ 2 relays" are both **procedural**: the tooling checks only that two
  `source` *strings* differ, never operator independence.
- A trap mirroring the selftest's: `test_tools.mjs` exits 1 when `CPG_U1_RESOLVER_CLONE` is unset, and the sole
  "failure" is `preflight tests NOT RUN` — easy to misreport as real.

### The frozen baseline, established by my own run

```
CPG_U1_RESOLVER_CLONE=C:/tmp/cpg049_integration/treatment  node test/selftest.mjs
  -> selftest: 1022 passed, 0 failed        exit 0
```

This is the figure the DR-1 variants must be read against: **1022/0 clean today**, versus 284 passed / 1 failed with 737
never run, and 661 passed / 3 failed with 358 never run, under the two candidate patches. The regression is genuine and
large, not an assertion-count adjustment.

Combined with `anchors: 389/389 occur exactly once`, also my own run, the instrument is confirmed healthy and
self-consistent at `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` over 593 files.

---

## Personnel automation stream (relaunched; tools existed, docs did not)

### VERIFIED by me — the sharpest structural finding of the wave

The stream's headline is not "the tooling lacks register binding" but **"the tooling already has it and does not apply
it to frames"**. I confirmed both halves:

```
enumerated_by across all 593 files:
  lib/schema.mjs:32    'enumerated_by',                                   (column name)
  lib/schema.mjs:124   if (!r.enumerated_by.trim()) errors.push(...)      (non-blank only)
  templates/candidate_frame.template.csv:1                                (header)
  -> NOTHING cross-references the personnel register.

but the pattern exists elsewhere in the same instrument:
  lib/assignment.mjs:10   import { checkPersonnelRegister } from './personnel.mjs';
  lib/assignment.mjs:19   export function checkRaterAssignment(a, { personnel } = {})
  lib/assignment.mjs:34-35   if (personnel !== undefined) { const reg = checkPersonnelRegister(personnel);
  cpg_u1_data.mjs:945    checkRaterAssignment(a, { personnel: readJson(need(o, 'personnel')) })
  cpg_u1_data.mjs:712    checkPersonnelRegister(readJson(need(o, 'personnel')))
```

So rater labels **are** bound to the register, with a `--personnel` option to supply it; `cmdFrame` simply has no
equivalent. **The gap is an asymmetry in application, not a missing capability** — which matters, because it means the
fix would follow the instrument's own idiom rather than introduce a new one.

### VERIFIED — the fixture that demonstrates the gap, with a nuance

`test/selftest.mjs:2260` really does use `enumerated_by: 'cpg-implementer-NOT-INDEPENDENT'`, and `:2264` asserts
`oc.errors.length === 0` ("honest-unknown record is no longer malformed").

**The nuance I want on the record:** that row *is* excluded — but on `A1_NOT_ESTABLISHED` plus C1(2)/C1(5)
contamination grounds (`:2265-2266`), **not** on attribution grounds. So the fixture demonstrates that the
**attribution field is structurally unvalidated**; it does not show a contaminated row slipping through. Stated this way
the finding is narrower and more defensible.

### A methodological contribution worth keeping

The stream diagnosed a defect in its **own** harness that bears directly on the `taskkill` hazard I warned it about:
a mutation-caused uncaught `TypeError` left no tally and was misread as an external kill. Its fix —
**a mutation-caused crash leaves a Node stack trace on stderr and is scored KILLED; a silent death stays
INDETERMINATE** — is the right discriminator, because on Windows there are no real signals so `taskkill` and a genuine
crash both surface as status 1. **The stack trace, not the exit code, separates them.** That belongs in the standing
lessons.

It also reported its three passes honestly: **47 → 42 killed / 2 survived / 3 not-applied**, then 48 → 47/1, then
**48 → 48 killed / 0 survived / 0 not-applied**, with 82 assertions. Both first-pass survivors were **live guards no
test had reached** (not dead code), and one "not-applied" was an ambiguous find-text matching two byte-identical lines —
split into two anchored mutants. **No test weakened, no guard deleted.** My own re-run is in progress.

### ACCEPTED-AS-ARGUMENT

- The conditional frozen-byte cost, named but not taken: making `cmdFrame` itself refuse would insert after
  `cpg_u1_data.mjs:206` and `:210`, moving the aggregate from `f7699f05…` to
  `8d67ddd74f3000ba948f98a5c8185a461bf3488699c376ffb904430b66ad2786` in a scratch copy that first reproduced the
  registered value. **No STOP condition fired** — all five capabilities are enforceable outside the frozen tree.
- Its correction to the record: the aggregate is **not** in the §13.2 dataset seal; it is pinned by the registration
  (§7.1) and re-checked by §21 step 2. Adoption must precede registration or never happen.
- Its honest disclosure that the prefix rule is a **fail-closed over-approximation**: because `prefixFor = personId + '-'`,
  it flags `X`/`XY` (actually disjoint) as well as `X`/`X-1` (genuinely colliding). Kept broad and documented rather
  than narrowed, which is the right call for a tool that only refuses.
- Its resolution of an apparent tension on registry completeness: §19.2 H2 is *Confirmed* only "to the best of
  knowledge", which is precisely **not** an attestation of completeness — consistent with §5.3's "the seed's
  completeness is not attested".
- Its six irreducibly-manual items, with the cross-cutting observation that **in every case the attester is the
  interested party**.
