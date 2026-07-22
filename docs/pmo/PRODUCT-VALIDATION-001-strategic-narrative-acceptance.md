# PRODUCT-VALIDATION-001 — Strategic Narrative Acceptance Review

**Assigned:** Agent 2 · **Subject:** PRODUCT-RESTORE-001 (flag `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED`).
**Type:** product validation only — **no code, no prompt, no implementation changes.** **Date:** 2026-07-22.

> Evaluation harness was throwaway and has been deleted. The working-tree diff is unchanged from
> PRODUCT-RESTORE-001; this review added no product code.

---

## 1. Method & scope

**Corpus — 60 company profiles**, constructed combinatorially (deterministic, no sampling):
10 industries (SaaS · fintech · healthcare · e-commerce · manufacturing · education · legal · real
estate · hospitality · logistics) × 3 maturity levels (early / growth / established) × 2 completeness
variants (**rich** = all narrative source fields; **sparse** = minimum fields, to exercise every
fallback chain). Each profile carries **5 recommendations** spanning the full polish-flag matrix
(diamond+authority, diamond, authority, generic-reframed, none) and a volume ladder that crosses the
rule-C 50%-of-max threshold. **300 cards per arm, 600 total.**

**Both arms executed against real product code** — `enrichRecommendationIntelligence`,
`enrichRecommendationCards`, `sequenceRecommendations`, `buildCampaignBlueprint`,
`buildRecommendationStrategicCard` → `cardToContentBridge`, and
`validateStrategicContentTransformation`. All are pure (verified: zero DB/AI/network imports), so the
comparison is real behaviour, not a simulation.

**Scope limit (stated plainly):** the full `generateRecommendations` engine is **not** executable in
this environment (it requires Supabase; its own suites fail on an incomplete mock — pre-existing, see
PRODUCT-RESTORE-001 §7). The engine's only role for this feature is *calling the producer*, which is
covered directly and by the wiring guard. Every one of the five requested comparison surfaces was
exercised.

## 2. Side-by-side (representative — SaaS, growth, rich)

| Field | Flag OFF (today) | Flag ON |
|---|---|---|
| `problem_being_solved` | `null` | "Helping RevOps leaders overcome fragmented revenue tooling — with focus on Revenue Operations Benchmarks" |
| `gap_being_filled` | `null` | "Audience lacks awareness of: how a unified pipeline view compounds over time" |
| `why_now` | `null` | "Audience attention already exists; opportunity is differentiation." |
| `authority_reason` | `null` | "Company has credibility in revenue operations." |
| `expected_transformation` | `null` | "Move audience from constant firefighting around fragmented revenue tooling toward a unified pipeline view through Revenue Operations Benchmarks" |
| `campaign_angle` | `null` | "Gap exposure → Education → Conversion" |

## 3. Measured results (60 profiles / 300 cards per arm)

| Surface / metric | OFF | ON | Read |
|---|---|---|---|
| **Recommendation cards** — core-5 fields populated | **0 / 300** | **300 / 300** | capability fully restored corpus-wide |
| **Content bridge** — synthetic sparse-card fallback fired | **60 / 60 profiles** | **0 / 60** | the generic-copy branch is fully eliminated |
| **Campaign sequencing** — stages produced | `awareness`, `authority` | `education`, `authority`, `conversion` | OFF collapses stages; ON classifies correctly |
| **Weekly plan / blueprint** — weeks containing generic filler | 240 / 240 | **180 / 240** | 25% reduction (see §5.3 — partial by design) |
| **Weekly plan** — week goals/topics changed | — | **240 / 240** | 100% of weekly copy changes: the blast radius |
| **Strategic validator** — retention / insight | **0 / 0** | **100 / 100** | OFF has *no signals to retain* |
| **Consistency** — non-deterministic profiles | — | **0 / 60** | byte-stable across repeat runs |

`authority_reason` is intentionally `null` when a company is not authority-elevated or has no
`authority_domains` (RULE D). Scoring the **five always-on fields** is therefore the correct
population metric; measuring all six would have understated it to 60/300.

## 4. Quality dimensions

