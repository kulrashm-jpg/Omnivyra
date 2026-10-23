# REGISTRATION_READINESS_PACKAGE — DEEPTECH-PARALLEL-011

Directive §13. The sixteen items of the registration readiness package.

**This document does NOT declare the candidate registration-ready.** Passing these preparations does
not make it ready; §5 below states what is still missing. **Nothing was registered.** No OSF action,
no Bitcoin broadcast, no network call, no credential.

## Rules applied to every line below

- Every **machine-derivable** value was **derived in this stream** from the candidate instrument, the
  protocol document or the pinned evaluation tree. Nothing was transcribed from an earlier report; the
  values that happen to agree with earlier reports (the tooling aggregate, the evaluation-tree triple,
  the provider configuration hash) were each recomputed independently and are noted as such.
- Every **human-supplied** value is marked **EXTERNAL INPUT REQUIRED** and carries the literal
  sentinel the instrument itself uses: `UNASSIGNED`. Nothing is invented — no identity, no ORCID, no
  ROR, no wallet key, no OSF id, no timestamp, no relay URL, not even as a placeholder that could be
  mistaken for real. (Run R28 in `VERIFIER_INTEGRITY_RECHECK.md` shows exactly why a "harmless"
  placeholder such as `TBD` is dangerous here: the verifier accepts it with exit 0.)
- The eleven external leaves of the registration record are enumerated individually in
  `EXTERNAL_LEAVES.md`.

**Tally: 16 items. 12 are entirely real and verified. 4 are mixed — real, verified rules plus named
EXTERNAL INPUT REQUIRED leaves. 0 are entirely external.** The eleven external registration-record
leaves all sit inside items 3 and 7.

---

## 1. Protocol identity — REAL, VERIFIED

| Field | Value |
|---|---|
| `protocol_version` | `CPG_U1_PROTOCOL_004` |
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| `study_id` | `CPG-U1-2026-01` |
| `schema` | `cpg-u1-registration/v1` |

Derived by hashing `CPG_U1_PROTOCOL_004.md` (1098 lines) as shipped beside the candidate instrument.
`verify-protocol` additionally requires the document to state 20 normative markers (`D = 6`,
`K = 12`, `180 days`, `Δ = 3 h`, `30 days`, the drand chain hash, `bls-unchained-g1-rfc9380`, the
seed / digest / payload / rater-order / execution-authorization / evaluation-tree domains,
`OSF Registries`, `STUDY_OPERATOR`, `UNASSIGNED`, `E ≥ 126 / 52 / 32`, the cited-URL rule) so the
protocol and the instrument cannot silently diverge.

## 2. Tooling identity — REAL, VERIFIED — **CANDIDATE, CERTIFICATION PENDING**

| Field | Value |
|---|---|
| `tooling_aggregate_sha256` | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| Files in the aggregate | **594** |
| Construction | sha256 over `"<sha256>  <path>\n"` lines for every regular file under the tooling root, sorted by path (§24); links and non-regular entries are refused |
| Tool version string | `cpg-u1-data-tooling-6` |

**Status: CANDIDATE, CERTIFICATION PENDING — not final.** The 404-mutant certification suite is *in
flight* against `C:/tmp/dt009-merge/tooling` at the time of writing. The aggregate and file count
above are verified facts about the tree; they are **not** a certification of it. This line must be
re-stated as final only after the mutation run completes and every mutant is killed. Until then no
registration may name this aggregate.

The aggregate was recomputed twice — once on the candidate and once on a byte-identical scratch copy
— and both returned `638d68e6…78fd2` / 594 files. Nothing was written under `C:/tmp/dt009-merge`.

## 3. Treatment identity — MIXED (real definition; `asOf` is EXTERNAL INPUT REQUIRED)

**Arm T — the CPG resolver.** §7: U1 exercises `lookupGroundedCompanyFacts`
(`companyFactsLookup.ts:107-122`) at the resolver SHA, in the non-production evidence environment.
The HTTP route's authentication, tenant authorisation and persisted-profile read are out of U1 scope.
Single-arm by design (§8).

