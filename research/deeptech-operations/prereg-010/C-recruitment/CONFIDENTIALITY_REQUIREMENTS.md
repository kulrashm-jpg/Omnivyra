# CONFIDENTIALITY_REQUIREMENTS — the confidentiality undertaking each of the eight signs

**CLASSIFICATION: PREPARATION.** No person exists. No undertaking has been signed, and no signature
block below is filled.

**This is new in this wave.** Prior waves fixed the *information boundaries* — what each role receives
and never receives (dt008 D-reference §2/§3, E-rating §3/§4; dt009 `KNOWLEDGE_WINDOW_RULE.md`). Nobody
wrote the **obligation running the other way**: what a role holder may not disclose, to whom, and for
how long. Both directions are needed, because U1's blinding fails identically whether the operator
leaks into a role or a role leaks into another role.

---

## 0. The one sentence this file exists to make operational

> **Every "never receives" in the protocol is someone else's confidentiality obligation.**

§9.2 says the reference adjudicator never receives *"the identities or pseudonyms of Author and
Confirmer"*. That is not a filing instruction for the operator alone — it is also an obligation on the
Author and the Confirmer not to identify themselves to the adjudicator, and on every other role holder
not to identify them either. The protocol states the receive-side; this file states the disclose-side,
so that the same rule binds at both ends.

---

## 1. The four confidentiality classes

| Class | What it protects | Failure mode if breached |
|---|---|---|
| **C-I — Blinding** | The separations §9.1, §9.2, §9.2.1, §12 and §12.2 create between role holders | The independence claim the separation existed to support is lost; §4A.1's per-role consequences apply |
| **C-II — No-preview** | That no company in the frame F is queried against CPG, or its stored output read, outside the authorised run | §6.5: the study is **VOID**, not flagged; *"nothing is repaired or replaced"* |
| **C-III — Restricted register** | The mapping from pseudonym to person | §4A.1: the register is a *"restricted register; a pseudonymous ID is used in study artifacts"*. Publishing it would make every published artefact person-identifying |
| **C-IV — Pre-publication** | That the study's design, contents and intermediate state are not disclosed before publication | §13.2 defines what is published and when; §20.13 records that parallel pseudonymous registrations cannot be detected, so early disclosure is unrecoverable |

---

## 2. The undertaking, per role

Each of the eight signs the **same seven clauses**, with one role-specific clause added. The clauses
are numbered so the register can record which set a person signed.

### The seven common clauses — every role

| # | Clause | Grounding |
|---|---|---|
| **K-1** | I will not disclose any material I receive for this role, or anything derived from it, to any other role holder, to the operator beyond the prescribed submission, or to any third party, until the study's results are published. | §13.2 (what is published) |
| **K-2** | I will not seek, accept or read any information my role's protocol section lists as never received, from any source, including the operator, another role holder, or a public channel. | §4A.2, §9.2, §9.2.1, §12, §12.2 |
| **K-3** | I will not execute CPG or Omnivyra, in any environment (production, staging, certenv, local, harness) or through any entry point, and I will not read any stored CPG output, for any company I encounter in this role. | §6.5's preview definition, verbatim in scope |
| **K-4** | I will not disclose that I hold this role, or which role I hold, to any other role holder, before publication. | §9.2.1 (adjudicator never receives Author/Confirmer identities); §12.2 (never rater identities) |
| **K-5** | I will not disclose my own or anyone else's `person_id`, pseudonym or the mapping between them. | §4A.1 restricted register |
| **K-6** | I will not retain, copy or transfer study material after my deliverable is submitted, except as the operator's archiving instruction requires. | §13.1, §13.2A (the archive is the retention mechanism, not a personal copy) |
| **K-7** | If I learn something my role is not permitted to receive, I will **disclose that fact to the operator immediately and will not act on it**. I understand the disclosure may result in a published finding and that concealing it would be worse. | §4A.1 *"the finding is published"*; §6.5 *"Disclosure by any person"* is a listed detection route |

**K-7 is the clause that makes the others survivable.** Every other clause can be breached by accident.
A regime in which accidental contamination is career-ending for the role holder is a regime in which
contamination is concealed, and §6.5 lists *"Disclosure by any person"* as one of only four detection
routes. So K-7 is drafted as a duty to disclose, not as an admission of fault.

### The role-specific eighth clause

| Role | Clause K-8 |
|---|---|
| **Enumerator A** | I will not disclose my frame rows, my `candidate_id` prefix, my allocated jurisdiction families, or any company I considered, to the other enumerator or to anyone else. I understand the two allocations are disjoint and that comparing them would defeat the purpose of the split. |
| **Enumerator B** | Identical, reciprocally. |
| **Reference Author** | I will not communicate with the Confirmer, about anything concerning this study, **before both of us have submitted** — §9.1's "Must not" column states this as a role condition, and I will not disclose my records to the reference adjudicator at any time. |
| **Reference Confirmer** | Identical, and additionally: I will not seek or read the Author's record before submitting my own (§9.1). |
| **Reference Adjudicator** | I will not seek the identity of Record 1's or Record 2's author, will not ask for or accept any count or tally of adjudication outcomes, and will not ask to see agreeing records (§9.2.1). |
| **Rater 1** | I will not disclose my labels to the other rater or to the rating adjudicator, and will not seek the other rater's labels, any running tally or any aggregate (§12). |
| **Rater 2** | Identical, reciprocally. |
| **Rating Adjudicator** | I will not seek which rater gave which label, rater identities, other observations' labels, any tally or provisional endpoint value, or **the number of disagreements** (§12.2). |

