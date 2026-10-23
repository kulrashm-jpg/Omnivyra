# RECRUITMENT_ROLE_MATRIX — all eight independent roles, at a glance

> **Filename note.** The directive asked for `ROLE_MATRIX.md`. That name is swallowed by
> `.gitignore:77` (`ROLE_*.md`), verified with `git check-ignore -v`. The file is therefore named
> `RECRUITMENT_ROLE_MATRIX.md`, which `git check-ignore` reports as trackable.

**CLASSIFICATION: PREPARATION.** No person exists in this document. No one has been recruited,
approached or engaged. Every person-shaped value in this package is the literal token
`PENDING_PERSON`.

## Baseline, recomputed by the author of this file

| Item | Value | How checked |
|---|---|---|
| Frozen protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum` in this worktree |
| Candidate instrument (READ ONLY) | `C:/tmp/dt009-merge/tooling`, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, **594 files** | `toolingManifest('.')` from `lib/aggregate.mjs` |
| Tree deliberately **not** read | any worktree's own `research/cpg-u1/tooling` — 587 files, aggregate `640510…`. It runs fine and lies | not opened |

## The eight slots over seven role strings

`INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) has **seven** members. `lib/personnel.mjs:26` permits
`n > 1` for `enumerator` **and for no other role**. Eight slots therefore require **eight distinct
persons**, which satisfies the §4A.3 floor of "minimum 7 independent persons" with one to spare, and
the operator holds none of them (`lib/personnel.mjs:33`).

**The literal role string for both enumerator slots is `enumerator`.** A row labelled `enumerator-2`
is refused as `unknown role` at `lib/personnel.mjs:31` — run and pasted verbatim in
`CHECK_PERSONNEL_EVIDENCE.md`, experiment 3.

## THE MATRIX

| # | Role (register string) | RECEIVES | NEVER RECEIVES | PRODUCES (deliverable) | MAY NOT ALSO BE |
|---|---|---|---|---|---|
| 1 | **Enumerator A** (`enumerator`) | public sources; the frame template; §4A; §5.1–§5.4; the jurisdiction-family list; the development-only registry (§4A.2) | pilot results; sizing output; quotas; **any** CPG output, including the development pilot and the instrument check (§4A.2, §5.5, §5.7.2) | frame rows for its allocated jurisdiction families — **22 `FRAME_COLUMNS`** (`lib/schema.mjs:11-35`), tri-state `a1/a2/a4/a6` and `c1_2…c1_5`, under a disjoint `candidate_id` prefix | the operator; any other §4A.3 role; the reference adjudicator (§4A.3, §4A.2(c)(d)) |
| 2 | **Enumerator B** (`enumerator`) | identical to Enumerator A | identical to Enumerator A | frame rows for its own allocated families, same 22 columns, **disjoint** `candidate_id` prefix from A | identical to Enumerator A — **and A's fee agreement may not also be B's** |
| 3 | **Reference Author** (`reference-author`) | company name; canonical domain; jurisdiction family; decisive identifier; the three field definitions; §9.3 value formats; the §9.4 authority table (§9.2) | CPG output including the pilot; the Confirmer's records; the class prediction (§9.2). **No communication with the Confirmer before both have submitted** (§9.1) | one blind record per drawn company × field, **13 `BLIND_RECORD_COLUMNS`** (`lib/schema.mjs:201`), with `constructed_without_cpg` = `yes`; both stages | any other §4A.3 role; the operator; an implementer of CPG, the protocol or the tooling (§9.1) |
| 4 | **Reference Confirmer** (`reference-confirmer`) | identical to the Author (§9.2) | the same as the Author, **plus the Author's record before submitting** (§9.1) | a **separate** blind record per company × field, same 13 columns, independently constructed | any other §4A.3 role, including Author; the operator |
| 5 | **Reference Adjudicator** (`reference-adjudicator`) | only the §9.2.1 packet: per **disagreeing** item — company name, domain, jurisdiction family, decisive identifier, the field definition, §9.3 formats, the §9.4 table, and the two records **unlabelled** as Record 1 / Record 2 | CPG output; class predictions, identity-hazard notes, stratum, split; screening logs, attestations, contamination bases; **agreeing records**; the Author's and Confirmer's identities or pseudonyms; **any count or tally of adjudication outcomes** (§9.2.1) | one decision per disagreeing item — **6 `ADJUDICATION_COLUMNS`** (`lib/schema.mjs:207`); decision ∈ `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT`; `rationale` required | **any** other §4A.3 role — §4A.3 names the enumerator explicitly, and it binds **both** enumerator slots |
| 6 | **Rater 1** (`rater-1`) | the §12 rater packet: field; CPG's value or null; the source URLs CPG cited for that value (§12.3); the sealed reference record; the §10.1 procedure and §10.2 rules; a presentation order derived per §12.1 | the other rater's labels; running tallies and aggregates; the development pilot (§12) | one rating sheet over **every** held-out company × field — **6 `RATING_COLUMNS`** (`lib/ratings.mjs:17`); label from the seven-member closed set; `pending` permitted and never imputed | any other §4A.3 role; the operator; an implementer of CPG, the protocol or the tooling (§12) |
| 7 | **Rater 2** (`rater-2`) | the identical packet, in its **own** §12.1-derived order | identical to Rater 1 | an independent sheet over the same item set, same 6 columns | identical to Rater 1 — `lib/ratings.mjs:97` refuses two sheets rated by the same person |
| 8 | **Rating Adjudicator** (`rating-adjudicator`) | only the §12.2 packet: the identical §12 rater packet per **disagreeing** held-out observation, the §10.1 procedure, the §10.2 rules, and the two labels **unlabelled** as Label A / Label B | which rater gave which label, or rater identities; other observations' labels; tallies, aggregates or provisional endpoint values; class prediction, stratum, split, identity-hazard note; pilot outputs; **the number of disagreements** (§12.2) | one decision per disagreeing item; decision ∈ `LABEL_A` / `LABEL_B` / `REFERENCE-AMBIGUOUS`; `rationale` required; `adjudicated_at` as `YYYY-MM-DD` (`lib/ratings.mjs:105-112`) | either rater — `lib/ratings.mjs:98` refuses it; any other §4A.3 role; the operator |
| — | **Operator** (not independent; holds no role in the `assignments` array) | the seal hash **only** (§9.6); pilot outputs (§11); the execution authorisation (§6.5) | reference values before the seal — structurally, not by promise (§9.6) | the register, the assignment artefact and its fingerprint, the seal, the authorisation, the no-preview declaration | **any** independent role (§4A.3; `lib/personnel.mjs:33`) |

