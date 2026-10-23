# CPG-U1 — DECISION DISCLOSURES FOR THE REGISTRATION RECORD AND THE OSF NARRATIVE

**CLASSIFICATION: PREPARATION.** Nothing here is registered, submitted, published, broadcast, committed or
pushed. No protocol byte, no instrument byte and no hashed object was created or modified by this document.
No external identity, identifier, timestamp, outpoint, block height or block hash is invented anywhere in it.

**This document extends, and does not replace:**
`C:/tmp/dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md` (field table),
`.../OSF_METADATA_PREPARED.md` (narrative), `.../OPERATOR_REGISTRATION_SEQUENCE.md` (stage order),
`C:/tmp/dt004-operations/registration/REGISTRATION_PACKAGE.md` and its `ERRATA.md`.
The **authority for the three decisions below is** `C:/tmp/dt009-closure/orchestrator/DECISION_RECORD.md`.
They are quoted from it, not re-derived here.

## 0. Baseline, recomputed by this agent at task start

| Item | Value | How |
|---|---|---|
| `origin/main` | `33bceb1f919113c622587fa7c6403a0d4596bbad` | `git rev-parse origin/main` in `C:/tmp/dt4-uncert` (**not** `main`, which is stale in a worktree) |
| Worktree HEAD (detached) | `af2fb6e99ce461894bf16f18c2251f75088eba18` | `git rev-parse HEAD` |
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256` of `research/cpg-u1/CPG_U1_PROTOCOL_004.md` in the worktree |
| `registry_sha256` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | `sha256` of `rules/development_only_registry.json` in the frozen instrument |
| `rules/analysis_decisions.json` | `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be` | same; status `DECIDED`, AD-1..AD-9 recorded (see `ERRATA.md` E-1) |
| Instrument aggregate **before this wave** | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, **593 files** | `toolingManifest()` from `lib/aggregate.mjs`, read-only over `C:/tmp/dt002/research/cpg-u1/tooling` |

**The instrument was read only from `C:/tmp/dt002/research/cpg-u1/tooling` and never written.** The worktree's
own `research/cpg-u1/tooling` is the stale 587-file tree (`640510...`) that self-consistently produces a wrong
aggregate; it was not read as the instrument by this agent.

---

## 1. DR-1 — drand relay floor · DECIDED: **ADOPT OPTION (B)**

### 1.1 What was decided

Quoted from `DECISION_RECORD.md` (DR-1):

> **Decision.** Implement a >= 2 independent-relay floor with explicit per-relay attribution.

> **The ten requirements are adopted verbatim and no additional requirement is inferred:** >= 2 distinct relays
> per bundle · relay identity survives into the evidence representation · duplicate use of one relay does not
> satisfy the floor · the verification result distinguishes the relays · a one-relay bundle fails closed · a
> two-relay bundle passes · malformed or missing relay identity fails closed · relay identity enters the
> deterministic evidence path so one-relay and two-relay bundles cannot hash alike · the test suite proves the
> distinction explicitly · no cryptographic authenticity weakening.

> **Scope limit.** Protocol semantics must not change. If the floor cannot be implemented without changing
> them, that is a STOP condition.

The finding it rests on, quoted from the same record: `lib/evidenceBundle.mjs:35` rebuilds each beacon from
exactly `{round, randomness, signature}`, so **relay identity is discarded** and a one-relay bundle and a
ten-relay bundle can be byte-identical; `lib/sampling.mjs:180` needs only one beacon; section 19.3 asks for
">= 2 drand relays for verification", so the requirement is **procedural today**.

### 1.2 The clause it touches

Protocol **line 961**, the trailing sentence of section 19.3, verbatim from the file at `c50fc680...00b719`:

> Also required before held-out execution: recording fetcher, recording Wikidata lookup, replay harness (§13);
> certenv with a fixture tenant; two independent Bitcoin header sources (or an own node) and ≥ 2 drand relays
> for verification.

**No protocol text changes.** DR-1 makes the instrument enforce what section 19.3 already asks.

### 1.3 Does it change a hashed object?

| Hashed object | Changes? |
|---|---|
| `protocol_sha256` | **No.** `c50fc680...00b719` unchanged. DR-1 is an instrument change, not a protocol amendment. |
| `tooling_aggregate_sha256` | **YES — this is the only hashed object DR-1 moves.** `DR1_DRAND_RELAY_FLOOR_MEMO.md:229` records that the aggregate "moves off `f7699f05...`" and that the manifest covers every file of the tree including vendored dependencies (`lib/aggregate.mjs:8-22`), so there is no "small" change. |
| `registry_sha256` | **No.** |
| Treatment commit `f01a7eb4...`, evaluation tree `3b4811fc...`, `provider_configuration_sha256` `c9a7e9aa...` | **No.** The wave's integrity gate says only the aggregate may move. |

**The new aggregate is not available to this document.** Implementation is running in a separate stream; two
earlier candidate patches were measured and, per `DECISION_RECORD.md`, **neither aggregate is registrable**,
because neither carried the required test changes. Handling rules are in
`PROVISIONAL_AGGREGATE_HANDLING.md` in this directory.

### 1.4 Exact wording to publish

#### (a) Decision-log entry — paste verbatim

```
DR-1 — drand relay floor: ADOPT OPTION (B), a >= 2 independent-relay floor with per-relay attribution.
Decided: <<UNFILLED: YYYY-MM-DD>>   By: <<UNFILLED: accountable identity>>
Status: CLOSED — instrument change, implemented BEFORE registration. No protocol amendment.

