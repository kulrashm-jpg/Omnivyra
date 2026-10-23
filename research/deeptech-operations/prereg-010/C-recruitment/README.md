# C-recruitment — the complete recruitment package for all eight independent CPG-U1 roles

**DEEPTECH-PARALLEL-010 / STREAM C. CLASSIFICATION: PREPARATION.**

**No person exists in this directory.** Nobody has been recruited, approached, engaged, named or
pseudonymised. Every person-shaped value is the literal token `PENDING_PERSON`. There is no fee figure,
no signature, no declaration, no confirmation and no calendar date anywhere in this package. No
registration was performed, no frame was touched, no U1 execution occurred.

## Baseline

| Item | Value |
|---|---|
| Frozen protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — recomputed in this worktree |
| Candidate instrument (READ ONLY) | `C:/tmp/dt009-merge/tooling`, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, **594 files** — recomputed via `lib/aggregate.mjs` |
| Not read | any worktree's own `research/cpg-u1/tooling` — the stale 587-file tree (`640510…`) that runs fine and lies |
| Worktree base | `af2fb6e99ce461894bf16f18c2251f75088eba18` (detached) |
| Instrument modified? | **No.** Read-only throughout; the aggregate is unchanged |

## The eight roles

Enumerator A · Enumerator B · Reference Author · Reference Confirmer · Reference Adjudicator ·
Rater 1 · Rater 2 · Rating Adjudicator. The **operator** is separate and holds no independent role
(§4A.3; `lib/personnel.mjs:33`).

Eight slots over **seven** role strings: `lib/personnel.mjs:26` permits more than one holder for
`enumerator` and for no other role. **Both enumerator slots carry the literal role string
`enumerator`** — `enumerator-2` is refused as `unknown role` (`:31`).

## Files

| File | What it is |
|---|---|
| `RECRUITMENT_ROLE_MATRIX.md` | **The one-table answer.** Eight rows: what each role receives, never receives, produces, and who may not also hold it. Plus the mutual-exclusion graph stated as refusals, the seven declaration keys, and the §4A.3 ordering constraint |
| `PENDING_PERSON_REGISTER.json` | A single `cpg-u1-personnel/v1` register covering all eight roles with `PENDING_PERSON` placeholders. **Built to be refused by `check-personnel`, and must never pass** |
| `CHECK_PERSONNEL_EVIDENCE.md` | Four real runs of the frozen `check-personnel`, verbatim with exit codes: the register's refusal, the shared-fee-hash pass, the `enumerator-2` refusal, and the understatement demonstration |
| `RECRUITMENT_PACKAGE_ENUMERATORS.md` | All twelve items for Enumerator A and B |
| `RECRUITMENT_PACKAGE_REFERENCE.md` | All twelve items for Author, Confirmer and Reference Adjudicator |
| `RECRUITMENT_PACKAGE_RATING.md` | All twelve items for Rater 1, Rater 2 and the Rating Adjudicator |
| `PROHIBITED_RELATIONSHIPS.md` | The three families of prohibited relationship, all eight roles, the 36 + 9*d* pair set in both directions, and the three gaps in what the instrument catches |
| `CONFIDENTIALITY_REQUIREMENTS.md` | **NEW.** Clauses K-1…K-7 plus a role-specific K-8, four confidentiality classes, their durations, and what is explicitly **not** confidential |
| `DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` | **NEW.** Per-role deliverable as a column contract, and acceptance defined as "the frozen instrument does not refuse it" — never an operator's opinion of quality |
| `REPLACEMENT_PROCEDURE.md` | **NEW.** The three ineligibility triggers, the two-condition salvage test, and a per-role table of what is salvageable before and after each sealing boundary |

## The twelve items, and where each is covered

