# PRODUCT-IMPLEMENTATION-001 — Strategic Narrative Compatibility Guard Rails

**Assigned:** Agent 2 · **Authority:** PRODUCT-QUALITY-001 · **Priority:** Critical · **Type:** implementation (tests only).
**Date:** 2026-07-22. **Status:** complete, **uncommitted**.

---

## 1. Executive summary

PRODUCT-QUALITY-001 discovered that `campaign_angle` is a **control token**, not presentation text —
`recommendationSequencingService` matches `.includes('conversion')` to assign execution stages, and
`deriveAngleType` matches a trigger-word list to classify blog angles. Those were *arguments in a
document*. This package converts them into **executable gates**.

Delivered: a reusable compatibility harness (`backend/tests/support/`) plus a 13-test suite pinning
six contracts across the canonical 60-profile / 300-card corpus. **No product file was modified** —
the only runtime files in the working tree are PRODUCT-RESTORE-001's, unchanged by this package.

The harness is deliberately built so that a future narrative-quality package **writes no new
compatibility tests**: it passes its candidate producer to one function and inherits every guarantee.

## 2. Tests added

| File | Kind | Content |
|---|---|---|
| `backend/tests/support/strategicNarrativeCompatibility.ts` | **harness** (not a jest suite — `testMatch` is `**/*.test.ts`) | canonical corpus + 6 contract checkers + aggregate runner |
| `backend/tests/unit/strategicNarrativeCompatibility.test.ts` | suite | **13 tests / 13 passing** across Phases 1–5 |

## 3. Compatibility contracts covered

| # | Contract | Guarantee | Verified over |
|---|---|---|---|
| 1 | **`campaign_angle` token** | `"Conversion"` appears **iff** `diamond_candidate`; angle is non-empty and retains the `→` funnel shape; **all 5 production flag combinations exercised** (no missing combination) | 300 cards |
| 2 | **Angle classification** | no angle contains any `deriveAngleType` trigger token (`contrarian/challenge/myth/wrong/strategic/lever/outcome/decision/roi`); every angle classifies as `analytical` | 300 cards |
| 3 | **Execution-stage parity** | induced stage distribution equals the pinned reference `{education:60, authority:60, conversion:60}` | 60 cases |
| 4 | **`authority_reason` nullability** | `null` iff (not authority-elevated **or** no authority domains); non-empty string otherwise. Both branches proven non-empty (`nullCases + valueCases = 300`) | 300 cards |
| 5 | **Determinism** | 5 runs → identical values, identical SHA-256 hash, identical ordering; plus a purity check (an interleaved unrelated call cannot perturb output) | 60 cases × 5 runs |
| 6 | **Schema / serialization** | exactly the six snake_case keys, no extras; the five always-on fields are non-empty strings; `authority_reason` is `string \| null`; JSON round-trips losslessly; **canonical key order is stable**; enrichment is additive (source rec fields survive) | 300 cards |

The trigger-token list itself is pinned by a test, so if `deriveAngleType` gains a new trigger word the
harness fails and must be updated deliberately rather than silently drifting out of date.

## 4. Determinism verification

`checkDeterminism` runs the full corpus **5×** and compares (a) a SHA-256 hash of all produced
intelligence and (b) a separate hash of output ordering. Both collapse to a single distinct value.
A second test proves purity: producing case A, then an unrelated case, then case A again yields an
identical hash — so there is no ambient state, clock, or randomness.

## 5. Regression harness (Phase 5 — the reusable part)

```ts
import { runNarrativeCompatibilitySuite } from '../support/strategicNarrativeCompatibility';

it('candidate preserves all compatibility contracts', () => {
  runNarrativeCompatibilitySuite(myCandidateProducer);
});
```

`runNarrativeCompatibilitySuite(producer, opts?)` runs all six contracts and returns a
`CompatibilityReport`. Individual checkers are exported for finer-grained use. Intentional changes are
accommodated without weakening the gate — e.g. a package that *deliberately* introduces a strategic
angle passes `{ expectedAngleType: 'strategic' }`, making the change explicit and reviewable rather
than silent.

Also exported for reuse: `buildNarrativeCorpus()` (the canonical 60/300 corpus shared with
PRODUCT-VALIDATION-001 and PRODUCT-QUALITY-001), `STRATEGIC_FIELDS`, `ALWAYS_ON_FIELDS`,
`ANGLE_TYPE_TRIGGER_TOKENS`, `REFERENCE_STAGE_DISTRIBUTION`, `FLAG_SETS`, `hashOf`, `intelligenceOf`.

**The harness demonstrably bites.** A dedicated test feeds it two plausible-looking "improvements" and
asserts both are rejected:
- an angle rewritten to `'Pain → Awareness → Trust'` (drops `Conversion` → would silently change
  execution-stage assignment) → **throws**;
- an angle rewritten to `'Pain → Outcome → Conversion'` (introduces the `outcome` trigger → would
  silently reclassify blog angles as `strategic`) → **throws**.

These are exactly the two regressions PRODUCT-QUALITY-001 predicted a naive rewrite would cause.

## 6. Coverage report

| Dimension | Coverage |
|---|---|
| Corpus | 60 cases (10 industries × 3 maturity × rich/sparse) · **300 cards** |
| Polish-flag combinations | **5 / 5** exercised (asserted, not assumed) |
| `authority_reason` branches | both (null and non-null) exercised, summing to 300 |
| Profile completeness | rich **and** sparse (exercises every fallback chain) |
| Contracts | 6 / 6 |
| Suite result | **13 / 13 passing** |
| Wider regression | 14 suites pass; the 2 failures are the pre-existing Supabase-mock engine suites (unchanged, proven pre-existing in PRODUCT-RESTORE-001) |
| Typecheck — backend-tests project | **443**, identical to before this package (baseline 470) ⇒ the harness adds **zero** new type errors and stays ratchet-safe |
| Typecheck — main backend project | 1 pre-existing error in `pages/api/company-profile/index.ts`, a file this package never touched (it adds no product code) |

## 7. Risks

| Risk | Level | Note |
|---|---|---|
| Pinned reference drifts if the corpus changes | Low–Med | corpus lives in the harness and is versioned with it; changing it fails the parity test loudly — which is the intent |
| `deriveAngleType` gains a new trigger word | Low | the token list is itself pinned by a test; adding a word fails until the harness is updated |
| Harness gives false confidence about the *engine* | Low | it guards the producer + its downstream contracts, not the full engine (which is DB-bound and untestable here — see PRODUCT-RESTORE-001 §7). The engine **wiring** is separately guarded by the restore suite |
| Contract tests become a change-blocker | Low | intended; opts (`expectedAngleType`, `stageReference`) make deliberate changes explicit rather than blocked |

**Bug caught during authoring (worth recording):** my first schema check called `keys.sort()`, which
sorts **in place**, so the later key-order assertion compared insertion-order keys against a mutated
sorted array and failed. Fixed by sorting a copy — and the contract was then *strengthened* to pin
canonical key **order**, a guarantee the original assertion could not have made.

## 8. Final certification

**PRODUCT-IMPLEMENTATION-001 COMPLETE — COMPATIBILITY GUARDS ESTABLISHED.**

The repository now has automated protection ensuring future narrative-quality work cannot accidentally
alter execution-stage assignment, change angle classification, break the intelligence schema or
serialization contract, introduce nondeterminism, or regress restored `authority_reason` semantics —
verified by a suite that is proven to reject the two specific regressions PRODUCT-QUALITY-001
identified. **Tests only: no producer rule, template, wording, prompt, sequencing, planner, flag, or
runtime behaviour was modified.**
