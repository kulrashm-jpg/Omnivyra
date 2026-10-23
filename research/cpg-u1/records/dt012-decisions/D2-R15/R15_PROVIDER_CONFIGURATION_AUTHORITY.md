# R15 — Provider-configuration authority

**Stream** DEEPTECH-PARALLEL-012 / D-2
**Date** 2026-09-25
**Candidate** `C:/tmp/dt009-merge/tooling`, tooling aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files, re-verified on a
scratch copy)
**Protocol** `CPG_U1_PROTOCOL_004.md`, sha256
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (re-verified; never modified)
**Status** Analysis and recommendation only. No code written, no patch, no protocol change, nothing
applied. Nothing was written under `C:/tmp/dt009-merge`.

All measurements in this document were taken against a **scratch copy** of the candidate at
`…/scratchpad/d2r15/tooling`, whose recomputed aggregate is byte-identical to the candidate's
(`638d68e6…`), with fixtures held *outside* the tooling tree so the aggregate is unperturbed. The
live 404-mutant run against `C:/tmp/dt009-merge/tooling` was neither inspected nor disturbed; each
measurement below is a single `verify-registration` invocation.

---

## 1. R15 confirmed, independently

`verify-registration` on the scratch copy, five registrations differing **only** in
`provider_configuration_sha256` (synthetic-test network, `--allow-synthetic`, protocol/registry/
aggregate hashes all consistent so that no other check can fire):

| Value | stdout/stderr | Exit |
|---|---|---|
| `UNASSIGNED` | `BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)` → `BLOCKED — 1 named prerequisite(s) missing` | **4** |
| `abc` | `ERROR provider_configuration_sha256 must be 64 lowercase hex characters` → `registration record refused (1 error(s))` | **1** |
| `ffff…ffff` (wrong, valid shape) | `registration … complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match` | **0** |
| `7592ce8b…f116` (stale, valid shape, a real output of the derivation over an earlier content state) | same success line | **0** |
| `c9a7e9aa…7561` (correct) | same success line | **0** |

**R15 is real and reproduced.** The three 64-hex rows are indistinguishable at the instrument's
surface: identical stdout, identical exit 0. `checkRegistration` tests shape only
(`lib/registration.mjs:112-113`); nothing on the registration path recomputes the value.

### It is strictly worse than the tooling-aggregate case

Measured contrast, same fixture family, `tooling_aggregate_sha256` forced to `aaaa…aaaa`:

| State | Result | Exit |
|---|---|---|
| Wrong aggregate **and** one blocker outstanding (`provider…` = `UNASSIGNED`) | `BLOCKED — 1 named prerequisite(s) missing` — the aggregate comparison never runs | **4** |
| Wrong aggregate, **no** blockers | `VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate 638d68e6…) is not the registered tooling` | **1** |

The aggregate check is *masked* while any blocker remains — `registered()` (`cpg_u1_data.mjs:174-184`)
calls `reportRegistrationCheck` first, which exits on blockers before line 180's comparison — but it
is **sound in the state a real registration is in** (all blockers cleared). It is *conditionally*
sound.

The provider hash is in a **strictly worse category**: it is **never compared, in any state**, by
`verify-registration`. Binding exists only downstream, after registration is already immutable at OSF:

| Where | Check | Refusal exit |
|---|---|---|
| `lib/harness.mjs:54` | `PROVIDER_CONFIG_MISMATCH` — clone's recomputed hash vs the registered one, at run start | 1 (`reportHarness` → `EXIT.REFUSED`) |
| `lib/execution.mjs:69` | authorisation carries the registered hash forward | — |
| `lib/evaluation.mjs:130` | `WRONG_TREATMENT` — the run's hash vs the authorised one | — |

Consequence: a transcription error in this field is discovered at **run start**, i.e. after
registration has been published and both Bitcoin commitments may already exist. There is no
recoverable moment in between.

Additional finding, not previously recorded: **the registration-side handling of this field has zero
mutation coverage.** `test/mutate.mjs` carries 404 mutants; three touch the provider configuration
(M191 `HAR`, M239 `EXE`, M328 `EVA`) and **none** touches `lib/registration.mjs` lines 112-113. The
shape-only check is itself unguarded by the mutation suite.

---

## 2. How the correct value was re-derived (not transcribed)

The rule is `lib/harness.mjs:17-23`: a domain-separated hash over the two named files' content
hashes, in declared order.

```
PROVIDER_CONFIG_FILES = [
  backend/services/companyProfile/grounding/registry/builtins.ts,
  backend/services/companyProfile/grounding/registry/coverageInventory.ts ]
sha256( "cpg-u1-provider-config/v1" |f0|sha256(bytes f0)|f1|sha256(bytes f1) )
```