Question: CPG_U1_PROTOCOL_004 section 19.3 (line 961) requires ">= 2 drand relays for verification",
but the instrument at f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd discarded relay
identity (lib/evidenceBundle.mjs:35 rebuilds each beacon from {round, randomness, signature} only) and
accepted a single beacon (lib/sampling.mjs:180), so a one-relay bundle and a ten-relay bundle could be
byte-identical and the requirement was procedural, not enforced.

Decision: implement the floor in the instrument before registration, with explicit per-relay
attribution, so that the registered instrument enforces what section 19.3 asks. Ten requirements
adopted verbatim: >= 2 distinct relays per bundle; relay identity survives into the evidence
representation; duplicate use of one relay does not satisfy the floor; the verification result
distinguishes the relays; a one-relay bundle fails closed; a two-relay bundle passes; malformed or
missing relay identity fails closed; relay identity enters the deterministic evidence path so one-relay
and two-relay bundles cannot hash alike; the test suite proves the distinction explicitly; no
cryptographic authenticity weakening.

Scope limit: protocol semantics must not change. If the floor cannot be implemented without changing
them, that is a STOP condition and this decision is reopened.

Objects affected: tooling_aggregate_sha256 ONLY. It moves off
f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd to
<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>.
protocol_sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719 unchanged;
registry_sha256 a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814 unchanged;
provider_configuration_sha256 c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561
unchanged; treatment commit f01a7eb4199be4e04d4fee7fc0116303949dc553 unchanged; evaluation tree
3b4811fc88e9fbb64ee42c37c4aacca2e76c67af unchanged. No field of cpg-u1-registration/v1 is added or
removed; exactly one field's VALUE changes.
```

**The registered value of `tooling_aggregate_sha256` is the aggregate of the instrument that carries this
change.** Whoever fills the record replaces the `<<PROVISIONAL: ...>>` marker with the value the orchestrator
supplies after two independent clean rebuilds agree, and with nothing else. This document states no candidate
value, so it remains correct whatever the value turns out to be.

#### (b) OSF registration narrative — paste verbatim

> Section 19.3 requires at least two drand relays for verification. In the registered instrument this is
> enforced rather than merely stated: an evidence bundle must carry beacons attributed to at least two
> distinct relays, relay identity is part of the deterministic evidence representation so that a one-relay
> bundle and a two-relay bundle cannot hash alike, duplicate use of one relay does not satisfy the floor, and
> a one-relay bundle or a bundle with missing or malformed relay identity is refused. The relay floor was
> implemented before registration; it is the reason the registered `tooling_aggregate_sha256` is not the value
> published in this study's earlier preparation notes. The protocol text at
> `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` is unchanged.

It names no relay operator, no person and no value that is not already fixed by the protocol and by the
registered record itself.

---

## 2. DR-2 — section 19.3 certenv wording · DECIDED: **ADOPT OPTION (A)**

### 2.1 What was decided

Quoted from `DECISION_RECORD.md` (DR-2):

> **Decision.** Keep the frozen protocol wording unchanged. "certenv with a fixture tenant" is a **procedural
> description**, not an assertion that a persistent fixture tenant exists in the resolver clone.

> **Consequences, recorded rather than implemented:** no fixture tenant is created · the protocol SHA does not
> change · no new protocol version is created · the implementation reality is disclosed in the registration
> supporting note — certenv is isolated, the fixture-company identifier is a test label, no production
> database is accessed, no real tenant is required for the resolver clone, the harness refuses unsafe `.env`
> construction, and this wording alters neither treatment nor measurement.

> **This decision requires no code change.** It is a documentation and disclosure act only.

### 2.2 The clause it touches

The same protocol **line 961** quoted in section 1.2 above, the clause "certenv with a fixture tenant". The
phrase occurs in the protocol exactly twice: line **466** (the section 6.5 preview prohibition, which names
`certenv` as one of the organisation's ambient environments in which CPG must **not** be executed) and line
**961**.

### 2.3 Does it change a hashed object?

**NO — nothing at all.**

| Hashed object | Changes? |
|---|---|
| `protocol_sha256` | **No.** Option (A) is precisely the option that keeps `c50fc680...00b719`. |
| Protocol version string | **No.** No `CPG_U1_PROTOCOL_005` exists and none is created. `PROTOCOL_VERSION` (`lib/registration.mjs:9`) stays `CPG_U1_PROTOCOL_004`, which `checkRegistration` enforces as an ERROR and `cmdVerifyProtocol` requires as a literal marker in the protocol text. |
| `tooling_aggregate_sha256` | **No — not by DR-2.** It moves only because of DR-1 and DR-10. `DR2_CERTENV_WORDING_MEMO.md:194`: "**Tooling aggregate impact: None.**" |
| Anything else | **No.** DR-2 adds no file, no flag, no environment variable and no check. |

**And nothing is created in the world either:** no certification environment, no fixture tenant, no database
row, no credential.

### 2.4 Exact wording to publish

#### (a) Decision-log entry — paste verbatim

```
DR-2 — section 19.3's "certenv with a fixture tenant": ADOPT OPTION (A), keep the frozen wording.
Decided: <<UNFILLED: YYYY-MM-DD>>   By: <<UNFILLED: accountable identity>>
Status: CLOSED — recorded interpretation plus a disclosure. No protocol amendment; no re-freeze;
no new protocol version; no code change.

