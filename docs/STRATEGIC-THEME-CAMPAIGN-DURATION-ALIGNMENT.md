# Strategic Theme Campaign Duration Alignment

Strategic Theme Cards generated on the Trend Campaign page are aligned with the campaign duration defined in the execution configuration. The original `campaign_duration` is preserved in `execution_config`; normalization is used only for blueprint and theme generation.

## Hard Limit: 4–12 Weeks

**Campaign duration must be between 4 and 12 weeks.** Durations below 4 or above 12 weeks are rejected across the recommendation and planning pipeline (API, engine, UI). This keeps campaigns within the supported strategic window.

## Priority Order

Campaign duration is resolved in this order:

1. **AI Chat explicit override** – If the user specifies a duration during campaign planning (e.g. in AI Chat), that overrides all other sources.
2. **execution_config.campaign_duration** – From the Trend Campaign execution bar (audience, frequency, duration, start date, goal, style).
3. **System default** – 12 weeks when neither of the above is available.

## Duration Normalization

Raw durations (4–12 weeks) are mapped to strategic buckets for stable blueprint generation:

| Raw weeks | Normalized | strategic_arc_type |
|-----------|------------|--------------------|
| 4–5 | 4 | condensed |
| 6–7 | 6 | moderate |
| 8–10 | 8 | extended |
| 11–12 | 12 | full |

## Recommendation context

The engine passes these fields to downstream consumers (LLM prompts, etc.):

- `campaign_duration_weeks` – Raw value from execution_config
- `normalized_campaign_duration` – Bucketed value (4, 6, 8, or 12)
- `expected_number_of_weeks` – Same as campaign_duration_weeks
- `strategic_arc_type` – `condensed` | `moderate` | `extended` | `full`

## Theme arc mapping

Theme count is never mapped 1:1 to weeks. Instead, arc-based counts are used:

| strategic_arc_type | Theme count |
|--------------------|-------------|
| condensed | 2–3 themes |
| moderate | 3–4 themes |
| extended | 4–5 themes |
| full | 5–7 themes |

Shorter campaigns produce fewer but deeper themes.

## Flow

```
Trend Campaign execution form (campaign_duration)
  → POST /api/recommendations/generate
  → recommendationEngineService.generateRecommendations()
  → normalizeCampaignDuration() → normalized, strategic_arc_type
  → recommendationContext (campaign_duration_weeks, normalized_campaign_duration, strategic_arc_type)
  → buildCampaignBlueprint(strategySequence, normalized, strategic_arc_type)
  → capLadderToArcType(ladder, strategic_arc_type)
  → Strategic Theme Cards
  → BOLT / Campaign Planning (execution_config preserved)
  → Weekly structure generation (plan.weeks.length)
```

## Theme progression by duration

| Duration | strategic_arc_type | Behavior |
|----------|-------------------|----------|
| 4–5 weeks | condensed | 2–3 themes, condensed |
| 6–7 weeks | moderate | 3–4 themes |
| 8–10 weeks | extended | 4–5 themes |
| 11–12 weeks | full | 5–7 themes |

## Theme Diversity Guard

Strategic themes are checked for similarity (token-based Jaccard). When `similarity(themeA, themeB) > 0.75`, the later theme is flagged. A warning is logged; future enhancements may regenerate via LLM to diversify.

## Strategic Phase Progression

Ladder stages are filtered to match the arc’s phase order:

| Arc       | Phases                                |
|-----------|----------------------------------------|
| condensed | Awareness → Education → Conversion     |
| moderate  | Awareness → Education → Authority → Conversion |
| extended  | Awareness → Education → Authority → Conversion |
| full      | Awareness → Education → Authority → Conversion |

## Content-Type Distribution

Daily distribution targets these ratios across the campaign:

- Posts → 50–60%
- Blogs → 20–25%
- Short articles → 10–15%
- Stories → 5–15%

## Backward Compatibility

If `execution_config` is not present in the request payload (or `campaign_duration` is missing/invalid), the engine uses `durationWeeks` from the request body or defaults to 12 weeks. Values outside 4–12 weeks are clamped or rejected depending on the layer.

## AI Chat Override

During campaign planning, AI Chat interactions may change the duration. The campaign AI orchestrator uses: explicit conversation duration → execution_config.campaign_duration → database → 12 weeks. Strategic Theme generation runs before planning, so theme cards reflect the execution bar at generation time.

## Campaign Learning Layer

The Campaign Learning Layer uses historical performance signals from `campaign_performance_signals` to influence strategy and content planning. `campaignLearningService` aggregates signals into company-level insights:

- **company_high_performing_themes** – Themes with above-average engagement
- **company_high_performing_platforms** – Platforms that historically perform well
- **company_high_performing_content_types** – Content types that drive engagement
- **company_low_performing_patterns** – Themes/platforms/types to avoid or reduce

These insights are injected into the recommendation context and passed to the daily content distribution planner. The planner biases platform and content-type distribution toward high performers while respecting strategic themes and trend intelligence.

**Learning augments, does not replace, trend intelligence.** Strategic themes from the theme engine remain primary; performance insights refine how themes are executed (platform mix, content-type ratio), not which themes are chosen.