Re-derived twice, by two independent routes.

**Route A — from git object storage, no candidate code at all.** `git cat-file blob` at the pinned
commit piped into `sha256sum`, then the preimage assembled with `printf` and hashed:

```
commit f01a7eb4199be4e04d4fee7fc0116303949dc553   ("Merge pull request #247", 2026-09-16)
builtins.ts          2332 bytes  ab9b944318add9af97642bda7d03003ac5ba74817704a57e8064039b46db85bb
coverageInventory.ts 14737 bytes 07506ff2cb569bc781a8d437562eaf130a6beb7c2ba939a1d3181834e3319fc1
preimage  cpg-u1-provider-config/v1|backend/services/companyProfile/grounding/registry/builtins.ts|ab9b9443…85bb|backend/services/companyProfile/grounding/registry/coverageInventory.ts|07506ff2…9fc1
result    c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561
```

**Route B — the candidate's own function**, `providerConfigurationSha('C:/virality')`, run from the
scratch copy: `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`.

Both routes agree, and agree with the prior stream's value. **There is one provider configuration;
none was invented.**

Two incidental observations about the working tree, recorded because they bear on how the derivation
must be anchored:

1. The two files are present **on disk** in `C:/virality` and hash identically to the pinned commit,
   but they are **not committed at the current branch head** (`82754497`, branch
   `preserve/creator-canonical-template-pool`): `git cat-file -e HEAD:<path>` reports
   *"exists on disk, but not in 'HEAD'"* for both. A derivation taken from a *working tree* therefore
   carries no git-visible provenance on this branch and could drift silently.
2. Across **all refs**, the two files have exactly **one** committed content version (introduced at
   `6a5c2a84`, unchanged through `f01a7eb4`). This matters for the wrong-vs-stale question in §5.

Conclusion: the derivation must be anchored to the **pinned commit**, never to whatever tree happens
to be on disk.

---

## 3. Task 1 — what must the verifier compare, and can it?

### 3.1 Where the derivation lives

| Function | Location | Already imported into the CLI? |
|---|---|---|
| `providerConfigurationSha(cloneDir)` | `lib/harness.mjs:20-23` | **yes** — `cpg_u1_data.mjs:37` |
| `resolverState()` (reads `CPG_U1_RESOLVER_CLONE`, `git rev-parse HEAD`, `git status --porcelain`, `.env*` scan, and calls the above) | `cpg_u1_data.mjs:791-797` | same file |
| `verifyEvaluationTree({ repoDir, protocolText })` | `lib/evaluationTree.mjs:68-89` | **yes** — `cpg_u1_data.mjs:42` |
| `declaredIdentity(protocolText)` — parses the §7.1 pin out of the protocol text | `lib/evaluationTree.mjs:48-63` | via the above |

**`verify-registration` could call the derivation with no new machinery.** Every function it needs is
already imported into the same file. The comparison itself is one line of the same form as
`cpg_u1_data.mjs:180`.

### 3.2 Are the two inputs always available at registration time?

This is the question that changes the recommendation, so it is answered precisely.

**Input 1 — the registered value.** Always available: it is a field of `--registration`, which
`verify-registration` already requires.

**Input 2 — the derived value.** Requires the two files at the pinned commit. Three sub-questions:

**(a) Is the pin present in the record?** *No.* `registrationTemplate()`
(`lib/registration.mjs:34-56`) emits `protocol_sha256`, `tooling_aggregate_sha256` and
`registry_sha256` and **nothing about the resolver**. `resolver_sha` exists only in the *development
manifest* (sourced from `scan.repo_sha`, `cpg_u1_data.mjs:459`), which is produced **after**
registration in the documented pipeline (`cpg_u1_data.mjs:3-4`:
`… → [registration] → frame → scan → …`). `verify-registration` does not take `--dev-manifest`. So
the record itself never names the resolver commit.

**(b) Is the pin nonetheless reachable?** *Yes — transitively, and offline, through an input the
verifier already has.* The pin is declared in the **protocol document**, whose `protocol_sha256`
**is** registered and **is** compared by `registered()` (`cpg_u1_data.mjs:178`). `declaredIdentity()`
parses it out of §7.1. Measured, on the pinned protocol (`c50fc680…`):

```
declaredIdentity → { commit  f01a7eb4199be4e04d4fee7fc0116303949dc553
                     tree    3b4811fc88e9fbb64ee42c37c4aacca2e76c67af
                     aggregate ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5
                     files   11552 }
```