| Input | Value | State |
|---|---|---|
| `companyId` | non-production fixture id | REAL (rule) |
| `companyName`, `websiteUrl`, `linkedinUrl` | from the sealed manifest; `linkedinUrl` null | REAL (rule) |
| `asOf` | **`UNASSIGNED`** — one frozen ISO-8601 UTC timestamp for the whole held-out run, chosen before registration | **EXTERNAL INPUT REQUIRED** (owner) |
| `fetcher` | `createSafeEvidenceFetcher({ budgetMs: 45_000 })`, wrapped by a recording fetcher (§13) | REAL (rule) |
| `wikidataLookup` | `lookupCompanyFirmographicsFromWikidata`, wrapped by a recording lookup (§13) | REAL (rule) |
| Sources | `[createWikidataSource(...)]`, identity pre-step on — exactly as production | REAL (rule) |

Both wrappers are harness code; no CPG code changes. The full response is captured per company
(§13.2). The tooling itself runs no CPG.

## 4. Evaluation-tree identity — REAL, VERIFIED

Derived in this stream from §7.1 of the protocol via the instrument's own `declaredIdentity()`
(not transcribed):

| Field | Value |
|---|---|
| Commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| Git tree object id | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` |
| Content manifest aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` |
| Files | **11552** |
| Domain | `cpg-u1-evaluation-tree/v1` |
| Instrument-exclusion path | `research/cpg-u1` — a clone whose tracked files include it is refused as a conflation of treatment with instrument |

**Content is authoritative.** A clone whose content differs is refused; a clone whose commit or tree
id differs while the content aggregate matches is accepted with a recorded note. If the commit ever
becomes unreachable, the content aggregate — not the commit id — is what the study was run against.
Re-pinning after any held-out result is a §18.3 protocol violation and voids the study.

**Caveat carried from the verifier recheck (property 5d):** `verify-registration` does **not** check
this identity. `verify-evaluation-tree` must be run separately against the clone that will actually
be executed. The registration record carries no evaluation-tree field; the binding is transitive,
through `protocol_sha256`.

## 5. Registry identity — REAL, VERIFIED

Two distinct registries; both verified.

**(a) The preregistration registry (§5.5.1, U1 approval).** Pinned in the record and enforced by
`checkRegistration` — a wrong value is refused unconditionally, even on an otherwise-UNASSIGNED
template (run R29):

| Field | Value |
|---|---|
| `registry.name` | `OSF Registries` |
| `registry.public` | `true` |
| `registry.embargo` | `false` |

**(b) The development-only contamination registry (§5.3 CPG-C1(6)).** Frozen at registration for both
stages; the held-out scan equals the development scan.

