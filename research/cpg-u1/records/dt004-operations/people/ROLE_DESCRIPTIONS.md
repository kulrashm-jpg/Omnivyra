# CPG-U1 — Study roles and independence

**Classification: PREPARATION.** This document is not evidence. It contains no identity, no
recruitment, no commitment and no result. Every identity field in this directory is empty or
`UNASSIGNED`.

- Governing protocol: `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — §4A.1, §4A.2, §4A.3,
  §9.1, §12.
- Verified instrument: CPG-U1 tooling v6, aggregate sha256
  `<NEW_AGG>`
  (`lib/personnel.mjs`, `lib/assignment.mjs`).
- Where the tooling and the protocol disagree, **the protocol wins and the tooling is defective.**

## 0. The rule that governs every role

> **No AI system, agent or language model may hold any of the seven independent roles.**
> An enumerator, reference Author, reference Confirmer, reference adjudicator, rater or rating
> adjudicator is a **real, independent human being**. An AI may not stand in for one, may not
> "assist" by producing the record, the frame row or the label that the human then signs, and may
> not be the source of any value entered in a blind record or a rating sheet. A role performed or
> ghost-written by an AI is not independent work; the §4A.1 consequences for a false declaration
> apply, and the affected work (frame / reference truth / rating) is published as non-independent.
> The preparer of these documents is an AI and therefore holds **no** role here.

> **The operator may hold no independent role.** `check-personnel` refuses the register with
> `ROLE COLLISION — the operator may hold no independent role` if the operator's `person_id`
> appears in any assignment (`lib/personnel.mjs:33`).

## 1. The eight roles

`INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is exactly:

```
enumerator · reference-author · reference-confirmer · reference-adjudicator ·
rater-1 · rater-2 · rating-adjudicator
```

plus the **operator (key custodian)**, who is explicitly **not independent** (§4A.3).

---

### 1.1 Operator (key custodian) — NOT independent

| | |
|---|---|
| **Does** | Creates the two P2WPKH funding outputs and spends each exactly once with the commitment `OP_RETURN`; runs every tooling command; holds the development-pilot outputs and the instrument check; publishes the rater-assignment fingerprint and the seal hash; assembles packets and distributes them. |
| **Never sees or does** | Never chooses or influences randomness (there is no `--seed` argument). Never sees reference truth before execution and archiving are complete — the operator **receives the seal hash only** (§9.6). Never enumerates, never writes a reference record, never adjudicates, **never rates**. |
| **Eligibility** | None of §4A.1 applies: the operator is expected to be inside the developing organisation. That is why the operator is fenced out of every independent role rather than screened. |
| **Exclusivity** | Holds **no** role in §4A.3's independent set. Enforced mechanically by `check-personnel`. |
| **Human dependency** | **H2** — the protocol requires a human key custodian (a wallet spend and a published timestamp are acts, not computations). |

---

### 1.2 Enumerator (≥ 1)

| | |
|---|---|
| **Does** | Builds the candidate frame from public, registry-anchored sources; answers every admissibility attestation `yes` / `no` / `unknown`; records the class prediction (`expected_outcome_class`) and identity-hazard notes; supplies `enumerated_by` (pseudonym), `enumerated_at` and `enumeration_source_url` per row (`templates/candidate_frame.template.csv`). |
| **Receives only** (§4A.2) | public sources; the frame template; §4A and §5.1–§5.4; the jurisdiction-family list; the development-only registry. |
| **Never sees or does** | Never pilot results, sizing output or quotas; **never any CPG output** (including the development pilot and the instrument check) before completing the frame; never the operator's key material. An unknown attestation is recorded `unknown` — never guessed to `yes`. |
| **Eligibility** | §4A.2 (a) not have implemented CPG, this protocol, the tooling or the development-only registry; (b) not have run CPG or seen any CPG output before completing the frame; (c) not be the operator; (d) hold no other §4A.3 role; (e) satisfy §4A.1 in full. |
| **Exclusivity** | Several enumerators are permitted (`check-personnel` allows n > 1 for `enumerator` only, `lib/personnel.mjs:26`); **each holds no other role.** An enumerator **may not be the reference adjudicator** (§4A.3) — the adjudicator decides contested reference values and the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7). |
| **Human dependency** | **H3** — the frame's independence *is* the evidence; a non-independent frame makes §20.18 apply. |

