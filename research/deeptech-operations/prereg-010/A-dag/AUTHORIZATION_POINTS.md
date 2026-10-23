# AUTHORIZATION_POINTS

DEEPTECH-PARALLEL-010 · STREAM A. Companion to `REGISTRATION_TO_EXECUTION_DAG.md` and
`IRREVERSIBILITY_MAP.md`.

**NOT EVIDENCE.** No person has been named, appointed, engaged, paid or asked to attest to anything. No
declaration has been signed, no register exists, no fingerprint has been published. Every role below is
**UNASSIGNED**. This document records what the frozen protocol requires a human to do and to attest, read from
`C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md` and from `C:/tmp/dt009-merge/tooling`. It creates no
identity and asserts no external value.

Status: **VERIFIED** = read with citation · **PREPARED** = synthesis · **EXTERNAL INPUT REQUIRED** = a human,
registry, chain or relay must supply it and nothing in the protocol or instrument can.

## 0. The cast — §4A.3

Eight roles. **Seven independent, mutually exclusive persons, plus the operator, who holds no independent role.**

| Role | Independent? | Named? | Tooling constant |
|---|---|---|---|
| operator (key custodian, `STUDY_OPERATOR`) | **No** — explicitly "not independent" | **UNASSIGNED** (§19.1, §19.3(2)) | `reg.operator.person_id`, `bitcoin_key_custodian.role` |
| enumerator (≥ 1) | Yes | UNASSIGNED | `'enumerator'` |
| reference Author | Yes | UNASSIGNED | `'reference-author'` |
| reference Confirmer | Yes | UNASSIGNED | `'reference-confirmer'` |
| reference adjudicator | Yes | UNASSIGNED | `'reference-adjudicator'` |
| rater 1 | Yes | UNASSIGNED | `'rater-1'` |
| rater 2 | Yes | UNASSIGNED | `'rater-2'` |
| rating adjudicator | Yes | UNASSIGNED | `'rating-adjudicator'` |

`lib/personnel.mjs:6`:
`INDEPENDENT_ROLES = ['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator', 'rater-1', 'rater-2', 'rating-adjudicator']`.
**VERIFIED.**

Enforced structurally by `checkPersonnelRegister` (`lib/personnel.mjs:16–43`):
- each role unfilled → a **blocker** (`role <x> is UNFILLED`), and `check-personnel` exits **4**
  (`cpg_u1_data.mjs:755`);
- every non-enumerator role held by exactly one person;
- `ROLE COLLISION` if a person holds two roles, or if the person is the operator;
- all seven `DECLARATION_KEYS` must read exactly `"no"`;
- `organisation_confirmation_sha256` required (64 hex); `study_fee_agreement_sha256` 64 hex **or null**.

**What the tooling cannot do, stated by the tooling:** "It cannot verify that declarations are true"
(`lib/personnel.mjs:1–3`; §4A.3; §20.23). **VERIFIED.**

There is also a ninth human who is not a §4A role: the **accountable identity**, bound to the OSF account with
a persistent identifier (§5.5.1). The protocol does not say it must be a natural person or that it must be
independent. In practice it is the party that can be held to the registration, and §5.5.1's Evidence rule makes
it the sole basis on which anything may be reported as CPG U1 evidence. **PREPARED.**

## 1. The authorization points, in sequence

Eleven points where a human must act, plus two standing attestations already given.

---

### A1 — Name the accountable identity and its persistent identifier

- **Step:** before S03 (registration). §19.3(1): "**before registration**."
- **Who:** the accountable party itself, plus whoever administers the OSF account.
- **What they attest:** that this identity is accountable for the study, that it is bound to the OSF account,
  and that the persistent identifier (type and value recorded) resolves to it.
- **Mechanism:** both are **UNASSIGNED in this document and in the tooling template**; "the tooling refuses to
  proceed while either is UNASSIGNED (**exit 4**)" (§5.5.1 Identity row). Measured blockers:
  `Accountable OSF identity is UNASSIGNED (accountable_identity.value)`,
  `Persistent identifier type is UNASSIGNED`, `Persistent identifier is UNASSIGNED`
  (`lib/registration.mjs:99–101`). A `SYNTHETIC` value is refused outside test mode
  (`lib/registration.mjs:69–72`).