| Field | Value |
|---|---|
| File | `rules/development_only_registry.json` (inside the tooling aggregate) |
| `registry_sha256` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` |

Derived by hashing the file in the candidate. **Completeness rests on attestation H2, not on a
mechanical proof** (§20.12).

## 6. Provider configuration identity — REAL, VERIFIED

Derived in this stream from the pinned evaluation tree, by reading the two named files at commit
`f01a7eb4` and applying the instrument's own domain-separated construction:

| Field | Value |
|---|---|
| Domain | `cpg-u1-provider-config/v1` |
| `backend/services/companyProfile/grounding/registry/builtins.ts` | `ab9b944318add9af97642bda7d03003ac5ba74817704a57e8064039b46db85bb` |
| `backend/services/companyProfile/grounding/registry/coverageInventory.ts` | `07506ff2cb569bc781a8d437562eaf130a6beb7c2ba939a1d3181834e3319fc1` |
| `provider_configuration_sha256` | **`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`** |

This is **machine-derivable and therefore NOT an external leaf** — it is the tenth registration
blocker but it is computed, not supplied. It must be written into the record before registration.

**Caveat (verifier property 6, run R15):** `verify-registration` checks only that this field is 64
lowercase hex. A plausible wrong value passes with exit 0. The hash is bound only downstream, at
`lib/harness.mjs:54` (`PROVIDER_CONFIG_MISMATCH`), through the execution authorisation
(`lib/execution.mjs:69`), and at `lib/evaluation.mjs:130` (`WRONG_TREATMENT`). **Transcribe it from
the derivation above, and re-derive it at registration time; the verifier will not catch an error
here.**

## 7. Randomness sources — MIXED (real parameters; outpoints, checkpoint and relay endpoints are EXTERNAL INPUT REQUIRED)

**No person supplies randomness** (§5.5). Each stage's randomness is the Bitcoin block hash at
`H_commit + K` combined with a drand round fixed by that block's successors. The tooling computes
both, has no seed argument, and refuses caller-chosen rounds.

### Pinned parameter set — REAL, VERIFIED (all 12 values, read from the candidate)

| Parameter | Value |
|---|---|
| `confirmations_D` | `6` |
| `randomness_offset_K` | `12` |
| `abandonment_days` | `180` |
| `randomness_model` | `B` |
| `drand_chain_hash` | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` (quicknet) |
| `drand_delta_seconds` | `10800` (Δ = 3 h) |
| `drand_missing_round_expiry_days` | `30` |
| `commitment_opreturn` | `CPGU1\|01\|44(D)/48(H)\|sha256 digest` |
| `digest_domain` | `cpg-u1-commitment-digest/v1` |
| `seed_derivation` | `cpg-u1-chain-drand-seed/v1` |
| `rank_key` | `sha256("<seed>\|<scheme>:<identifier>")` |
| `bls_implementation` | `@noble/curves@1.9.7 + @noble/hashes@1.8.0 (vendored)` |

`checkRegistration` requires the parameter set to contain **exactly** these twelve keys with exactly
these values; an extra or altered parameter is an error.

### Bitcoin source — network pinned, values EXTERNAL

| Field | State |
|---|---|
| `network` | `bitcoin-mainnet` — REAL, pinned; `synthetic-test` is accepted only under `--allow-synthetic` |
| `outpoints.development` (`O_dev`) | **`UNASSIGNED`** — **EXTERNAL INPUT REQUIRED** (Bitcoin / key custodian) |
| `outpoints['held-out']` (`O_ho`) | **`UNASSIGNED`** — **EXTERNAL INPUT REQUIRED** (Bitcoin / key custodian) |
| `checkpoint.height` | **`UNASSIGNED`** — **EXTERNAL INPUT REQUIRED** (Bitcoin) |
| `checkpoint.hash` | **`UNASSIGNED`** — **EXTERNAL INPUT REQUIRED** (Bitcoin) |

Two single-use P2WPKH outputs, each ≥ D = 6 confirmations; the checkpoint is a block at or after both
funding confirmations; the two outpoints must be distinct. **No key is created, no transaction is
built and nothing is broadcast by this tooling or by this stream.**

### drand source — floor enforced (DR-1 landed), endpoints EXTERNAL

`lib/evidenceBundle.mjs` refuses any round attested by fewer than **two differently named relays**,
records the sorted relay-name set in the bundle, and refuses beacons that disagree for the same round
("do not choose one"). `verify-sampling` prints `drand_relays` so the ≥ 2-relay claim is readable from
the verification output (§19.3, §21 step 5).

| Field | State |
|---|---|
| Relay floor | **≥ 2** — REAL, enforced in code |
| The specific relay URLs used at verification time | **EXTERNAL INPUT REQUIRED** — *not fabricated here.* These are §19.3 named prerequisites of the verifier, **not** registration-record fields, so they are **not** among the eleven leaves |
| Two independent Bitcoin header sources (or an own full node) | **EXTERNAL INPUT REQUIRED** — same footing as the relays: a §19.3 prerequisite, not a record field |

## 8. Endpoint definitions — REAL, VERIFIED (§10, closed)