---

### 1.3 Reference Author

| | |
|---|---|
| **Does** | Constructs a **blind** record for **every** drawn company × field (development + held-out), in the §9.3 format, from an authoritative source per §9.4. |
| **Receives only** (§9.2) | company name, canonical domain, jurisdiction family, decisive identifier, the three field definitions, the §9.3 value-format rules, the §9.4 authority table. |
| **Never sees or does** | Never CPG output (including the development pilot and the instrument check); never the Confirmer's record; never the class prediction; **never communicates with the Confirmer before both have submitted** (§9.1). Never records a target, projection, run-rate, order book or estimate as an expected value. Never has implemented CPG, the protocol or the tooling. |
| **Eligibility** | §4A.1 in full; §9.1 "must not" column. |
| **Exclusivity** | Exactly one person; may hold no other role. |
| **Human dependency** | **H3** — reference truth constructed without CPG *is* the anti-circularity evidence (`constructed_without_cpg` must be `yes`). |

---

### 1.4 Reference Confirmer

| | |
|---|---|
| **Does** | Constructs a **separate, independent blind** record for every company × field — the same task, done again from scratch. |
| **Receives only** | Exactly what the Author receives (§9.2). Nothing that identifies or reflects the Author's work. |
| **Never sees or does** | Same prohibitions as the Author, **plus**: never sees the Author's record before submitting. Does not "check" or "review" the Author's record; the Confirmer re-derives the value. |
| **Eligibility** | §4A.1 in full; §9.1. |
| **Exclusivity** | A **different** person from the Author (§9.5: "The author and confirmer must be different people"); may hold no other role. |
| **Human dependency** | **H3** — two independent constructions are the measurement; one person doing both is no measurement at all. |

---

### 1.5 Reference adjudicator

| | |
|---|---|
| **Does** | For **disagreeing** company × field items only, decides between two unlabelled records: `RECORD_1`, `RECORD_2`, or `REFERENCE-CONFLICT`. Records a rationale, a pseudonym and a date (`templates/adjudication.template.csv`). |
| **Receives only** (§9.2.1) | The reference-adjudicator packet: per disagreeing item, company name, canonical domain, jurisdiction family, decisive identifier; the field definition, §9.3 formats and §9.4 authority table; the two records **unlabelled** as Record 1 / Record 2 carrying only value, source and search content. |
| **Never sees or does** | **Never supplies a third value** (§9.5: "cannot supply a third value"). Never any CPG output (including pilot and instrument check); never class predictions, identity-hazard notes, stratum or split; never screening logs, attestations or contamination bases; never **agreeing** records; never the identities or pseudonyms of Author and Confirmer; never **any count or tally** of adjudication outcomes. Never overrides an `AGREED` row — §9.5: "an adjudication may not override it". |
| **Eligibility** | §4A.1 in full; a **third** independent person; **may not be an enumerator** (§4A.3); may not be Author, Confirmer or operator. |
| **Exclusivity** | Exactly one person; no other role. |
| **Human dependency** | **H2/H3** — the decision is a human judgement the protocol reserves (H2) and its independence from the Author, the Confirmer and the class predictions is itself the evidence (H3). |

---

### 1.6 Rater 1 and Rater 2 (≥ 2 independent raters, NORMATIVE)