The commit is exactly the one the provider hash was derived at. So the chain
*registration → protocol_sha256 → §7.1 → commit/tree/content-aggregate* is complete and already
machine-readable by code the CLI imports. Substituting the pin requires editing the protocol, which
changes `protocol_sha256`, which `registered()` catches.

**(c) Does the comparison require network or a checkout?** **A local checkout, yes. Network, no;
credentials, no.** `providerConfigurationSha` reads two files from a directory; `verifyEvaluationTree`
runs `git ls-files` / `rev-parse` / `status` locally. No fetch, no remote, no secret. This clone is
**already a standing, documented operator prerequisite**: `README.md:277` —
*"`CPG_U1_RESOLVER_CLONE` = clean clone at `f01a7eb4199be4e04d4fee7fc0116303949dc553` (required by
self-test and mutation run)"*, and `README.md:291` describes running against it *"real resolver,
offline"*. Nothing new is asked of the operator.

**But an outsider running §21 step 2 may legitimately not have it.** §21 steps 1–2 assume only the
OSF record, the protocol file, the registry file and the identity list. Making a clone *mandatory*
would make `verify-registration` unrunnable for an honest outsider who has the record but not the
resolver. That is the constraint that shapes the rule in §3.4: the comparison must be performed
whenever it *can* be, and the verifier must never *claim* it when it cannot.

### 3.3 The exit-code vocabulary

Enumerated, as instructed:

- **`lib/registration.mjs`: no `EXIT.*` at all.** It is pure: `checkRegistration` returns
  `{ errors, blockers }` and never exits. All exit semantics live in the CLI.
- **`cpg_u1_data.mjs:53`** — `const EXIT = { REFUSED: 1, POOL: 2, HALT: 3, BLOCKED: 4, WAITING: 5, VOID: 6 };`
  with the meaning comment at line 52. Plus `0` = success, and `fail(msg, code = 1)` at line 67.

| Code | Name | Meaning | Reachable from `verify-registration` |
|---|---|---|---|
| 0 | — | success | yes |
| 1 | `REFUSED` | refused record / abort / unreadable input / missing flag | yes |
| 2 | `POOL` | held-out pool below the §5.7 minimum | no (draw/pool commands only) |
| 3 | `HALT` | §18 halt | **no — declared and referenced nowhere. Dead.** |
| 4 | `BLOCKED` | a named human prerequisite is missing | yes |
| 5 | `WAITING` | sampling state neither FINAL nor VOID | no (`stateExit()` only) |
| 6 | `VOID` | `STUDY_VOID_*` / `STAGE_VOID_*` | yes |

Two known defects to **work around, not repeat**: code 3 is dead; code 1 conflates *"this record is
wrong"* with *"the verifier could not read your file"*. Neither is R15's to fix, and the rule below
does not lean on either.

### 3.4 Failure semantics — the four states

The comparison is stated as: **registered `provider_configuration_sha256` vs the value derived from a
clone that has first been proven to be the §7.1 evaluation tree.** Deriving from an *unproven* clone
must never be compared, because a mismatch would then be a false accusation against the record.

| State | Current | **Recommended** | Message | Rationale |
|---|---|---|---|---|
| **absent** (`UNASSIGNED`) | 4 | **4 `BLOCKED`** — unchanged | unchanged: `BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)` | It is a §19.1 named prerequisite. The tooling must not invent it, and must not silently derive-and-fill it. Nothing to change. |
| **malformed** (not 64 lowercase hex) | 1 | **1 `REFUSED`** — unchanged code | `ERROR REGISTRATION_RECORD_REFUSED: provider_configuration_sha256 must be 64 lowercase hex characters` | A record defect: exactly code 1's *first* meaning. A stable `REGISTRATION_RECORD_REFUSED:` token lets an outsider tell it from *"input unreadable"* **without** minting a new code — the code-1 conflation is worked around by message discipline, not by resurrecting dead code 3. |
| **mismatched** (64 hex, ≠ derived) | **0** | **1 `REFUSED`** | `ERROR VERIFY_ABORT_PROVIDER_CONFIG_MISMATCH: registered provider_configuration_sha256 <reg> is not the value derived from the §7.1 evaluation tree (<clone commit>, content aggregate verified): <derived>` | The defect. 1, not 6: a wrong hash in a *draft* record is a correctable transcription error, not a void study, and the verifier cannot tell draft from registered. §5.5/§5.10's VOID rules do not enumerate this condition, so the tooling must not assert VOID on its own. 1 also matches how the instrument already treats the **identical** condition downstream — `harness.mjs:54` `PROVIDER_CONFIG_MISMATCH` exits 1 via `reportHarness`. Same fact, same code. |
| **matching** | 0 (unverified) | **0**, success line strengthened | `… hashes match; provider_configuration_sha256 verified against the §7.1 evaluation tree (commit <c>, content aggregate <a>)` | Exit 0 must now *mean* the comparison happened. |

