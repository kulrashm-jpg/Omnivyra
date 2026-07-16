# Canonical Grounding — Operational Monitoring (IaC)

Operational infrastructure-as-code for the `canonical-grounding` rollout. These
files change **no application runtime**; they wire the *already-emitted*
HARDEN-001 metrics into Prometheus / Grafana / Alertmanager so SHADOW can be
observed and gated.

| File | Purpose | Deploy target |
|---|---|---|
| `prometheus-scrape-omnivyra.yml` | scrape `/api/observability/metrics` (app + worker) | prometheus.yml |
| `canonical-grounding-alerts.yml` | alert rules (overwrite gate, errors, fallback, latency, cache, missing metrics, worker down) | `/etc/prometheus/rules/` |
| `grafana-canonical-grounding-dashboard.json` | dashboard (call/shadow/overwrote/backfilled/fallback/latency/cache/context_backed/kill/error) | Grafana import |

## Exact exported metric names
Registry dots → underscores; histograms → summaries (`_sum`, `_count`, `quantile`).
`canonical_grounding_call{mode}`, `canonical_grounding_shadow{result}`,
`canonical_grounding_error{mode}`, `canonical_grounding_fallback{mode}`,
`canonical_grounding_kill{source}`, `canonical_grounding_read{context_backed}`,
`canonical_grounding_shadow_context{ok}`,
`canonical_grounding_fields_overwrote{_sum,_count,quantile}`,
`canonical_grounding_fields_backfilled{...}`, `canonical_grounding_assembly_ms{...}`,
`canonical_grounding_total_ms{mode,...}`,
`cache_hit{cache="omnivyra:canonical_ctx"}`, `cache_miss{...}`.
RF-2 forensic exemplar `canonical_grounding.shadow_overwrite` is a **log event**, not a metric.

## The safety gate
`CanonicalGroundingOverwriteViolation` — `increase(canonical_grounding_shadow{result="overwrote"}[5m]) > 0`
→ CRITICAL/page. Must stay **0** in shadow. Any fire HALTS promotion; investigate via
`getShadowDivergenceDiagnostics()` (trace/request/correlation id + overwrittenFields).

## Activation runbook (operator, once monitoring is live)
1. Provision the metrics scrape token file (`/etc/prometheus/secrets/omnivyra_metrics_token`) — the value of the app's metrics auth secret. **Do not commit it.**
2. Merge `prometheus-scrape-omnivyra.yml` into prometheus.yml; fill the Railway worker host; load `canonical-grounding-alerts.yml`; reload Prometheus.
3. Import `grafana-canonical-grounding-dashboard.json`; confirm `canonical_grounding_call{mode="off"}` populates (proves scrape works at OFF).
4. Confirm Alertmanager routes the `page: sre` alerts.
5. Confirm the Railway worker runs the same commit as Vercel and (if separate) exposes its metrics.
6. Only then enable SHADOW on **both** surfaces: `ROLLOUT_CANONICAL_GROUNDING_MODE=shadow`, redeploy, watch the dashboard.

## Rollback (pre-staged, instant)
- Emergency: `ROLLOUT_CANONICAL_GROUNDING_KILL=1` (or global `ROLLOUT_KILL_SWITCH`) → legacy immediately, no redeploy.
- Revert: unset / `ROLLOUT_CANONICAL_GROUNDING_MODE=off` on both surfaces.
- Cache: `CACHE_KILL_OMNIVYRA_CANONICAL_CTX=1` (fail-open).