| ID | Endpoint | Definition | Threshold |
|---|---|---|---|
| **G1** | Assessability gate | all fills = SUPPORTED + UNSUPPORTED + INCORRECT + MISATTRIBUTED | **≥ 20** (derived from θ_EFR); below → INCONCLUSIVE |
| **P1** | Erroneous Fill Rate | (UNSUPPORTED + INCORRECT + MISATTRIBUTED) ÷ all fills, pooled | **≤ 0.05** |
| **P2** | Abstention Recall (corrected) | CORRECT-ABSTENTION ÷ (CORRECT-ABSTENTION + UNSUPPORTED-FILL) | **≥ 0.90** |
| **P3** | Identity Integrity | count(MISATTRIBUTED-FILL) | **= 0**; any > 0 fails the run outright |
| **R1** | Fill Recall | SUPPORTED ÷ (SUPPORTED + MISSED + INCORRECT) | **no threshold** — mandatory, reported with every EFR |

**Outcome vocabulary — exactly one**, checked in this order: **INCONCLUSIVE** (any §15.5 condition, or
G1 fails) → **FALSIFIED** (II > 0, or EFR > 2 × θ_EFR) → **FAILURE** (conclusive, not falsified, any of
P1/P2/P3 missed, *explicitly including a near miss*) → **SUCCESS** (G1 holds and P1, P2, P3 all met).

Secondary metrics S1–S8 are diagnostic and are **never an acceptance basis**. No weighted or composite
score. No coverage claim may be made from a SUCCESS. Krippendorff's α, nominal, ≥ 0.667 for rater
agreement.

## 9. Personnel model — MIXED (structure real and verified; the eight identities are EXTERNAL INPUT REQUIRED)

**Eight persons: the seven mutually exclusive independent roles plus a second enumerator
("Enumerator B").** The structure was verified by real runs of `check-personnel` against synthetic
registers:

| Register | Result | Exit |
|---|---|---|
| 7 roles, one enumerator | accepted | 0 |
| **8 persons: 7 roles + a second `enumerator`** | **accepted** | **0** |
| 7 roles + a second `rater-2` | `ERROR role rater-2 must be held by exactly one person` | 1 |
| empty assignments | 7 × `BLOCKED role … is UNFILLED` | 4 |

So the 8-person model is admissible **without a protocol amendment**: `enumerator` is the only role
`checkPersonnelRegister` permits more than one holder of; every other role is exactly one person, all
seven are mutually exclusive, and the operator may hold none.

| # | Role | Identity |
|---|---|---|
| 1 | `enumerator` (Enumerator A) | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 2 | `enumerator` (**Enumerator B**, the second enumerator) | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 3 | `reference-author` | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 4 | `reference-confirmer` | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 5 | `reference-adjudicator` | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 6 | `rater-1` | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 7 | `rater-2` | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| 8 | `rating-adjudicator` | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |
| — | `operator.person_id` (study operator = key custodian; holds **no** independent role) | **`UNASSIGNED`** — EXTERNAL INPUT REQUIRED |

These eight (nine with the operator) are **not** among the eleven registration-record leaves: the
personnel register is a restricted §4A.2 / §19.3(3) prerequisite, not a field of the registration
record. They are due **before the respective stage**, not before registration — except that
enumerators are needed before frame construction, which follows registration.

`enumerated_by` (DR landed) binds each frame row to a registered eligible enumerator, and because it
is a frame column, re-attribution changes `frame_hash`. Enumerators never receive pilot, sizing or
quota information (§4A.2 barrier).

## 10. Declarations status — MIXED

**(a) Methodological decisions AD-1…AD-9 — REAL, ALL DECIDED.** Read from
`rules/analysis_decisions.json` in the candidate; file status is `DECIDED`; none is `UNDECIDED`.
Because the file is inside the tooling aggregate, these nine values are frozen by registration.
`analyze` refuses at exit 4 while any is UNDECIDED.

