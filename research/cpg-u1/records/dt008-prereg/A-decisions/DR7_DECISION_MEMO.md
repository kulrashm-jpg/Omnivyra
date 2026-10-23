# DR-7 — §19.3(3) "Seven mutually exclusive independent persons": minimum or cap?

**CLASSIFICATION: PREPARATION. This memo decides nothing; it presents two readings and a
recommendation, and supplies paste-ready disposal text.** No protocol byte, no instrument byte and no
hashed object was modified or created. Nothing registered, committed, pushed or executed.

**Baseline recomputed for this memo.** `main` `33bceb1f919113c622587fa7c6403a0d4596bbad`;
`research/cpg-u1` tree `2d66f68088e6f230d8ae92b180b6db53c49502b4` (identical at `33bceb1f` and at the
worktree HEAD `af2fb6e99ce461894bf16f18c2251f75088eba18`); protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`<NEW_AGG>`, <NEW_N> files, read from
`C:/tmp/dt002/research/cpg-u1/tooling` (the worktree's own tooling tree is the stale 587-file
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` and was not used and not written).
Protocol line numbers are lines of the file at `c50fc680…00b719`.

---

## 1. The question

May the study register **eight** independent persons (two enumerators) without breaching §19.3(3),
which ends "Seven mutually exclusive independent persons."?

## 2. The two readings, verbatim

Heading, line **955**:

> ### 19.3 Named prerequisites (**not decisions; must exist before the stated act**)

Item 3, line **959**:

> 3. **Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference
>    Author, Confirmer and adjudicator, ≥ 2 raters and a rating adjudicator — before the respective
>    stage (or a recorded absence of raters with the §12 ceiling). Seven mutually exclusive
>    independent persons.

**Reading M (minimum).** The sentence is a compression of §4A.3 line **185** — "The seven independent
roles are mutually exclusive: **minimum 7 independent persons**" — whose numeral is expressly a floor.
Supporting text: line **176** "enumerator (≥ 1)"; line **186** "Several enumerators are permitted; each
holds no other role."; the same sentence's own "enumerator(**s**)" and "**≥ 2** raters"; the heading's
"must exist before the stated act", which is a floor by nature and disclaims being a decision.
Mechanism: no cap is implemented anywhere — `lib/personnel.mjs:26` refuses `n > 1` for every role
**except** `enumerator`; `test/selftest.mjs:829` is a **passing** test named "multiple distinct
enumerators permitted"; `check-personnel`'s success line counts **roles**
(`cpg_u1_data.mjs:662`); §5.10 (420–439) has no personnel VOID state; §15.5 (859–868) has no personnel
INCONCLUSIVE condition; §21 (991–1002) has no personnel step; and the registration record has no
personnel field at all (`lib/registration.mjs:33–57`, `checkRegistration` `:66–114`).

**Reading C (cap).** "Seven mutually exclusive independent persons." is a **bare cardinal with no
minimum marker**, sitting in §19 "Freeze (registration) requirements" (line 923), in the same sentence
in which the author **did** write "≥ 2 raters" where a minimum was meant. *Expressio unius* inside one
sentence yields "exactly seven". An eight-person roster then fails a §19 requirement, and §15.5(7) —
"A protocol violation discovered mid-run … this also **halts** (§18)" — supplies the consequence.

## 3. Recommendation

**Adopt Reading M, and dispose of Reading C on the public record by a recorded interpretation.** Reading
C cannot be mechanised — there is no field, no check and no VOID state that counts persons — but the
study's entire value is adversarial verifiability, so the objection should be answered in the
registration record rather than for the first time after registration. This is **not** an amendment: it
changes no frozen byte, and the alternative (editing line 959) moves `protocol_sha256` and re-opens the
whole freeze for a wording tidy.

**DECISION REQUIRED — the owner rules between M and C.** Everything below presumes M.

## 4. Disposal text — paste-ready

### 4.1 Decision-log entry (exact text)

```
DR-7 — §19.3(3) "Seven mutually exclusive independent persons" is a MINIMUM.
Decided: <<UNFILLED: YYYY-MM-DD>>   By: <<UNFILLED: accountable identity>>
Status: CLOSED — recorded interpretation. No protocol amendment; no re-freeze.

Question: does §19.3(3) (CPG_U1_PROTOCOL_004, line 959, final sentence) cap the number of
independent persons at seven, so that an eight-person roster with two enumerators would fail a
§19 freeze requirement?

Decision: it does not. §19.3(3) states a floor, not a cap, and eight independent persons
satisfy it.

Grounds:
 1. §19.3's heading reads "Named prerequisites (not decisions; must exist before the stated
    act)" — a prerequisite is a floor, and the section disclaims deciding anything.
 2. §4A.3 line 185, the closed rule to which §19.1 defers, reads "The seven independent roles
    are mutually exclusive: minimum 7 independent persons." Line 959's sentence is a
    compression of it and inherits "minimum". "Mutually exclusive" is a property of roles.
 3. The same sentence writes "enumerator(s)", and §4A.3 line 176 writes "enumerator (>= 1)" and
    line 186 "Several enumerators are permitted; each holds no other role." A cap reading voids
    all three.
 4. No mechanism implements a cap: lib/personnel.mjs:26 permits n > 1 for enumerator and for no
    other role; test/selftest.mjs:829 is a passing test named "multiple distinct enumerators
    permitted" inside the registered instrument; check-personnel reports in role-count language
    (cpg_u1_data.mjs:662); no §5.10 VOID state, no §15.5 condition and no §21 step counts
    persons; and the registration record has no personnel field (lib/registration.mjs:33-57,
    checkRegistration :66-114).

