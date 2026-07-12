# Campaign Intelligence — Metrics Catalog (CAMPAIGN-OPS-001)

Every metric emitted by the campaign-intelligence pipeline, routed through the
HARDEN-001 observability registry (`backend/observability`) and readable via
`getObservabilitySnapshot()`. Counters are monotonic; histograms expose
avg/p50/p95/p99. Labels are **low-cardinality only** — `campaign_id` / `company_id`
are captured in structured logs, **never** as labels (they would exhaust the
bounded ~5000-series budget).

Alert thresholds below are **documentation recommendations only** — this phase
tunes nothing and changes no behavior. `status`: `existing` = emitted before
CAMPAIGN-OPS-001; `added` = instrumented in this phase.

Stage order: Creation → Planner → Master-Idea → Quality → Optimization →
Generation → Semantic Validation → Creator Validation → Scheduling → Publishing.

---

## Campaign run (stage: creation / execution) — `added`

| Metric | Type | Labels | Meaning | Expected range | Suggested alert |
|---|---|---|---|---|---|
| `campaign.run.duration_ms` | histogram | mode, campaign_type | Wall-clock of `generateWeeklyStructure` (skeleton build) | p95 < 30s | p95 > 120s |
| `campaign.run.success` | counter | mode, campaign_type | Weekly-structure runs that reached the return | — | — |
| `campaign.run.failure` | counter | mode, campaign_type | Reserved for run-level failures (stage failures also recorded by the pipeline) | — | success/(success+failure) < 0.9 |

Context (`campaign_id`, `company_id`, `week`, `generation_mode`) is in the
`[campaign-quality]` / `[campaign-optimization]` / `[planner-metrics]` /
`[semantic-validation]` structured logs.

## Planner (stage: planner) — `existing`

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `planner.request.count` | counter | mode | Items requested (Σ format_frequency × weeks) | — | — |
| `planner.item.generated` | counter | mode | Items persisted | — | — |
| `planner.item.dropped` | counter | mode, reason | Items dropped, by reason | — | dropped/requested > 0.3 |
| `planner.item.regenerated` | counter | mode | Regenerate-before-drop successes | — | — |
| `planner.success_pct` | histogram | mode | generated / requested × 100 | 70–100 | p50 < 60 |
| `planner.integrity_pct` | histogram | mode | Invariant health (100 = planned=generated+dropped) | 100 | any < 100 |
| `planner.lifecycle.transition` | counter | mode, from, to, legal | FSM transitions; `legal=false` = a planner bug | legal=true | any legal=false |

## Master-Idea (stage: master-idea) — `existing` (identity is deterministic; no dedicated metric)

Master-Idea identity is carried on each asset and surfaced via quality
(`master_idea_diversity`) and validation (`master_idea_consistency`) rather than a
standalone counter.

## Quality Engine (stage: quality) — `added`

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `campaign.quality.score` | histogram | mode, campaign_type | Overall 0–100 weighted quality | 55–100 | p50 < 55 |
| `campaign.quality.grade` | counter | mode, campaign_type, grade | Count per grade (excellent/good/fair/needs_attention) | — | needs_attention share > 0.25 |
| `campaign.quality.dimension` | histogram | mode, campaign_type, dimension | Per-dimension 0–100 (theme/narrative/buyer-journey/cta/platform-fit/content-balance/master-idea/audience/fatigue) | 55–100 | platform_fit p50 < 100 |

## Optimization Engine (stage: optimization) — `added`

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `campaign.optimization.before_score` | histogram | mode, campaign_type | Overall quality before optimization | 0–100 | — |
| `campaign.optimization.after_score` | histogram | mode, campaign_type | Overall quality after optimization | ≥ before | after < before (should never) |
| `campaign.optimization.delta` | histogram | mode, campaign_type | after − before (≥ 0 by construction) | ≥ 0 | any < 0 |
| `campaign.optimization.passes` | histogram | mode, campaign_type | Passes run (≤ max budget) | 1–4 | p95 at max (budget too low) |
| `campaign.optimization.changes` | counter | mode, campaign_type | Total applied metadata changes | — | — |
| `campaign.optimization.change` | counter | mode, campaign_type, pass | Applied changes per pass | — | — |

## Generation (stage: generation) — `added` (text) / `existing` (creator render)

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `campaign.generation.duration_ms` | histogram | content_type, platform | Text master-content generation time per card | p95 < 20s | p95 > 60s |
| `creator.render_asset.ms` (via `recordCreatorDuration('render_asset', …)`) | histogram | asset_type, … | Creator render time | p95 < 30s | p95 > 90s |
| `creator.provider_image.ms` | histogram | … | Provider image generation time | — | — |

## Semantic Validation — text (stage: validation) — `existing`

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `planner.validation.pass_pct` | histogram | mode | validated / generated × 100 | 90–100 | p50 < 80 |
| `planner.validation.accepted` | counter | mode | Assets accepted | — | — |
| `planner.validation.adapted` | counter | mode | Assets adapted (cross-platform differentiate) | — | — |
| `planner.validation.regenerated` | counter | mode | Regenerate-before-drop successes | — | — |
| `planner.validation.dropped` | counter | mode | Assets dropped (duplicate/unfixable) | — | dropped/generated > 0.2 |
| `planner.validation.reason` | counter | mode, reason | Failure-dimension distribution | — | duplicate_* spike |

## Creator Validation (stage: creator-validation) — `existing`

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `creator.validation.accepted` | counter | content_type | Creator assets accepted | — | — |
| `creator.validation.regenerated` | counter | content_type | Creator regenerate-before-drop successes | — | — |
| `creator.validation.dropped` | counter | content_type | Creator assets dropped (duplicate slides/sections) | — | dropped spike |
| `creator.validation.reason` | counter | reason | Creator failure-dimension distribution | — | duplicate_slide spike |

## Scheduling / queue (stage: scheduling) — `existing`

| Metric | Type | Labels | Meaning | Range | Alert |
|---|---|---|---|---|---|
| `queue.job.retry` | counter | queue | Job retries | — | retry rate spike |
| `queue.job.dead_letter` | counter | queue | Jobs dead-lettered after final retry | 0 | any > 0 |
| `queue.job.stalled` | counter | queue | Stalled jobs | 0 | sustained > 0 |

Publishing delay / queue depth / queue wait are BullMQ-native and observed via the
queue's own instrumentation (`backend/observability/queueObservability.ts`) rather
than a campaign-specific metric — see Remaining gaps in the phase report.

---

## Reading the metrics

```ts
import { getObservabilitySnapshot } from '@/backend/observability';
const snap = getObservabilitySnapshot();
// snap contains all series keyed by name{sorted,labels}; histograms carry avg/p50/p95/p99.
```

Note (serverless): on Vercel, counters aggregate per-instance; durable analytics
should read the snapshot on the worker or persist to logs. The structured log lines
(`[campaign-quality]`, `[campaign-optimization]`, `[planner-metrics]`,
`[semantic-validation]`) carry the full per-campaign context for log-based queries.