- **Consequence of the act:** it becomes the study's authority anchor. §5.5.1 Authority: the **earliest**
  registration under this identity with `study_id = CPG-U1-2026-01` is authoritative; a second one with
  different sampling fields, or a withdrawal, **voids the study**. §20.13 concedes that parallel registrations
  under *other* identities can be neither prevented nor detected — only this identity counts.
- **Status:** VERIFIED (requirement) · **EXTERNAL INPUT REQUIRED** (the naming).

---

### A2 — Name the Bitcoin wallet-key custodian (role `STUDY_OPERATOR`)

- **Step:** before funding (S02a). §19.3(2): "**before funding**."
- **Who:** one named person, CPG-040 §3.2 preserved. This person is **not independent** and may hold **no**
  §4A.3 role.
- **What they attest:** custody of the keys to `O_dev` and `O_ho`, and — implicitly, by §5.5.2 — that custody
  "cannot buy a second draw", because each outpoint can be spent once.
- **Mechanism:** `check-funding-prerequisites` is BLOCKED until named (§5.5.2). Measured: at
  `phase: 'funding'` the template yields exactly **1 blocker**,
  `Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)`. `bitcoin_key_custodian.role` must
  be exactly `STUDY_OPERATOR` or it is an **error**, not a blocker (`lib/registration.mjs:90`).
- **Consequence:** loss of the key means the stage cannot start → abandonment (§5.10 `STUDY_ABANDONED`), and a
  restart needs a new registration citing this one.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A3 — Create the funding outputs and choose the checkpoint

- **Step:** S02a, between A2 and S03.
- **Who:** the custodian, entirely outside the tooling — "The tooling creates **no wallet, no key, no
  transaction**" (§5.5.2), repeated at `lib/registration.mjs:1–3` and `cpg_u1_data.mjs:318`.
- **What they attest:** that `O_dev` and `O_ho` are **distinct single-signature P2WPKH** outputs, each funding
  transaction with **≥ D = 6 confirmations at the checkpoint** (`funding_height + 6 − 1 ≤ checkpoint_height`),
  and that neither outpoint was spent at or before the checkpoint.
- **Mechanism:** enforced at verification, not at creation. `verify-registration --evidence` fails on
  `STUDY_VOID_REGISTRATION` or `STUDY_VOID_PRE_REGISTRATION_SPEND` with exit 6 (`cpg_u1_data.mjs:337–340`);
  `lib/sampling.mjs:130` returns `VOID_PRE_REGISTRATION_SPEND` for a spend at or before the checkpoint. The
  registration refuses identical outpoints as an **error** (`lib/registration.mjs:113`).
- **Consequence:** irreversible. Two slots, two draws, no more.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A4 — Choose `as_of` and compute the provider configuration hash

- **Step:** before S03. §19.1: "computed / chosen **before** registration."
- **Who:** the operator, with the resolver clone.
- **What they attest:** one frozen ISO-8601 UTC timestamp for the **whole held-out run** (§7 `asOf` row), and
  the provider configuration hash over exactly two files of the evaluation tree —
  `backend/services/companyProfile/grounding/registry/builtins.ts` and `…/coverageInventory.ts` —
  domain-separated: `sha256(['cpg-u1-provider-config/v1', file, hash, file, hash].join('|'))`
  (`lib/harness.mjs:17–23`).
- **Mechanism:** two of the ten measured blockers:
  `as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)` and
  `provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before registration)`
  (`lib/registration.mjs:115–118`). Format enforced: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.
- **Note:** this is a human *choice* with analytic consequences — `as_of` sets the §10.2 24-month temporal
  window (whose arithmetic is AD-5, `CALENDAR_MONTHS`) and therefore which reference records become
  REFERENCE-STALE. Choosing it before registration is what stops it being chosen afterwards.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A5 — Publish the registration (the freeze)

- **Step:** S03.
- **Who:** the accountable identity, on **OSF Registries**, **public**, **no embargo**.
- **What they attest:** the whole §5.5.1 Content list — `study_id`, `protocol_version`, `protocol_sha256`,
  **`tooling_aggregate_sha256`**, `registry_sha256`, registry settings, accountable identity, persistent
  identifier, key custodian, network `bitcoin-mainnet`, `O_dev`, `O_ho`, checkpoint, the pinned parameter set,
  the authority rule and the §21 verification procedure — and, by the `authority_rule` text the template
  carries, that a second registration with different sampling fields or a withdrawal voids the study
  (`lib/registration.mjs:53`).
