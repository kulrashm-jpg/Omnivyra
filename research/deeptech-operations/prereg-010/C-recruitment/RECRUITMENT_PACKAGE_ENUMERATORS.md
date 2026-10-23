# RECRUITMENT_PACKAGE_ENUMERATORS — the twelve items, for Enumerator A and Enumerator B

**CLASSIFICATION: PREPARATION.** No person exists. Both slots are UNFILLED. Nobody has been recruited,
approached or engaged, and no fee figure, signature, declaration, confirmation or calendar date appears
anywhere below.

Both slots carry the **literal register role string `enumerator`** (`lib/personnel.mjs:6`). Slot
identity is carried in the ignored `$slot` key. A row labelled `enumerator-2` is refused as
`unknown role` (`CHECK_PERSONNEL_EVIDENCE.md`, experiment 3).

**The two slots are identical in all twelve items below except item 5 (the fee agreement must be a
separate agreement with a distinct hash) and the jurisdiction/prefix allocation**, which dt008
`ENUMERATOR_AB_DIFFERENCES.md` settled as the only two differences.

---

## 1. Role description

Construct the single frozen candidate frame F for the allocated jurisdiction families, from public
sources only, before any CPG output exists anywhere in the study. The frame is the population from
which both stages are drawn; it is committed, and §5.5.3 requires the held-out frame to be identical to
the development one.

| Slot | Allocated families | `candidate_id` prefix |
|---|---|---|
| ENUMERATOR_A | `US-SEC`, `LEI-ONLY` | disjoint; proposed `A-` (dt009 `ENUMERATOR_WORK_ALLOCATION.md`) |
| ENUMERATOR_B | `FR-SIRENE`, `BR-CNPJ` | disjoint; proposed `B-` |

Authority for a second slot: §4A.3 *"enumerator (≥ 1)"* and *"Several enumerators are permitted; each
holds no other role."* `lib/personnel.mjs:26` exempts the role string `enumerator`, and only it, from
the exactly-one rule.

## 2. Eligibility requirements

§4A.2, in full — an enumerator must:

> *(a) not have implemented CPG, this protocol, the tooling or the development-only registry;*
> *(b) not have run CPG or seen any CPG output (including the development pilot and instrument check)
> before completing the frame;*
> *(c) not be the operator (key custodian);*
> *(d) hold no other §4A.3 role;*
> *(e) satisfy §4A.1.*

Plus §4A.3: **an enumerator may not be the reference adjudicator**, with the protocol's own reason —
*"The adjudicator decides contested reference values, and the enumerator authored the class predictions
whose mismatches with reference truth are published (§9.2, §9.7)."* This binds **both** slots.

Note (b)'s wording: *"before completing the frame"*. The prohibition is anchored to frame completion,
not to publication, and it is the only §4A.2 clause with a timing anchor.

## 3. Prohibited relationships

See `PROHIBITED_RELATIONSHIPS.md` for the full three-family enumeration and the 36 + 9*d* pair set.
Enumerator-specific additions:

- **§4A.3**: may not be the reference adjudicator (both slots).
- **Between A and B**, the five non-dependence conditions of dt009 `NON_DEPENDENCE_CONDITION.md`:
  C-1 separate fee agreements, never one shared agreement · C-2 no sub-contracting in either direction ·
  C-3 neither pays nor employs the other · C-4 no shared economic interest in a common entity ·
  C-5 §4A.1 item 6's relational exclusions applied **between** them.

C-1 is the condition with no mechanical backstop: a shared fee hash passes `check-personnel` with 0
errors and 0 blockers (`CHECK_PERSONNEL_EVIDENCE.md`, experiment 2).

## 4. Independence declaration

The seven frozen `DECLARATION_KEYS`, every answer the literal `"no"`
(`RECRUITMENT_ROLE_MATRIX.md` has the key table and the §4A.1 mapping). Keys 6 and 7 carry §4A.2(a) and
(b) for this role. §4A.1: *"An unknown answer is not 'no'."*

Also recorded per §4A.1: the fee-agreement hash (or `null`), and **the developing organisation's written
confirmation that its records show no item 1–4 relationship**.

Template: dt008 `C-enumerators/` + `C:/tmp/dt004-operations/people/INDEPENDENCE_DECLARATION_TEMPLATE.md`.
Nothing in this package fills one in.

## 5. Fee / contract conditions

§4A.1(5), the only permitted economic relationship: a **fixed fee for the study role**, agreed in
**writing**, **before any role material is released**, **not contingent** on any result, finding or
future engagement, with its **SHA-256 recorded**.