| ID | Topic | Decided value |
|---|---|---|
| AD-1 | Krippendorff's α population | `EXCLUDE_INVALID_CONFLICT_AND_STALE` |
| AD-2 | Undefined α | `INCONCLUSIVE` |
| AD-3 | SOURCE-COINCIDENT match | `URL_WITHOUT_FRAGMENT` |
| AD-4 | Decisive registry path unavailable | `ENTRY_FOR_DECISIVE_IDENTIFIER` |
| AD-5 | 24-month temporal rule arithmetic | `CALENDAR_MONTHS` |
| AD-6 | REFERENCE-STALE scope | `STATED_REFERENCE_VALUES_ONLY` |
| AD-7 | Outcome of a declared protocol violation | `VOID` |
| AD-8 | Undefined abstention recall | `INCONCLUSIVE` |
| AD-9 | Abstention split basis (diagnostic) | `ANY_UNAVAILABLE_ENTRY` |

**(b) §19.2 approvals and attestations — REAL, RECORDED.** H1 Approved (CAP 60); H2 Confirmed
(development-only registry complete to the best of knowledge); H3 Superseded by U1/U2/U3; U1, U2, U3
Approved (identity and custodian **not named**); CPG-042 A-1…A-6, B-1, B-2, X-1 Approved for CPG-043
and implemented.

**(c) Human declarations — EXTERNAL INPUT REQUIRED, none of them registration-record fields:**

- the seven §4A.1 independence declarations per person (all seven keys must answer `no`), plus each
  person's `organisation_confirmation_sha256` (the developing organisation's no-relationship
  confirmation) and `study_fee_agreement_sha256` (64 hex, or `null` for no fee);
- the operator's signed **no-preview declaration**, covering frame completion to run completion (§6.5);
- the analysis-time declarations file (`seal_hash`, `protocol_violations`, `identity_inadmissible`),
  which is due after the seal, not before registration.

**§20.23 is the standing limitation here: personnel independence rests on declarations and
organisational confirmation, not on verifiable proof. The tooling checks the register's structure
only.**

## 11. Frame construction rules — REAL, VERIFIED (§5, closed)

- **Single frozen frame F**, complete and sufficient **before** the development commitment. One frame
  serves both stages: the held-out payload's `frame_hash` and `scan_sha256` must equal the
  development payload's, and its `registry_sha256` must equal the registered value.
- **No changes after the development commitment** — rows may never be added, removed, edited,
  re-identified or reclassified (CLI refusal before the held-out commitment; VOID at chain
  verification). This closes the protocol-003 outcome-dependent-frame-composition defect (§0.0.1).
- **Sufficiency rule (§5.7.2):** for each class, `E_c ≥ 2·Qmax_c + Dev_c`, that is
  **E ≥ 126 / 52 / 32** (fill-expected / abstention-expected / identity-hazard). If unmet, **no
  development commitment may be made**. A commitment to an insufficient frame is
  `STAGE_VOID_FRAME_INSUFFICIENT` — the slot is consumed and there is no retry. Enumeration is
  therefore **≥ 210 eligible admissible rows** before the development commitment (§20.22).
- **Admissibility A1–A6 tri-state; classes; held-out ineligibility CPG-C1(1)–(6); scan scope** — all
  closed at §5.1–§5.4, evaluated on the U1 evaluation tree.
- **Registry frozen at registration** for both stages (§5.3, §0.0.2), closing the registry-steering
  defect.
- **22 frame columns**, including `enumerated_by`, `enumerated_at` and `enumeration_source_url`;
  `frame_hash` is computed over all of them, so enumeration attribution is cryptographically bound to
  the committed frame.
- **Ordering (§5.5):** funding confirmed → checkpoint → **registration** → frame construction → scan →
  `check-frame-sufficiency` → development commitment. **The frame is built after registration**, so no
  frame content is a registration prerequisite.

## 12. Execution authorisation rules — REAL, VERIFIED (§6.5, closed)

- **Authorising artifact** `cpg-u1-execution-authorization/v1`, produced by `authorize-execution`,
  binds: the recomputed seal hash; both manifests as bound by the seal; the single frozen frame
  (development `frame_hash` = held-out `frame_hash`); and the **published seal record** — a public
  record linked to the registration on OSF, naming the seal hash, with a registry-issued timestamp.
  Its sha256 is recorded.
