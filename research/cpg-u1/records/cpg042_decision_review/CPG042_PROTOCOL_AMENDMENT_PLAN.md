# CPG-042 — Protocol Amendment Plan (NOT APPLIED)

**Target:** a new protocol file `CPG_U1_PROTOCOL_004.md`, derived from `CPG_U1_PROTOCOL_003.md` (sha256 `9c3a64a6f1e58abe98a02ef75aa7285fd2afafcb01d57cad49f681d4716d7ead`), which remains byte-unchanged and historical.
- **Not applied, not approved.** Each change below requires approval of its wording.
- Only the changes required by A-1…A-6, B-1 and B-2, plus one optional editorial change (D-1), are listed.
- No other section changes.

**Version consequence.** The protocol file hash changes, so the registration must name protocol-004. Tooling changes are listed separately in §T, and each is marked *required for validity* or *recommended enforcement*.

---

## A-1 / A-5 / A-6 — New section §4A (insert between §4 and §5)

```markdown
## 4A. Study personnel and independence [NORMATIVE]

### 4A.1 Independence from the developing organisation

"Developing organisation" means the entity that develops, owns or operates CPG or Omnivyra, and any affiliate.
A person is **not independent**, and may hold no role in §4A.3, if at any time from the first repository commit of the
developing organisation's product until publication of this study's results the person:

1. is or was employed by the developing organisation, in any capacity;
2. has or had any contract, engagement or other work (paid or unpaid) for it, other than the engagement in item 5;
3. received any payment or benefit from it, other than the fee in item 5;
4. holds equity, options or any other financial interest in it;
5. — *permitted exception:* a fixed fee for the study role, agreed in writing before any role material is released,
   not contingent on any result, finding or future engagement; the agreement's SHA-256 is recorded;
6. is the spouse or partner, a family member or a household member of, or has a current or former direct reporting
   relationship with, any person who developed CPG, the operator (key custodian), or any holder of another §4A.3 role.

Recorded per person (restricted register; pseudonymous ID in study artifacts): a signed declaration covering items 1–6,
the fee-agreement hash, and the developing organisation's written confirmation that its records show no item 1–4
relationship. These are procedural evidence, not proof. A declaration later found false makes that person's work
non-independent: rater work → §12 UNADJUDICATED consequences; enumerator work → the frame is not independent (§20.18);
reference work → the reference truth is not independent. The finding is published.
This is a methodological rule; it is not a legal determination.

### 4A.2 Enumerator eligibility

An enumerator must: (a) not have implemented CPG, this protocol, the tooling or the development-only registry;
(b) not have run CPG or seen any CPG output (including the development pilot and instrument check) before completing
the frame; (c) not be the operator (key custodian); (d) hold no role other than enumerator in §4A.3;
(e) satisfy §4A.1. Enumerators receive only: public sources, the frame template, §4A, §5.1–§5.4, the jurisdiction
family list and the development-only registry. They never receive pilot results, sizing output, quotas or any
CPG output (§5.5, §5.7).

### 4A.3 Roles and permitted combinations

Roles: operator (key custodian; not independent), enumerator (≥ 1), reference Author, reference Confirmer,
reference adjudicator, rater 1, rater 2, rating adjudicator. **Every independent role is held by a different person,
and no independent role is held by the operator.** In particular, an enumerator may not be the reference adjudicator,
because the adjudicator decides contested reference values and the enumerator authored the class predictions whose
mismatches with reference truth are published (§9.2, §9.7). Minimum: 7 independent persons.

The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is recorded, and its SHA-256
fingerprint published, before the held-out commitment transaction is broadcast (§12).
```