Question: CPG_U1_PROTOCOL_004 section 19.3 (line 961) names "certenv with a fixture tenant" as a
prerequisite before held-out execution, and no code path in the instrument corresponds to it. Does
the study therefore have to provision a certification environment and a fixture tenant, or amend the
protocol?

Decision: neither. The phrase is a PROCEDURAL DESCRIPTION — the resolver is exercised somewhere that
is not production, against a fixture rather than a real customer — and NOT an assertion that a
persistent fixture tenant exists in the resolver clone. The instrument's frozen resolver clone, with
no environment file and a constant fixture label, satisfies that description, and satisfies it more
strictly than a literal certenv would. The protocol wording stands.

Objects affected: NONE. protocol_sha256
c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719 unchanged; protocol_version stays
CPG_U1_PROTOCOL_004 and no new version exists; tooling_aggregate_sha256 is not moved by this
decision; registry_sha256 unchanged; no field of cpg-u1-registration/v1 is added, removed or
altered. No certenv, tenant, database row or credential was created.
```

#### (b) **REGISTRATION SUPPORTING NOTE — the disclosure DR-2 requires.** Paste verbatim into the OSF narrative.

> **Supporting note on section 19.3's "certenv with a fixture tenant".** Section 19.3 of the registered
> protocol lists, among the prerequisites before held-out execution, "certenv with a fixture tenant". That
> phrase describes a procedure — exercising the resolver somewhere that is not production, against a fixture
> rather than a real customer — and this study discloses in advance exactly how it is satisfied, so that no
> reader has to infer it.
>
> 1. **The certification environment is isolated.** Held-out execution runs in the frozen resolver clone at
>    commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`, with a clean working tree and **no `.env*` file of any
>    kind**, and the evaluated child process receives only an allow-listed environment.
> 2. **The fixture-company identifier is a test label, not a tenant.** It is a single constant string, the
>    same for every row of the frame, and it is never looked up anywhere.
> 3. **No production database is accessed.** The evaluated subtree of the clone contains no database client at
>    all; the resolver path performs no persistence of any kind during held-out execution.
> 4. **No real tenant is required, and none exists.** Nothing in the evaluated path reads tenant state, so a
>    persistent fixture tenant would be a row that nothing queries. None was created for this study.
> 5. **The harness refuses unsafe `.env` construction.** A literal certification-environment file placed
>    inside the resolver clone is detected and the run is refused; this refusal is itself covered by the
>    instrument's mutation testing. Satisfying section 19.3's words literally by adding such a file would
>    therefore stop held-out execution rather than enable it.
> 6. **The wording alters neither treatment nor measurement.** This note changes no protocol text, creates no
>    new protocol version, and changes no registered hash. The protocol registered here is
>    `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`, unamended. Treatment, sampling,
>    admissibility, frame construction and every measured outcome are identical with and without this note;
>    it is a disclosure, not a change.
>
> The divergence disclosed here is that the protocol's words name *an environment with a tenant* while the
> instrument's guarantee is that the evaluated path runs with *no environment file, no credentials and no
> persistence*. The study registers the stricter mechanism and states the divergence rather than leaving a
> reader to discover it.

