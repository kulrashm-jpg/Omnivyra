# LIVE REPORT 1 SCORING CONTRACT

| | |
|---|---|
| **Scope** | Report 1 / Digital Snapshot — the public-domain scoring model as implemented |
| **Established** | Wave 4A, 2026-10-06 |
| **Source of truth** | the code cited below, not this document; where they disagree the code is correct and this document is a defect |

> **The audit's proposed 9-pillar / 196-or-197-row framework is NOT the current product scoring contract and is NOT adopted by Wave 4A.**
>
> That framework is an audit *proposal* — it was never implemented, and its headline percentages
> (implementation coverage, capability maturity, evaluable coverage, and the 196/197 denominator)
> are audit-level classifications of a spreadsheet, not product scoring semantics. The live model
> is **5 pillars and 9 canonical dimensions**, described below. Nothing in the audit's matrix,
> its pillar-equal weighting proposal, its fixed denominator, or the `D12 — Local discovery` row
> participates in any customer-facing Report 1 score.

---

## 1. The five live pillars

`canonicalReportTypes.ts` (`PILLAR_META`): `foundation` · `authority` · `discoverability` · `trust` · `momentum`.

There are no pillar weights. Pillars are not weighted against one another; the overall score is a
geometric mean over the pillars that have usable evidence (§5). Introducing weights would be a new
scoring architecture and is explicitly out of scope.

## 2. The nine live canonical dimensions

`CanonicalDimensionKey` in `canonicalReportTypes.ts`:

| Pillar | Dimensions |
|---|---|
| Foundation | `index_integrity` · `extraction_readiness` · `accessibility` |
| Authority | `authority_inflow` · `entity_graph_strength` |
| Discoverability | `topical_authority` · `ai_surface_presence` |
| Trust | `trust_coherence` |
| Momentum | `authority_velocity` |

Dimensions are equally weighted *within* a pillar (§4). A pillar with more dimensions therefore
has finer granularity, not more influence on the overall score.

## 3. Evidence states, and which ones score

The vocabulary is `ScoreState` = `measured | inferred | insufficient_signal | unavailable`.
There is no separate scoring vocabulary and no second provenance system.

`isMeasured(value, state)` in `canonicalReportBuilderInputs.ts` decides contribution:

```
contributes  ⇔  typeof value === 'number'
                 && state !== 'insufficient_signal'
                 && state !== 'unavailable'
```

So:

| State | Contributes a value? | Meaning |
|---|---|---|
| `measured` | **yes** | directly observed |
| `inferred` | **yes** | derived from evidence, or a directional proxy — not itself observed |
| `insufficient_signal` | **no** | looked, could not establish anything |
| `unavailable` | **no** | could not look — no provider, no credential, no source |

**Inferred evidence does contribute to the score.** That is deliberate: a directional proxy is
still information, and excluding it would publish fewer numbers rather than more honest ones. What
is forbidden is presenting it *as* an observation — see §6.

## 4. Pillar aggregation

`aggregatePillarScore` (`canonicalReportBuilderInputs.ts`):

- **Value** — the arithmetic mean of the contributing dimensions, `Math.round`ed.
- **No contributors** — `emptyCanonicalScore('insufficient_signal')`: the value is **`null`**, never `0`.
- **State** — `measured` only when every dimension contributes **and every contributor is itself
  `measured`**; otherwise `inferred` if at least one contributes; otherwise `insufficient_signal`.

The second half of that state rule is Wave 4A's correction. Previously the state was decided by
count alone, so a pillar built entirely from inferred proxies was published as `measured`.
Authority is exactly that shape — both its dimensions are on-page proxies, and `BR-H-001` already
downgrades `authority_inflow` to `inferred` for this reason, only for the pillar above it to
relabel the pair as observed. **The correction changed no value**; `isMeasured` is untouched and
the mean is identical.

## 5. Overall aggregation

`aggregateOverallScore`:

- **Value** — the **geometric mean** of the contributing pillars, `Math.round`ed and clamped to
  `0..100`. A geometric mean is used so a single weak pillar drags the total rather than being
  averaged away.
- **No contributors** — `insufficient_signal` with a **`null`** value.
- **State** — `measured` only when every pillar contributes **and every contributor is itself
  `measured`**; `inferred` when at least `ceil(pillars/2)` contribute; otherwise
  `insufficient_signal`.

## 6. Observed · inferred · proxy · unavailable

| Rule | Where it is enforced |
|---|---|
| a proxy may not render as direct observation | `resolveAuthorityInflowState` (`BR-H-001`): a `measured` state without a real `backlink_api` source is downgraded to `inferred` |
| an on-page heuristic may not claim an external measurement | `entity_graph_strength`'s rationale states it is *"Inferred from on-page entity clarity … not a measurement of knowledge-graph presence or sameAs linkage"* |
| a pillar may not claim observation its dimensions lack | `aggregatePillarScore` / `aggregateOverallScore` (§4, §5) |
| the customer can see which it is | `renderPillar` prints the pillar's evidence state beside its band (Wave 4A); `buildDataConfidence` counts all four states for the Data Confidence & Coverage section |
| unavailable never becomes a zero | `isMeasured` excludes it; an empty pillar is `null`, not `0` |

## 7. The denominator is DYNAMIC, and that is disclosed rather than fixed

The live denominator is **measurement-dependent**: a dimension with no usable evidence is excluded
from its pillar's mean, and a pillar with no usable evidence is excluded from the overall geometric
mean. There is no fixed denominator, and Wave 4A deliberately did not introduce one.

The consequence must be stated plainly, because it is counter-intuitive: **missing evidence can
raise the composite**, since removing a weak pillar raises the geometric mean of those that remain.
This is why coverage must be published alongside performance and never folded into it:

