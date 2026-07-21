# PB-011 — Type Debt Attribution & Ratchet Enforcement

**Status:** Engineering complete. **Authority:** PMO-002. **Program:** B. **Agent:** 1 (Platform/Core).
**Zone:** tooling/governance only — no runtime, product, or test code touched. **Date:** 2026-07-21.

Changes: `scripts/typecheck-certification.js` · `scripts/lib/typecheckFingerprint.js` (new) ·
`scripts/typecheck-certification-fingerprints.json` (new artifact) ·
`scripts/typecheck-certification-baseline.json` (note corrected; **numbers untouched**) ·
`package.json` (one script added) · `docs/TYPESCRIPT-VALIDATION-STRATEGY.md` ·
`docs/ENGINEERING-GOVERNANCE.md` · this doc.

---

## 1. The gap PB-011 closes

PB-009 established, and PB-010 lowered, a **scalar** type-debt baseline:

```json
{ "tsconfig.backend.json": 1, "tsconfig.backend-tests.json": 470 }
```

A total answers *how many* errors exist. It cannot answer *which*. That is exploitable without
any bad intent:

> **Fix one baselined error and introduce a different one.** The total is still 470. The gate
> is green. Brand-new type debt is now permanently inside the baseline, and nobody is
> attributed.

This is not hypothetical — it is how PB-005/PB-008 put 4 type errors into this surface with no
attribution. A ratchet that only compares totals cannot detect it, by construction.

## 2. The fingerprint

```
identity = (repo-relative file path, TS error code, normalized message)
value    = count of occurrences in that bucket
```

**Line and column are deliberately excluded.** They shift whenever anything above the error is
edited. A line-keyed baseline would report a storm of false "new errors" on every commit, and
would be regenerated until it meant nothing — the failure mode that turns a ratchet into
ceremony. File + code + message is invariant under pure line drift (proven, Control 0) and
still specific enough that a *different* mistake in the *same* file yields a *different*
identity (proven, Control 1).

**Message normalization** strips only what is machine-dependent: CR/whitespace runs, the
absolute repo root (→ `<root>`), and Windows separators inside path-like tokens. Identifier and
type text is **not** blurred — that text *is* the identity, and softening it would let a new
mistake reuse an existing fingerprint.

**Counts per bucket** mean three identical errors in one file cannot quietly become four
(proven, Control 6).

Sample (`scripts/typecheck-certification-fingerprints.json`):

```json
"tsconfig.backend-tests.json": {
  "total": 470,
  "files": {
    "backend/tests/integration/campaign_preemption_execution.test.ts": [
      { "code": "TS2339", "message": "Property 'logId' does not exist on type 'PreemptionAttemptResult'.", "count": 1 }
    ]
  }
}
```

## 3. Decision rules

| Situation | Verdict |
|---|---|
| fingerprint absent from baseline | **NET-NEW → FAIL** |
| fingerprint present but count exceeds baseline | **NET-NEW → FAIL** |
| fingerprint present at or below baseline count | pre-existing debt → informational, never fails |
| fingerprint gone / count lower | **REDUCED → PASS** + re-baseline instruction |
| everything matches | **PASS** at baseline |

Existing debt never fails a build. Reductions are never punished.

## 4. Attribution

Net-new errors are matched against the files this change touched. Resolution order:

1. `--base <ref>` or `TYPECHECK_ATTRIBUTION_BASE` → `git diff <merge-base>..HEAD` + working tree
2. `GITHUB_BASE_REF` (CI pull requests) → same, against `origin/$GITHUB_BASE_REF`
3. default: working tree vs `HEAD` — tracked edits **and** untracked files

`[ATTRIBUTED]` = the error is in a file this change touched. `[UNATTRIBUTED]` = a cascade from
an edit elsewhere, or git was unavailable. **Attribution is evidence, never an escape hatch: an
unattributed net-new error still FAILS**, and the report says plainly that it was not
attributable.

## 5. Anti-gaming properties (all preserved or strengthened)

- **Coverage assertion (PB-009) intact.** Files are enumerated from disk and matched against
  `tsc --listFiles`; dropping a failing file from a project still FAILs instead of lowering the
  count. Verified at 2961/2961 and 1111/1111.
- **Scalar ratchet (PB-009/PB-010) intact.** Unmodified logic, unmodified numbers.
- **`npm run typecheck:ci` untouched.** `scripts/typecheck-all.js`,
  `scripts/typecheck-baseline.js` and `scripts/typecheck-baseline.json` are byte-for-byte
  unchanged.