**Where this note lands:** in the OSF submission's free-text narrative, **not** in the machine record. The
`cpg-u1-registration/v1` record has no narrative, notes or description field, and `REGISTRATION_PACKAGE.md`
section 6(1) requires the submission to carry the record "as `registration-fields` produced it", so **no key is
added**. It sits beside the "tooling v4" / `cpg-u1-data-tooling-6` naming disclosure already prepared in
`REGISTRATION_PACKAGE.md` section 5 and the DR-7 sentence carried forward in section 4 below.

---

## 3. DR-10 — `cmdScan` duplicate collapse · DECIDED: **FIX BEFORE REGISTRATION**

### 3.1 What was decided

Quoted from `DECISION_RECORD.md` (DR-10):

> **Decision.** Fix the defect before registration.

> **Finding this rests on** (established and verified in DEEPTECH-PARALLEL-008): `cpg_u1_data.mjs:233` builds
> a `Map` keyed on `candidate_id`, which keeps only the last row for a repeated key, and it is reachable
> because line 230 loads with `loadCsv`, not `loadFrame`. With a **divergent** duplicate the collapse **hides
> real contamination** — the control frame flags the row with two repository hits and a registry match, while
> the duplicate frame reports `held_out_ineligible_by_scan=false` (control flagged 6, duplicate frame 5) — and
> `scan.frame_hash` still matches the full frame, so the artefact attests to rows it never assessed. Ten
> downstream commands refuse it and both bypasses are closed, so it is not evidence-bearing; it is fixed
> because it is cheap now and impossible after registration.

> **The twelve requirements are adopted verbatim:** preserve every occurrence needed for contamination
> detection · normalisation may serve efficiency but must not erase provenance-bearing occurrences · a
> duplicate stays attributable to source file, source location where available, matched
> identifier/name/domain, and contamination reason · a contaminated occurrence must never vanish because an
> identical one was seen first · fail-closed behaviour is retained · a regression fixture proves the
> historical failure mode · negative controls prove benign duplicates are still handled · scan semantics are
> not broadened beyond the defect · admissibility rules, the development registry, the frozen protocol and
> frame-construction rules are all unchanged.

**Corroborated read-only by this agent** in `C:/tmp/dt002/research/cpg-u1/tooling/cpg_u1_data.mjs`: line 230
is `const frame = loadCsv(need(o, 'frame'), FRAME_COLUMNS);`; line 233 is
`const state = new Map(frame.map((r) => [r.candidate_id, { r, tokens: tokensFor(r), hits: [] }]));`; and the
report sets `frame_hash: hashRecords(frame, 'candidate_id')` — **over the full `frame` array** — while
`results` are derived from the collapsed `Map`. That is exactly the shape of the finding: the hash covers rows
the results do not.

### 3.2 The clause it touches

**None.** DR-10 touches no protocol clause. It is a defect in the instrument's implementation of
CPG-C1(1)/CPG-C1(6) contamination scanning, not a rule change. Admissibility rules, the development registry,
the protocol and frame-construction rules are all unchanged.

### 3.3 Does it change a hashed object?

| Hashed object | Changes? |
|---|---|
| `protocol_sha256` | **No.** |
| `tooling_aggregate_sha256` | **YES.** `cpg_u1_data.mjs` changes and test material is added, so the manifest text changes and the aggregate moves. DR-1 and DR-10 therefore move it **together**, and it must move **once** — see `PROVISIONAL_AGGREGATE_HANDLING.md`. |
| `registry_sha256` | **No.** |
| `scan_sha256` / `frame_hash` of any real artefact | **No, because none exists.** No real frame has been enumerated and no real scan has been produced. This is precisely why the fix is free now. |