- **Mechanism:** `registry.name` must be `OSF Registries`, `registry.public` must be `true`,
  `registry.embargo` must be `false`, each an **error** if not (`lib/registration.mjs:96–98`).
  `registration_id` and `registration_timestamp` are **registry-issued** and, per §5.5.1, "never asserted by
  the operator" — they are blockers, not fields the operator fills.
- **Consequence:** one-way door #1 closes. See `IRREVERSIBILITY_MAP.md` §1.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A6 — Seven independent persons sign §4A.1 declarations

- **Step:** before their respective stage. §19.3(3): "enumerator(s), reference Author, Confirmer and
  adjudicator, ≥ 2 raters and a rating adjudicator — **before the respective stage** (or a recorded absence of
  raters with the §12 ceiling). Seven mutually exclusive independent persons."
- **Who:** each of the seven, individually.
- **What each attests — "no" to all of these** (`lib/personnel.mjs:8–12`, mapping §4A.1 items 1–4 and 6 and
  §4A.2 (a)–(b)):
  1. `employed_by_developing_organisation`
  2. `contract_or_work_for_developing_organisation`
  3. `payment_other_than_study_fee`
  4. `financial_interest_in_developing_organisation`
  5. `close_relationship_with_developer_operator_or_role_holder` — spouse/partner, family, household member of,
     or a current or former direct reporting relationship with, any person who developed CPG, the operator, or
     any other role holder
  6. `implemented_cpg_protocol_tooling_or_registry`
  7. `ran_or_saw_cpg_output`
- **Exclusion period:** from the developing organisation's first product repository commit until publication of
  this study's results (§4A.1).
- **Also recorded per person:** the fee-agreement SHA-256 or none — the fee must be **fixed, agreed in writing
  before any role material is released, and not contingent on any result, finding or future engagement**
  (§4A.1 item 5) — and **the developing organisation's written confirmation that its records show no item 1–4
  relationship**, as `organisation_confirmation_sha256`.
- **"An unknown answer is not 'no'"** (§4A.1). The tooling enforces literal `"no"`
  (`lib/personnel.mjs:39`).
- **Consequence of a false declaration, published:** rater work → the §12 UNADJUDICATED consequences; enumerator
  work → "the frame is not independent (§20.18)"; reference work → "the reference truth is not independent."
  §4A.1 closes: "These are **procedural evidence, not proof**… This is a methodological rule; it is not a legal
  determination."
- **Additional enumerator-specific attestation (§4A.2):** not having implemented CPG, the protocol, the tooling
  or the development-only registry; **not having run CPG or seen any CPG output — including the development
  pilot and instrument check — before completing the frame**; not being the operator; holding no other role.
  Enumerators receive only public sources, the frame template, §4A and §5.1–§5.4, the jurisdiction-family list
  and the development-only registry; they **never** receive pilot results, sizing output, quotas or any CPG
  output.
- **Enforcement point in the pipeline:** `frame` refuses with
  `ENUMERATION_ATTRIBUTION_REFUSED` unless every row names a registered eligible enumerator, and
  `enumerated_by` is inside `frame_hash` (`cpg_u1_data.mjs:220–224`).
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED** (seven persons, seven declarations, seven organisational
  confirmations, up to seven fee agreements).

---

### A7 — Broadcast the development commitment

