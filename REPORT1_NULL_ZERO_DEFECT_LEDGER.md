# Report 1 — Material Defect Ledger: unavailable evidence treated as measured evidence

**Workstream:** pre-T3 material closure, Workstream D (documentation reconciliation)
**Written at:** `9bd50179` on `pre-t3/d-documentation` (parent `43b60e89`, the T2-verified
integrated tree carrying all eleven Report 1 workstreams)
**Compiled:** 2026-10-03
**Type:** Record. No production code was written or modified to produce this document.

> **Read the integration column before acting on anything here.** Four of the six fixes are in
> the integrated tree. **Two are not** — they are on Workstream B's branches and are recorded
> here so the release record is accurate, not because they have landed.

---

## 1. THE DEFECT CLASS

**Unavailable evidence treated as measured evidence.**

Six distinct instances have now been found and closed across Report 1. In every one, a value the
repository itself declares `number | null` *because it may never be observed* was converted to
the number `0` — by `?? 0`, by a zeroed whole-object default, or by an empty-set average — and
the resulting `0` was then consumed as though it were an observation: subtracted, averaged,
ranked, thresholded, or rendered to a customer.

Two properties recur in all six and are what makes the class hard to see:

1. **`0` is arithmetically and type-wise indistinguishable from a measurement.** Under this
   repository's `"strict": false` compiler, `x ?? 0` is well-typed under every setting and every
   type shape (measured in `WP13_NULL_CONTRACT_DECISION.md` section 3.4, at `3e4c502d`). Nothing
   flags it.
2. **A denominator that does not follow the evidence.** Where an average was involved, the
   numerator lost real values to absence while the divisor stayed pinned at the full dimension
   count — so the output was dragged toward parity in proportion to how little was actually known.

**Scope of this claim.** Six instances of one class in one report pipeline is a strong empirical
finding about Report 1's competitive-evidence path. It is **not** a general theory of this
codebase, and nothing here should be read as one. `?? 0` is correct in many places — the
enumerated fence at `33a399d7` explicitly permits `decision.confidence_score ?? 0` and
`decision.effort_score ?? 0` in the same file where it forbids others, because those are
decision-prioritisation inputs and not comparative evidence. The defect is not the operator. It
is the operator applied to a field that is nullable *because it may be unobserved*.

---

## 2. STATUS VOCABULARY

These five are kept apart deliberately and are never collapsed into "done".

| Status | Means |
|---|---|
| **FIXED** | A code change exists that removes the defect. Says nothing about where it is integrated. |
| **VERIFIED** | A committed test pins the fix, and the implementing workstream recorded a differential (fails without the production hunk, passes with it). Workstream D executed no suite — the heavyweight gate is a global mutex held centrally. Every VERIFIED below rests on the implementing workstream's recorded differential plus a first-hand read of the production code at the named commit. |
| **BLOCKED** | Cannot proceed without an authorization or resource this workstream does not hold. |
| **DEFERRED** | Known, decided, deliberately not now. |
| **NOT WIDENED** | A nullable value is still flattened to `0` in a persisted wire shape, by an explicit standing decision, and therefore still arrives at readers as an indistinguishable zero. |

---

## 3. THE LEDGER — SIX INSTANCES

| # | Site | Consequence | Commit(s) | Status | In `43b60e89`? |
|---|---|---|---|---|---|
| 1 | `reportCompetitorIntelligenceServiceEngine.ts` into `subtractMetrics` with a null company baseline; `ServiceModel.ts` `EMPTY_COMPARISON_METRICS` | **Silent total report loss**, and a zeroed company baseline published as a measurement | WP-12 `6dd5e487`, `34681e6a` | FIXED - VERIFIED | **Yes** |
| 2 | `snapshotReport/visualIntelligenceHelpers.ts` — competitor standing | Every standing diluted **1/5 toward parity** | WP-15 `a10c429c` | FIXED - VERIFIED | **Yes** |
| 3 | `snapshotReport/actionHelpers.ts` — competitive delta average | Market position averaged unobserved axes as parity | WP-17 `3e369f4a` | FIXED - VERIFIED | **Yes** |
| 4 | `snapshotReport/actionHelpers.ts` — empty-set average into minus fifty | **"Ahead of the market" published on zero competitive evidence** | WP-18 `6a05fd31` | FIXED - VERIFIED | **Yes** |
| 5 | `snapshotReport/competitorSummaryHelpers.ts` — the company radar baseline (**computation layer**) | Competitor's absolute score published as a measured gap; primary-gap narrative and `competitive_position` both wrong | WP-13 `33a399d7` | FIXED - VERIFIED | **No** — `pre-t3/b-wp13-null-hardening` |
| 6 | `export/reportHtmlSectionsExtended.ts` — `renderSection7BacklinkAuthority` (**export consumer**) | Competitors' entire average rendered to the customer as "Authority Gap Vs Competitors" | WP-13 `f83551d8` | FIXED - VERIFIED | **No** — `pre-t3/b2-defect6-authority-abstention` |

