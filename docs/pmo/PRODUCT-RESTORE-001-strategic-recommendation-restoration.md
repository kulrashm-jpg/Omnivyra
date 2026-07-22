# PRODUCT-RESTORE-001 — Strategic Recommendation Intelligence Restoration

**Assigned:** Agent 2 (Product Architecture) · **Authority:** PRODUCT-ARCH-001 (decision locked).
**Type:** restoration, not redesign. **Date:** 2026-07-22. **Status:** complete, flag-dark, **uncommitted**.

---

## 1. Executive summary

The deterministic Strategic Recommendation Intelligence producer — destroyed as collateral in the
901-file bulk commit `6cd30522` — has been restored from its canonical historical implementation and
reconnected to the recommendation engine on both the primary and fallback paths, behind a
default-OFF feature flag.

The six strategic fields are produced again. The type collision that allowed the capability to vanish
silently is resolved. The two orphaned suites are no longer orphaned, and 11 new regression tests
(including an **anti-silent-loss wiring guard**) pin the restoration. Measured impact: the strategic
validator moves from scoring **nothing** (0 signals, vacuously 0) to **83% signal retention over 6
real signals**.

## 2. Files modified

| File | Change |
|---|---|
| `backend/services/strategicRecommendationIntelligenceService.ts` | **NEW** — restored producer (rules A–F verbatim) + feature flag |
| `backend/services/recommendationIntelligenceService.ts` | Phase 1: `RecommendationIntelligence` → `SeoGrowthRecommendationIntelligence` + deprecated alias |
| `backend/services/analyticsEnterpriseSnapshotService.ts` | Phase 1: import/usage → explicit name (type-only) |
| `backend/services/leadGenerationAuthorityIntelligenceService.ts` | Phase 1: import/usage → explicit name (type-only) |
| `backend/services/recommendationEngine/engine.ts` | Phase 3/4: producer re-imported; both no-op sites re-wired, flag-gated |
| `backend/tests/unit/recommendationIntelligenceEnrichment.test.ts` | Import repointed to the restored module |
| `backend/tests/unit/companyContextFoundationFix.test.ts` | Import repointed to the restored module |
| `backend/tests/unit/strategicRecommendationIntelligenceRestore.test.ts` | **NEW** — 11 regression tests |
| `docs/pmo/PRODUCT-RESTORE-001-…md` | This report |

**No schema. No migration. No UI/prompt/planner/validator redesign. No LLM.**

## 3. Type collision resolution (Phase 1)

Two incompatible concepts shared the export name `RecommendationIntelligence` — which is precisely
*why* the producer could be deleted without a compile error.

- SEO/growth analytics domain → **`SeoGrowthRecommendationIntelligence`** (`{status, recommendations}`),
  with `export type RecommendationIntelligence = SeoGrowthRecommendationIntelligence` retained and
  `@deprecated` for backward compatibility.
- Narrative domain → **`StrategicRecommendationIntelligence`** (the six fields), in the new module.

Both consumers (`analyticsEnterpriseSnapshotService`, `leadGenerationAuthorityIntelligenceService`)
migrated to the explicit name. **Type-only; zero runtime behavior change**, as Phase 1 requires.
`lib/recommendationStrategicCard.ts` was *not* a third collision — it declares the six fields as an
inline anonymous block, not a competing named export.

## 4. Producer restoration (Phase 2)

Restored from `git show 6cd30522^:backend/services/recommendationIntelligenceService.ts`. Rules **A–F**
are reproduced verbatim — same priority chains, same 0.5 popularity/alignment thresholds, same literal
output sentences, same non-null `catch` fallback. Every `CompanyProfile` field the rules read
(`core_problem_statement`, `pain_symptoms`, `campaign_focus`, `content_themes`, `target_audience`,
`target_customer_segment`, `ideal_customer_profile`, `target_audience_list`, `authority_domains`,
`life_with_problem`, `desired_transformation`, `life_after_solution`, `awareness_gap`) was verified to
still exist on the current type, and `PolishFlags` matches exactly.

**Deviations — three, all declared in the file header, all naming-only or provably behaviour-neutral:**

| # | Deviation | Justification |
|---|---|---|
| D1 | Module renamed → `strategicRecommendationIntelligenceService.ts` | the historical filename now belongs to the SEO/growth domain; restoring into it would re-create the exact ambiguity that caused the loss |
| D2 | `RecommendationIntelligence` → `StrategicRecommendationIntelligence`; `EnrichedRecommendation` → `StrategicallyEnrichedRecommendation` | Phase 1 explicit domain naming. Shapes byte-identical |
| D3 | Dropped one dead local (`const vol = …`, declared and never read) | unread assignment; `buildWhyNow` computes its own. Provably behaviour-identical; avoids a no-unused-vars violation |

No business rule was changed.

## 5. Engine integration (Phase 3)

Both historical call sites restored with their original control flow:

- **Primary path** — after `polishRecommendations`, before card rendering: `if (enriched.length > 0) trendsUsed = enriched`.
- **Fallback path** — the original ternary: `enrichedFallback.length > 0 ? enrichedFallback : polishedFallback`.

Data path validated end-to-end: producer writes `intelligence` onto `trendsUsed` → `trends_used: trendsUsed`
(engine.ts:1054) → `enrichRecommendationCards` (engine.ts:1130) normalizes `card.intelligence` with `?? null`.
The **null-only pass-through is cured at its cause** (the missing producer). `recommendationCardEnrichmentService`
was deliberately *not* modified — it is a legitimate shape-guarantor that now receives real data;
rewriting it would be the redesign this package forbids.

**The unrelated Report/PDF/Decision-Intelligence `whyNow` lineage was not touched** (verified: no file in
that lineage is in the diff).

## 6. Feature flag design (Phase 4)

`STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED` — enabled only on the exact string `'true'`.

- **OFF (default):** both sites short-circuit; `trendsUsed` / `polishedFallback` carried forward unchanged
  — byte-identical to the no-op pass-through it replaces. All six fields keep resolving to `null`.
- **ON:** the complete restored behaviour.

The flag guards **integration only**; the producer itself is pure and unflagged, so it stays directly
testable and there is a single auditable decision point. **Removal criteria** are documented in the
module header: (1) one full production generation cycle with no regression; (2) validator score
distribution re-baselined against non-null intelligence; (3) one human review of generated week-topic /
decision-block copy with the flag ON.

## 7. Validation results (Phase 5)

| Suite | Result |
|---|---|
| `strategicRecommendationIntelligenceRestore` (new) | **11/11 pass** |
| `recommendationIntelligenceEnrichment` (orphaned → restored) | **pass** — the producer's own historical tests are green again |
| `recommendationCardEnrichment`, `strategicContentTransformationValidator`, `recommendationSequencing`, `recommendationBlueprintService`, `recommendationPolishSimulation` | **26/26 pass** |
| `companyContextFoundationFix` | 22/25 — section 6 (`awareness_gap → gap_being_filled`) **green**; 3 failures are `buildCompanyMissionContext` returning `null` |
| Backend typecheck (`tsconfig.backend.json`) | **0 errors** |
| Backend-tests typecheck | 443 (baseline 470); **all 8 recommendation-intelligence fingerprint errors eliminated** |

**Honest attribution of the remaining red.** Two engine suites (`recommendationFallbackSignal`,
`recommendationEngineCharacterization`) fail with `ownedDbTable(...).select(...).eq(...).single is not a
function` — an incomplete Supabase mock at `engine.ts:165` (profile fetch), upstream of both my call
sites. **Proven pre-existing**: I backed up my `engine.ts`, reverted it to HEAD, re-ran, and the suites
failed *identically* (5 failed / 14 passed), then restored my version. The 3 `companyContextFoundationFix`
failures are the same class (DB-dependent path returning null) and were previously **invisible** because
that suite died at import — restoring the import made pre-existing failures *visible*, which is an
improvement in transparency, not a regression. **I did not silence them.**

## 8. Before / after behavioural analysis (Phase 7)

Measured with a representative profile (B2B founders · "inconsistent content prioritization" ·
diamond+authority flags · volume at max):

| Field | Before | After |
|---|---|---|
| `problem_being_solved` | `null` | "Helping B2B founders overcome inconsistent content prioritization — with focus on Content Prioritization" |
| `gap_being_filled` | `null` | "Audience lacks awareness of: how compounding beats volume" |
| `why_now` | `null` | "Audience attention already exists; opportunity is differentiation." |
| `authority_reason` | `null` | "Company has credibility in content strategy." |
| `expected_transformation` | `null` | "Move audience from scattered ad-hoc posting toward a predictable authority engine through Content Prioritization" |
| `campaign_angle` | `null` | "Gap exposure → Education → Conversion" |

**Strategic validator (measured, same `final_content` both runs):**

| Metric | Before | After |
|---|---|---|
| `signal_preservation.retention_score` | **0** | **83** |
| `insight_transfer.insight_transfer_score` | **0** | **83** |
| `missing_signals` | 0 *(vacuous — zero signals existed)* | 1 *(real, actionable)* |

The "before" 0 was **vacuous**: with all six null the validator collected *no signals*, so it scored 0
while reporting nothing missing. Post-restoration it measures 6 real signals at 83% retention and
correctly flags 1 gap — feedback that was previously impossible.

**Downstream (from the PRODUCT-ARCH-001 consumer map, now unblocked):** `recommendationBlueprintService`
stops interpolating its hard-coded generics (`'current pain patterns'`, `'the current market shift makes
this urgent'`, …) into generated week topics; `cardToContentBridge`'s sparse-card branch (`:280–303`),
which previously fired *always*, stops firing; `recommendationSequencing` can classify `education` /
`authority` stages instead of collapsing to `awareness`; the card UI's Diamond Intelligence section
renders instead of hiding.

## 9. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Generated copy changes (week topics, decision blocks) from generic → specific | **Medium — the real one** | flag default OFF; removal criterion (3) requires a human copy review before unflagging |
| Validator scores rise off a silent 0 | Medium | expected and now *measured* (0→83); removal criterion (2) requires re-baselining |
| Planner (4/6) vs engine (6/6) narrative divergence | Low–Med | unchanged by this package; tracked as PRODUCT-ARCH-001 WP-3 |
| Deprecated `RecommendationIntelligence` alias lingers | Low | `@deprecated`, zero remaining importers; delete in a later hygiene pass |
| Pre-existing engine-suite mock failures | Low | proven pre-existing; separate fix, deliberately not silenced |

## 10. Rollback strategy

1. **Instant, zero-deploy:** unset `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED` (or set ≠ `'true'`).
   Both call sites short-circuit and behaviour returns byte-identically to pre-restoration.
2. **Code-level:** revert the engine diff — the producer module becomes inert (imported, never called).
3. **Full:** revert all files in §2. The Phase-1 rename is independently safe to keep (type-only, alias
   retained) and can be preserved even if the restoration itself is rolled back.

## 11. Final certification

**PRODUCT-RESTORE-001 COMPLETE — STRATEGIC RECOMMENDATION INTELLIGENCE RESTORED.**

All six strategic fields are produced again; downstream consumers receive meaningful values; validator
scores reflect restored data (measured 0 → 83); the unrelated `whyNow` lineage is untouched; the
restoration is feature-flagged and reversible; and behaviour matches the historical deterministic
implementation, with three declared naming-only/behaviour-neutral deviations.