### 3.4 Exact wording to publish

#### (a) Decision-log entry — paste verbatim

```
DR-10 — cmdScan duplicate collapse: FIX BEFORE REGISTRATION.
Decided: <<UNFILLED: YYYY-MM-DD>>   By: <<UNFILLED: accountable identity>>
Status: CLOSED — instrument defect, fixed before registration. No protocol amendment.

Finding: cmdScan loaded the frame with loadCsv rather than loadFrame (cpg_u1_data.mjs:230) and then
keyed a Map on candidate_id (:233), so a repeated candidate_id kept only the last row. With a
DIVERGENT duplicate this hid real contamination: against the same repository, the control frame
flagged the row (two repository hits and a registry match) while the duplicate frame reported
held_out_ineligible_by_scan=false — control flagged 6 rows, the duplicate frame 5 — and the scan
report's frame_hash still matched the FULL frame, because frame_hash is computed over the loaded
array while the results are computed from the collapsed map. The artefact therefore attested to rows
it had never assessed.

NOT EVIDENCE-BEARING. Ten downstream commands already refuse such a frame and both bypasses were
already closed, so no produced artefact of this study was affected — no real frame has been
enumerated and no real scan produced. The defect is fixed because the fix is cheap now and
impossible later: after registration tooling_aggregate_sha256 is fixed, so a repair would be a
re-registration, and a second registration naming different sampling fields VOIDS the study.

Twelve requirements adopted verbatim: preserve every occurrence needed for contamination detection;
normalisation may serve efficiency but must not erase provenance-bearing occurrences; a duplicate
stays attributable to source file, source location where available, matched identifier/name/domain,
and contamination reason; a contaminated occurrence must never vanish because an identical one was
seen first; fail-closed behaviour retained; a regression fixture proves the historical failure mode;
negative controls prove benign duplicates are still handled; scan semantics are not broadened beyond
the defect; admissibility rules, the development registry, the frozen protocol and frame-construction
rules unchanged.

Objects affected: tooling_aggregate_sha256 ONLY, jointly with DR-1 (one move, not two).
protocol_sha256, registry_sha256, provider_configuration_sha256, the treatment commit and the
evaluation tree are all unchanged. No scan_sha256 or frame_hash of any real artefact is affected,
because none exists.
```

#### (b) OSF registration narrative — paste verbatim

> Before registration, a defect was found and fixed in the contamination scanner: a repeated candidate
> identifier in the frame could collapse to a single row, so that where two rows shared an identifier but
> differed in content, contamination evidence belonging to one of them could be dropped while the scan
> report's frame hash still covered the whole frame. No artefact of this study was affected — no frame has
> been enumerated and no scan produced, and every downstream command already refused a frame with repeated
> identifiers — but the defect is disclosed and was repaired before the instrument was frozen, because
> `tooling_aggregate_sha256` cannot be changed after registration. The scanner now preserves every occurrence
> needed for contamination detection, keeps each occurrence attributable to its source, and is covered by a
> regression fixture reproducing the historical failure together with negative controls for benign duplicates.

---

## 4. Carried forward from the previous wave — DR-7 and DR-8

**The disposal text below is carried forward unchanged from
`C:/tmp/dt008-prereg/A-decisions/DR7_DECISION_MEMO.md` section 4 and `.../DR8_OPERATIONAL_RULE.md`. It is not
rewritten here.** Both are personnel matters and neither touches a hashed object.

### 4.1 DR-7 — section 19.3(3) "Seven mutually exclusive independent persons" is a MINIMUM

Decision-log entry — quoted verbatim from `DR7_DECISION_MEMO.md` section 4.1:

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
unchanged; tooling_aggregate_sha256 f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
unchanged; registry_sha256 unchanged; no field of cpg-u1-registration/v1 added, removed or altered.
```

**One correction of fact, not of reasoning, applies to the final paragraph of that entry and to nothing else
in it:** the entry was drafted when `tooling_aggregate_sha256` was expected to remain `f7699f05...`. DR-1 and
DR-10 now move it. DR-7 itself still affects **no** object; the operator should publish the entry with its
"Objects affected: NONE" clause intact and the aggregate value **omitted** rather than quoted (the clause does
not depend on the value), or else quote whatever value DR-1/DR-10 produce. **The reasoning, the four grounds
and the OSF sentence below are unchanged.**

OSF narrative sentence — quoted verbatim from `DR7_DECISION_MEMO.md` section 4.2:

> §19.3(3)'s closing words "Seven mutually exclusive independent persons" are read as a minimum, not a cap:
> §4A.3 states "minimum 7 independent persons", lists "enumerator (≥ 1)", permits "Several enumerators", and
> the registered instrument accepts and positively tests a register with two enumerators
> (`lib/personnel.mjs:26`; `test/selftest.mjs:829`), so this study's eight independent persons satisfy
> §19.3(3) with no amendment to the protocol at
> `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.

