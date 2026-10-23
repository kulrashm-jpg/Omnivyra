# DEEPTECH-PARALLEL-012 — REGISTRATION AUTHORITY / IDENTITY DECISION CLOSURE

**Nothing was implemented, committed, pushed, registered or broadcast. No candidate byte changed. The
running mutation suite was neither restarted nor inspected.** Six streams ran read-only or in throwaway
scratch copies.

**No decision below is approved.** Each is a *recommendation* with owner approval required. The record's
convention for a real ruling — an explicit `OWNER DECISION:` / `DECIDED:` line naming an adopted option —
exists in exactly **six** places and names **DR-1, DR-2 and DR-10 only**, verified exhaustively by two
independent streams.

Filename note: this file avoids `*_REPORT.md` deliberately. See §11.

---

## 0. THE CORRECTION THAT MATTERS MOST — I WAS WRONG ABOUT DR-12

My wave-011 report stated that **DR-12's worst case is exit 4 — "bounded, cannot reach exit 0"** — and I
used exactly that to rank R28 above it. **That is false.** Verified by direct trace of the candidate's own
predicates:

| value | blocker? | error? | contributes |
|---|---|---|---|
| `UNASSIGNED` | true | false | **SOMETHING** |
| `UNASSIGNED␠` | false | false | **NOTHING** |
| `unassigned` | false | false | **NOTHING** |
| `␠UNASSIGNED` | false | false | **NOTHING** |
| `UNASSIGNED\u200B` | false | false | **NOTHING** |

`human()` has two rejection paths and a variant sentinel trips neither. A field contributing neither a
blocker nor an error **cannot hold the exit code above 0**. So in an otherwise-complete record,
`accountable_identity.value = "UNASSIGNED "` yields **0 blockers, 0 errors, exit 0, "complete, public,
unembargoed, authoritative."**

**Why I got it wrong:** I reasoned from wave-011's probe, which used the **pristine template** — where
nine *other* blockers pin the exit at 4. That is a property of the probe, not of the defect. And
`checkAuthority()` does not save it: the operator generates the record and the identity list from one
JSON, so both carry the same variant and agree.

**Consequence:** DR-12 and R28 are in the **same severity class** — both are fail-open to exit 0. They
differ only in trigger (a typo versus a deliberate placeholder). My published severity ordering is
withdrawn.

---

## 1. R28 — identity / accountability validation

**Measured: 9 of 12 matrix rows reach exit 0, 8 wrongly.** Two rows are *new* defects: `unassigned` and
`UNASSIGNED␠` (i.e. the DR-12 surface, independently rediscovered). So **§5.5.1's own claim that "the
tooling refuses to proceed while either is UNASSIGNED" is false as written.**

**The deepest result is about what any verifier can claim.** Four levels — NONEMPTY · PLAUSIBLE ·
VALIDATED · AUTHORITATIVE — with **two distinct boundaries**: PLAUSIBLE→VALIDATED is the limit of an
*offline* verifier (a capability limit); VALIDATED→AUTHORITATIVE is the limit of **every** verifier,
because authority is *constituted* by consent and publication, not observed. **No identity leaf can ever
be legitimately classified AUTHORITATIVE by any verifier**, and two of the four can never exceed NONEMPTY
by machine at all.

**Structural over denylist, decided on computed arithmetic:** `0000-0000-0000-0000` fails ISO 7064
MOD 11-2 (expected check digit 1, actual 0) — the hardest placeholder falls to a checksum with nobody
enumerating it. `TBD`, `PLACEHOLDER`, `q7f3`, `.`, `foo`, `ORCID` all fail on length first. A denylist is
unboundedly incomplete *and advertises a completeness it lacks*, manufacturing the false authority R28
targets.

**The exit-0 wording is wider than identity.** Of "complete, public, unembargoed, authoritative", **three
are not established by the verifier**: `public`/`unembargoed` are read off fields *inside the record being
checked* (operator self-assertion; §21 step 1 assigns the real confirmation to an outsider), and
"authoritative" means only "earliest in the file supplied on the command line".