### 3.1 Defect #1 — null baseline into subtractMetrics - FIXED - VERIFIED

`subtractMetrics` dereferences its right-hand operand, so an unguarded null company baseline
threw a `TypeError` for every successfully crawled competitor. The throw was not contained as a
degraded section: it propagated out of `composeSnapshotReport` (which has try/finally and no
catch) to `reportCardServiceAssembly.ts`, which logs "composed report generation failed" and
rethrows **only** for `requestedCategory === 'performance'`. Report 1 is `snapshot`, so the whole
composed report was lost silently. Separately, `comparison.company ?? EMPTY_COMPARISON_METRICS`
published a baseline of zero on all seven dimensions — a positive claim that the company has no
content, no authority and no coverage.

Fixed at both call sites, which now read
`resolution.metrics && companyMetrics ? subtractMetrics(...) : null`
(`Engine.ts:522` and `:808`, each carrying a WP-12 comment). `EMPTY_COMPARISON_METRICS` is gone
and `comparison.company` is `ComparisonMetrics | null`. Read first-hand at `43b60e89`.

**The containment trace above is a code trace, not an execution.** It is recorded as such in
`docs/WP14_REAL_TENANT_VALIDATION.md` section 4b and is repeated with the same caveat here.

### 3.2 Defect #2 — geo_presence zero-default in competitor standing - FIXED - VERIFIED

An average over five dimensions feeding `clamp(parity - avgDelta * slope)`. `geo_presence` is null
on every report by construction, so a fabricated parity reading entered the numerator while the
denominator stayed 5: a competitor genuinely 10 points ahead across the four observed axes was
published as 8 ahead. WP-15 `a10c429c` filters to `typeof value === 'number' &&
Number.isFinite(value)` before averaging, and the entry drops out entirely when nothing was
observed.

**Note on how it was fixed.** WP-15 used a local filter over the same hand-written five-element
literal, which still names `geo_presence`. The symptom is gone; the shape that produced it —
iterating a dimension set as if it were uniform — is unchanged at that site.

### 3.3 Defect #3 — competitive delta average in market position - FIXED - VERIFIED

`assessPositioningAndMarket` averaged three delta dimensions with zero-defaults and the
denominator pinned at 3. WP-17 `3e369f4a` replaced the coercions with the same `typeof` +
`Number.isFinite` guard and let the denominator follow the observed count. WP-17 records this
instance as **inert at the time of the fix** — those three are the non-nullable members of
canonical `ComparisonMetrics` — and says so rather than claiming a live defect.

### 3.4 Defect #4 — empty-set average produces "ahead" - FIXED - VERIFIED

The sharpest customer-facing instance, and it was live. `average([])` returns `0`, so with no
competitive evidence at all `competitorPressure` is 0, `avgDelta` becomes minus 50, the threshold
`avgDelta <= -4` is satisfied, and **Report 1 told the customer it was ahead of the market on zero
competitive evidence.** `buildCompetitorGaps` returns an empty array whenever the company baseline
is null or no competitor was observed, which was the production shape. Fixed by WP-18 `6a05fd31`.

Here the empty set, not a zero-default, was the collapse — the same class reached through a
different operator. The sibling `impact_score` zero-default was a dead branch and WP-18 documents
it as such rather than claiming it as the cause.

### 3.5 Defect #5 — the company radar baseline, in the COMPUTATION layer - FIXED - VERIFIED

`backend/services/snapshotReport/competitorSummaryHelpers.ts`, commit **`33a399d7`** (parent
`43b60e89`).

`buildCompetitorVisuals` built `competitor_positioning_radar.user` by reading five `number | null`
axes with a zero-default, and `buildCompetitorIntelligenceSummary` subtracted that flattened
baseline from the leading competitor to publish the keyword / authority / answer gaps, rank them
to choose the primary gap narrative and its three recommended actions, average them into
`competitive_position`, and cite them in the evidence sentence. `backlinks_score` is null whenever
no backlink source is wired — the producer's documented steady state, tagged `ScoreState`
`unavailable`.

WP-13 proved it by execution before the fix, on the real path with a gate-passing competitor and
no mocks: a competitor scoring 80 on authority produced an 80-point "authority gap", won the
primary-gap ranking outright, and dragged `competitive_position` to `lagging` through a five-axis
average containing two fabricated zeroes (40.8 against 64).

The fix introduces `deriveUserRadarAxisValues` as the single derivation of the baseline, guarding
on the raw value before any coercion, and makes `buildCompetitorIntelligenceSummary` require that
`number | null` record. Both averages now run over exactly the axes each side was observed on.