- Template and the terms that void the exception: dt008 `FEE_AGREEMENT_TEMPLATE.md` §3 and §4.
- Register value: 64 lower-case hex, **or** the JSON literal `null` meaning a deliberate no-fee
  engagement (`lib/personnel.mjs:38`). The `PENDING_PERSON_REGISTER.json` uses neither, because a
  `null` there would assert a no-fee decision nobody has made.
- **A's hash and B's hash must differ.** Compare them by hand; nothing in the instrument does.

## 6. Material-release conditions

Fail-closed, and it is the act that cannot be undone. Two gates apply and the stricter governs:

- dt008 `MATERIAL_RELEASE_GATE.md` — the per-slot nine boxes, run twice, plus the pairwise and
  register-wide checks;
- dt009 `MATERIAL_RELEASE_JOINT_GATE.md` — **no study material reaches either enumerator until the
  conditions for BOTH are satisfied.** Any unchecked box blocks release for both.

The gate's textual basis is §4A.1(5)'s *"before **any** role material is released"*. Release is
irreversible: material once seen cannot be unseen, which is why this is a gate and not an audit.

## 7. Permitted information

§4A.2, *"Enumerators receive only"*:

> *public sources; the frame template; §4A, §5.1–§5.4; the jurisdiction-family list; the
> development-only registry.*

dt009 `KNOWLEDGE_WINDOW_RULE.md` §4 works through the four items (K-1…K-4) where the directive's
broader "operational information necessary to perform their assigned work" exceeds §4A.2's closed list,
and it is the reference for anything not literally in the five bullets above. **The closed list wins
where they conflict.**

## 8. Prohibited information

§4A.2: *"They never receive: pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2)."*

And, operationally, from each other: the other slot's frame rows, prefix, allocated families, or the
companies it considered (`CONFIDENTIALITY_REQUIREMENTS.md` K-8). Also prohibited: **any** count or
target for the slot's own row yield, which would be a quota.

## 9. Confidentiality requirements

`CONFIDENTIALITY_REQUIREMENTS.md`: clauses K-1…K-7, plus the enumerator K-8. The clause that matters
most here is **K-3** — no execution of CPG or Omnivyra in any environment, and no reading of stored CPG
output, for any company encountered in this role. §6.5's preview definition covers *"any entry point"*
and *"any environment (production, staging, certenv, local, harness)"*, and a detected preview makes the
**study VOID**.

## 10. Deliverables

`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §1: frame rows in the **22 `FRAME_COLUMNS`**
(`lib/schema.mjs:11-35`), tri-state `a1/a2/a4/a6`, contamination attestations `c1_2`…`c1_5`, under the
slot's disjoint `candidate_id` prefix.

## 11. Acceptance criteria

`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §1, criteria A-1…A-8. Six are mechanical (column
completeness, tri-state vocabulary, no MALFORMED row, `candidate_id` uniqueness, frame sufficiency ≥
210 eligible admissible rows). Two are not: prefix discipline (A-5) and "constructed without CPG
output" (A-8). **Row count is not an acceptance criterion** — a per-slot target would be a quota.

## 12. Replacement if the slot holder becomes ineligible

`REPLACEMENT_PROCEDURE.md` §2.2, enumerator row. In summary:

| When | Outcome |
|---|---|
| **Before the frame is committed** | Replaceable. The replacement re-enumerates **the lost slot's allocated families only**; the other slot's rows are untouched; `frame_hash` changes and the frame is re-committed |
| **After the frame is committed** | **Not replaceable in any way that keeps the study.** A different frame is a different `frame_hash` → `STAGE_VOID_BINDING_MISMATCH` (§5.10) → study VOID, and §18(5) halts |
| **A false declaration (T-1), at any point** | Not a replacement question. §4A.1: *"enumerator work: the frame is not independent (§20.18)"*, and the finding is **published** |

§20.18 is the honest statement of what is lost: cryptographic sampling integrity *"is **not**
independent candidate selection (the frame is unbiased); the latter rests on enumerator independence
only."*

---

## What remains blocked on the operator for these two slots

| # | Blocked | Why |
|---|---|---|
| E-1 | Two people | No candidate exists. §19.3(3) names independent enumerators as a prerequisite before the stage |
| E-2 | The `candidate_id` prefixes, confirmed | dt009 proposes `A-` / `B-`; the instrument imposes no namespace rule |
| E-3 | Both fee agreements, separately drafted and separately hashed | And a hand comparison proving the hashes differ |
| E-4 | Both organisation confirmations | Issued by the developing organisation, not by any role holder |
| E-5 | The three anchor dates | No calendar date may appear in this package |
| E-6 | Whether the directive's broader knowledge window or §4A.2's closed list governs the four K-1…K-4 conflicts | dt009 `KNOWLEDGE_WINDOW_RULE.md` left them as recorded readings |