**Recommended rule:** a typed leaf must be machine-checkable against its declared type; an untypeable leaf
must be explicitly attested rather than merely non-empty; **and the verifier must claim only what it
checked.** Wording alone is insufficient *and newly misleading*; validation alone leaves a narrower false
claim. **Both halves are required.** Admitted limit: a checksum-valid identifier belonging to nobody still
passes. **Protocol mandates nothing about identifier shape; none is proposed.**

**Scope correction: four leaves, not five.** `as_of` carries an anchored `ISO_UTC` validator and never
reaches exit 0 — the same *type-constrains-value* pattern being recommended, already working in the same
file.

## 2. R15 — provider-configuration authority

**Measured, five records differing only in that field:** `UNASSIGNED` → 4; `abc` → 1; and **wrong, stale
and correct 64-hex all → exit 0, byte-identical output.** A wrong tooling aggregate with no blockers *does*
exit 1. So the aggregate is *conditionally* sound; **the provider hash is never compared in any state.**

**New: zero mutation coverage.** Of 404 mutants, three touch the provider config (M191, M239, M328); **none**
touches `lib/registration.mjs:112-113`, which I confirmed is an `assigned()` blocker plus `HEX64` and no
comparison.

The hash was **re-derived two independent ways** (`git cat-file`+`printf` outside the candidate; and the
candidate's own function) → `c9a7e9aa…`. Incidental: the two source files are present on disk but **not
committed at branch head**, though content-identical to the pin.

**The pin is not in the record but is reachable offline and transitively** — it is in the protocol, whose
`protocol_sha256` **is** registered and **is** compared; parsing it yields commit `f01a7eb4…`, exactly
where the hash derives. No new machinery; both functions are already imported.

**Recommended rule:** compare whenever a clone is available, *after* proving it is the §7.1 treatment;
mismatch → exit 1 `VERIFY_ABORT_PROVIDER_CONFIG_MISMATCH`; clone rejected → exit 1 without comparing;
absent/malformed unchanged (4/1). **Honest limit: with no clone a wrong 64-hex hash still exits 0** — the
false *authority claim* is removed (the line must read "FORMAT ONLY — NOT verified"), the false *positive*
is narrowed, not eliminated.

**Wrong vs stale: cannot be told apart from the value, and should not be** — "was correct at X" invites
"then it's nearly right", which is the authority leak the invariant forbids. Refuse both identically.

**Protocol: §21 step 2 omits the provider configuration**, and §22's 37 attack rows contain no
treatment-substitution-at-registration row. This closure is a **strengthening beyond the protocol**, not a
compliance fix.

## 3. DR-11 — scan-results collapse

**Exact text located** at `dt009-closure/orchestrator/RECONCILIATION_LOG.md:201-217` and
`DEEPTECH_PARALLEL_009_REPORT.md:204-206`. Seven occurrences; **none is a ruling.**

**Live, not stale.** Seven candidate catchers read individually; none sees a duplicate in a *supplied*
`scan.results`: the `:119` guard catches a **missing** result (a collapsed duplicate still returns truthy);
`assertUnique` runs over the admissible **frame** keyed on identifier and domain; `hashRecords` is never
applied to `scan.results`; lengths are never compared; the `scan_sha256` gates catch substitution **after**
the commitment.

**Material consequence:** via `lib/select.mjs:93` a CPG-C1-contaminated company enters the **held-out
pool** and is written as fact into the manifest, screening log and seal — **silently**, if the edit precedes
the development commitment, because the committed `scan_sha256` is the hash of the *edited* file.

**Two record defects corrected — both mine:** the statement is `cpg_u1_data.mjs:114`, **not `:113`**; and
`contamination()` is consumed by **five commands via four call sites**, **not nine** — nine is
`loadFrame`'s number, carried across in error. **That weakens the scope objection wave 009 used to decline
the fix.**

**Framing that must survive into the package: DR-11 is NOT a security control.** An actor who can edit
`scan.json` can simply zero `repository_hits` — no duplicate, no guard fires. Its value is **input hygiene**:
converting accidental malformation into a loud refusal. Recording it as a security fix would put an
overclaim inside the registration package.

**Recommended:** fix before registration as a read-time well-formedness refusal. **Moves the aggregate**
(`cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs`).

## 4. DR-12 — sentinel normalisation

**Rule:** `isUnassignedSentinel(v) = v.trim().toUpperCase() === UNASSIGNED`; sentinel → **blocker** (every
spelling, because the sentinel *is* the template's declaration that nothing was supplied, and exit-4
BLOCKED is the resumable state the workflow runs on); padding or an invisible `Cf` code point on a genuine
value → **error**; sentinel-first ordering, so the wave-011 probe returns to reporting **identically to
the template**, bypass delta 0.

**Case-fold, and the argument was rebuilt.** "Collision risk is zero in 8 of 10 fields" is true but
*irrelevant* — in those fields folding has no acceptance consequence. The decision turns on the five
unshaped fields, and it is **not a probability claim but a decidability claim**: a value rendering as the
word "unassigned" makes the record **undecidable** to the very outside verifier DR-12 serves. Direction is
forced — `toLowerCase` against the uppercase constant matches nothing and flips the exact-sentinel fixture
4→0.

**`UN ASSIGNED` is ACCEPTED and registers.** It is a *visible* difference, so the undecidability argument
does not apply, and rejecting it needs a similarity judgement with no principled stopping point. Consequence
stated: **DR-12 makes the record proof against a sentinel left in place, mis-cased or invisibly padded. It
does NOT make it proof against a human who deliberately writes a look-alike placeholder.**

**Five fields, not four, rest on `assigned()` alone — verified by me.** The four `human()` fields **plus
`registration_id`**, which has only `.includes('|')`. There are **five** anchored validators (ISO×2,
HEX64×1, `parseOutpoint`×2), not six.

**Mutation design.** Of the directive's nine cases only **two are mutants**; trailing/both share M431's
anchor (and the leading/trailing pair earns its keep against **M435**, not M431); uppercase *is* the exact
sentinel; empty and whitespace-only are governed by the pre-existing conjunct and kill nothing; `UN ASSIGNED`
documents accepted behaviour so no mutation can flip it. **Saying so plainly is the honest §6 answer.**

**Seven mutants, each with its killing assertion and message, all measured.** The TypeError concern is
answered structurally: **no mutant in the set can throw** — each replaces one total expression with another —
and five of eight kill rows land on **exit 0**, which no throw can reach. **The measured trap:** under M431
`"UNASSIGNED "` is *still refused*, at exit 1 with the whitespace error — so `expectCode: 1` or any bare
"refused" assertion **passes and M431 survives**. Only `expectCode: 4` **plus the blocker sentence** kills it.

**Arithmetic: 404 → 410** (six mutants) or **411** with the `Cf` case adopted. **M77's anchor repair is
404 → 404 by itself** and is mandatory. **Without the selftest assertions the run reports 405/411** — six
survivors. The three edits are one atomic unit.

**Why 404 cannot detect DR-12:** M77 removes the sentinel conjunct entirely and is killed by a fixture using
the **exact** string. That proves the clause is load-bearing *for the exact sentinel* and nothing more.
**404/404 certifies that 404 named behaviours are each protected by at least one assertion. It is not, and
must never be recorded as, a statement that the instrument is correct.**

**R28 boundary: DR-12 does not close R28. `TBD` still registers at exit 0 after this rule.**

## 5. EVIDENCE_SCHEMA — freeze `/v1`

`export const EVIDENCE_SCHEMA = 'cpg-u1-sampling-evidence/v1'` (`lib/sampling.mjs:16`); declared once,
imported once, stamped once, gated once. Not a `PROTOCOL_MARKER`; `sampling-evidence` occurs **0 times** in
Protocol-004. **Count corrected: 26 distinct versioned identifiers, all `/v1`, plus one unversioned
`TOOL_VERSION`** — "27 schemas" was imprecise. `grep /v2` over 108 non-`node_modules` files → **zero**.

**The ambiguity is real in principle**: pre- and post-DR-1 bundles both stamp `/v1` for two *mutually
incompatible* contracts. **But no evidence-bearing artefact can be generated ambiguously**, for three
independent reasons: the old instrument is refused outright at `lib/sampling.mjs:194`; in the only
silently-tolerant direction the sampling record is **byte-identical** (`drandRelays` is returned *beside*
the record at `:204`); and `tooling_aggregate_sha256` records which code verified it, with `checkAuthority`
making at most one aggregate authoritative on pain of VOID.

**Recommended: freeze, document, do not bump.** Residual: a bundle circulating detached from the package is
not self-identifying — an **auditability** gap, not an integrity gap, closable by publishing the aggregate
beside it. One finding *against* the recommendation, recorded: `lib/sampling.mjs:183-189` returns
`WAITING_DRAND` before the relay floor at `:193`, so a wrongly-shaped bundle is reported as "round not in
evidence"; `/v2` would refuse it up front. Weight: small — a waiting state, never a wrong result.

**This is the only decision that moves neither the aggregate nor the mutation count, so it can be ruled on
immediately.**

## 6. TOOL_VERSION — documentary, no aggregate cost

**Canonical label:** *CPG-U1 dataset tooling v6 (`cpg-u1-data-tooling-6`), aggregate `<NEW_AGG>`, `<NEW_N>`
files.* Placeholders deliberate — the README edits move the aggregate, so `638d68e6…` is **not** the final
value and appears in no prepared edit.

Three axes confirmed: the protocol says "tooling v4" at `:18, :25, :953, :1098` and **never** v5 or v6;
`cpg_u1_data.mjs:49` is the package identity; the README's v3–v6 are feature generations. **`TOOL_VERSION` is
pinned nowhere — confirmed at six points**, and its `tool:` stamps are never read back. `CPG_U1_PROTOCOL_004.md:25`
says the aggregate is bound in the registration record *"not in this file"*.

**Do not touch `cpg_u1_data.mjs:49`.** Editing it moves the aggregate, contradicts every stamped artefact,
and closes no gap. **The answer is a disclosure, not an amendment.** Mutation effect **none** — so the live
run is unaffected by this decision. **The one decision needing no owner approval.**

**Chain defect still open:** links 3–4 hold the superseded value in `registration_record.DRAFT.json:6`,
`registration_fields.TEMPLATE.json:6`, four `instrument.mjs` gateways and
`RATING_PACKET_VALIDATOR.mjs:43` (`REGISTERED_TOOLING_FILE_COUNT = 593`).

## 7. README / current identity — nine defects

**HIGH:** `:116` "all set `UNDECIDED`" is **false** (`rules/analysis_decisions.json:4` is `DECIDED` with nine
values; `:110` is descriptive and correct — do not touch). **`verify-evaluation-tree`: 0 occurrences**, though
registered at `cpg_u1_data.mjs:1128` and its domain is `PROTOCOL_MARKERS[19]`, so `CONTENT_MISMATCH` /
`INSTRUMENT_IN_TREATMENT` are invisible to a verifier.

Seven MEDIUM: `:1`, `:11`, `:208`, `:5-6`, `:278`, `:191` (conditional on the `EVIDENCE_SCHEMA` choice),
`:280`. Re-confirmed **not** defective: the README states no aggregate and no file count.

**Rule:** correct what is read as current; preserve what records the past; annotate the boundary. Two hard
constraints: the README must **never** state its own aggregate, and the v3–v6 headings **stay** — annotate
above them, never renumber.

## 8. VP-2 — ABSENT; the §7 constraint should be withdrawn

**Option A cannot satisfy "impossible to authorize".** There are **three** machine barriers, not two — and
the third is decisive: `cpg_u1_data.mjs:444-445`, `draw-development` **re-derives sufficiency from the
committed frame** and exits `EXIT.VOID`, so a hand-crafted payload and a broadcast OP_RETURN still yield no
sample. All three route through `frameSufficiency`, whose entire body reads only `expected_outcome_class`.

**So the constraint as written selects B** — and B *contradicts* §5.7.1 clause (c), which prescribes that
missing families be **declared as a scope limitation**, not refused. B therefore also needs a protocol
amendment, moving `protocol_sha256`. **Recommendation: withdraw the constraint**, because it would install
a refusal where the protocol prescribes a declaration.

**Adopt the third option instead:** discharge §5.7.1 clause (b) — the `[NORMATIVE]` publication duty that is
**currently unmet** — with a published per-class/per-family tally citing `frame_hash` and both screening-log
hashes. **Zero aggregate cost, zero protocol cost.** Sharp supporting point: clause (c) **cannot** be
pre-written into §20, because registration precedes frame enumeration, so the missing-family declaration is
necessarily a post-frame act.

**Record correction:** "operational, no aggregate cost" is half right. *No aggregate cost* — true, but only
because nothing was written. *Operational* — **not supported**: there is no procedure, checklist row or
attestation field. **If VP-2 stays labelled a gate, the record asserts a control that cannot refuse — a worse
evidentiary position than admitting absence.**

Also: **zero of the 404 mutants mention `jurisdiction`, `FAMILY` or `orderedClass`**, so even the
protocol-required round-robin is uncertified.

## 9. Contamination carrier — C for the carrier, D for the semantics

**And this overturns wave 011, mine included.** My report said *"every candidate carrier is excluded by a
closed enumeration or a freeze"*, citing §13.2 and §13.2A as closed lists. **The text does not support that.**
I read them: §13.2A is headed **"Sampling archive (mandatory)"** — floor-language — and neither list carries
any exhaustiveness wording.

The correct discriminator: **prohibition-by-absence is valid only for a vocabulary that is exhaustive *and*
selective** — where a value outside would displace one inside (§10.5 "exactly one", §5.10's states, §15.1's
dispositions). **A published addendum displaces nothing.**

So **carrier = C**: an existing procedural publication route (a record linked to the registration, with a
registry-issued timestamp) lawfully carries the §5.3 disclosure. §5.3 names no artefact and carries **no
`[enforced]` tag**; the protocol already uses unbound "published" elsewhere and already makes published OSF
records load-bearing. **Zero aggregate cost, zero protocol cost.** Strengthening available for free:
pre-specify the channel in the **registration narrative**, which is not part of `samplingView`.

**Semantics = D.** The three senses in which the §15.1 flag is dead were independently re-verified and stand:
structurally always false (`lib/select.mjs:93` filters `ineligible` out of the pool), never read (one grep
hit — the write), and the literal `CONTAMINATION-DISCLOSED` appears **nowhere** in 594 files. Both post-seal
channels are prohibited: `identity_inadmissible` → `INVALID`; `protocol_violations` → `INCONCLUSIVE`.

**Honest residual: C makes a *made* disclosure timestamped; it does not make the *absence* of one
falsifiable.** Only the aggregate-moving option closes that, and it is **pre-registration only**.

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

## 10. Stale-identity correction manifest

**167 files / 321 occurrences**, union arithmetic closing exactly (176 minus wave-011's own 9 deliverables,
which quote the digest *as their subject*).

| Class | Files |
|---|---|
| CURRENT EXECUTABLE | 14 |
| CURRENT TEST | 4 (5 pins) |
| CURRENT DOC | 73 |
| HISTORICAL | 72 |
| INTENTIONAL FIXTURE | 0 standalone; 4 sites inside the current tests |
| UNKNOWN | 4 |

**The directive's "23 executable references" is superseded. The true count is 29** (27 `.mjs` + 2 `.sh`),
independently measured twice — plus a **30th with zero literal hits**, `test_rating_packet_validator.mjs`,
which inherits the pin by `import` at `:17`. Also unusable for scoping: "five", "eight" and my own "roughly
six".

**The transposed abbreviation is in 12 files, not seven.** The real digest ends `…dbb04e5cc5dd`; these write
`…5eb04e5cc5dd`, a suffix of **neither** tree. Seven are `dt004-operations/people/` role packets — documents
humans read to verify the instrument — and one, `HUMAN_DEPENDENCY_MAP.md:7`, **claims "VERIFIED by
recomputation"** of a digest matching no tree. **That must be re-attested, not relabelled.**

**Three files unsafe to "fix", all confirmed** — `test_derive_frame.mjs` (assertions never check
`instrument_aggregate`, so editing it alone leaves an inconsistent golden set that **still passes**),
`demo_auditlog.mjs` (digest written *into* a hash-chained log), `05_assemble_docs.mjs` (states it was not
recomputed). **Plus** `test_reference_packet_validator.mjs:57`'s `STALE_AGGREGATE` — the best-labelled
fixture in the corpus; **27 files name `640510…` and every one warns against it: preserve, don't correct.**

**One wave-011 judgement reversed:** `dataset/tools/test_tools.mjs:100` and `people/tools/test_tools.mjs:369`
quote the *tool's own error message*, so they **must** be updated in lockstep with `instrument.mjs` or the
negative controls fail. **There the hazard is omission, not substitution.**

**Decisive for sequencing — verified by me:** grep for all three digests and all three file counts returns
**0 files** inside `dt009-merge`, `dt002/research/cpg-u1`, and the tracked in-repo `research/cpg-u1/`. **No
instrument tree ever names its own identity.** So **the 167-file sweep does not move the aggregate; only the
nine in-tree README corrections do.**

**Correct order: README session → one recomputation → write `<NEW_AGG>`/`<NEW_N>` into the CURRENT files →
register.** No prepared edit contains a provisional digest.

## 11. Readiness-package tracking — worse than §10 states

`.gitignore:51 *_READINESS*.md` confirmed. **`*_PACKAGE*.md` is not a pattern** — the earlier guess was
wrong. But the exposure is a **class, not a file: 16 collisions across five patterns**, including
`:50 *_CHECKLIST.md` (`OPERATOR_CHECKLIST.md`), `:55 *_REPORT.md` (**six wave reports plus this wave's**),
`:58 *_RUNBOOK*.md`, `:77 ROLE_*.md` (`ROLE_DESCRIPTIONS.md`), and `:12 *.log`
(`MUTATION_RUN.log` — certification evidence).

**And the deeper fact: none of it is in a repo at all.** `git ls-files | grep -c DEEPTECH_PARALLEL` → **0**;
`research/deeptech-operations` is entirely untracked; the wave-011 and wave-012 roots are **not git
repositories**.

**The silence was proved by dry run:** 56 files present, `git add -An` lists 55, the ignored one absent,
**exit 0, no warning.** Naming it explicitly *does* fail loudly. **So the hazard is specific to bulk adds —
which is how a wave's output gets committed.**

**Compounding:** four files are **simultaneously stale-identity CURRENT DOC and untracked** — correctable in
the final pass, then silently not committed. **Fix git before the identity corrections.**

**Proposed only:** a new `research/deeptech-operations/.gitignore` whose operative line is `!*.md`, verified
in an isolated scratch repo, with in-repo precedent for scoped negation at `.gitignore:155-158`. Rename,
`git add -f` and relocate were each rejected with reasons. `MUTATION_RUN.log` is a separate, narrower
decision, **not decided**.

## 12. Mutation invalidation status

```
CURRENT RUN = PRE-DECISION CANDIDATE / NOT FINAL EVIDENCE
```

PID 4092 alive, **7.41 h** elapsed at last measurement, aggregate `638d68e6…` recomputed and unchanged, zero
candidate files modified. **No partial verdict inspected.**

The §11 condition is **conditional on approval**, so the run is not yet *formally* invalidated — if all seven
were declined it would stand. But it is near-certain to be met, because DR-12 provably requires three files,
two of which are the verification machinery. **If the run completes during this wave its result must still
not be interpreted**, for the three independent reasons in §4, §8 and §7 above: the suite cannot find DR-12,
cannot see VP-2 or the round-robin, and cannot catch a false README claim inside its own aggregate.

## 13. CONSOLIDATED OWNER DECISION SHEET

| ID | Decision | Status | Recommended | Owner approval | Instrument? | Aggregate? | Mutation count? | Protocol? | Without re-registration? |
|---|---|---|---|---|---|---|---|---|---|
| **D-1** | R28 identity authority | OPEN | structural validation **+** honest wording (both halves) | **YES** (4 gates) | yes | **yes** | **+n** | no (advisable later) | **pre-registration only** |
| **D-2** | R15 provider authority | OPEN | conditional comparison via §7.1-verified clone; state "NOT verified" when absent | **YES** | yes | **yes** | **+3** | no (beyond protocol) | **pre-registration only** |
| **D-3** | DR-11 scan collapse | OPEN | fix as read-time well-formedness refusal; **label input hygiene, not security** | **YES** | yes | **yes** | +2–4 | no | **pre-registration only** |
| **D-4** | DR-12 sentinel | OPEN | trim+case-fold sentinel → blocker; padding/`Cf` → error; `UN ASSIGNED` accepted | **YES** (3 gates) | yes | **yes** | **404→410/411** | no | **pre-registration only** |
| **D-5** | EVIDENCE_SCHEMA | OPEN | **freeze `/v1`**, document | **YES** | **no** | **no** | **none** | no | **yes — rule now** |
| **D-6** | TOOL_VERSION | OPEN | documentary label; **do not touch the constant** | **NO** | **no** | **no** | **none** | no | **yes — rule now** |
| **D-7** | README / identity | OPEN | correct current, preserve historical, annotate boundary | **YES** (4 gates) | yes | **yes** | none | no | **pre-registration only** |
| **VP-2** | jurisdiction coverage | OPEN | **withdraw the constraint**; discharge §5.7.1(b) by publication | **YES** | **no** | **no** | none | no | **yes** |
| **Contam.** | disclosure carrier | OPEN | **carrier C** (procedural) · **semantics D** | **YES** | **no** | **no** | none | no | **yes** |
| **§11 git** | tracking hazard | OPEN | scoped `.gitignore` negation | **YES** | no | no | none | no | **yes — do first** |

**Four decisions cost nothing and can be ruled on immediately: D-5, D-6, VP-2, contamination-carrier, plus
the git fix.** Six move the aggregate and must land in **one** edit session followed by **one** certification
run.

## 14. EXACT VALUES AND WORDING REQUIRING OWNER APPROVAL

1. **Authority to open the single in-tree edit session**, accepting that `tooling_aggregate_sha256` moves off
   `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` and must be re-certified from scratch.
2. **D-1**: the validation rule; the operator-supplied scheme table with **no national or institutional
   identity system**; acceptance that the rule is inherently incomplete; replacement of the exit-0 message.
3. **D-2**: conditional comparison, and separately whether to carry the §7.1 pin in the record (a schema and
   §19.1 change). Extending §21 step 2 is protocol text and **yours alone**.
4. **D-3**: adopt the DR-11 fix, **recorded as input hygiene and not as a security control**.
5. **D-4**: the rule; whether to adopt the `Cf` case (**411**) or sever it (**410**, leaving the zero-width
   exit-0 route open as a named residual); the atomic three-file edit window.
6. **D-5**: freeze `cpg-u1-sampling-evidence/v1`.
7. **D-7**: the four gates, including the disposition of the **4 UNKNOWN** files — closed record or live
   reproducibility path.
8. **VP-2**: withdraw "impossible to authorize"; and whether clause (b) is discharged by a published prose
   tally or requires a seal-bound one.
9. **Contamination**: adopt carrier C plus the registration-narrative pre-specification, and either accept
   and publish the unfalsifiable-duty limitation **or** elect the aggregate-moving attestation **before
   registration**.
10. **Git**: the scoped negation, and separately `MUTATION_RUN.log`.
11. **Whether the DeepTech record is committed to `C:/virality` at all** — currently zero files are tracked.

**No claim of registration readiness. No claim of U1 evidence. No interpretation of the running 404-mutant
result. Nothing implemented.**