## The mutual-exclusion graph, stated as refusals

| Pair | Who refuses it | Where |
|---|---|---|
| operator ↔ any independent role | `check-personnel` | `lib/personnel.mjs:33` |
| any two independent roles under one `person_id` | `check-personnel` | `lib/personnel.mjs:34` |
| a second holder of any non-enumerator role | `check-personnel` | `lib/personnel.mjs:26` |
| rater-1 = rater-2 | `resolve-rating-adjudication`, and `analyze` condition 3 | `lib/ratings.mjs:97` |
| rating-adjudicator ∈ {rater-1, rater-2} | `resolve-rating-adjudication` | `lib/ratings.mjs:98` |
| enumerator = reference adjudicator | **nothing beyond the generic `person_id` collision check** — it bites only if the two rows carry the identical `person_id` string | §4A.3 prose; `lib/personnel.mjs:34` |
| Author = Confirmer | §9.5 "The author and confirmer must be different people" | §9.5 |

**The honest limit.** Every one of those mechanical refusals compares **strings**. Two rows carrying
`PERSON_1` and `PERSON_2` for the same human pass every check. `check-personnel`'s own header says so:

> *"It cannot verify that declarations are true."* — `lib/personnel.mjs:3`

§20.23 says the same at protocol level: personnel independence "rests on declarations and
organisational confirmation (§4A.1), not on verifiable proof. The tooling checks the register's
structure only."

## One frozen declaration array, seven keys, for every one of the eight

`DECLARATION_KEYS` (`lib/personnel.mjs:8-12`) is a single `Object.freeze`d array applied to **every**
assignment at `:36-37`, whatever its role. There is no per-role variant and no per-role exemption.

| # | Key | §4A.1 / §4A.2 item |
|---|---|---|
| 1 | `employed_by_developing_organisation` | §4A.1(1) |
| 2 | `contract_or_work_for_developing_organisation` | §4A.1(2) |
| 3 | `payment_other_than_study_fee` | §4A.1(3) |
| 4 | `financial_interest_in_developing_organisation` | §4A.1(4) |
| 5 | `close_relationship_with_developer_operator_or_role_holder` | §4A.1(6) |
| 6 | `implemented_cpg_protocol_tooling_or_registry` | §4A.2(a) |
| 7 | `ran_or_saw_cpg_output` | §4A.2(b) |

**Every answer must be the literal string `"no"`.** `:37` tests `d[k] !== 'no'`, so `"No"`, `"NO"`,
`false`, `null`, `"unknown"` and an absent key all fail. §4A.1 closes the gap in words:

> *"An unknown answer is not 'no'."*

§4A.1 items (1)–(4) and (6) are five items and §4A.2(a)–(b) are two; §4A.1(5) is the **permitted
exception** (the fixed study fee), which is not a declaration key but the fee-agreement hash checked
at `:38`. That is why there are seven keys and not eight.

## The hard ordering constraint that no tool enforces

§4A.3, final paragraph:

> *"The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is
> recorded in the personnel register, and its SHA-256 fingerprint is published, **before the held-out
> commitment transaction is broadcast** (§12.1)."*

`check-personnel` knows nothing of this ordering: it reads one JSON file, and it has no clock and no
chain. Getting it wrong is a §18.3 protocol violation → §15.5(7) halt → no endpoint, and republishing
the fingerprint afterwards repairs nothing.

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A, §5.8–§5.10, §6.5, §9, §12, §13, §15, §18, §19, §20
- `C:/tmp/dt009-merge/tooling/lib/personnel.mjs`, `lib/schema.mjs`, `lib/ratings.mjs`, `lib/packets.mjs`, `lib/aggregate.mjs`, `cpg_u1_data.mjs`
- `C:/tmp/dt009-closure/F-enumerators/` (6 files) · `C:/tmp/dt008-prereg/C-enumerators/` (7) · `C:/tmp/dt008-prereg/D-reference/` (10) · `C:/tmp/dt008-prereg/E-rating/` (8) · `C:/tmp/dt004-operations/people/` (9)