| Dimension | Result |
|---|---|
| **Consistency** | **Pass.** 0/60 non-deterministic; identical inputs → byte-identical outputs. Structural consistency 300/300 on the core five. |
| **Factual grounding** | **Pass — 80.8%** of field values contain no token outside the source profile, the card topic, or the fixed template vocabulary. The remaining ~19% are *entirely* fixed template sentences (see specificity). **No value contained invented company facts** — the producer is template-composition over profile fields, with no LLM, so fabrication is structurally impossible. |
| **Specificity** | **Partial — 80.4%** of field values contain at least one company-specific token. The shortfall is structural: `why_now` (3 fixed sentences chosen by volume/alignment) and `campaign_angle` (4 fixed phrases chosen by polish flags) carry **no company data at all**. |
| **Repetition** | **Weakest dimension.** Distinct-value ratio across the 5 cards of one company: `problem_being_solved` **1.00**, `expected_transformation` **1.00** (topic-aware ✓) — but `gap_being_filled` **0.30**, `authority_reason` **0.30**, `why_now` **0.40**, `campaign_angle` **0.60**. A user viewing 5 cards sees the same "why now" and "gap" text repeated ~3–4 times. |
| **Narrative usefulness** | **Materially improved.** Validator 0→100; bridge fallback 60→0; sequencing gains `education`/`conversion` stages. Caveat: the validator's 100 is an upper bound by construction (evaluation content was derived from the ON narrative); the load-bearing comparison is that **OFF scores 0 on identical content because it has no signals at all**. |

## 5. Findings

**5.1 No regressions detected.** Across 600 card-evaluations and all five surfaces, no output was worse
under ON, no errors were raised, and determinism held. Nothing that previously worked stopped working.

**5.2 Repetition and specificity ceilings are pre-existing design limits, not restoration defects.**
Only rules A and E are topic-aware; B/C/D/F key off flags and profile fields, so they repeat across a
company's cards. This is faithful to the canonical implementation (PRODUCT-RESTORE-001 reproduced it
verbatim, correctly). Restoration did not *introduce* this — it made it **visible**, because
previously every field was null.

**5.3 Blueprint generic filler is only partially removed (240 → 180).** `buildWeekTopics` draws
several fallbacks from `company_context_snapshot` (a separate input the intelligence layer does not
feed); intelligence ON only displaces the one fallback it supplies (`problem_being_solved` →
`painState`). Enabling this flag alone will **not** fully de-genericize week topics.

**5.4 The blast radius is 100% of weekly-plan copy.** Every one of 240 weeks changed its goal/topics.
This is the intended effect, but it means enablement is a visible content change for every campaign,
not a silent improvement.

> **Process note:** my first harness read `blueprint.weeks` (the real property is `weekly_plan`) and
> therefore measured *nothing* on that surface, which would have been reported as "no change." I
> caught and corrected it before drawing conclusions. The blueprint numbers above are from the
> corrected run.

## 6. Recommendation — **ENABLE GRADUALLY**

Justification:

- **Not "keep disabled."** The current state is measurably broken, not merely feature-less: 0/300 cards
  populated, the content bridge's synthetic-copy branch firing on 100% of profiles, and the validator
  scoring 0 while reporting nothing missing. There are zero regressions blocking enablement.
- **Not "enable globally."** 240/240 weekly-plan goals change on flip — a user-visible copy change on
  every campaign — and no human has yet reviewed generated copy with the flag ON (removal criterion 3
  of PRODUCT-RESTORE-001 is unmet). The validator re-baseline (criterion 2) is also outstanding, and
  its distribution shift is now quantified (0 → 100 upper bound).

**Suggested ramp:** (1) enable for a small internal/design-partner cohort; (2) human copy review of
week topics + decision blocks against the §2 side-by-side; (3) re-baseline validator thresholds on
non-null intelligence; (4) widen. Rollback stays instant and zero-deploy (unset the env var).

**Follow-ups this review surfaced (not blockers, and out of scope here — no code changes made):**
- **V-1 (repetition):** make `gap_being_filled` / `why_now` topic- or signal-aware so cards stop
  repeating 3–4 of 6 narrative slots. Highest-leverage narrative-quality improvement.
- **V-2 (specificity):** `why_now` and `campaign_angle` are fixed constants; consider deriving at least
  one from company data.
- **V-3 (blueprint):** feed `company_context_snapshot` alongside intelligence so the remaining 180
  generic weeks resolve (§5.3).
- **V-4:** Planner still produces 4/6 (PRODUCT-ARCH-001 WP-3) — engine and Planner narratives will differ.

## 7. Certification

**PRODUCT-VALIDATION-001 COMPLETE — RESTORED NARRATIVES IMPROVE PRODUCT QUALITY; RECOMMEND GRADUAL ENABLEMENT.**

Zero regressions across 600 card-evaluations and five surfaces; unambiguous improvement on every
measured surface; two pre-existing narrative-quality ceilings (repetition, specificity) documented as
follow-ups rather than blockers.