**It also landed the enforcement mechanism** `backend/tests/unit/report1NullContractTripwire.test.ts`
— the source-text fence specified as D5 in `WP13_NULL_CONTRACT_DECISION.md`, over nine comparison
**producer** modules.

### 3.6 Defect #6 — the same unobserved authority, in the EXPORT CONSUMER - FIXED - VERIFIED

`backend/services/export/reportHtmlSectionsExtended.ts`, `renderSection7BacklinkAuthority`,
commit **`f83551d8`** (parent `33a399d7`, unmodified).

Pre-fix, read first-hand at `33a399d7` line 188, the code computed the competitor average
authority minus the persisted user authority with a zero-default on the user side, whenever any
competitor was on the radar, and rendered the result to the customer in a card labelled
**"Authority Gap Vs Competitors"**. With the company's authority unobserved and
`user.authority_score` persisted as `0`, the customer saw the competitors' entire average
presented as a measured gap. Pre-fix test output, verbatim, with competitors at 80 and 70:

    Expected: "Not Available"
    Received: "75/100"

**The fix is evidence-state based, never a test for zero** — read first-hand at `f83551d8`
lines 208 to 217. It derives `observedCompanyAuthority` only when `backlinkStrength` is STRONG or
INFERRED and both the company backlinks score and the persisted user authority are finite numbers;
otherwise null.

A null gap selects the `score-missing` class and the `displayScore(null, 'MISSING')` abstention
path **that this section already had and simply never reached**. The STRONG/INFERRED versus
WEAK/MISSING split is the one the section already drew; Report 1 admits INFERRED as a displayable
provenance class, disclosed rather than withheld. No new plumbing, no new state, no wire-type
change; thresholds, weights, authority scoring, competitor ranking and the competitor-side average
are untouched.

7/7 focused tests. The differential was proven in both directions: reverting only the production
hunk returns 1 failed / 6 passed; restoring it returns 7/7. Test B pins that a **genuinely
observed 0 still yields the full 75-point gap** — the explicit guard against a "fix" by testing
for zero.

---

## 4. THE GENERALISABLE LESSON: FIXING THE PRODUCER DOES NOT FIX THE CONSUMERS

This is the reason defect #6 existed, and it is the one finding here that generalises beyond its
own site.

Defect #5 fixed the **computation layer**. It did so correctly and completely for what it owned:
`buildCompetitorIntelligenceSummary` now consumes the honest `number | null` record rather than
the flattened one. But #5 deliberately **did not widen the persisted wire shape**. At
`f83551d8:competitorSummaryHelpers.ts` lines 172 to 176 the published object still applies a
zero-default to each axis.

So the honest baseline exists *inside* the producer, and a flattened zero is still what leaves it.
Every downstream reader of `competitor_positioning_radar.user` therefore still receives a value in
which "observed 0" and "never observed" are the same number — and `reportHtmlSectionsExtended.ts`
read it back and subtracted it.

**The fence inherited the same assumption, and said so in writing.** The header of
`report1NullContractTripwire.test.ts` at `33a399d7` states its producer-only scope and its reason:
that renderers are deliberately excluded because they re-read values already non-nullable on the
persisted wire, where a zero-default is a defensive default rather than a collapse of unavailable
evidence.

**Defect #6 falsified exactly that sentence.** The renderer's zero-default was *not* defensive,
because the non-nullable value it defended was itself a fabricated zero manufactured upstream. The
nine fenced files do not include `reportHtmlSectionsExtended.ts`, and nothing in the producer-side
fix or the producer-side fence could have caught it.

The same file's header is candid about the limit in general terms: a new nullable dimension nobody
adds to these lists is not fenced, and it is a regression fence for a measured, enumerated defect
class rather than a detector for the next one. That caveat is correct and must be carried forward;
defect #6 is the first demonstration of it.

**Stated as narrowly as the evidence supports:** where a nullable value is flattened to a
non-nullable wire representation, correcting the producer's own arithmetic does not correct the
readers of that wire. Each consumer that makes a comparative or customer-facing claim from the
flattened value needs the availability signal independently. Six instances support this for Report
1's competitive-evidence path. They do not establish it for the codebase at large.

---

## 5. STANDING ITEMS, CLASSIFIED