```
performance score  = what the usable evidence says about the dimensions that had evidence
evidence coverage  = how much of the scoring surface actually had usable evidence
```

These are separate readings of the same report. A score never implies that unmeasured dimensions
were measured, and the coverage surfaces that disclose this are:

- **Data Confidence & Coverage** — `buildDataConfidence`: counts of `measured` / `inferred` /
  `insufficient_signal` / `unavailable` across every pillar and dimension;
- **the pillar card** — each pillar's own evidence state (Wave 4A);
- **evidence readiness** — rendered as report *completeness*, explicitly not as authority.

## 8. Rounding and null behaviour

`Math.round` at the pillar and overall level; the overall value is additionally clamped to
`0..100`. A score that cannot be computed is `null` with a non-contributing state. **`null` is
never coerced to `0`, and `0` is only ever a real measurement of zero.**

## 9. Content Freshness is a proxy, not Momentum history

`authority_velocity`, labelled **"Content Freshness"**, is the Momentum pillar's only dimension. It
is a single-snapshot heuristic over the current crawl.

- It is **a current directional proxy**, not a trajectory, not change over time, and not historical
  momentum.
- Where history is absent the report must say historical evidence is unavailable or insufficient. It
  must not imply a trajectory.
- Wave 3's comparability machinery (`comparabilityIdentity`: `company_id`, `subject_domain`,
  `scan_profile`, `engine_version`) establishes *how* genuine history will be compared. It does not
  create history, and a single snapshot is still not a trend.

Renaming this dimension, or making Momentum history-based, is a **parked owner decision**
(audit §34.7) and was not done here.

## 10. Authority treatment

External authority requires external evidence. `authority_inflow` is an on-page credibility proxy,
not backlink inflow; `backlinksState` is `unavailable` whenever no backlink provider answered; a
Wikidata no-hit is `unavailable` with a `null` score, never a measured zero; and a **genuine**
provider-reported zero — Ahrefs answering zero — **remains a measured zero**, because a provider
answering zero is evidence.

The names `Authority Inflow`, `backlinks_score` and `competitor_backlink_advantage` still read as
external measurements. Their renaming is a **parked owner decision**, not settled here.

## 11. Trust treatment

`trust_coherence` can only be measured by a review provider. The `REMEDIATION-002` provenance
boundary keeps private/platform-derived signals out of Report 1, so without a configured review
source Trust is `unavailable` — not a low score. Unavailable reputation evidence never becomes
negative performance.

## 12. AI treatment

Coverage divides by **measurable** cells, not the enumerated grid, because only a
retrieval-grounded adapter can ever produce a measured cell and dividing by the whole grid reports
a shortfall no operator can close. A probe with no subject identity is refused *before* any paid
call and reported `unavailable` / `no_identity`, which can never be read as a rate. A grounded,
sourced answer that does not name the company is a **genuine measured zero** and is preserved as
one. The citation-density label states its own population:
`"${citedCells} of ${observedAiCells} measured cells citing reliably"`.

### Two coverage figures, two denominators, both correct

The AI surface carries **two** coverage figures. They answer different questions, so they
deliberately divide by different populations. Reading one as a stale version of the other is the
mistake this section exists to prevent.

| | Citation-rate / measurement coverage | AI coverage qualifier (grid shortfall) |
|---|---|---|
| Question | *Of the cells that were structurally measurable, how much was actually measured?* | *Of the enumerated provider × query-class grid, how much produced a measurement?* |
| Expression | `measured_cells / measurable_cells` | `measured_cells / total_cells` |
| Where | `retrieval_consistency_pct` (`intelligenceSurfacesCompetitive`) | `aiCoverageGate.coverageLabel` |
| Emitted | always, as the customer-visible rate | only when `supportsGeneralClaim` is false, paired with the providers that were not queried |
| `measurable_cells === 0` | `null` — no percentage exists | still discloses `0 of N`, because the shortfall is the point |

**`coverageLabel` is correct by design, and `total_cells` is its correct denominator.** It is not a
coverage ratio at all: it names its own unit — `"N of M provider × query-class cells measured"` — and
it exists solely to qualify a sentence that would otherwise generalise over AI systems the report
never asked. `aiCoverageQualifier` returns `''` whenever `supportsGeneralClaim` holds, so the label
appears only alongside `unqueriedLabel`, which names the silent providers.

`supportsGeneralClaim` is **provider-quantified** (`providers.length > 0 && unmeasuredProviders.length === 0`),
not cell-quantified, because the gated claims quantify over AI systems rather than over cells.

Switching `coverageLabel` to `measurable_cells` would **regress the GAP-12 protection**: with no
provider or an unresolved identity the denominator is 0, so the disclosure would vanish entirely;
with partial coverage it would read "8 of 10" while hiding the structurally unmeasurable cells that
no operator asked. Either outcome restores absence-of-evidence-as-evidence-of-absence, which is
precisely what GAP-12 closed.

This item is **closed as correct by design**. No production behaviour change is required, and the
exact-string test that pins `"4 of 20 provider × query-class cells measured"` is the negative
control: it fails if the denominator is ever switched.

## 13. What this contract does not define

Deliberately absent, because each is an unresolved owner decision rather than an implementation
detail: adoption of the 9-pillar framework · the 196/197 fixed denominator · `D12 — Local
discovery` · business-weighted pillars · historical Momentum · the Authority naming questions ·
the audit's Implementation Coverage, Capability Maturity and Evaluable Coverage metrics, which are
audit-level framework classifications and are **not** live product scores.

`aiCoverageGate.coverageLabel` was previously listed here as unresolved. It is **no longer open** —
§12 settles it as correct by design.
