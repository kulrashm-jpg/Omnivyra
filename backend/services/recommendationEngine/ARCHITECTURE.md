# recommendationEngine — Architecture & Change-Safety Contract

_Audited 2026-07-09. Read this before modifying `engine.ts`._

## Module map

| Module | LOC | Role |
|---|---|---|
| `engine.ts` | ~1,127 | Two exports: `getRecommendedTopicsForCompany` (small IO+reduce) and `generateRecommendations` (the orchestrator, lines 123–1127) |
| `engineHelpers.ts` | ~566 | Already-extracted helpers: persona/confidence/scoring/explanation builders, plan mappers, intelligence-signal attachment |
| `scoringHelpers.ts` | ~442 | Pure token/alignment scoring: `buildCoreProblemTokens`, `hasOverlapWithTokens`, `scoreByAlignmentThenPopularity`, tier extraction |
| `types.ts` | ~154 | Input/result contracts (`RecommendationEngineInput`, `RecommendationEngineResult`) |

Only two production importers consume `engine.ts`. **All database access** (engine + helpers)
flows through one seam: `backend/repositories/recommendationEngineReadRepository.ts` (6 functions).

## `generateRecommendations` — the orchestrator

A single sequential pipeline (~92 top-level statements) with **three exit points**:

1. **No-signals early return** (~line 527) — external APIs, profile fallback, AND AI theme
   rescue all produced nothing → `PROFILE_ONLY` result with placeholder
   `no_external_signals` and a bare fallback plan. Skips all main-path assembly.
2. **All-unhealthy early return** (~line 936) — every external API health score < 0.3
   (and signals were not AI/LLM-sourced) → `PROFILE_ONLY` result with placeholder
   `all_sources_unhealthy`, trends discarded.
3. **Main return** (~line 999) — full result: trends, plans, confidence, blueprint chain,
   learning snapshot.

### Pipeline order (behavior-critical — do not reorder)

```
ensureCampaignCompanyLink → getProfile(autoRefine) → context intelligence → campaign memory
→ persona summary → campaign intelligence (try/catch fallbacks) → duration clamp 4..12 +
normalizeCampaignDuration → recommendationContext accretion (performance insights,
learning signals, viral memory, lead intelligence — each with catch-default semantics)
→ objective mapping → platform rules → signal acquisition (3-way branch on insightSource:
'llm' = DB themes→AI themes; multi-region loop; single-geo) → fallback ladder (profile
signals → AI theme rescue → early exit 1) → keyword pre-filter (partition into
trendsToScore / filteredOut) → Omnivyra relevance+ranking (or local
scoreByAlignmentThenPopularity when disabled) → trend reasoning → onContext callback
→ plan generation → novelty check (similarity > 0.6 ⇒ exactly ONE regeneration)
→ persona bias → polish → theme-key exclusion filter → MIN_THEME_COUNT(5) AI top-up
(limit = needed×2, slice to 5) → sequencing → confidence/scoring adjustments
→ all-unhealthy guard (early exit 2) → result assembly → blueprint validation
→ card enrichment → lineage backfill loop → execution blueprint resolution
→ learning snapshot (only when Omnivyra enabled) → return
```

### Mutable state (function-local, threaded through the pipeline)

`recommendationContext` (accreted record, emitted once via `onContext`), `merged`, `tagged`,
`usedFallbackContextSignals`, `trendsUsed`, `trendsIgnored`, `omnivyraMeta`,
`fallbackReason`, `weeklyPlan`, `dailyPlan`, `rawSignals`, `missingEnvPlaceholders`,
`result` (reassigned by `enrichRecommendationCards`; items mutated in the lineage loop).

### Side effects & IO boundaries

- **DB reads**: profile, campaign memory/intelligence, performance insights, platform
  strategies, theme exclusions, intelligence-signal lookup (via the read repository).
- **Network**: `fetchExternalApis` (per region or single-geo), Omnivyra relevance/ranking,
  `sendLearningSnapshot`.
- **AI/LLM**: `generateAdditionalStrategicThemes` (three call sites: LLM-path rescue,
  no-signal rescue, MIN_THEME_COUNT top-up — different limits/correlation metadata each).
- **Module-global state**: `setLastFallbackReason`/`getLastFallbackReason`
  (omnivyraHealthService) — written mid-pipeline, read during result assembly.
- **Fire-and-forget**: theme-originality guard inside the `campaign_blueprint` IIFE
  (`loadRecentCompanyThemes().then(...)`, unawaited, warn-only).
- **Console telemetry**: `[STRATEGIC_TRACE]`, `EXTERNAL_API_*`, `NOVELTY_WARNING`,
  `OMNIVYRA_FALLBACK_*` — treated as observable output; downstream log tooling may match
  on these strings.
- **Dynamic imports**: `durationNormalization`, `strategicThemeEngine`,
  `companyTrendRelevanceEngine`, `themeKeyService`, `companyThemeStateService` — lazy by
  design (AI prompt timing / cycle avoidance). Do not hoist to static imports.

### Error-handling semantics (observable behavior)

Nearly every context enrichment is `try/catch` with a **specific** default (null, `[]`,
or guidance-note omission). Region fetch failures skip the region with a warn. Omnivyra
failures degrade to local scoring with a recorded `fallback_reason`. The `onContext`
callback and trend-reasoning builder are best-effort (`catch {}`). Preserve exact
catch-defaults when touching any block.

## Function classification (Phase-1 audit result)

| Unit | Class |
|---|---|
| `getRecommendedTopicsForCompany` | IO read + pure max-score reducer |
| `generateRecommendations` | **Orchestrator / Coordinator** (sequential rule chain; not safely splittable) |
| `buildTrendReasoning` (inline closure, ~749) | Pure mapper over read-only locals |
| Keyword pre-filter reduce (~632) | Pure partition over locals |
| `engineHelpers.ts` exports | Mostly pure + 5 IO functions (link check, signal attach, learning loads) |
| `scoringHelpers.ts` exports | Pure |

## Change-safety contract

1. The pure-helper harvest **already happened** (engineHelpers/scoringHelpers/types =
   1,162 lines extracted). The remaining inline logic either performs IO, mutates
   pipeline state, or closes over pipeline locals. There is **no compliant pure
   extraction left** that doesn't change call shape inside an untested body.
2. **Characterization suite**: `backend/tests/unit/recommendationEngineCharacterization.test.ts`
   (14 tests + 2 golden-master snapshots) locks: topic aggregation, the hybrid single-geo
   happy path, keyword-filter partition, novelty single-retry, theme exclusion,
   MIN_THEME_COUNT top-up arithmetic, all three exit points, Omnivyra
   relevance/ranking/learning, Omnivyra failure fallback, and the `onContext` contract.
   **Run it before and after ANY change to this directory.** It mocks every IO seam and
   keeps engine/helpers/trend-processing real.
3. Never: reorder pipeline stages, change catch-defaults, alter the novelty retry count,
   change the MIN_THEME_COUNT/top-up arithmetic, hoist dynamic imports, remove/rename
   telemetry strings, or move the learning-snapshot send relative to result assembly —
   without deliberately updating the characterization suite first.
4. Uncovered residual risk (extend the suite before touching): multi-region merge loop,
   `insightSource: 'llm'` DB-theme path, strategic-payload trace/tiering, simulate-mode
   scenario outcomes.
