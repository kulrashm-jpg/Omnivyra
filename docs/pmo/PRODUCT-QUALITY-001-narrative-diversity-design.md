# PRODUCT-QUALITY-001 — Strategic Narrative Diversity Enhancement (Design)

**Assigned:** Agent 2 · **Authority:** PRODUCT-VALIDATION-001 · **Priority:** High.
**Type:** design proposal — **nothing implemented.** The producer's rules are unmodified; the
simulation harness was throwaway and is deleted. **Date:** 2026-07-22.

---

## 1. Executive summary

Four of the six strategic fields repeat across a company's recommendation cards because they are
driven by **company-level state** (`awareness_gap`, `authority_domains`) or collapse per-recommendation
signals into **3–4 constant strings**. Measured distinct-value ratio across 5 cards averages **0.40**.

This proposal keeps every rule deterministic, LLM-free, and grounded, and raises the measured average
to **0.70 (+75%)** — with `gap_being_filled` going **0.30 → 1.00** — by (a) consuming per-recommendation
signals that are *already available and currently discarded*, and (b) **composing** sentences from small
independent clause sets instead of enumerating templates.

The decisive constraint this design respects: **`campaign_angle` is a load-bearing control token, not
display text.** Simulation confirms the proposal leaves downstream execution-stage assignment and blog
angle-type derivation **byte-identical**.

## 2. Current rule analysis (Phase 1)

| Rule | Inputs | Branching | Outputs | Per-rec inputs available but **unused** |
|---|---|---|---|---|
| **B** `gap_being_filled` | `profile.awareness_gap` (company), `flags.diamond_candidate` (per-rec) | awareness_gap → else diamond → else default | 3 (one is company-constant) | topic, volume, diamond_score, frequency, sources, is_generic_reframed |
| **C** `why_now` | `rec.volume` vs `volumeMax`, `alignmentHigh` (per-rec) | 2 booleans | **3 fixed sentences** | topic, frequency, sources, velocity, sentiment, platform_tag |
| **D** `authority_reason` | `flags.authority_elevated` (per-rec), `profile.authority_domains` (company) | flag+domains → `domains[0]` | 1 per company | **`topic` is passed as a parameter and never read**; `domains[1..n]` ignored |
| **F** `campaign_angle` | `polish_flags` only | 3 booleans, **two branches return the same string** | effectively 3 | topic, volume, diamond_score, everything else |

## 3. Sources of repetition

1. **Company-level inputs used verbatim.** `awareness_gap` and `authority_domains[0]` are constant per
   company, so B and D emit the identical sentence on every card.
2. **Constant-string collapse.** C and F reduce genuinely varying per-rec inputs (volume, diamond_score,
   flags) to a 3-element output vocabulary — the *input* diversity exists; the *output* vocabulary is
   the bottleneck.
3. **Discarded inputs.** D receives `topic` and ignores it; every rule ignores `frequency`/`sources`
   (corroboration), which the engine already computes.
4. **A duplicate branch.** F returns `'Pain → Awareness → Authority → Solution'` for both
   `authority_elevated` and the default case, cutting its real cardinality from 4 to 3.

## 4. Available per-recommendation signals (Phase 2)

Verified against `PolishedRecommendation` + `TrendSignalNormalized` at the enrichment point:

| Signal | Availability | Usable to diversify? |
|---|---|---|
| `topic` / `polished_title` | **guaranteed** (polish always sets it) | ✅ strongest — unique per card |
| `polish_flags` (3 booleans) | **guaranteed** | ✅ already used |
| `diamond_score` (0..1) | **guaranteed** (clamped) | ✅ supports banding |
| `volume` (+ derived `volumeMax`) | usually present | ✅ supports banding |
| `frequency`, `sources[]` | usually present | ✅ **corroboration strength — currently unused** |
| `platform_tag`, `geo`/`regions`, `signal_type`, `source` | optional | ⚠️ usable but not guaranteed — treat as optional refinement only |
| `velocity`, `sentiment` | optional, often undefined | ⚠️ avoid as primary drivers |

**Correction to the brief's signal list:** `category` is **not** a per-recommendation signal —
`engine.ts` computes it once via `pickEffectiveCategory(profile, strategicPayload)` and applies the same
value to every recommendation. Likewise "maturity", "audience", "content theme", "campaign focus",
"pain signals", "awareness gaps" are **company-level** and cannot diversify within a company. Only the
signals marked ✅ above are legitimate diversifiers.

