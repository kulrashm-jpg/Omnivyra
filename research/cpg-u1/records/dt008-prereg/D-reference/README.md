# D-reference — onboarding packages for the three reference roles

**Classification: PREPARATION. This directory is not evidence.**

It records **no identity, no recruitment, no fee, no signature, no declaration, no
organisation confirmation and no reference value**. *Author*, *Confirmer* and *reference
adjudicator* are **slot labels** for three positions that are currently **UNFILLED**.
**No person has been recruited.** Nothing here may be filed, hashed, cited or registered
as a completed record.

> **The preparer of this directory is an AI and therefore holds no role in this study.**
> No AI system, agent or language model may hold the Author, Confirmer or reference-adjudicator
> role, may "assist" by producing a record a human then signs, or may be the source of any value
> entered in a blind record. A role ghost-written by an AI is not independent work: the §4A.1
> consequence applies and the reference truth is published as **not independent**.

## Unfilled-marker convention (inherited from `dt007-eight-person/F-recruitment/`)

Every field a real person or the operator must supply is written as

```
<<UNFILLED: what belongs here>>
```

and identity slots reuse the register's own token `UNASSIGNED`. Neither is data. **A document
that still contains any `<<UNFILLED: ...>>` marker is not a completed record.**
`REFERENCE_PACKET_VALIDATOR.mjs` refuses such a document mechanically.

## Baseline, recomputed by the author of this directory

| Thing | Value | How verified |
|---|---|---|
| Protocol | `research/cpg-u1/CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum` recomputed at `C:/tmp/dt002/research/cpg-u1/` → exact match |
| Registered instrument | aggregate sha256 `<NEW_AGG>` over **<NEW_N>** files | recomputed with the instrument's own `lib/aggregate.mjs` (`toolingManifest`) against `C:/tmp/dt002/research/cpg-u1/tooling` → exact match, `files <NEW_N>` |

**Recorded baseline discrepancy (not hidden, not worked around).** The worktree this package was
written in — `C:/tmp/dt5-ref`, detached at `af2fb6e99ce461894bf16f18c2251f75088eba18` — carries a
**stale 587-file** `research/cpg-u1/tooling` tree that is **not** the registered instrument.
Every rule cited in this directory was read from `C:/tmp/dt002/research/cpg-u1/tooling` (<NEW_N> files,
aggregate verified). Nothing in `C:/tmp/dt002` was written to. No protocol or instrument byte was
changed.

**Where the protocol and the tooling disagree, the protocol wins and the tooling is defective.**

## Files

| File | What it is |
|---|---|
| `REFERENCE_AUTHOR_PACKET.md` | Onboarding package for the Author slot |
| `REFERENCE_CONFIRMER_PACKET.md` | Onboarding package for the Confirmer slot |
| `REFERENCE_ADJUDICATOR_PACKET.md` | Onboarding package for the reference-adjudicator slot |
| `REFERENCE_INDEPENDENCE_DECLARATION.md` | **Shared.** The §4A.1 declaration form all three sign, unfilled |
| `REFERENCE_MATERIAL_RELEASE_GATE.md` | **Shared.** The operator's fail-closed checklist before any role material is released |
| `REFERENCE_WORKLOAD_NOTE.md` | **Shared.** The honest workload figure (90–330 records per recorder) and the earlier under-count |
| `REFERENCE_ADJUDICATION_NOTE.md` | **Shared.** Two verified facts about the decision space and the unadjudicated-difference refusal, plus one known defect |
| `REFERENCE_PACKET_VALIDATOR.mjs` | Deterministic checker: unfilled markers, missing files, declaration keys, hash shape, three-distinct-person rule |
| `test_reference_packet_validator.mjs` | Its tests |

## What this directory deliberately does **not** do

- It does not name, number or imply a candidate for any slot.
- It does not supply a date. Every deadline is expressed relative to an **operator-supplied anchor**.
- It does not fill any hash, fee, signature or confirmation.
- It does not construct, suggest or exemplify a reference value for a real company.
- It does not modify `reference/`, `human-min/B-reference/`, `eight-person/D-merge/`, the protocol
  or the instrument. Those are read-only inputs here.

## What it builds on, rather than duplicating

- `C:/tmp/dt004-operations/people/REFERENCE_TEAM_PACKET.md` — the §9.3/§9.4 working instructions for
  the two recorders. The Author and Confirmer packets here **reference** it and add what it lacks:
  per-slot eligibility, the never-receive list as a checkable list, the deadline anchors, the
  submission procedure, and the corrected record-format derivation.
- `C:/tmp/dt004-operations/people/REFERENCE_ADJUDICATION_PACKET.md` — the blinded-packet mechanics and
  the operator commands. The adjudicator packet here **references** it and adds eligibility, the
  §9.1 "Must not" column as an undertaking, the record format, and the relative deadline.
- `C:/tmp/dt004-operations/people/ROLE_DESCRIPTIONS.md`, `INDEPENDENCE_DECLARATION_TEMPLATE.md`,
  `ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md` — the register and workflow vocabulary.
- `C:/tmp/dt007-eight-person/F-recruitment/` — the marker convention and the per-role file structure
  this directory mirrors for the reference roles.

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