- **Step:** S07b.
- **Who:** the custodian.
- **What they attest by acting:** that the frame is **complete and sufficient** (§5.5 "Complete before the
  development commitment"; §5.7.2 `E ≥ 126 / 52 / 32`), that the scan was run at the frozen resolver SHA on a
  clean clone, and that the payload they are committing is the one they will publish.
- **Mechanism:** the act is a Bitcoin spend of `O_dev` with exactly one OP_RETURN of script `6a 27` + 39 bytes
  = `"CPGU1" ‖ 01 ‖ 44 ‖ digest`. Nothing in the tooling can perform it, and nothing can undo it. A commitment
  to an insufficient frame is `STAGE_VOID_FRAME_INSUFFICIENT` — the slot is consumed.
- **Why this is an authorization point and not a mechanical step:** §5.7.2 gives the operator a standing
  instruction to *not* commit ("If unmet, no development commitment may be made; enumeration continues
  first"), and §5.5 gives the frame's completeness as a judgement the enumerators make. The broadcast is where
  a human decides those judgements are done.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A8 — Publish the rater / rating-adjudicator assignment fingerprint

- **Step:** S12, and its **publication must precede S13b**, the held-out broadcast.
- **Who:** the personnel-register holder publishes the fingerprint; the three named persons accept the labels
  `rater-1`, `rater-2`, `rating-adjudicator`.
- **What is attested:** that these three specific people hold these three specific labels, fixed **before** the
  presentation order becomes knowable. §12.1 "Remaining discretion removed procedurally: The person-to-label
  assignment is fixed and fingerprinted before the held-out commitment (§4A.3)."
- **Mechanism:** §4A.3 final paragraph — "its SHA-256 fingerprint is published, **before the held-out
  commitment transaction is broadcast** (§12.1)". `rater-assignment-fingerprint` prints the same instruction
  verbatim: "Publish this fingerprint BEFORE the held-out commitment transaction is broadcast (§4A.3). The
  assignment itself stays restricted until rating completes" (`cpg_u1_data.mjs:986–987`).
  `fingerprint = sha256(canonicalJson(assignment))` over exactly
  `{schema, study_id, registration_id, assignments, nonce}` with a mandatory 256-bit nonce
  (`lib/assignment.mjs:16, 30, 52`). Three different people enforced (`lib/assignment.mjs:36`); each must hold
  exactly that role in the register (`lib/assignment.mjs:44–47`).
- **Why the order matters:** the presentation order derives from `ho_record_sha256`, which "cannot be known
  before the held-out drand round exists" (§12.1). If the assignment were published after the held-out
  commitment, someone could learn the order first and then choose who rates under it. The fingerprint is the
  only thing that forecloses this, and its timing is the only thing that makes the fingerprint meaningful.
- **The gap, stated by the tooling itself:** "The tooling **cannot check WHEN** the fingerprint was published —
  that is the publication record's timestamp (procedural) — only that the artifact matches it"
  (`lib/assignment.mjs:5–6`). So A8 is a **procedurally-enforced** authorization point with no mechanical
  guard. It is the weakest-guarded of the eleven.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A9 — Broadcast the held-out commitment

- **Step:** S13b.
- **Who:** the custodian.
- **What they attest by acting:** same frame, same scan, registered registry; the binding names the correct
  development txid, digest, manifest, pilot, sizing and append-only proof; and **A8 has already been
  published**.
- **Mechanism:** spend `O_ho` once, stage byte `48`, **after development finality** (`height > H_rand_dev + 6`).
  Six distinct `VOID_BINDING` checks at `lib/sampling.mjs:151–157`; five more comparing the committed binding
  to the supplied artefacts at `cpg_u1_data.mjs:533–541`.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A10 — Blind reference adjudication

- **Step:** S17, after both blind record sets, **before `seal`** (§9.2.1 Timing).
- **Who:** the **reference adjudicator** — a third independent person who may hold no other §4A.3 role,
  **including enumerator**. §4A.3 gives the reason explicitly: "The adjudicator decides contested reference
  values, and the enumerator authored the class predictions whose mismatches with reference truth are published
  (§9.2, §9.7)."
- **What they attest:** for each disagreeing company × field, one of `RECORD_1`, `RECORD_2`,
  `REFERENCE-CONFLICT` — a choice **between the two records only**. §9.5: the adjudicator "**cannot supply a
  third value**".
- **What they must not have received** (§9.2.1): any CPG output including pilot and instrument check; class
  predictions, identity-hazard notes, stratum or split; screening logs, attestations or contamination bases;
  agreeing records; the identities or pseudonyms of Author and Confirmer; any count or tally of adjudication
  outcomes.
- **Mechanism:** the packet is built deterministically and verified by rebuilding —
  `verify-adjudication-packet` refuses "any added information, extra or agreeing item, reordering or
  reassignment". Record 1 is the Author's iff the first hex digit of
  `order_key("reference-adjudicator-record-1", candidate_id, field)` is even; items appear in
  `order_key("reference-adjudicator", …)` order. `seal` refuses an `--adjudication` that is not the mechanical
  resolution of the blind decisions, and refuses an adjudication "typed by role name (AUTHOR/CONFIRMER) without
  a blind packet" (`cpg_u1_data.mjs:578–603`).
- **Two upstream attestations this depends on (A6a, A6b, not separately numbered):** the **reference Author**
  and the **reference Confirmer** each attest `constructed_without_cpg = yes` on every record
  (§9.3), and that they did not communicate before both had submitted (§9.1). Both receive only company name,
  canonical domain, jurisdiction family, decisive identifier, the three field definitions, the §9.3 formats and
  the §9.4 authority table — never CPG output, each other's records, or the class prediction.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A11 — Publish the seal record (opens the execution window)

- **Step:** S21.
- **Who:** the accountable identity, on OSF Registries, **linked to the registration**.
- **What they attest:** that this `seal_hash` is the seal of this study's sealed dataset, timestamped by the
  registry. §9.6: "**The seal hash is published (timestamped) before held-out execution.**"
- **Mechanism:** §6.5 "Authorising artifact" requires "the **published seal record**: a public record linked to
  the registration on OSF Registries, naming the seal hash, with a registry-issued timestamp".
  `buildAuthorization` requires `sealPublication.seal_hash === sealHash`, a non-empty `record_id`, a valid ISO
  `registry_timestamp`, and refuses a timestamp earlier than the held-out drand round's scheduled time —
  "seal published before the held-out draw could exist" (`lib/execution.mjs:84–89`).
  `window_opens_at` is set to that registry timestamp (`lib/execution.mjs:79`).
- **Consequence:** the window opens. §15.5(6) makes a seal-hash mismatch, or execution beginning before
  publication, run-level INCONCLUSIVE.
- **Note on the trust basis:** this is an **institutional** guarantee. §20.14: "Registry trust is
  institutional: immutability, timestamps, public listing and tombstones rest on OSF, not cryptography." The
  one moment that gates the study's only observation is timestamped by a third party, not by a chain.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A12 — The operator's no-preview declaration, and starting the single run

- **Step:** S23.
- **Who:** the operator, alone. Nobody else can start the run and nobody else signs the declaration.
- **What they attest — the signed no-preview declaration** (§6.5 "Evidence retained"), covering **the period
  from frame completion to run completion**, that no execution of CPG in **any** environment (production,
  staging, certenv, local, harness) through **any** entry point, and no reading of stored CPG output (logs,
  persisted results), occurred where the input identified a company in F by identifier, name or domain, when
  performed by study personnel, the developing organisation's staff, or anyone at their direction — except as
  §6.5(b) permits for development companies after the development drand round.
- **What else they must retain:** the execution authorisation; the execution log of **every** CPG invocation by
  the U1 harness in `cpg-u1-execution-log/v1` form; the recording-fetcher archive; **where the deployment
  stores CPG lookups or results, an export of records for the frame's companies over that period, made where
  possible by someone other than the operator**; and the `audit-execution-log` output.
- **The discretion they hold:** the start time. §6.5 "Start time": "The operator chooses when to start after
  the window opens. No held-out outcome information exists without a preview, so this choice cannot use
  outcomes. Public source-availability information remains observable (§20.21)." This is the one substantive
  free choice left in the sequence, and the protocol concedes in §20.21 that it is not fully neutral.
- **Mechanism:** `runHeldOut` refuses without a verified authorization (`AUTHORIZATION_MISSING`), refuses an
  altered or unbuildable one, refuses before the window opens (classified `PREVIEW_ATTEMPT` if any requested id
  is held-out), refuses a second start (`RESTART_REFUSED`), refuses after closure (`WINDOW_CLOSED`), and
  refuses a candidate set that is not exactly the authorized one. Every attempt, executed or refused, is
  appended to the hash-chained event log (`lib/harness.mjs:118–127, 155–196`).
- **Consequence:** one-way door #3. A detected preview, unauthorised, repeated or post-window execution makes
  the **study VOID**, not flagged: the finding is published, no endpoint is reported, nothing is repaired or
  replaced, a restart requires a new registration citing this one (§6.5 Consequence; §18.6).
- **The limit:** §6.5 and §20.20 — "**Nothing in this protocol can prove that an unlogged private query did not
  occur** in another environment. Protection against that is procedural (declaration, restricted access) and
  audit-based (exports, archives)." A12 is therefore the point where the study's central integrity claim rests
  most heavily on one person's signature.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

### A13 — The two raters rate; the rating adjudicator resolves

- **Step:** S26 and S29.
- **Who:** `rater-1`, `rater-2`, and the `rating-adjudicator` — the three persons the **A8 fingerprint** names.
- **What the raters attest:** a label from the seven-value categorical scale per item, applied by the §10.1
  procedure with the §10.2 rules, from their own packet only. They are blind to each other's labels, to running
  tallies and aggregates, and to the development pilot (§12). Missing ratings are `pending` — "never imputed,
  never scored".
- **What the rating adjudicator attests:** `LABEL_A`, `LABEL_B` or `REFERENCE-AMBIGUOUS` per disagreeing item,
  never knowing which rater gave which label, rater identities, other observations' labels, tallies, aggregates
  or provisional endpoint values, class prediction, stratum, split, hazard note, pilot output, or **the number
  of disagreements** (§12.2).
- **Mechanism:** `ingest-ratings` refuses unless the packet is byte-identical to the deterministic rebuild
  **and** `assignedPerson(assignment, published_fingerprint, label)` matches; sheets record `rated_by` and
  `assignment_fingerprint`; `ratingInputs` refuses a sheet "not rated by the person the published assignment
  names" (`cpg_u1_data.mjs:1024–1029`); `resolve-rating-adjudication` and `analyze` both refuse a resolution not
  made by the assigned adjudicator (`cpg_u1_data.mjs:1044`, 1075).
- **The escape hatch, and its price:** §12 — "**If independent raters are unavailable:** execution may occur,
  but every primary endpoint is labelled **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and
  **no claim of independent validation may be made.** The protocol is not weakened to accommodate
  unavailability." §19.3(3) allows "a recorded absence of raters with the §12 ceiling". §20.8 lists rater
  availability as unproven.
- **Status:** VERIFIED · **EXTERNAL INPUT REQUIRED**.

---

## 2. Standing authorizations already given (§19.2) — no further human act required

| ID | Item | Status per §19.2 | Where it binds |
|---|---|---|---|
| **H1** | CAP 60 fill-expected held-out companies (→ at most 60/25/15 = 100 held-out companies) | **Approved**, verbatim in the CPG-037 record | §5.6 CAP row; `lib/sizing.mjs`; `lib/frame.mjs`'s derived Qmax |
| **H2** | Development-only registry complete to the best of knowledge | **Confirmed**, verbatim in the CPG-037 record | §5.3; `rules/development_only_registry.json`; §20.12 notes it "rests on an attestation, not on a mechanical proof" |
| **H3** | Seed custodian | **Superseded** by U1/U2/U3 (§0.1) — there is no seed custodian | §12.1 "No seed and no custodian exist" |
| **U1** | OSF, public, no embargo, accountable identity + persistent identifier | **Approved**; identity **not named** | §5.5.1 |
| **U2** | Two single-use outputs, D = 6, K = 12, 180-day abandonment, VOID rules | **Approved**; custodian **not named** | §5.5.2, §5.5.3, §5.10 |
| **U3** | Model B, Δ = 3 h, 30-day expiry, pinned verifiable BLS | **Approved** | §5.7.1 |
| **CPG-042 A-1…A-6, B-1, B-2, X-1** | Personnel independence and blinding, single frozen frame, registry freeze, execution window / no-preview | **Approved for CPG-043**; implemented in protocol-004 and tooling v4 | §4A, §5.3, §5.5, §5.7.2, §6.5, §9.2.1, §12.1, §12.2 |

**Also standing, and worth naming as a de facto authorization:** the nine methodological decisions
**AD-1…AD-9** in `rules/analysis_decisions.json` carry the status "**DECIDED** — the values below are
owner-approved methodological decisions, recorded before registration. Protocol-004 does not define them and
the tooling does not choose them." Because that file is inside the tooling aggregate, publishing the
registration (A5) **is** the act that freezes those nine choices. Whoever performs A5 is authorizing them.
**VERIFIED** (the file) · **PREPARED** (the characterisation as an authorization point).

## 3. Points where no human may act — recorded because they look like authorization points and are not

| Looks like a choice | It is not | Citation |
|---|---|---|
| The seed | "**No person supplies randomness.**" The tooling has no seed argument and refuses caller-chosen rounds [enforced]. The seed is derived inside the draw commands; only `seed_fingerprint` is recorded | §5.5; `cpg_u1_data.mjs:423–431` |
| The drand round | Fixed by the round rule: the first round scheduled ≥ `MTP(H_rand+6) + 10800 s`. **"no verifiable round 30 days after R's scheduled time → study VOID (no substitute round)"** | §5.7.1 |
| The randomness block | `H_rand = H_commit + 12`, fixed by the commitment | §5.7.1 |
| The presentation orders | Derived, not seeded, from `ho_record_sha256` | §12.1 |
| Record 1 / Record 2 and Label A / Label B positions | Derived from `order_key` parity | §9.2.1, §12.2 |
| The held-out quotas | A pre-registered deterministic function of the pilot, "fixed now and applied before the held-out draw" | §5.6 |
| The frame minimum 126/52/32 | Derived by evaluating the frozen sizing rule on all 4096 permitted pilot outcomes, not typed in | §5.7.2(9); `lib/frame.mjs:26–36` |
| `registration_id`, `registration_timestamp` | Registry-issued, "**never asserted by the operator**" | §5.5.1 |
| Reference values, after CPG output is seen | Sealed first and never visible to the operator; "The operator therefore cannot choose reference values after seeing CPG output" | §9.6 |
| Replacing a drawn company | Never. "A drawn company is **never replaced**" | §5.9 |
| Excluding an unfavourable observation | "**No observation may be excluded because its result is unfavourable.**" Exclusion rules may not change after any held-out result is seen | §15.2 |
| Selecting cited URLs | "**Post-hoc favourable selection is prohibited** and would be a protocol violation (§18.3)" | §12.3 |
| Any analysis decision at analysis time | `analyze` refuses a `--decisions` file other than the pinned `rules/analysis_decisions.json` outside this study's synthetic-test registration, and exits 4 on any `UNDECIDED` value | `cpg_u1_data.mjs:1078–1084` |

## 4. Readiness — the eleven points and what is missing

| # | Authorization point | Blocking state now |
|---|---|---|
| A1 | Accountable identity + persistent identifier | **UNASSIGNED** — 3 of the 10 measured `verify-registration` blockers |
| A2 | Bitcoin key custodian | **UNASSIGNED** — 1 blocker, and the only blocker at `phase: 'funding'` |
| A3 | Funding outputs + checkpoint | **UNASSIGNED** — 2 blockers (outpoints, checkpoint) |
| A4 | `as_of` + provider configuration hash | **UNASSIGNED** — 2 blockers |
| A5 | Registration published | **not done** — `registration_id`, `registration_timestamp` are 2 blockers, registry-issued |
| A6 | Seven signed declarations | **no register exists**; `check-personnel` would exit 4 with 7 `role … is UNFILLED` blockers |
| A7 | Development broadcast | blocked by A1–A6 and by the absence of a frame |
| A8 | Assignment fingerprint published | blocked by A6; **no mechanical guard on its timing** |
| A9 | Held-out broadcast | blocked by A7, A8 |
| A10 | Blind reference adjudication | blocked by A6, A9 |
| A11 | Seal record published | blocked by A10 |
| A12 | No-preview declaration + start the run | blocked by A11 |
| A13 | Rating + rating adjudication | blocked by A8, A12 |

**Measured:** `checkRegistration(registrationTemplate(...), {phase:'registered'})` on the candidate instrument
returns **0 errors and 10 blockers**; `reportRegistrationCheck` then exits with `EXIT.BLOCKED = 4`
(`cpg_u1_data.mjs:50, 163–168`). The briefing states nine. See `REGISTRATION_TO_EXECUTION_DAG.md` §5 C-1 for
the two readings that reconcile to nine; I do not choose between them.

## 5. Not evidence

No person is named anywhere in this document, and none has been approached. No declaration, fee agreement,
organisational confirmation, personnel register, assignment artifact, fingerprint, seal record or no-preview
declaration exists. Every authorization point above is **open**.