- **Parser completeness assertion (new).** If the fingerprint parser ever sees fewer
  diagnostics than the raw `error TS\d+` count, the run FAILs — an unrecognised `tsc`
  diagnostic shape can never become a hiding place.
- **Cross-artifact integrity (new).** The scalar baseline's totals must equal the fingerprint
  baseline's enumerated totals, or the run FAILs. A half-update cannot reopen the scalar hole.
- **Guarded re-baselining (new).** `npm run typecheck:certification:baseline` refuses to run
  under CI, refuses to raise a total, and refuses to absorb a net-new fingerprint without an
  explicit `--accept-new-debt` that prints every absorbed error. Re-baselining is a reviewed
  governance act, never a build side effect.

## 6. Grandfathered debt

The 4 PB-005/PB-008 errors are **already absorbed inside the 470**. The count-only baseline
recorded no identity for them, so there is nothing to diff them against and they **cannot be
retroactively attributed**. They are grandfathered as pre-existing debt. Attribution begins
from this baseline forward.

## 7. Corrected `strictNullChecks` finding

PB-010's baseline note asserted: *"117 of the remaining 470 are TS2339 false positives …
TS2339 drops 227 → 110 genuine."* PB-011 re-measured (TypeScript 5.9.2, 2026-07-21,
`tsc -p tsconfig.backend-tests.json --noEmit --strictNullChecks`). **It does not reproduce.**

| Metric | non-strict (current) | `--strictNullChecks` | Δ |
|---|---|---|---|
| **total errors** | **470** | **595** | **+125 (+27%)** |
| TS2339 | 227 | 156 | −71 (≈15% of backlog, not 25%) |
| TS2322 | 49 | 94 | +45 |
| TS2345 | 33 | 89 | +56 |
| TS2352 | 74 | 81 | +7 |
| TS18048 | 26 | 40 | +14 |
| TS18047 | 0 | 23 | +23 |
| TS2571 | 0 | 18 | +18 |
| TS18049 | 0 | 18 | +18 |
| TS2454 / TS2783 / TS18046 / TS2698 / TS2739 | 0 | 6 / 4 / 4 / 2 / 1 | +17 |

The **underlying insight is real** — TypeScript does not narrow boolean-discriminated unions
(`{ok:true}|{ok:false}`) when `strictNullChecks` is off, so some TS2339 in this corpus are
narrowing artifacts, not defects. But the **magnitude was overstated by ~65%**, and the note as
written implied that enabling strictness would *reduce* debt when it *increases* measured debt
by ~27%.

**`strictNullChecks` is a debt-*disclosure* lever, not a debt-*reduction* lever.** It reveals
~125 real null/undefined hazards the current configuration hides. Enabling it is a separately
budgeted remediation programme. **PB-011 changed no strictness setting and no tsconfig.**

## 8. Validation

Real repo, both projects: coverage **2961/2961** and **1111/1111**; scalar **1/1** and
**470/470**; fingerprints **at baseline, 0 net-new** → PASS.

Negative controls (see §Validation in the PB-011 execution report): pure line drift → PASS;
**same-count-different-error (470→470) → old scalar gate PASSES, PB-011 gate FAILS** and names
the new fingerprint; net-new in a changed file → FAIL `[ATTRIBUTED]`; debt reduction → PASS;
no change → PASS; cascade in an untouched file → FAIL `[UNATTRIBUTED]`; extra duplicate of a
baselined fingerprint → FAIL.

Two controls were additionally run **end-to-end through real `tsc` and the shipped script**:

1. a scratch `.ts` fixture with one deliberate error → `471/470` **FAIL** with the net-new
   fingerprint `[ATTRIBUTED]` to the untracked fixture, coverage correctly rising to
   `1112/1112` (the disk walk stays honest);
2. the decisive one, without touching any test file: one identity in the committed baseline
   was replaced so the baseline described error *A′* while the repo still contained error *A*
   — arithmetically identical to a developer fixing *A′* and introducing *A*. Result:
   `errors: 470 (baseline 470) — PASS — at baseline, no regression` from the scalar gate,
   and **`FINGERPRINT FAIL — 1 net-new type error(s)`** from PB-011, naming *A* and stating
   that the 1 resolved error does not offset it. `--update-baseline` against the same state
   was **REFUSED**.

Both fixtures were removed and the baseline restored to a byte-identical SHA-256. `CI=1`
re-baseline → **REFUSED**. All scratch files deleted.

Jest regression baseline (16 suites) re-run unchanged: **440/440**.