- **Window opens** at the registry-issued timestamp of the published seal record, which must be later
  than the held-out drand round's scheduled time. **Closes** when the single authorised run completes.
  **Exactly one run**; not restarted, resumed or repeated; a company without a response is INVALID.
- **Preview is prohibited** in any environment and through any entry point, including reading stored
  CPG output, for (a) held-out companies at any time before the authorised run starts or after it
  completes, (b) development companies before the development drand round's scheduled time, (c) any
  other frame company before the held-out drand round's scheduled time.
- **Detection** is mechanical over the supplied log only: `audit-execution-log` flags
  `STUDY_VOID_PREVIEW`, `STUDY_VOID_UNAUTHORIZED_EXECUTION`, `STUDY_VOID_REPEATED_EXECUTION`,
  `STUDY_VOID_POST_WINDOW_EXECUTION`; plus archive-timestamp comparison, stored-lookup exports and
  disclosure.
- **Technical prevention available:** the registered tooling runs no CPG; the harness must refuse
  held-out companies without a verified authorisation and must log every invocation. **This prevents
  previews through the harness only** — §20.20 declares that an unlogged private query in another
  environment cannot be disproved.
- **Consequence of a detected violation:** the study is **VOID, not flagged** — the finding is
  published, no endpoint is reported, nothing is repaired or replaced, and a restart requires a new
  registration citing this one.

## 13. Amendment rules — REAL, VERIFIED

- **Authority rule, verbatim in the record:** *"The earliest registration under the accountable
  identity with this study_id is authoritative; a second registration with different sampling fields,
  or a withdrawal, voids the study."* Enforced over the verifier-supplied identity listing by
  `checkAuthority` — earlier registration → not authoritative; duplicate with different sampling
  fields → VOID; withdrawal → VOID; **identical duplicates are ignored** (all exit 6; runs R9–R11).
- **Sampling fields** that may not differ: `protocol_sha256`, `tooling_aggregate_sha256`,
  `registry_sha256`, `network`, `outpoints`, `checkpoint`, `parameters`.
- **Protocol amendment path:** protocol-004 applies only the CPG-042 integrity amendments approved for
  CPG-043 (decision review sha256 `75a794a336c17bada920292cdd2035e49243ad2fbbe5788dc391eac04119ccd8`;
  CPG-040 amendment sha256 `03675db1ab2c72aaead25a43f40747762cf93ba95945632762ad20cc3743ed3f`).
  Corrections are **recorded, not silently fixed** (§0).
- **Re-pinning the evaluation tree is prohibited.** It is chosen before frame construction, frozen at
  registration, never advanced to track mainline, and never changed after any held-out result is seen
  — doing so is a §18.3 violation and voids the study. **A study of a later resolver is a new protocol
  version and a new registration.**
- **A restart after a VOID requires a new registration citing the voided one.** Nothing is repaired.

## 14. Halt rules — REAL, VERIFIED (§18)

**No sequential stopping.** Held-out executes once, in full; no interim look, no optional extension.
Six halt conditions:

1. the instrument check (§8.5) produces any fill;
2. the pilot yield is 0 (§5.6);
3. a protocol violation is found mid-run — e.g. a company admitted after execution began, a seal
   mismatch, or the operator having seen reference truth. **The run is void, not repaired**;
4. any production system is touched;
5. any §5.10 VOID state, a protocol or tooling hash ≠ registered, or a seed recomputed ≠ recorded;
6. a detected §6.5 violation (preview, unauthorised, repeated or post-window execution).

**Instrument note carried from the verifier recheck (property 7): exit code 3 (`HALT`) is declared in
the instrument but reachable from no code path.** The halt rules are enforced through VOID states
(exit 6) and refusals (exit 1). An outsider should not wait for exit 3.

## 15. Limitations — REAL, VERIFIED (§20, 23 items, verbatim scope)