Contrary reading recorded and rejected: line 959's "Seven" carries no minimum marker where the
same sentence writes ">= 2 raters", so expressio unius could yield an exact count. Rejected on
grounds 1-4; noted here so that it is disposed of on the record rather than argued later.

Objects affected: NONE. protocol_sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
unchanged; tooling_aggregate_sha256 <NEW_AGG>
unchanged; registry_sha256 unchanged; no field of cpg-u1-registration/v1 added, removed or altered.
```

### 4.2 OSF registration narrative — the exact sentence

> §19.3(3)'s closing words "Seven mutually exclusive independent persons" are read as a minimum, not a
> cap: §4A.3 states "minimum 7 independent persons", lists "enumerator (≥ 1)", permits "Several
> enumerators", and the registered instrument accepts and positively tests a register with two
> enumerators (`lib/personnel.mjs:26`; `test/selftest.mjs:829`), so this study's eight independent
> persons satisfy §19.3(3) with no amendment to the protocol at
> `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.

One sentence, 1 of 1. It names no person, asserts no identity, and contains no value that is not
already public in the protocol and the instrument aggregate.

## 5. Confirmation by inspection — no frozen or hashed object is touched

| Object | Touched? | How confirmed |
|---|---|---|
| `research/cpg-u1/CPG_U1_PROTOCOL_004.md` | **No** | §4.1/§4.2 are new prose in a decision log and an OSF free-text field; neither is the protocol file. `protocol_sha256` is quoted, never recomputed from edited text. |
| `lib/registration.mjs` | **No** | §4.2 adds no key. The record's shape is fixed by `registrationTemplate` (`:33–57`); `checkRegistration` (`:66–114`) validates `schema`, `study_id`, `protocol_version`, three hex digests, `network`, `parameters` (exact key set, `:81`), custodian, registry, identities, `registration_id`/`_timestamp`, outpoints, checkpoint, `as_of`, `provider_configuration_sha256` — **and never mentions personnel**. Nothing in §4.1/§4.2 is an input to any of those checks. |
| Instrument aggregate `<NEW_AGG>` | **No** | The aggregate is `toolingManifest()` over the <NEW_N> files of `C:/tmp/dt002/research/cpg-u1/tooling` (`lib/aggregate.mjs`). Nothing was written to that tree; the aggregate was recomputed read-only for this memo and matched. |
| `registry_sha256`, `frame_hash`, `scan_sha256`, any commitment payload or digest | **No** | None of them takes personnel, decision-log or narrative input. `SAMPLING_FIELDS` (`lib/registration.mjs:119`) — the only fields `checkAuthority` compares — are `protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`, `network`, `outpoints`, `checkpoint`, `parameters`. None changes. |
| Personnel register fingerprint (§4A.3:189) | **No** | §4.1/§4.2 add nothing to the register. The fingerprint covers the rater-label assignment, which is unaffected. |

## 6. Which registration field does the narrative sentence land in?

**NONE — and that is the correct outcome, not a gap.** The `cpg-u1-registration/v1` record
(`lib/registration.mjs:33–57`) has no narrative, notes, description or personnel field; its only
free-text-ish fields (`authority_rule`, `verification_procedure`) are fixed literals the verifier
compares. `checkRegistration` does not exhaustively constrain the top-level key set (only `parameters`
is exact-key, `:81`), so a key *could* be added — but adding one would break
`REGISTRATION_PACKAGE.md` §6(1), which requires the OSF submission to carry "the full
`cpg-u1-registration/v1` record **as `registration-fields` produced it**". **Recommendation: add no
key.**

The sentence therefore lands in the **OSF submission's free-text narrative**, outside the machine
record, beside the two disclosures the registration stream has already prepared for the same place —
the "tooling v4" / `cpg-u1-data-tooling-6` naming divergence (`REGISTRATION_PACKAGE.md` §5,
`OPERATOR_CHECKLIST.md` §0.2) and DR-2 option (a)'s certenv paragraph. It is an **addition to the
public statement** of `REGISTRATION_PACKAGE.md` §6, not a change to items (1)–(4).

**Timing.** §5.5's ordered pipeline puts registration at step 2 and enumeration at step 3, so the
sentence can be written and published before any enumerator exists and before any personnel
identity is known. Nothing about DR-7 is on the recruitment critical path — but the *roster size*
decision is (see `C:/tmp/dt007-eight-person/orchestrator/VERIFIED_BASELINE.md` §6b: the eighth person
must enter the original roster, because §4A.1 item 6 cannot be answered retrospectively).

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