**The fifth state that the four do not cover, and which the honest recommendation turns on: no clone
available.**

| State | Recommended | Message |
|---|---|---|
| 64 hex, **no clone supplied** and `CPG_U1_RESOLVER_CLONE` unset | **0** — code unchanged | success line must read `provider_configuration_sha256: FORMAT ONLY — NOT verified against the §7.1 evaluation tree (supply --resolver-clone, or set CPG_U1_RESOLVER_CLONE, to verify)` |
| clone supplied but **not** the §7.1 treatment (dirty tree, content mismatch, instrument folded in) | **1 `REFUSED`**, `EVALUATION_TREE_MISMATCH` (`verifyEvaluationTree`'s own refusal codes, reused verbatim) | do **not** compare; say the clone was rejected, not that the record is wrong |

This is what closes R15 without over-claiming: the verifier **refuses when it can check and the value
is wrong**, and **never claims authority it did not establish**.

---

## 4. Task 2 — the §5 false-positive matrix

Current column **measured** on the scratch copy, real exit codes, reproduced above.

| # | Registered `provider_configuration_sha256` | Current verifier state (measured) | Proposed verifier state | Reason |
|---|---|---|---|---|
| 1 | **absent** — `UNASSIGNED` | **exit 4** `BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1 …)` | **exit 4**, unchanged | §19.1 names it as computed before registration. Correct already: a missing prerequisite is a blocker, and the tooling refuses to invent it. Not a false positive. |
| 2 | **malformed** — `abc` | **exit 1** `provider_configuration_sha256 must be 64 lowercase hex characters` → `registration record refused (1 error(s))` | **exit 1**, message prefixed `REGISTRATION_RECORD_REFUSED:` | Shape refusal already holds. The only change is disambiguating code 1's two meanings by message token. Not a false positive. |
| 3 | **wrong but valid SHA-256** — `ffff…ffff` | **exit 0**, `registration … complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match` | **exit 1** `VERIFY_ABORT_PROVIDER_CONFIG_MISMATCH` when a §7.1-verified clone is available; exit 0 with an explicit *NOT verified* success line when it is not | **The false positive.** Never compared in any state. A value that is merely 64 hex characters is presented as an authoritative registration. Downstream refusal at `harness.mjs:54` arrives only at run start, after the record is immutable and both commitments may exist. |
| 4 | **stale but valid SHA-256** — `7592ce8b8e066a5b3638183b91916fd56165f64b4731603dbff76f76cb36f116` (a genuine output of the derivation over an earlier content state of `coverageInventory.ts`) | **exit 0**, byte-identical output to rows 3 and 5 | **exit 1**, the **same** refusal as row 3, with the **same** wording | §7.1 pins the treatment to one content state. Any value other than the one derived at the pin is equally disqualifying. Treating "stale" more gently is precisely the authority leak the invariant forbids. |
| 5 | **current valid SHA-256** — `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | **exit 0** — correct outcome, but **reached without any comparison**; indistinguishable from rows 3 and 4 | **exit 0** with `provider_configuration_sha256 verified against the §7.1 evaluation tree (commit f01a7eb4…, content aggregate ffe4f603…)` | The outcome is right today by luck, not by check. Exit 0 must become evidence that the comparison ran. |

**Invariant defended:** rows 3, 4 and 5 are today *identical at the instrument's surface*. Under the
proposed rule they separate — and where they cannot be separated (no clone), the instrument says so
in the success line instead of asserting authority. A syntactically valid but incorrect provider hash
never again becomes "authoritative" merely because it is 64 hex characters.

---

## 5. Wrong vs stale: can the instrument tell? Should it?

**Can it? No — not from the record.** The derivation is a one-way domain-separated SHA-256 over two
file contents. Given a 64-hex value, the verifier can decide only *equal / not equal* to the single
value derived at the pin. Rows 3 and 4 above are, and remain, indistinguishable from the value alone;
that is why they produce byte-identical output today.

**Could it, with more work?** In principle: the clone is a git repository, so one could enumerate
every historical content state of the two files and test membership. Measured cost and payoff in this
repository: across **all refs** the two files have exactly **one** committed content version
(introduced at `6a5c2a84`, unchanged at `f01a7eb4`; verified by `git log --all --follow` over both
paths, de-duplicated by blob hash). The real stale set is therefore **empty**, and the distinction is
today **vacuous** — the stale row in §4 had to be *constructed* by perturbing a copy of the two files
and running the real derivation over it.

**Should it? No.** Three reasons:

1. **It is not a distinction the protocol recognises.** §7.1 and the glossary (protocol line 1093)
   pin "at the resolver SHA" to one content state. A hash correct for a different state is simply not
   the treatment.
2. **It weakens the invariant.** A verifier that reports *"stale — was correct at commit X"* invites
   the reply *"then it is nearly right"*. There is no "nearly" here: the harness will refuse the run
   either way (`PROVIDER_CONFIG_MISMATCH`).
3. **It costs history-scanning machinery for a diagnostic that is empty in practice.**

**Recommendation: do not distinguish. Refuse both with the same code and the same wording.** The
refusal message already carries everything an operator needs to diagnose the cause — both hashes and
the verified clone identity — without the instrument volunteering an excuse.

---

## 6. Task 3 — the nine-field D-2 return

### DECISION
**R15 is a real, reproduced false-positive defect and should be closed — by adding the comparison the
verifier does not make, in the strongest form that does not require an input an honest outsider may
lack.** It is in a **strictly worse** category than the tooling-aggregate masking: the aggregate is
compared once blockers clear (measured: exit 1), whereas the provider hash is **never** compared by
`verify-registration` in any state. **This is a recommendation only. It is not approved, not applied,
and no code was written.**

### RECOMMENDED RULE
Three parts, in `verify-registration` only, using only functions already imported into
`cpg_u1_data.mjs`:

1. **Compare whenever a clone is available.** Accept `--resolver-clone <dir>`, falling back to
   `CPG_U1_RESOLVER_CLONE` (already a documented operator prerequisite, `README.md:277`). First prove
   the clone is the treatment with `verifyEvaluationTree({ repoDir, protocolText })` against the
   **registered** protocol text — the §7.1 pin is machine-readable from it, measured. If the clone is
   rejected, exit **1** with `verifyEvaluationTree`'s own refusal codes and do **not** compare. If the
   clone is accepted, derive with `providerConfigurationSha(clone)` and compare to
   `reg.provider_configuration_sha256`; on mismatch exit **1**,
   `VERIFY_ABORT_PROVIDER_CONFIG_MISMATCH`, naming both hashes and the verified clone identity. On
   match, exit **0** and say so in the success line.
2. **Never claim what was not checked.** With no clone available, exit codes stay exactly as today
   (0 / 1 / 4) but the success line must state `provider_configuration_sha256: FORMAT ONLY — NOT
   verified against the §7.1 evaluation tree`. The current unconditional *"complete … authoritative"*
   line is the part that makes R15 a false positive rather than merely a gap.
3. **Leave absent and malformed alone** (exit 4 and exit 1 respectively; both measured correct), other
   than prefixing record refusals with a stable `REGISTRATION_RECORD_REFUSED:` token so an outsider
   can tell a refused record from an unreadable input **without** minting a new exit code.

No new exit code. Dead code 3 (`HALT`) is **not** repurposed. No new machinery, no network, no
credentials, no second provider configuration.

### ALTERNATIVES CONSIDERED
1. **Require `--resolver-clone` unconditionally (exit 4 BLOCKED without it).** *Rejected.* It adds a
   required input that §21 step 2 does not list and would make `verify-registration` unrunnable for an
   outsider holding only the record — a net loss in outsider verifiability, which is the point of the
   command.
2. **Add `resolver_sha` / the §7.1 triple to the registration record**, making the comparison
   unconditional and self-contained. *Deferred, not rejected.* It is the structurally cleanest fix,
   but it changes the record schema and §19.1's table, so it needs owner approval and a protocol
   amendment — and it is **not necessary**, because the pin is already bound transitively through
   `protocol_sha256` → §7.1 (measured). Recorded as the option to take if the owner wants
   unconditional binding.
3. **Exit 6 (`VOID`) on mismatch.** *Rejected.* The VOID rules of §5.5/§5.10 do not enumerate this
   condition; a draft record with a mistyped hash is correctable, and the verifier cannot tell draft
   from registered. Asserting VOID would be the tooling inventing a study-ending fact.
4. **A new exit code for "provider configuration mismatch", or reusing dead code 3.** *Rejected.* A
   vocabulary change needs owner approval, code 3 means §18 `HALT`, and code 1 is already what the
   instrument returns for the identical condition downstream (`reportHarness`).
5. **Distinguish stale from wrong** by scanning the clone's history for earlier content states.
   *Rejected* — see §5: not a protocol-recognised distinction, weakens the invariant, and the stale
   set is measurably empty in this repository.
6. **Derive from the working tree instead of a verified clone.** *Rejected.* The two files are present
   on disk at `C:/virality` but **not committed at the current branch head** (`82754497`), so a
   working-tree derivation has no git-visible provenance and can drift with no signal.
7. **Auto-fill the field from the clone when `UNASSIGNED`.** *Rejected.* §19.1 makes it a named human
   prerequisite; `registrationTemplate()` exists precisely so the tooling invents nothing.

### SCIENTIFIC / INTEGRITY EFFECT
Closes the last unchecked treatment-identity leaf on the registration path. Today the treatment the
study claims to have evaluated is asserted, not verified, at the only moment the assertion is still
correctable; the first machine check (`harness.mjs:54`) fires after the record is immutable at OSF and
after both commitments may exist, so a transcription error converts into a dead study rather than a
fixed typo. Closing R15 also removes a **false-authority** claim: at present a registration with a
fabricated 64-hex provider hash is printed as *"complete, public, unembargoed, authoritative"*, which
an outsider reading §21 step 2 would reasonably take as covering the treatment identity — and it does
not. Secondary effect: it gives the registration-side provider-configuration handling its first
mutation coverage (currently zero; see §1).

### REGISTRATION EFFECT
**No change to the registration record, and no new blocker.** The field, its shape rule and its
`BLOCKED` semantics are untouched, so a record that passes today's `verify-registration` with the
**correct** hash passes tomorrow's, and nothing new must be decided before registration. The record
schema is unchanged, so no re-derivation of `tooling_aggregate_sha256`-independent artefacts is
required beyond the aggregate itself (below). One **operational** effect: the registration runbook
should state that `verify-registration` is to be run **with** the resolver clone (which the operator
already has, `README.md:277`), because only then does exit 0 mean the treatment identity was checked.
The independent-derivation-by-hand step in the current readiness package can then be retired.
Alternative 2, if ever approved, *would* change the record and §19.1 — which is why it is deferred.

### MUTATION EFFECT
**Yes, closing R15 adds mutants, and the count interacts with DR-12's transition.**

Candidate baseline, measured on the scratch copy: **404** mutants in `test/mutate.mjs` (404 bracketed
entries, 404 distinct ids). Three concern the provider configuration — M191 (`harness.mjs:54`), M239
(`execution.mjs:69`), M328 (`evaluation.mjs:130`) — and **none** concerns `lib/registration.mjs` or the
registration path. The suite's discipline is one mutant per protocol guard, so the recommended rule
implies **+3**:

| New mutant | Anchor | Kills via |
|---|---|---|
| provider-config comparison removed | the new comparison in `cmdVerifyRegistration` → `verify(true, …)` / `if (false)` | row 3/4 of the §4 matrix reaching exit 0 |
| clone accepted without §7.1 verification | the `verifyEvaluationTree` gate → `if (false)` | a dirty / wrong-content clone being compared against |
| success line claims verification when no clone was supplied | the conditional success string → unconditional | the *NOT verified* assertion |

A minimal closure (part 1 only, no part-2 success-line guard) would be **+2**.

**Interaction with DR-12's 404 → 410.** If the DR-12 stream lands **+6** (404 → 410), and D-2's R15
closure lands **+3**, the combined total is **413** (410 + 3), or **412** on a minimal +2 closure.
**I cannot assert that as final without coordinating with the DR-12 stream**, for two concrete
reasons:

1. **Anchor ownership overlaps.** DR-12 concerns `assigned()` at `lib/registration.mjs:57`, which is
   the *verbatim anchor* of existing mutant **M77** (`'M77 UNASSIGNED treated as assigned'`). Any
   DR-12 fix to that line invalidates M77's anchor and forces it to be rewritten, so the DR-12 delta
   may be a mix of additions and rewrites rather than a clean +6. My three anchors are in
   `cpg_u1_data.mjs` (`cmdVerifyRegistration`) and touch neither `assigned()` nor lines 112-113, so
   **no anchor collision between the two streams** — but the *arithmetic* is theirs to state.
2. `mutate.mjs --anchors` enforces that every anchor string occurs **exactly once**. Two streams
   adding guards near the same registration-completeness code must confirm jointly that no new anchor
   becomes ambiguous. That check is cheap but must be run **after** both land, and it cannot be run
   now (a 404-mutant run is live and must not be disturbed).

Also unavoidable: the closure changes `cpg_u1_data.mjs` and `test/mutate.mjs`, so the **tooling
aggregate moves off `638d68e6…`**, and any registration carrying that aggregate must be re-derived.
Sequencing with DR-12 (one aggregate, not two) is therefore a coordination requirement, not a
preference.

### PROTOCOL EFFECT
**None required. Protocol-004 says nothing about the provider configuration or the treatment identity
being verified at registration.** Checked directly; quoting the only relevant passages:

- **§19.1 ("Must be in the registration")**, last row — the field is required to *exist*, not to be
  verified: *"| Provider configuration hash; `asOf` | computed / chosen before registration |"*.
- **§21 step 2**, the outsider procedure, which enumerates this command's duties and **omits** the
  provider configuration: *"`verify-protocol` and `verify-registration` (protocol, tooling aggregate
  and registry hashes; authority; completeness) — with `--evidence` to check funding against the
  checkpoint."*
- **§7.1 scope note (protocol line 528)** places the provider configuration under the resolver pin:
  *"Every rule that reads 'at the resolver SHA' — the treatment (§7), the contamination scan scope and
  C1(1) (§5.3–§5.4), A5 accessibility (§5.1) and the provider configuration hash (§13.1) — is
  evaluated on the U1 evaluation tree."*
- **§13.1** lists it as **run** metadata, i.e. checked at execution, not at registration: *"| Run
  metadata | Run id, `asOf`, resolver SHA, provider configuration hash (`registry/builtins.ts` +
  `coverageInventory.ts`), wall-clock start and end, the published seal hash |"*.
- **§22 attack matrix**: rows 1–37 contain **no** row for provider-configuration or treatment
  substitution at registration. There is nothing to quote.

So R15's closure is a **tooling strengthening beyond what the protocol requires**, not protocol
compliance, and the protocol does not forbid it. Two guard-rails follow: the rule must be **additive**
(no new named prerequisite — §19.3 and the tooling's own "invents none" stance forbid the tooling
inventing one, which is the second reason Alternative 1 is rejected), and because §21 step 2's
enumeration would no longer be exhaustive, the owner may wish to extend that sentence. That sentence
is **protocol text**, so it is the owner's to change and is **not** proposed here.

### OWNER APPROVAL REQUIRED?
**Yes — for the change. No approval of any kind is claimed or implied by this document.** Specifically:

- **Required:** approval to modify `cpg_u1_data.mjs` and `test/mutate.mjs`, accepting that the tooling
  aggregate moves off `638d68e6…` and any registration naming it must be re-derived.
- **Required:** approval to sequence this with DR-12 under **one** aggregate change, and a joint
  `--anchors` + mutation run afterwards.
- **Required separately, and only if the owner wants unconditional binding:** Alternative 2 (carrying
  the §7.1 pin in the registration record), which is a record-schema and §19.1 change.
- **Optional, owner's alone:** extending §21 step 2's enumeration.
- **Not required:** nothing in this document changes the protocol, the record, or any code.

### EXACT WORDING TO RECORD
> **R15 — provider-configuration authority (DEEPTECH-PARALLEL-012 / D-2, 2026-09-25).** Confirmed on
> candidate aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, measured on a
> scratch copy: `verify-registration` validates `provider_configuration_sha256` for **shape only**
> (`lib/registration.mjs:112-113`) and **never compares it in any state**. Measured exit codes —
> `UNASSIGNED` → **4**; `abc` → **1**; a wrong 64-hex value (`ffff…ffff`) → **0**; a stale 64-hex value
> that is a genuine output of the derivation over an earlier content state (`7592ce8b…f116`) → **0**;
> the correct value (`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`) → **0**, with
> byte-identical output in all three 64-hex cases. This is **strictly worse** than the
> tooling-aggregate masking, which is conditionally sound: a wrong aggregate is refused with exit 1
> once blockers clear (measured). Binding for the provider hash exists only downstream
> (`lib/harness.mjs:54`, `lib/execution.mjs:69`, `lib/evaluation.mjs:130`), i.e. only after the record
> is immutable. The correct value was **re-derived independently**, twice — from git object storage at
> the pinned commit `f01a7eb4199be4e04d4fee7fc0116303949dc553` with `git cat-file blob` + `sha256sum`
> over the domain `cpg-u1-provider-config/v1`, and again via the candidate's own
> `providerConfigurationSha` — both yielding `c9a7e9aa…7561`. **There is one provider configuration.**
> The derivation lives at `lib/harness.mjs:20-23` and is **already imported** into `cpg_u1_data.mjs:37`;
> the §7.1 pin is machine-readable **offline** from the registered protocol text via
> `declaredIdentity()` / `verifyEvaluationTree()` (`lib/evaluationTree.mjs`, imported at
> `cpg_u1_data.mjs:42`), measured as commit `f01a7eb4…`, tree `3b4811fc…`, aggregate `ffe4f603…`
> (11552 files). **No new machinery, no network and no credentials are needed — but a local clone is,
> and the registration record does not itself name the resolver commit.** **Recommended rule (not
> approved, not applied):** compare whenever a clone is available (`--resolver-clone`, else
> `CPG_U1_RESOLVER_CLONE`, already a documented operator prerequisite), after proving the clone is the
> §7.1 treatment; refuse a mismatch with exit **1**
> `VERIFY_ABORT_PROVIDER_CONFIG_MISMATCH`, refuse a clone that is not the treatment with exit **1**
> `EVALUATION_TREE_MISMATCH` **without** comparing, leave absent at **4** and malformed at **1**, and —
> when no clone is available — keep the exit code unchanged while stating in the success line that the
> provider configuration hash was **NOT verified**. No new exit code; dead code **3 (`HALT`)** is not
> repurposed, and code **1**'s record-vs-unreadable conflation is worked around by a stable
> `REGISTRATION_RECORD_REFUSED:` message token rather than repeated. **Wrong and stale are not
> distinguishable from the value alone and must not be distinguished**: §7.1 pins one content state, and
> across all refs the two provider-configuration files have exactly one committed content version, so
> the stale set is measurably empty. **Mutation effect:** +3 mutants on the recommended rule (+2
> minimal) against a measured baseline of **404**; combined with DR-12's **404 → 410** this gives
> **413** (**412** minimal), **which cannot be asserted as final without coordinating with the DR-12
> stream**, because DR-12's fix to `assigned()` (`lib/registration.mjs:57`) is the verbatim anchor of
> existing mutant **M77** and may rewrite rather than only add, and because `--anchors` uniqueness must
> be re-run jointly after both land. Registration-side provider-configuration handling currently has
> **zero** mutation coverage. **Protocol effect: none required.** §19.1 requires only that the hash be
> *"computed / chosen before registration"*; §21 step 2 enumerates `verify-registration` as *"protocol,
> tooling aggregate and registry hashes; authority; completeness"* and omits the provider
> configuration; §13.1 lists it as **run** metadata; §22's 37 attack rows contain no
> treatment-substitution-at-registration row. The closure is therefore a strengthening beyond the
> protocol, must be additive (no new named prerequisite), and any extension of §21 step 2's sentence is
> the owner's to make. **Owner approval is required** to change `cpg_u1_data.mjs` and `test/mutate.mjs`,
> accepting that the tooling aggregate moves off `638d68e6…`, and to sequence this with DR-12 under one
> aggregate change. **No approval is implied by this recommendation existing.**

---

## 7. Risks

1. **Sequencing / aggregate churn.** Closing R15 changes the tooling aggregate. If D-2 and the DR-12
   stream land separately, the aggregate moves twice and every artefact naming it must be re-derived
   twice. Must land as one change.
2. **Mutation arithmetic is not mine to finalise.** The 413 figure depends on whether DR-12 lands +6
   cleanly or rewrites M77's anchor. Stated as a dependency, not a result.
3. **Residual exposure in the no-clone path.** With part 2 alone, a wrong 64-hex hash still exits 0 for
   an outsider without a clone. The false *authority claim* is removed, but the false *positive* is
   only narrowed, not eliminated, in that configuration. Full elimination needs Alternative 1
   (rejected: breaks outsider runnability) or Alternative 2 (record-schema change, owner's call).
   **This is the honest limit of the recommendation and should not be presented as more.**
4. **Clone-provenance fragility.** The two provider-configuration files are uncommitted at the current
   branch head (`82754497`) though present on disk and content-identical to the pin. Anchoring to
   `verifyEvaluationTree` mitigates this; anchoring to a working tree would not.
5. **`verifyEvaluationTree` cost.** It hashes 11552 tracked files. Acceptable for a verification
   command run once, but it makes `verify-registration` materially slower when a clone is supplied.
   Worth stating in the runbook.
6. **Scratch-copy fidelity.** All measurements were taken on a copy whose recomputed aggregate equals
   the candidate's (`638d68e6…`, 594 files, zero symlinks), with fixtures outside the tooling tree. The
   candidate itself was read but never written, and the live mutation run was neither inspected nor
   disturbed.

---

## 8. Provenance of measurements

| Item | Value |
|---|---|
| Candidate aggregate, recomputed on the scratch copy | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files, 0 symlinks) |
| Protocol sha256, re-verified | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Provider configuration hash, re-derived (2 routes) | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` |
| §7.1 declared identity, parsed from the protocol | commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`, tree `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`, aggregate `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5`, 11552 files |
| Constructed stale hash (row 4) | `7592ce8b8e066a5b3638183b91916fd56165f64b4731603dbff76f76cb36f116` |
| Mutant baseline | 404 |
| Fixtures | `…/scratchpad/d2r15/fx/` (outside the tooling tree; disposable) |