### 4.2 DR-8 — section 4A.1 item 6 between co-enumerators

Carried forward from `DR8_OPERATIONAL_RULE.md` "Summary — the seven rules", verbatim:

| # | Rule | Status |
|---|---|---|
| **A1** | A and B must be mutually independent under §4A.1 item 6; each declares it. | **DECISION REQUIRED** (record the reading; no amendment — the frozen declaration key already asks it) |
| **A2** | Two separate, complete declaration sets and two organisation confirmations. | **MECHANICALLY ENFORCED** — `lib/personnel.mjs:36-39` |
| **A3** | Separate fee agreements, or a recorded absence; per person. | **RECOMMENDED** (a shared agreement is permitted but leaks the pairing) |
| **A4** | Fee-ordering: joint within the enumerator cohort, per-person across cohorts. | **RECOMMENDED** — satisfies both readings of item 5 |
| **A5** | Neither learns the other's identity; declarants supply relational schedules; the operator performs and records `pairwise_item6_check`; re-run on any roster change. | **RECOMMENDED** — no instrument change; unknown register keys are ignored |
| **A6** | No exchange of rows, progress, counts or identities; own work only; operator de-duplicates. | **RECOMMENDED** — receive-list closed for what the study releases; operational rule for the rest |
| **A7** | No material to either until both sets of paperwork are complete and `check-personnel` is clean. | **RECOMMENDED** — and it is what keeps the eighth person net-positive |

> **Still DECISION REQUIRED after this memo:** (i) the owner's ruling on A1's reading; (ii) who performs
> cross-partition entity reconciliation (§(e) hazard / OQ-5); (iii) whether the registration narrative should
> disclose that the item-6 pairwise check is an operator attestation (recommended: yes).

**DR-8 changes no hashed object and lands in no registration field.** Its consequence for the registration
record is set out in `ENUMERATOR_B_IN_REGISTRATION.md` in this directory.

---

## 5. Summary — what each decision does to the record

| Decision | Status | Clause touched | Changes `protocol_sha256`? | Changes `tooling_aggregate_sha256`? | Lands in a machine field? | Lands in the OSF narrative? |
|---|---|---|---|---|---|---|
| **DR-1** | DECIDED — option (B), implement the relay floor | 19.3 line 961 (">= 2 drand relays") — **enforced, not amended** | **No** | **YES** (jointly with DR-10) | `tooling_aggregate_sha256` — value only | **Yes** (1.4b) |
| **DR-2** | DECIDED — option (A), keep the wording | 19.3 line 961 ("certenv with a fixture tenant") — **interpreted, not amended** | **No** | **No** | **No field at all** | **Yes** — the supporting note (2.4b) |
| **DR-10** | DECIDED — fix before registration | **None** (instrument defect) | **No** | **YES** (jointly with DR-1) | `tooling_aggregate_sha256` — value only | **Yes** (3.4b) |
| **DR-7** | carried forward; owner ruling pending | 19.3(3) line 959 — **interpreted** | **No** | **No** | **No field at all** | **Yes** (4.1) |
| **DR-8** | carried forward; A1 ruling pending | 4A.1 item 6, line 138 — **interpreted** | **No** | **No** | **No field at all** | Recommended for item (iii) only |

**Net effect on the `cpg-u1-registration/v1` record: exactly one leaf's value changes** —
`tooling_aggregate_sha256` — and **no key is added, removed or renamed**. Everything else these five decisions
produce is decision-log and OSF free-text prose outside the machine record.

## 6. What this document did NOT do

No registration. No OSF submission. No Bitcoin activity of any kind. No fabricated external value or
identity — every external leaf is left as an explicit `<<UNFILLED: ...>>` or `UNASSIGNED` marker. No protocol
edit and no instrument edit; the instrument was read from `C:/tmp/dt002` only, and nothing was written there.
No commit, push or pull request. No network access, no credentials. No real frame, no U1 execution. The
post-DR-1/DR-10 aggregate is represented **only** as
`<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>`.
