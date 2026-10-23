# PI-ADR-009 — source precedence for conflicting person observations

**Status:** ACCEPTED by the programme owner, 2026-09-26.
**Base SHA:** `8621b1d93cb6f6a878c0156277c9f5112949fb0a` · **Decision id:** `OD-PRECEDENCE` (PI-LEAD-FOUNDATION-002, Part 2).
**Closes:** the `PRECEDENCE UNDECIDED` state recorded by `PI-SIM-001`.
**Does not change:** `PI-ADR-002`, `PI-ADR-006`, `PI-ADR-007`, `PI-ADR-008`.

---

## 1. The decision

The owner was offered the broad model written into the brief and chose a **narrower** one. The narrower rule is what is recorded, because the broad one is not what was approved:

> **Sales Navigator is authoritative ONLY for `current title` and `current company`.
> Every other field — including seniority — is resolved by recency and confidence rather than by source.
> All observations are retained regardless.**

So this ADR deliberately does **not** grant Sales Navigator authority over LinkedIn identity, person identity, or seniority, even though the brief's example list named them. Recording the broader rule would have meant implementing a policy the owner declined.

## 2. The three rules

**RULE 1 — Authoritative fields.** For `job_title` (current title) and the employer identity (current company), a Sales Navigator observation outranks every other source **where Sales Navigator actually supplies one**. Absence is not authority: if Sales Navigator says nothing about the field, it does not win it by default, and the field falls to Rule 2.

**RULE 2 — Everything else: recency, then confidence.** For every other attribute, the canonical value is the most recently observed one. Ties on `observedAt` are broken by the higher stated confidence. Ties on both are unresolved and reported as such rather than settled by source name or array order, because an arbitrary tiebreak that looks deterministic is worse than an admitted one.

**RULE 3 — Nothing is destroyed, ever.** Selection is a *read-time* decision over retained observations. Every observation keeps its source, value, `observedAt` and confidence. A conflict is a fact about the evidence, not a defect to be cleaned up, and a later precedence change must be able to re-decide from the same evidence.

## 3. Worked example, from `PI-SIM-001`

| Source | `job_title` | observed |
|---|---|---|
| Sales Navigator | `VP Marketing` | 2026-09-05 |
| Apollo | `Marketing Manager` | 2026-09-08 |
| ZoomInfo | `Head of Marketing` | 2026-09-08 |

Canonical `job_title` = **`VP Marketing`** by Rule 1 — and note that it wins **despite being the oldest observation**. That is the point of an authority rule: without Rule 1, recency would have selected a vendor value. All three observations remain queryable with their provenance.

For a field Sales Navigator does not supply — `email`, say — Rule 2 applies and the vendor observation is simply the answer, not a fallback.

## 4. What this is not

- **Not a merge rule.** It selects a canonical value for display and downstream use; it does not merge people. Identity remains W1's, duplicates remain LI-4C's.
- **Not a write authority.** It does not widen who may write to the spine. LI-2 remains the single writer, and `decideCanonicalUpdates` keeps its own never-overwrite rule; this ADR governs *which observation is canonical*, not *whether a row may be updated*.
- **Not a trust score.** Confidence is a tiebreak within Rule 2 only. It never lets a high-confidence vendor value beat Sales Navigator on an authoritative field, because that would reintroduce by arithmetic exactly what Rule 1 decides categorically.
- **Not applicable to a source that says nothing.** A null or blank observation is not a claim and never competes.

## 5. Verification standard

Both directions must be proven: that Sales Navigator wins `job_title` and `current company` even when older, and that it does **not** win `seniority` or `email` — that second half is what distinguishes the approved narrow rule from the broader one that was declined. Retention must be proven independently of selection: every observation still present after a selection has been made.

## 6. Open

Ties on both `observedAt` and confidence are reported unresolved. If that turns out to happen in practice, the tiebreak is a further owner decision and not an implementation detail.
