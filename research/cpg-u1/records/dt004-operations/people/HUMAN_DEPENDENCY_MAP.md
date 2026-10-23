# CPG-U1 — Human dependency map (personnel, reference truth, rating)

**Classification: PREPARATION.** Collects every human dependency named in the other documents in this
directory and classifies it. Nothing here has been executed; no person exists in any register.

- Protocol: `CPG_U1_PROTOCOL_004.md`, sha256 `c50fc680…df00b719`.
- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd` (VERIFIED by recomputation).

## Classification scheme

| Class | Meaning | Operator's leverage |
|---|---|---|
| **H0** | **Automatable.** A machine does it, deterministically, and the result is rebuildable and checkable by an outsider. | Full — just run it. |
| **H1** | **Everything is prepared; the human only signs or answers.** The form, the packet, the command and the format exist; the human contributes a signature or an answer. | High — remove every excuse for delay; nothing but the answer is missing. |
| **H2** | **The protocol requires a human act or judgement.** It cannot be automated without changing the protocol, but the *person's independence is not itself the claim*. | Low — can be scheduled and prepared, never performed by the operator's tooling. |
| **H3** | **The human's independence is itself the evidence.** Substituting anyone inside the developing organisation — or any AI — destroys the property being claimed, and the protocol says so with a named published consequence. | None — the study is blocked until real independent people exist. |

**Rule applying to every H2 and H3 row:** the human is a **real, independent person**. No AI system,
language model or agent may stand in as enumerator, reference Author, reference Confirmer, reference
adjudicator, rater or rating adjudicator, or produce, draft, suggest or check the work such a role
returns. The preparer of these documents is an AI and holds **no** role.

---

## 1. Personnel and independence (§4A)

| # | Dependency | Class | Evidence / enforcement | Consequence if substituted |
|---|---|---|---|---|
| P-1 | Seven **distinct independent persons** exist and accept roles (minimum 7 + operator = 8 people) | **H3** | §4A.3; `check-personnel` exits **4** naming each `UNFILLED` role | Study cannot proceed past `check-personnel`; roles cannot be merged |
| P-2 | Each person answers the seven `DECLARATION_KEYS` and signs | **H1** (collect) / **H3** (truth) | §4A.1; `INDEPENDENCE_DECLARATION_TEMPLATE.md`; `lib/personnel.mjs:37` requires each = `"no"` | False declaration → work published as non-independent (§4A.1: rater → §12 UNADJUDICATED; enumerator → frame non-independent §20.18; reference → reference truth non-independent) |
| P-3 | Fixed fee agreed **in writing before any role material is released**, not contingent on any result | **H1** (draft) / **H2** (the signing) | §4A.1 item 5; `study_fee_agreement_sha256` (64 hex or `null`) | A contingent or post-hoc fee destroys independence |
| P-4 | Developing organisation issues a written **no-relationship confirmation** per person | **H2** | §4A.1; `organisation_confirmation_sha256` **required**, never `null` | `check-personnel` exit 1 |
| P-5 | Pseudonym assignment and custody of the restricted name mapping | **H1** | `person_id` matches `[A-Za-z0-9_-]{1,64}`; real names never in study artifacts | Identity leakage into artifacts |
| P-6 | Personnel register assembled from collected inputs | **H0** | `cpg-u1-personnel/v1` | — |
| P-7 | `check-personnel --personnel personnel.json` | **H0** | exit `0` / `1` / **`4`** | — |
| P-8 | Assignment artefact `cpg-u1-rater-assignment/v1` with a fresh **256-bit nonce** | **H0** | `lib/assignment.mjs`; exactly 5 keys; three distinct persons | — |
| P-9 | `rater-assignment-fingerprint --assignment … --personnel …` | **H0** | prints 64-hex fingerprint | — |
| P-10 | **Publishing the fingerprint to a timestamped public venue BEFORE the held-out commitment is broadcast** | **H2** | §4A.3, §12.1; publication record's timestamp | The tooling **cannot check when** it was published (README; `lib/assignment.mjs:6-7`). Late publication means the person→label assignment could have been chosen after the order became knowable |
| P-11 | Custody of the restricted assignment and its nonce until rating completes | **H2** | §13.2 (archived and published with the per-rater sheets) | Losing the nonce makes the commitment unopenable; leaking the assignment early un-blinds the raters |
| P-12 | `verify-rater-assignment --assignment … --fingerprint …` | **H0** | exit `0` / `1`; re-checked implicitly by `ingest-ratings` and both rating-adjudication commands | — |
| P-13 | Operator (key custodian): funding outputs, single-use commitment spends, running commands | **H2** | §4A.3; explicitly **not independent** | — |
| P-14 | Operator holds **no** independent role and **never rates** | **H2** (discipline) | `lib/personnel.mjs:33` `ROLE COLLISION`; `lib/assignment.mjs`; `lib/ratings.mjs:98` | Structural refusal |
| P-15 | `check-personnel` proving **truth** of declarations, or that pseudonyms denote distinct real people | **not automatable at all** — **H3** | `lib/personnel.mjs:3`; README "What the tooling does not prove" | The residual trust in the whole personnel chain sits here |

## 2. Frame enumeration (§4A.2, §5)

| # | Dependency | Class | Evidence / enforcement | Consequence if substituted |
|---|---|---|---|---|
| E-1 | ≥ 1 enumerator builds the frame from public, registry-anchored sources and answers every attestation `yes`/`no`/`unknown` | **H3** | §4A.2; `templates/candidate_frame.template.csv` | Frame is not independent (§20.18) |
| E-2 | Enumerator has **not** run or seen any CPG output (incl. pilot and instrument check) before completing the frame | **H3** | §4A.2(b); declaration key `ran_or_saw_cpg_output` | Contaminated frame |
| E-3 | Enumerator receives **only** public sources, the frame template, §4A and §5.1–§5.4, the jurisdiction-family list, and the development-only registry | **H2** (procedural control) | §4A.2 | Pilot/sizing/quota leakage into enumeration |
| E-4 | Enumerator is **not** the reference adjudicator | **H2** (structural rule) | §4A.3 (the enumerator authored the class predictions) | Class predictions leak into reference adjudication |
| E-5 | Frame validation, scan, sufficiency check | **H0** | `frame`, `scan`, `check-frame-sufficiency` | — |

## 3. Reference truth (§9)

| # | Dependency | Class | Evidence / enforcement | Consequence if substituted |
|---|---|---|---|---|
| R-1 | **Author** constructs a blind record for every drawn company × field | **H3** | §9.1; `constructed_without_cpg` = `yes` | Reference truth not independent; the study's anti-circularity claim fails |
| R-2 | **Confirmer**, a different person, constructs a **separate** record for every company × field, from scratch | **H3** | §9.1, §9.5 ("must be different people") | One construction is no measurement; nothing to reconcile |
| R-3 | Author and Confirmer **never communicate before both submit**, and neither sees the other's records | **H2** (procedural; unenforceable by tooling) | §9.1, §9.2 | Correlated records inflate the agreement rate |
| R-4 | Neither sees **any** CPG output, including the development pilot | **H3** | §9.1, §9.2, §11 (pilot outputs *"never shown to the reference team"*) | Circular reference truth |
| R-5 | Neither sees the **class prediction** | **H2** | §9.2 | Prediction anchors the lookup |
| R-6 | Records meet §9.3 formats and §9.4 authority tiers; no target / projection / run-rate / order book / estimate as a value | **H1** (rules fully specified) / **H2** (the lookup judgement) | `lib/schema.mjs` `VALUE_FORMAT`, `AUTHORITY`, `FORBIDDEN_KINDS`, `checkBlindRecord` | Machine refusal at `reconcile` / `seal` |
| R-7 | `as_of_date` recorded correctly (it drives the §10.2 temporal rule) | **H2** | §9.3; AD-5 `CALENDAR_MONTHS` | Wrong staleness classification downstream |
| R-8 | Agreement comparison (`AGREED` vs must-adjudicate) | **H0** | `agreementKey` — whitespace-collapsed, case-insensitive | — |
| R-9 | **Reference adjudicator** decides each disagreement: `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT` | **H2** | §9.2.1, §9.5 | No automatable substitute; and no third value may ever be supplied |
| R-10 | The adjudicator is a **third** person, not an enumerator, not Author or Confirmer, not the operator | **H3** | §4A.3, §9.1, §9.5 | Reference truth not independently reconciled |
| R-11 | Adjudicator receives **only** the §9.2.1 packet — no CPG output, no class prediction, no agreeing records, no Author/Confirmer identity, **no tally** | **H2** (procedural) + **H0** (artifact) | §9.2.1: *"What the adjudicator learns outside the packet is controlled procedurally (§4A)"* | Un-blinded adjudication |
| R-12 | Packet build / verify / resolve; Record 1/2 assignment; mechanical AUTHOR/CONFIRMER mapping | **H0** | `reference-adjudication-packet`, `verify-adjudication-packet --type reference`, `resolve-reference-adjudication` | — |
| R-13 | `AGREED` rows are never overridden | **H0** | §9.5: *"an adjudication may not override it"* | — |
| R-14 | Reconciled file produced **only** by `reconcile`; `seal` binds the packet and the blind decisions | **H0** | `blindReferenceAdjudication`, `BLIND_ADJUDICATION_REFUSED` | — |
| R-15 | Seal hash **published, timestamped, before held-out execution**; operator receives the seal hash only | **H2** | §9.6 | Post-hoc reference selection becomes possible on its face |
| R-16 | Reference file stays with the reference team until execution and archiving complete | **H2** (custody) | §9.6 | Operator could see values before execution |

## 4. Rating (§12)

| # | Dependency | Class | Evidence / enforcement | Consequence if substituted |
|---|---|---|---|---|
| T-1 | **≥ 2 independent human raters** label every held-out observation | **H3** | §12 [NORMATIVE]; §15.5(3) | §12: every primary endpoint **UNADJUDICATED**, evidence rung **cannot exceed Rung 2**, **no claim of independent validation**. *"The protocol is not weakened to accommodate unavailability."* |
| T-2 | Each rater applies §10.1 in order with the §10.2 rules to every item of their own packet | **H2** | `RATER_PACKET_INSTRUCTIONS.md` | — |
| T-3 | §10.1 **first branch** (value present vs absent) | **H0** — mechanically enforced | `lib/ratings.mjs:36-38` refuses a fill label with `cpg_value === null` and an abstention label with a value | — |
| T-4 | Sub-reasons used only where permitted: `CURRENCY_NOT_STATED` → UNSUPPORTED-FILL / `revenue_range`; `STALE_VALUE` → INCORRECT-FILL / `employee_count`+`revenue_range` | **H0** (validation) / **H2** (the judgement) | `lib/ratings.mjs:21-24`, `:39-43` | Machine refusal of the sheet |
| T-5 | Missing ratings are `pending` — explicit, never blank, never imputed | **H0** (enforced) / **H1** (instructed) | §12; `ingestRatings` *"never silently missing"*; a `pending` row has empty `rated_at` | ≥ 90% completeness rule (§15.5(3)) → INCONCLUSIVE |
| T-6 | Raters blind to each other's labels, to tallies and aggregates, and to the development pilot | **H2** (procedural) + **H0** (packet contents) | §12; `checkItem` excludes *"class, split, pilot or rater information"* | Correlated labels destroy the α measurement |
| T-7 | Raters never convert REFERENCE-CONFLICT / REFERENCE-AMBIGUOUS / REFERENCE-STALE into a scored label | **H2** | §10.3 | Excluded observations silently scored |
| T-8 | Rater packets, presentation order, §12.3 cited-URL extraction, intake validation, sheet hashing and binding | **H0** | `rater-packet`, `verify-rater-packet`, `rater-order`, `verify-rater-order`, `ingest-ratings` | — |
| T-9 | Each sheet is rated by the person the **published fingerprint** names for that label | **H0** (checked) / **H3** (the underlying fact) | `lib/ratings.mjs:57`; `assignedPerson` | A swapped rater is refused at ingestion |
| T-10 | **Rating adjudicator** decides each disagreement: `LABEL_A` / `LABEL_B` / `REFERENCE-AMBIGUOUS` | **H2** | §12.2; *"never a new label"* | — |
| T-11 | The adjudicator is **neither rater** and not the operator | **H3** | §4A.3; `lib/assignment.mjs:33`; `lib/ratings.mjs:97-98` | Structural refusal |
| T-12 | Adjudicator receives **only** the §12.2 packet — no rater identity, no other items' labels, no tallies, no pilot, **not the number of disagreements** | **H2** (procedural) + **H0** (artifact) | §12.2; `RATING_ITEM_KEYS` exactness | Un-blinded adjudication |
| T-13 | Pending and agreeing items never reach adjudication | **H0** | `lib/packets.mjs:81-82` | — |
| T-14 | Rating packet build / verify / resolve; Label A/B assignment; label mapping; sub-reason carried from the chosen rater | **H0** | `rating-adjudication-packet`, `verify-adjudication-packet --type rating`, `resolve-rating-adjudication` | — |
| T-15 | Resolution bound to both sheets, the deterministic packet, the evaluation artifact and the seal | **H0** | `finalRatings`, `RATING_RESOLUTION_REFUSED` | — |

## 5. Cross-cutting

| # | Dependency | Class | Notes |
|---|---|---|---|
| X-1 | Somebody notices and **declares** a protocol violation | **H2** | AD-7 `"value": "VOID"`; §15.5(7) also halts the run (§18). Nothing detects this automatically — it depends on a role-holder speaking up, which every packet in this directory instructs them to do |
| X-2 | The nine methodological decisions **AD-1…AD-9** are DECIDED before registration | **H2** (owner decision) — **already made** | `rules/analysis_decisions.json` status: *"DECIDED — owner-approved … recorded before registration"*; `analyze` exits **4** (BLOCKED) while any value is `UNDECIDED`. AD-5 and AD-6 are quoted in the rater instructions because a rater's application of the temporal rule depends on them |
| X-3 | Public OSF registration, funding outputs, commitment broadcasts, checkpoint choice | **H2** | External acts; the tooling *"creates no key, no transaction, no registration and no seed input"* |
| X-4 | Exit **4** (BLOCKED) is respected rather than worked around | **H2** (discipline) | *"BLOCKED — … named prerequisite(s) missing; the tooling will not invent them"*. Neither may the operator, with a placeholder, a synthetic identity, themselves, or an AI |
| X-5 | No AI stands in for any independent role | **H3** | Not machine-checkable. Stated as a binding condition in every packet and in the declaration's section B1 |

---

## Summary counts

56 rows above (P-1…P-15, E-1…E-5, R-1…R-16, T-1…T-15, X-1…X-5). A row carrying two classes is
counted under each, so the four counts sum to more than 56.

| Class | Rows | Reading |
|---|---|---|
| **H0** | 21 | Already built and verified in the instrument; the operator can run these today |
| **H1** | 5 | Fully prepared by this stream — a form, a packet or an instruction sheet is waiting for a signature or an answer |
| **H2** | 26 | Protocol-reserved human acts and procedural controls; schedulable, never automatable |
| **H3** | 13 | The independence itself. **These are the study's hard blockers, and no amount of engineering moves them.** |

**The single dominant blocker is P-1 / E-1 / R-1 / R-2 / R-10 / T-1 / T-11: seven distinct independent
real people.** Until they exist, `check-personnel` exits 4, the fingerprint cannot be published, the
seal cannot be produced with independent reference truth, and no primary endpoint can be adjudicated.
Every document in this directory exists to make that moment require nothing but the people.