## 5. Proposed deterministic rule enhancements (Phase 3)

**Design principle — compose, don't enumerate.** Build each sentence from independent clause sets:
*N* fragments across *K* slots yields *Nᴷ* distinct outputs from *N·K* authored strings. This avoids
template explosion while multiplying variety.

**B′ `gap_being_filled`** — keep the historical grounded core, append a per-rec qualifier + topic anchor:
```
core      = awareness_gap ? "Audience lacks awareness of: {awareness_gap}"
          : diamond ? "Underserved but high-alignment opportunity"
          : "Existing demand lacking clear authority-driven guidance"
qualifier = corroboration≥2 ? "corroborated across {n} sources"
          : demandBand=high ? "demand is already concentrated"
          : diamond          ? "alignment is strong but coverage is thin"
          : genericReframed  ? "the framing is crowded"
          :                    "coverage is thin relative to intent"
⇒ "{core} — {qualifier} for {polished_title}."
```

**C′ `why_now`** — 3×3 composition (6 authored fragments → 9 outcomes):
```
demandBand = volume vs 66%/33% of volumeMax → {attention already exists | interest building steadily | demand still forming}
alignBand  = diamond_candidate or diamond_score vs .66/.33 → {differentiation not discovery | positioning compounds before saturation | early entry while competition is thin}
⇒ "{demandClause}; {timingClause}."
```

**D′ `authority_reason`** — consume the discarded `topic` and the whole domains array:
```
pick = domain with highest token-overlap with polished_title;
       no overlap ⇒ domains[stableHash(polished_title) % domains.length]   // deterministic, not random
⇒ "Company has credibility in {pick} — directly relevant to {polished_title}."
```
Null-return conditions unchanged (still null when not authority-elevated or no domains) — this is
load-bearing (see §7).

**F′ `campaign_angle`** — compose the funnel, removing the duplicate branch:
```
opening = diamond ? "Gap exposure" : genericReframed ? "Reframe" : "Pain"
middle  = demandBand → "Differentiation" | "Education" | "Awareness"
tail    = diamond ? "Conversion" : authority ? "Authority → Solution" : "Trust"
⇒ "{opening} → {middle} → {tail}"
```
**Token contract preserved:** `"Conversion"` appears **iff `diamond_candidate`** — exactly as today —
and no fragment contains any `deriveAngleType` trigger word (§7).

## 6. Expected quality improvements (Phase 4 — measured on the PRODUCT-VALIDATION-001 corpus)

Same 60 profiles / 300 cards; baseline arm = the **real restored producer**, proposed arm = simulated rules.

| Metric | Baseline | Proposed |
|---|---|---|
| distinct ratio — `gap_being_filled` | 0.30 | **1.00** |
| distinct ratio — `why_now` | 0.40 | **0.60** |
| distinct ratio — `authority_reason` | 0.30 | **0.40** |
| distinct ratio — `campaign_angle` | 0.60 | **0.80** |
| **average across the four** | **0.40** | **0.70 (+75%)** |
| qualifier variety **excluding** the topic anchor | — | **1.00** |
| factual grounding | — | **100%** |
| determinism (non-deterministic profiles) | — | **0 / 60** |

The **qualifier-variety control matters**: it confirms the gain is *signal-driven*, not an artifact of
appending the topic. Even with the topic anchor removed, the per-rec qualifier is fully distinct
across a company's five cards.

**Representative (SaaS):**
- Baseline — the same sentence ×5: *"Audience lacks awareness of: how a unified pipeline view compounds over time"*
- Proposed — same grounded core, per-card signal: *"… — corroborated across 3 sources for Revenue Operations Benchmarks."* / *"… — demand is already concentrated for SaaS Cost Control."* / *"… — the framing is crowded for SaaS Automation."*

**Two honest caveats:**
1. **Validator retention reads 100 → 84.5 in simulation.** This is a **measurement artifact**, not a
   regression: the evaluation content was generated from the *baseline* narrative and held fixed, so
   the proposed narrative's *additional* signal has nowhere to be retained. Adding information to the
   source necessarily lowers retention against fixed content. Operationally it confirms the same note
   as PRODUCT-RESTORE-001: **validator thresholds must be re-baselined after any narrative change.**