| | |
|---|---|
| **Does** | Applies the §10.1 decision procedure with the §10.2 agreement rules to **every** item of that rater's own packet, returning one CSV row per item: `candidate_id, field, label, sub_reason, rated_by, rated_at`. An item the rater cannot complete is `pending` — explicit, never blank. |
| **Receives only** (§12) | That rater's own deterministic packet: for each observation, the field; CPG's value **or null**; the source URLs CPG cited for that value (§12.3, rule id `cpg-u1-cited-urls/field-evidence-union/v1`); the sealed reference record. Plus §10.1 and §10.2 and this instruction sheet. |
| **Never sees or does** | Never the other rater's labels; never running tallies, aggregates or provisional endpoint values; never the development pilot or instrument check; never the class prediction, stratum, split or identity-hazard note (`checkItem` refuses an item carrying "class, split, pilot or rater information", `lib/raterPackets.mjs:55`). Never converts REFERENCE-CONFLICT, REFERENCE-AMBIGUOUS or REFERENCE-STALE into a scored label (§10.3). Never imputes a missing rating. |
| **Eligibility** | §12: must not have implemented CPG, the protocol or the tooling; must hold no other §4A.3 role; must satisfy §4A.1. |
| **Exclusivity** | Two different people, and both different from the rating adjudicator (`lib/assignment.mjs:33`: "rater-1, rater-2 and the rating adjudicator must be three different people (§4A.3)"). `resolveRatingAdjudication` also refuses two sheets rated by the same person. |
| **Human dependency** | **H3** — "≥ 2 independent ratings" is the endpoint's evidential basis. If independent raters are unavailable, execution may occur but every primary endpoint is **UNADJUDICATED**, the evidence rung cannot exceed Rung 2, and **no claim of independent validation may be made** (§12). The protocol is not weakened to accommodate unavailability. |

---

### 1.7 Rating adjudicator

| | |
|---|---|
| **Does** | For **disagreeing, completely rated** observations only, decides `LABEL_A`, `LABEL_B` or `REFERENCE-AMBIGUOUS`, with a rationale and a date. |
| **Receives only** (§12.2) | The identical §12 rater packet for that item, the §10.1 procedure and §10.2 rules, and the two labels shown **unlabelled** as Label A / Label B. |
| **Never sees or does** | Never which rater gave which label, or rater identities; never other observations' labels; never tallies, aggregates or provisional endpoint values; never class prediction, stratum, split or identity-hazard note; never pilot outputs; **never the number of disagreements**. Never invents a new label — the three decisions map mechanically to the labels already present, or to REFERENCE-AMBIGUOUS. |
| **Eligibility** | §4A.1 in full; must be **neither rater** (§4A.3) and not the operator. |
| **Exclusivity** | Exactly one person; no other role. |
| **Human dependency** | **H2/H3** — a reserved human judgement (H2) whose independence from both raters is the evidence (H3). |

---

## 2. The §4A.3 exclusivity rule, exactly

> **Every independent role is held by a different person, and no independent role is held by the
> operator.**
> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**.
> - Several enumerators are permitted; each holds no other role.
> - An enumerator may not be the reference adjudicator. The adjudicator decides contested reference
>   values, and the enumerator authored the class predictions whose mismatches with reference truth
>   are published (§9.2, §9.7).
>
> The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is
> recorded in the personnel register, and its SHA-256 fingerprint is published, **before the
> held-out commitment transaction is broadcast** (§12.1).

So the minimum head count is **7 independent persons + 1 operator = 8 people**. More enumerators
raise the count; nothing lowers it.

## 3. What the tooling can and cannot establish

`check-personnel` verifies **structure only**: every independent role filled, the seven roles
mutually exclusive, the operator in none, every one of the seven `DECLARATION_KEYS` answered
exactly `"no"`, and the §4A.1 evidence fingerprints present.

It **cannot** verify:
- that any declaration is **true** (`lib/personnel.mjs:3`; README "What the tooling does not prove");
- that pseudonymous IDs denote **distinct real people**;
- **when** the rater-assignment fingerprint was published — that is the publication record's
  timestamp, a procedural fact;
- that a human, rather than an AI, did the work of a role.

§4A.1 states the consequence plainly: these are **procedural evidence, not proof**. If a declaration
is later found false, the finding is **published** — rater work takes the §12 UNADJUDICATED
consequences, enumerator work makes the frame non-independent (§20.18), reference work makes the
reference truth non-independent. **This is a methodological rule; it is not a legal determination.**

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