| Item | Status | Detail |
|---|---|---|
| The persisted radar zero | **NOT WIDENED** | `competitor_positioning_radar.user` axes are still published with a zero-default. Deliberate: widening is a wire change, held out of scope by `WP13_NULL_CONTRACT_DECISION` section 3.7 / D8, because `ComparisonMetrics` and the radar are **persisted** payloads read back by `reportComposedMapper.ts` from already-stored reports. Changing the shape breaks every stored report and every downstream reader. **Consequence that must stay on the record: every consumer of this wire still receives an indistinguishable zero, and must obtain availability from a sibling signal — exactly as `f83551d8` does.** |
| Customer-facing consumers must respect evidence/availability state | **FIXED at the two known sites; NOT systematically enforced** | #6 is the only export-layer consumer audited and corrected. The availability signals already exist in the same payloads (`seo_capability_radar.data_source_strength`, `ScoreState` / `ScoreEnvelope`, `metrics_state` / `metrics_basis`), so no new plumbing was needed at either site. No audit has established whether other export or view consumers derive comparative claims from a flattened wire value. **That is an open question, not an assertion that others exist.** |
| Observed zero must remain distinguishable from unobserved | **VERIFIED as a design constraint at both #5 and #6** | Neither fix tests for equality with zero. #5 guards on the raw `number \| null` before coercion; #6 guards on `backlinkStrength` plus finiteness. #6's test B pins that a genuinely measured 0 still produces the full 75-point gap, and #5's suite pins that a genuinely measured 0 still produces the pre-fix verdict. A future "fix" by zero-testing would fail both suites. |
| Enforcement fence (`report1NullContractTripwire.test.ts`) | **FIXED (landed at `33a399d7`) - scope limited to nine producer modules** | Renderers excluded by design; see section 4. Extending it to consumers is not proposed here — that is a decision for whoever owns the fence, and this document does not make it. |
| WP-13 remedy (d), parts D1 / D2 / D3 | **DEFERRED** | `comparisonArithmetic.ts`, the `COMPARABLE_DIMENSIONS` production partition and the `MetricDeltas` type do not exist in `43b60e89`. `CRAWL_OBSERVED_DIMENSIONS` and `CRAWL_UNOBSERVED_DIMENSIONS` still have **zero production consumers**. The four `as number` casts in `subtractMetrics` remain. |
| WP-13 section 3.3 figures (84 scoped-strictness errors, 11 in-scope) | **DEFERRED — stale, not re-measured** | Measured at `3d643f5c`. The document's own section 7 warns they are stale and must be re-measured if the argument is reopened. Re-measurement needs the typecheck mutex and was not performed. |
| Integration of defects #5 and #6 into the release tree | **BLOCKED** | Both are on Workstream B's branches (`pre-t3/b-wp13-null-hardening`, `pre-t3/b2-defect6-authority-abstention`) and neither is in `43b60e89`. Integration is the orchestrator's call, not this workstream's. |
| `WP8_LINKEDIN_FEASIBILITY_DECISION.md` (`9d247025`) and `WP13_NULL_CONTRACT_DECISION.md` (`3e4c502d`) | **BLOCKED** | Both decision records still live only on their own unmerged branches. The cherry-pick that would bring them into the release tree was denied by the permission classifier and needs the user's authorization. WP-13's document is cited throughout this ledger and is currently **not in the tree that cites it**. |

---

## 6. CORRECTION TO THE RECORD — a previously recorded residual is no longer valid

**The superseded claim.** Workstream B's residual note, recorded before defect #6 was found,
stated that no comparative claim currently derives from the persisted radar zero.

**It was wrong, and defect #6 is the counterexample.** `renderSection7BacklinkAuthority` derived
a comparative claim — "Authority Gap Vs Competitors" — directly from the persisted radar zero and
rendered it to the customer. The error was not careless: it followed from the same producer-only
reasoning the fence states in its own header (section 4), namely that a value already non-nullable
on the wire is safe for a renderer to default. The persisted zero made that reasoning unsound.

**What replaces it:**

> At least one comparative, customer-facing claim did derive from the persisted radar zero —
> `renderSection7BacklinkAuthority`'s "Authority Gap Vs Competitors" — and it is **FIXED** at
> `f83551d8` by gating on evidence state rather than on the value. The persisted radar zero is
> **NOT WIDENED**, so it remains a wire representation in which observed and unobserved are the
> same number. The producer-side fence does not cover renderers and says so. Whether any other
> consumer derives such a claim from that wire is **an open question that no audit has settled** —
> it is not asserted here either way.

The superseded sentence is recorded rather than deleted: it is the reasoning that allowed #6 to
reach a customer, and a reader needs to see what was believed, when, and what changed it.

---

## 7. WHAT THIS DOCUMENT DOES NOT CLAIM

- It does not claim the class is exhausted. Six instances were found by six separate
  investigations; each of the last two was found only because someone looked at a layer the
  previous one did not own.
- It does not claim any consumer beyond `renderSection7BacklinkAuthority` is affected. No such
  audit has been run.
- It does not propose widening the persisted wire shape, extending the fence to renderers, or any
  other change. Those are decisions for their owners.
- It reports no executed test result of its own. Every differential cited is the implementing
  workstream's, recorded in its commit message; every code quotation is a first-hand read at the
  named commit.

---

*Documentation only. No TypeScript file was created or modified, no test was executed, no
heavyweight gate was run, and no branch was merged, integrated or pushed in producing this record.*