1. Small, clustered, exploratory; no population, customer or jurisdiction generalisation.
2. Three fields only; six fields with declared authority are not requested by CPG.
3. Four accessible jurisdiction families; identity resolution under-tested elsewhere.
4. Wikidata evidence archived as adapter snapshots, not raw bytes.
5. Live-source drift: live re-runs are not byte-replicable.
6. Reference independence is bounded; SOURCE-COINCIDENT is published and capped.
7. User-vs-public conflict is structurally unmeasurable while `userClaims: []`.
8. **Rater availability unproven; without raters, Rung 2 at most.**
9. U1 exercises the resolver function, not the production deployment or its route.
10. A single-arm design cannot attribute reliability to grounding per se.
11. The development pilot's yield is optimistically biased; SAFETY mitigates but does not remove the
    INCONCLUSIVE risk.
12. The development-only registry's completeness rests on attestation H2, not a mechanical proof.
13. **Study-level grinding under other identities cannot be prevented or detected**; only
    registrations under the accountable identity count.
14. **Registry trust is institutional** — immutability, timestamps, listing and tombstones rest on
    OSF, not cryptography.
15. **drand threshold honesty is assumed**, and the correctness of the vendored BLS library
    (@noble/curves 1.9.7 contains changes after its 2024 audit of 1.6.0).
16. **Bitcoin finality is probabilistic**; a reorganisation deeper than 6 blocks before finality is
    re-evaluated, after finality it voids the study.
17. Tooling cannot prove non-spend, most-work status, source independence or drand unavailability
    from a bundle; outsiders confirm with a full node and ≥ 2 relays.
18. Cryptographic sampling integrity is **not** independent candidate selection; the latter rests on
    enumerator independence only.
19. The registration timestamp is off-chain; the tooling proves only that registration preceded the
    development drand round.
20. **No-preview protection is procedural and audit-based.** The protocol cannot prove that no
    unlogged private CPG query occurred in any environment.
21. Execution start time is chosen by the operator after the window opens.
22. Frame enumeration is larger (≥ 210 eligible admissible rows before the development commitment).
23. **Personnel independence rests on declarations and organisational confirmation, not on verifiable
    proof.** The tooling checks the register's structure only.

**Additional limitations established by this stream, not yet in §20** (they belong in the package
because an outsider following §21 would otherwise not know them): the eight residual verifier defects
listed in §3 of `VERIFIER_INTEGRITY_RECHECK.md` — in particular that a plausible wrong
`provider_configuration_sha256` passes `verify-registration` with exit 0, that non-`SYNTHETIC`
placeholder identities pass with exit 0, and that DR-12 lets the reported blocker count understate the
true one by up to five.

## 16. Outsider-verification instructions — REAL, VERIFIED (§21, 10 steps)

1. Resolve the registration's persistent identifier on OSF; confirm public, unembargoed, registry
   timestamp; **list the accountable identity's registrations for `CPG-U1-2026-01` and export them as
   the identity-registration list.**
2. `verify-protocol` and `verify-registration` (protocol, tooling aggregate and registry hashes;
   authority; completeness) — with `--evidence` to check funding against the checkpoint.
3. Fetch headers from **two independent sources** from a retarget boundary ≤ checkpoint to the tip;
   `verify-archive`.
4. Confirm with a **full node** that the commitment transactions are the spends of `O_dev` / `O_ho`
   (or that the outpoints are unspent).
5. Fetch drand rounds `R_dev`, `R_ho` from **≥ 2 relays**.
6. `verify-sampling --stage development`, then `--stage held-out` with the published sampling records
   as `--prior-final`.
7. Confirm `registration_timestamp` precedes the development commitment block (the tooling enforces
   only "precedes `R_dev`").
8. Recompute both draws with `draw-development` / `draw-held-out` on the archived frame, scan, pilot
   and sizing; compare manifests and seed fingerprints.
9. Verify frame sufficiency on the committed frame and scan (`check-frame-sufficiency`); confirm both
   payloads carry the same frame and scan hashes and the registered registry hash.