**§9.1 table (replace the adjudicator row's "Must not" cell).** Old: `Be the Author, Confirmer or operator; introduce a new value`. New: `Hold any other §4A.3 role (including enumerator); introduce a new value`.

**§12 "Eligibility" row (replace cell).** Old: `Must not have implemented CPG, the protocol or the tooling, and must not have been the operator (key custodian), an enumerator, the reference Author, Confirmer or adjudicator`. New: `Must not have implemented CPG, the protocol or the tooling; must hold no other §4A.3 role; must satisfy §4A.1`.

**§5 heading paragraph (append one sentence).** `Every person performing a §5 task satisfies §4A.`

## A-2 — §9.2 (replace the last sentence)

Old: `The adjudicator receives both blind records for the disagreeing company × field only.`

New:

```markdown
The reference adjudicator receives, for each disagreeing company × field only: the company name, canonical domain,
jurisdiction family and decisive identifier; the field definition, §9.3 formats and §9.4 authority table; and the two
blind records presented as "Record 1" and "Record 2", with sources, where Record 1 is the Author's record if and only if
the first hexadecimal digit of order_key("reference-adjudicator", candidate_id, field) (§12) is even. The mapping back
to AUTHOR / CONFIRMER is applied mechanically after the decision. The adjudicator never receives: any CPG output
(including pilot and instrument check); class predictions, identity-hazard notes, stratum or split; screening logs,
attestations or contamination bases; agreeing records; the identities or pseudonyms of Author and Confirmer; or any count
of adjudication outcomes. Adjudication occurs after both blind record sets are submitted and before `seal`.
```

## A-3 / A-4 — §12

**"Randomisation" row (replace cell).** Old: `Presentation order randomised per rater with a recorded seed [NORMATIVE]`.

New:

```markdown
Presentation order is derived, not seeded [NORMATIVE]:
order_key(label, candidate_id, field) = sha256("cpg-u1-rater-order/v1|" + ho_record_sha256 + "|" + label + "|" + candidate_id + "|" + field),
where ho_record_sha256 is the held-out sampling record_sha256 bound in the seal and label ∈ {rater-1, rater-2,
rating-adjudicator, reference-adjudicator}. Items are presented in ascending order_key, ties by "candidate_id|field".
No other seed exists. Person-to-label assignment is fixed before the held-out commitment (§4A.3).
```

**"Rater disagreement" row (replace cell).** Old: `Resolved by a **rater adjudicator** (not either rater, not any excluded role), who selects one of the raters' labels or REFERENCE-AMBIGUOUS; adjudicated values are flagged`.

New:

```markdown
Resolved by a rating adjudicator (§4A.3) who receives, for each disagreeing observation only: the identical rater packet,
the §10.1 procedure and §10.2 rules, and the two labels shown as "Label A" and "Label B" in order_key("rating-adjudicator", …)
order, without rater identity. The adjudicator never receives: other observations' labels; tallies, aggregates or provisional
endpoint values; class prediction, stratum, split or identity-hazard note; pilot outputs; the number of disagreements.
The adjudicator selects Label A, Label B or REFERENCE-AMBIGUOUS; adjudicated values are flagged. U1 is single-arm: company
identity and CPG output are necessarily visible and no arm identity exists.
```

**§13.2 (replace phrase).** Old: `rater randomisation seed`. New: `rater order derivation (§12) and the published person-to-label assignment fingerprint`.

**§24 (append row).** `| "randomised per rater with a recorded seed" | order_key derived from the held-out record_sha256 with domain "cpg-u1-rater-order/v1" | No discretionary seed; unknowable before R_ho; outsider-recomputable |`

## B-1 — single frozen frame

**§5.5 diagram (replace steps 3 and 9, renumber nothing else).**
- Step 3 new: `3. enumerate the complete frame F → frame → scan → verify frame sufficiency (§5.7) — NO LATER ADDITIONS`.
- Step 9 new: `9. (removed — no frame extension after the development commitment; held-out draws from F)`.
- Step 10: replace `…, append-only proof` with `…, append-only proof (F identical)`.

**§5.5 bullet "Append-only" (replace).**

```markdown
- **Single frozen frame** [NORMATIVE]: the complete frame F is fixed before the development commitment and is the
  frame for both stages. The held-out payload's `frame_hash` must equal the development payload's `frame_hash`.
  Enumerators never receive pilot, sizing or quota information.
```

**§5.5.3 held-out-binding table (add row).** `| Held-out payload frame_hash ≠ development payload frame_hash | **Held-out stage VOID** |`

**§5.7 "Pool minimum" bullet (append).**

```markdown
**Frame sufficiency [NORMATIVE]:** before the development commitment, for each class c, the number of admissible,
held-out-eligible rows E_c in F (per the committed scan and the registered registry) must satisfy
E_c ≥ 2·Qmax_c + Dev_c, with Qmax = {fill-expected 60, abstention-expected 25, identity-hazard 15} (the §5.6 quotas at CAP)
and Dev = {6, 2, 2}; i.e. E ≥ 126 / 52 / 32. If unmet, no development commitment is made; enumeration continues first.
```

**§5.10 (add row).** `| STAGE_VOID_BINDING_MISMATCH (frame) | Held-out frame_hash differs from the development frame_hash | Study VOID |`

**§22 row 26 (replace control cell).** `Single frozen frame: held-out frame_hash must equal development frame_hash (§5.5); sufficiency verified before commitment (§5.7)`.

**§22 (add row).** `| 26a | Outcome-dependent frame composition (appending after pilot sizing) | PREVENTED | Frame fixed before any CPG output; enumerators never receive sizing (§4A.2, §5.5) |`

## B-2 — registry frozen at registration

**§5.3 "Development-only registry" paragraph (append).**

```markdown
**For this study the registry is frozen at registration** [NORMATIVE]: held-out eligibility for both stages is
determined solely by the registry whose SHA-256 is in the registration. Entries added after registration do not
apply to this study. A contamination discovered after registration is recorded (company, basis, date, discoverer)
and published; the company is never excluded or replaced (§5.9, §15.2), and its observations are flagged
CONTAMINATION-DISCLOSED. A pre-specified secondary analysis excluding flagged observations may be reported and
never changes the §10.5 outcome.
```

**§5.5.3.**
- Rule (7) change. Old: `(7) the payload is valid and binds this registration.` New: `(7) the payload is valid and binds this registration, including a registry_sha256 equal to the registration's registry_sha256 for **both** stages.` Protocol-003 states no registry equality at all; the tooling enforces it for development only.
- Binding table, add row: `| Held-out payload registry_sha256 ≠ registered registry_sha256 | **Held-out stage VOID** |`.

**§15.1 (append disposition).** `CONTAMINATION-DISCLOSED (flag; observation remains VALID in the primary analysis)`.

**§22 (add row).** `| 27a | Registry growth after the pilot to exclude unfavourable companies (e.g. after private CPG runs) | PREVENTED | Registry frozen at registration; held-out registry hash must equal registered (§5.3, §5.5.3) |`

## D-1 — optional editorial (no substantive change)

**§16 headings.** `### 16.1 U4 — generalisation` → `### 16.1 CPG-U4 — CPG generalisation (not DT-U4)`. Likewise `CPG-U8`, `CPG-U9`, adding one sentence under §16: `"CPG-U<n>" denotes this protocol lineage's uncertainties; "DT-U<n>" denotes DEEPTECH_BASELINE_001 §9. They are different studies unless a document states equivalence.`

---

## §T — Tooling consequences (not implemented; any change alters the aggregate and must precede registration)

| # | Change | Needed for validity? | Reason |
|---|---|---|---|
| T-1 | Held-out: require `registry_sha256` = registered value (replace the "registry may only grow" behaviour and README line) | **Recommended enforcement.** The rule is outsider-checkable from public hashes, but the current tooling *accepts* a changed registry, contradicting B-2 | B-2 |
| T-2 | Held-out: require held-out `frame_hash` = development `frame_hash` | Recommended enforcement (outsider-checkable) | B-1 |
| T-3 | Pre-commitment frame-sufficiency check (`E_c ≥ 2·Qmax_c + Dev_c`) | Recommended (outsider-checkable from frame + scan) | B-1 |
| T-4 | `rater-order` helper computing §12 `order_key` | Optional (formula suffices) | A-3 |
| T-5 | Mutations and tests for T-1…T-4; re-run of the 037A-style clean rebuild | Required if T-1…T-4 are implemented | CPG-041 standard |

If T-1…T-3 are **not** implemented, the registration must state that those rules are verified by outsiders, not by the registered tooling.