| Item | Enumerators | Reference | Rating | New in this wave? |
|---|---|---|---|---|
| role description | §1 | §1 | §1 | assembled |
| eligibility requirements | §2 | §2 | §2 | assembled |
| **prohibited relationships** | §3 + `PROHIBITED_RELATIONSHIPS.md` | §3 | §3 | assembled into one closed enumeration |
| independence declaration | §4 | §4 | §4 | assembled |
| fee / contract conditions | §5 | §5 | §5 | assembled |
| material-release conditions | §6 | §6 | §6 | assembled |
| **confidentiality requirements** | §9 | §9 | §9 | **NEW** |
| permitted information | §7 | §7 | §7 | assembled |
| prohibited information | §8 | §8 | §8 | assembled |
| **deliverables** | §10 | §10 | §10 | **NEW** as a column contract |
| **acceptance criteria** | §11 | §11 | §11 | **NEW** |
| **replacement if ineligible** | §12 | §12 | §12 | **NEW** |

## What this package builds on rather than duplicating

- `C:/tmp/dt009-closure/F-enumerators/` (6 files) — `PENDING_PERSONNEL_REGISTER.json`,
  `NON_DEPENDENCE_CONDITION.md`, `MATERIAL_RELEASE_JOINT_GATE.md`, `KNOWLEDGE_WINDOW_RULE.md`,
  `ENUMERATOR_WORK_ALLOCATION.md`, `ENUMERATOR_B_ROLE_AUTHORIZATION.md`
- `C:/tmp/dt008-prereg/C-enumerators/` (7) — `FEE_AGREEMENT_TEMPLATE.md`, `MATERIAL_RELEASE_GATE.md`,
  `ENUMERATOR_AB_DIFFERENCES.md`, `ENUMERATOR_B_AUTHORIZATION.md`, `ENUMERATOR_DEADLINES.md`, validator
- `C:/tmp/dt008-prereg/D-reference/` (10) — the three reference packets, the shared declaration,
  the release gate, the adjudication note, the workload note, validator
- `C:/tmp/dt008-prereg/E-rating/` (8) — the three rating packets, the release gate, the integrity notes,
  the workload note, validator
- `C:/tmp/dt004-operations/people/` (9) — role descriptions, dependency map, declaration template,
  invitation packet, eligibility/assignment workflow, four role packets

Those directories are **not modified** by this wave. Neither is `research/deeptech-operations/people/`,
`prereg-008/`, `prereg-009/` or `eight-person/` in this worktree.

## `.gitignore` hazard encountered and resolved

`.gitignore:77` is `ROLE_*.md`, which would silently swallow the directive's requested
`ROLE_MATRIX.md`. Confirmed with `git check-ignore -v`. The file is named
**`RECRUITMENT_ROLE_MATRIX.md`**, which `git check-ignore` reports as trackable. Also checked and
avoided: `*_CHECKLIST.md`, `*_READINESS*.md`, `*_RUNBOOK*.md`, `*_PLAN.md`, `*_SUMMARY.md`,
`*_REPORT.md`. Every file in this directory was run through `git check-ignore`; **none is ignored.**

## What this package deliberately does NOT do

- It does not name, approach, engage or recruit anyone.
- It does not fill a single placeholder.
- It does not modify the candidate instrument, the frozen protocol, the treatment, the evaluation tree
  or the registry.
- It does not commit, push, open a PR or merge anything.
- It does not register anything, use a network, use a credential, build a real frame or execute U1.
- It did not run the selftest, any mutation run, or a clean rebuild. Only `check-personnel`, four times,
  which is a pure JSON structure check and returns instantly.

## The honest limit of the whole package

`check-personnel`'s own header:

> *"The register itself is restricted; the tooling checks its STRUCTURE: every independent role filled,
> seven roles mutually exclusive, the operator in none, every §4A.1 declaration answered "no", and the
> §4A.1 evidence fingerprints present. **It cannot verify that declarations are true.**"*
> — `lib/personnel.mjs:1-3`

And §20.23: *"Personnel independence rests on declarations and organisational confirmation (§4A.1), not
on verifiable proof. The tooling checks the register's structure only."*

Every rule in this package is procedural. Its value is that it was written **before** any person existed
and before any outcome was known, so no result could have shaped it.