10. After the seal: verify the published seal record, recompute the execution authorisation
    (`authorize-execution`), audit the execution log (`audit-execution-log`), and recompute rater
    orders (`verify-rater-order`) and adjudication packets (`verify-adjudication-packet`).

**Additions an outsider needs that §21 does not state**, established by this stream:

- **Run `verify-evaluation-tree` separately.** §21 step 2 does not cover the evaluation-tree identity;
  `verify-registration` never checks it (property 5d).
- **Re-derive `provider_configuration_sha256` yourself** from the two named files at the evaluation
  tree and compare with the registered value by hand (property 6).
- **Read exit codes as: 0 = pass, 1 = refused *or* unreadable input, 4 = blocked, 6 = VOID.** Exit 3
  never occurs. A record carrying both errors and blockers exits **1**, not 4.
- **Set both `CPG_U1_TOOLING` and `CPG_U1_INSTRUMENT`** when running the two packet validators; with
  `CPG_U1_INSTRUMENT` unset, the reference-packet validator runs on inlined constants and is not
  cross-checked against the instrument.

---

## Tally

| | Items |
|---|---|
| **Entirely real and verified (12)** | 1 protocol · 2 tooling (candidate) · 4 evaluation tree · 5 registry · 6 provider configuration · 8 endpoints · 11 frame rules · 12 execution authorisation · 13 amendment rules · 14 halt rules · 15 limitations · 16 outsider verification |
| **Mixed — real rules + named external leaves (4)** | 3 treatment (`asOf`) · 7 randomness (2 outpoints, 2 checkpoint fields, relay/header endpoints) · 9 personnel (8 identities + operator) · 10 declarations (§4A.1 declarations, no-preview declaration) |
| **Entirely external (0)** | — |

The **eleven external registration-record leaves** are in items 3 and 7 and are enumerated
individually in `EXTERNAL_LEAVES.md`. Every one carries the literal sentinel `UNASSIGNED`.

---

## What is still missing before registration

**The candidate is NOT registration-ready.** The directive is explicit that passing these preparations
does not make it ready. Missing, in the order it blocks:

1. **The 404-mutant certification run is in flight.** Until it completes with every mutant killed, the
   tooling identity is **CANDIDATE, CERTIFICATION PENDING** and no registration may name the aggregate
   `638d68e6…78fd2`.
2. **All eleven external leaves are UNASSIGNED** — five owner-supplied, two OSF-issued, four
   Bitcoin-generated. The verifier reports exit 4 with ten blockers and will not invent any of them.
3. **DR-12 is not fixed.** While it stands, the blocker count a preparer sees can understate the truth
   by up to five, and the five suppressible fields are exactly the five human identity leaves.
4. **Two substantive exit-0 gaps are open** (verifier properties 2 and 6): a non-`SYNTHETIC`
   placeholder identity and a plausible wrong `provider_configuration_sha256` both pass with exit 0.
   Either could carry a wrong registration past verification.
5. **`provider_configuration_sha256` is derived but not yet written into a record**, and the verifier
   will not check it once written.
6. **The personnel register does not exist.** Eight persons (7 roles + Enumerator B) plus the operator
   are UNASSIGNED; `check-personnel` returns exit 4 with seven unfilled roles. Independence
   declarations and organisation confirmations are absent.
7. **The §19.3 verification prerequisites are not in place**: two independent Bitcoin header sources
   (or an own full node), ≥ 2 named drand relays, a certenv with a fixture tenant, the recording
   fetcher, the recording Wikidata lookup and the replay harness.
8. **Funding has not happened.** No key, no outputs, no confirmations, no checkpoint — and nothing in
   this stream created or broadcast anything.
9. **`RATING_PACKET_VALIDATOR.mjs` still names the previous tooling** (593 files,
   `f7699f05…e5cc5dd`). It must be updated to the certified aggregate before outsiders use it.
10. **The frame does not exist** — correctly so: §5.5 puts frame construction *after* registration. It
    is listed here only to record that its absence is not a registration blocker.