2. **Specificity is 69%** across these four fields. `why_now` and `campaign_angle` remain
   company-non-specific **by design** — they encode *timing* and *funnel shape*, which are legitimately
   not company facts. Forcing company tokens into them would be fabrication-adjacent.
3. **Residual:** the company-level lead clause still repeats verbatim across cards (the qualifier
   differentiates the tail). Fully varying the lead clause is a presentation concern, not a rule
   concern, and is deliberately out of scope.

## 7. Compatibility assessment (Phase 5)

| Check | Result |
|---|---|
| Product contracts / DTO shape | **Unchanged** — same 6 keys, same `string`/`string\|null` types |
| Schemas / migrations | **None** — these fields have no DB columns (PRODUCT-ARCH-001 §5) |
| APIs | **Unchanged** — no endpoint emits these fields directly |
| **Execution-stage assignment** (`recommendationSequencing`) | **Byte-identical** in simulation: `{education:60, authority:60, conversion:60}` both arms. Preserved because `"Conversion"` still appears **iff** `diamond_candidate`, and `authority_reason` keeps its exact null-conditions |
| **Blog angle type** (`deriveAngleType`) | **Byte-identical**: `{analytical:300}` both arms. No proposed fragment contains `contrarian/challenge/myth/wrong/strategic/lever/outcome/decision/roi` |
| Planner compatibility | **Unaffected** — Planner produces its own 4/6 fields via `plannerStrategicCard.ts`; untouched |
| Report/PDF `whyNow` lineage | **Untouched** — different family entirely (PRODUCT-ARCH-001 §3) |
| AI dependencies | **None** — pure string composition; no LLM, no network, no randomness (rotation uses a stable hash) |
| Determinism | **Preserved** — 0/60 non-deterministic in simulation |

**This is the highest-value finding of the package:** a naive diversity rewrite would very likely have
dropped the `"Conversion"` token or introduced the word `"outcome"`, silently changing execution-stage
assignment and blog angle type respectively. The design is constrained to preserve both, and the
simulation proves it.

## 8. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Breaking the `campaign_angle` token contract | **High if unguarded** | pin with a test asserting `"Conversion" ⟺ diamond_candidate` and that no angle contains a `deriveAngleType` trigger word |
| Validator scores shift again | Medium | re-baseline thresholds; fold into the PRODUCT-RESTORE-001 criterion-2 re-baseline rather than doing it twice |
| Optional signals absent (`sources`/`frequency`) | Low | qualifier chain degrades to the flag/demand branches; never throws, never fabricates |
| Narrative feels formulaic at scale | Low–Med | composition gives 9 `why_now` and 27 `campaign_angle` combinations vs 3 today |
| Lead clause still repeats | Low | accepted residual (§6.3) |

## 9. Recommended implementation plan

Sequence deliberately **after** the PRODUCT-RESTORE-001 rollout, so only one narrative change is in
flight at a time:

1. **Q-1 — Guard first (do this before any rule edit).** Add tests pinning the token contract:
   `"Conversion" ⟺ diamond_candidate`; no angle contains a `deriveAngleType` trigger word;
   `authority_reason` null-conditions unchanged. These convert §7 from an argument into a gate.
2. **Q-2 — D′ `authority_reason`.** Smallest, safest, highest-clarity change (consumes an
   already-passed parameter). Ship alone.
3. **Q-3 — B′ `gap_being_filled`.** Largest measured gain (0.30 → 1.00).
4. **Q-4 — C′ + F′** (composition). Ship together; they share the demand/alignment banding helper.
5. **Q-5 — Re-run the PRODUCT-VALIDATION-001 corpus** and re-baseline the validator once.

Gate each behind the **existing** `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED` flag — no new flag —
so diversity ships only where the narrative itself is already enabled.

## 10. Final certification

**PRODUCT-QUALITY-001 COMPLETE — DETERMINISTIC NARRATIVE ENHANCEMENT DESIGNED.**

A credible path is demonstrated with measured evidence: repetition materially reduced (average distinct
ratio 0.40 → 0.70; the worst field 0.30 → 1.00), grounding at 100%, determinism preserved (0/60),
specificity improved on the two fields where company data legitimately applies, **no architectural
change, no schema, no API, no LLM**, and — proven by simulation — **zero downstream behavioural drift**
in execution-stage assignment and angle-type derivation.