---

## 3. Duration

| Obligation | Runs until |
|---|---|
| C-I blinding (K-1, K-2, K-4, K-8) | Publication of the study's results — the same terminus §4A.1 sets for the exclusion period |
| C-II no-preview (K-3) | §6.5's own boundaries, which differ by company class: for a **held-out** company, *"at any time before the authorised run starts, or after it completes"*; for a **development** company, before the development drand round's scheduled time; for any **other frame company**, before the held-out drand round's scheduled time |
| C-III restricted register (K-5) | **Indefinitely.** §4A.1 gives the register no expiry, and publication does not de-restrict it: published artefacts carry pseudonyms, so de-anonymising afterwards would retroactively make every published artefact person-identifying |
| C-IV pre-publication (K-6, K-7) | Publication, except that K-7's duty to disclose a contamination survives it — §4A.1's finding is published whenever it is found |

**K-3's asymmetry deserves emphasis.** It is the only clause whose end date is *earlier* than
publication for some companies and *never* for others: for a held-out company the prohibition resumes
**after the authorised run completes** (§6.5(a)). A role holder who queries a held-out company out of
curiosity a week after the run has caused `STUDY_VOID_PREVIEW`.

---

## 4. What is NOT confidential — stated, so nobody over-restricts

| Item | Status |
|---|---|
| The protocol document itself | **Published** (§13.2 lists "protocol document") |
| The registration, both commitment payloads, both sampling records | **Published** (§13.2) |
| The rater instructions | **Published** (§13.2 lists "rater instructions") |
| The exclusion table and both screening logs | **Published** (§15.2) |
| Rater order artifacts and the person-to-label assignment **fingerprint** | **Published** (§13.2, §4A.3) — the fingerprint, not the assignment |
| The fact that a role holder's declaration was found false | **Published** (§4A.1) — and confidentiality may not be invoked to suppress it |
| A detected preview | **Published** (§6.5 *"the finding is published"*) |

**No confidentiality clause may be drafted to restrict any row of this table.** A clause that did so
would conflict with §13.2 or §15.2, and the protocol section wins. This is why the fee agreement
template (dt008 `FEE_AGREEMENT_TEMPLATE.md` §4) already refuses terms that void the §4A.1(5) exception:
the same drafting discipline applies here.

---

## 5. Recording it in the register

`checkPersonnelRegister` (`lib/personnel.mjs:16-41`) validates `schema`, `operator.person_id` and the
`assignments` array, and **ignores every unknown root-level and per-assignment key**. A
`$confidentiality` block therefore:

- costs **no instrument byte** and does not move the aggregate
  `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`;
- is also **not checked** — nothing verifies that the undertaking was signed. It is recorded evidence,
  in exactly the sense §4A.1 uses: *"procedural evidence, not proof."*

The block records, per assignment: which clause set was signed (K-1…K-7 plus the role's K-8), and the
SHA-256 of the signed undertaking. **Not** the undertaking's text, and not the signatory.

---

## 6. What confidentiality cannot do

1. **It cannot prevent an unlogged private query.** §20.20: *"No-preview protection is procedural and
   audit-based. The protocol cannot prove that no unlogged private CPG query occurred in any
   environment."* K-3 is a promise, and §6.5 says so itself.
2. **It cannot make the blinding verifiable.** The instrument verifies that a *packet* contains only
   what it should (`verify-adjudication-packet`, `verify-rater-packet`). It cannot verify what a person
   learned outside the packet — §9.2.1: *"What the adjudicator learns outside the packet is controlled
   procedurally (§4A)."*
3. **It cannot survive a role holder who does not want it to.** Two role holders who decide to compare
   notes leave no trace the instrument can find. §20.23 is the protocol's own admission.
4. **It is not a legal instrument.** §4A.1's closing sentence governs the whole of §4A: *"This is a
   methodological rule; it is not a legal determination."* The same applies here — these are study
   conditions, and nothing in this file is drafted as, or should be read as, a legal obligation.

## 7. What remains blocked on the operator

| # | Blocked item | Why |
|---|---|---|
| C-1 | Whether the undertaking is a separate signed document or a clause set inside the fee agreement | dt008 `FEE_AGREEMENT_TEMPLATE.md` §2 binds exactly one named role; folding K-1…K-8 in would work, but it changes the hash that §4A.1(5) requires, so the choice must be made before any fee agreement is hashed |
| C-2 | Who holds the pseudonym↔person mapping, and where | §4A.1 says "restricted"; it does not say by whom. The operator cannot be the only holder if the operator must not learn reference values (§9.6) |
| C-3 | The channel by which K-7 disclosures reach the operator without themselves breaching C-I | A disclosure that names what was learned may itself transmit prohibited information |
| C-4 | Whether K-5 binds after publication in the operator's final reading | §3 argues indefinitely; the protocol is silent, so this is a recorded reading, not a ruling |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2, §6.5, §9.1, §9.2, §9.2.1, §12, §12.2, §13.1, §13.2, §13.2A, §15.2, §20.13, §20.20, §20.23
- `C:/tmp/dt009-merge/tooling/lib/personnel.mjs`
- `C:/tmp/dt008-prereg/C-enumerators/FEE_AGREEMENT_TEMPLATE.md`, `MATERIAL_RELEASE_GATE.md`
- `C:/tmp/dt009-closure/F-enumerators/KNOWLEDGE_WINDOW_RULE.md`
- `C:/tmp/dt008-prereg/D-reference/` §2/§3 receive-lists; `E-rating/` §3/§4 receive-lists
