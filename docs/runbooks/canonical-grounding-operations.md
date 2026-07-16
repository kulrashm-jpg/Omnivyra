# Canonical Grounding — Operations Runbook

Operational documentation for the `canonical-grounding` rollout. **No application
behaviour is defined here** — this is the operator's guide to running, observing,
gating, and rolling back the feature. Pairs with `monitoring/` (scrape, recording
rules, alerts, dashboard, alertmanager, env template).

## 1. What it is
- **Single control point:** `backend/services/context/canonicalProfileAdapter.ts`. All 96 consumers read grounding only through it (`getCanonicalProfile`, `getCanonicalGroundingContext`). No parallel pipeline.
- **Modes (flag `canonical-grounding`):** `off` (default, byte-faithful legacy) → `shadow` (run + measure, return legacy) → `enforce` (return canonical).
- **Runs in BOTH surfaces:** Vercel app (API routes) and Railway worker (jobs). Env changes must be applied to **both** to avoid skew.
- **Certified:** RF-1 (single control point, byte-faithful OFF), RF-2 (overwrite traceability), RF-3A/3B (equivalence: canonical ≥ legacy, 0 overwrites, hallucination halved — see prior certs).

## 2. Endpoints & deploy commands
- **Version/parity:** `GET https://www.omnivyra.com/api/health/version` → `{ build: <sha>, environment }`. Both Vercel and Railway must run the same `build` sha.
- **Metrics:** `GET /api/observability/metrics` — **404 unless `OBSERVABILITY_EXPORT_TOKEN` is set**; then `Authorization: Bearer <token>`.
- **Deploy (from clean origin/main):** `git push origin main` (Railway worker auto-deploys) → `npx vercel --prod --scope <scope>` (app). Gate: `npm run deploy:check`. Post: `npm run verify:vercel-render-parity`.
- **Ops smoke:** `node scripts/ops/verify-canonical-grounding-ops.mjs` (probes version + metrics reachability).

## 3. Rollout controls (env — set on Vercel AND Railway)
| Action | Variable | Effect |
|---|---|---|
| Enable shadow | `ROLLOUT_CANONICAL_GROUNDING_MODE=shadow` | run+measure, return legacy |
| Per-tenant canary | `ROLLOUT_CANONICAL_GROUNDING_TENANTS=<orgIds>` (mode=shadow) | those tenants → enforce |
| Enable enforce | `ROLLOUT_CANONICAL_GROUNDING_MODE=enforce` | return canonical |
| **Emergency stop** | `ROLLOUT_CANONICAL_GROUNDING_KILL=1` | instant OFF, no redeploy |
| Global kill | `ROLLOUT_KILL_SWITCH=1` | all rollout flags OFF |
| Cache disable | `CACHE_KILL_OMNIVYRA_CANONICAL_CTX=1` | fail-open; grounding still assembles |

## 4. Key metrics (exact exported names)
`canonical_grounding_call{mode}`, `canonical_grounding_shadow{result}` (result: overwrote/backfilled/identical/no_object), `canonical_grounding_error{mode}`, `canonical_grounding_fallback{mode}`, `canonical_grounding_kill{source}`, `canonical_grounding_read{context_backed}`, `canonical_grounding_fields_overwrote{_count}`, `canonical_grounding_fields_backfilled{_count}`, `canonical_grounding_assembly_ms{quantile}`, `canonical_grounding_total_ms{mode,quantile}`, `cache_hit|cache_miss{cache="omnivyra:canonical_ctx"}`.
**Overwrite gate:** `increase(canonical_grounding_shadow{result="overwrote"}[5m]) > 0` must stay **0**. RF-2 forensic exemplar is the **log** event `canonical_grounding.shadow_overwrite` (trace/request/correlation id + `overwrittenFields`); also `getShadowDivergenceDiagnostics()` in-process.

---

## 5. Checklists

### 5.1 Deployment checklist (dark, flag OFF)
- [ ] `main` == `origin/main`; `npm run deploy:check` passes.
- [ ] Push `main` → Railway worker rebuilds; deploy Vercel app.
- [ ] `GET /api/health/version` on app == deployed sha; confirm Railway sha matches.
- [ ] `npm run verify:vercel-render-parity` = PASS.
- [ ] Flag confirmed OFF (`ROLLOUT_CANONICAL_GROUNDING_MODE` unset on both surfaces).
- [ ] Record deploy tag `deploy/omnivyra-<ts>`.

### 5.2 Observability readiness (before shadow)
- [ ] `OBSERVABILITY_EXPORT_TOKEN` set on app + worker; metrics endpoint returns 200 (with token), not 404.
- [ ] Prometheus scraping app **and** worker (`monitoring/prometheus-scrape-omnivyra.yml`); token in scrape secret file.
- [ ] Recording + alert rules loaded (`monitoring/canonical-grounding-recording-rules.yml`, `canonical-grounding-alerts.yml`).
- [ ] Grafana dashboard imported (`monitoring/grafana-canonical-grounding-dashboard.json`); `canonical_grounding_call{mode="off"}` populates.
- [ ] Alertmanager routes `page: sre` (`monitoring/alertmanager-canonical-grounding-route.yml`); overwrite alert synthetic-tested in staging.

### 5.3 Shadow rollout checklist
- [ ] 5.1 + 5.2 complete (all PASS).
- [ ] Set `ROLLOUT_CANONICAL_GROUNDING_MODE=shadow` on **both** surfaces; redeploy.
- [ ] Verify **zero user-visible change** (legacy still returned; sample outputs unchanged).
- [ ] Dashboard: `call{mode=shadow}` climbing; `assembly_ms`/`total_ms` within budget; `fallback` < 5%; cache hit ratio stable.
- [ ] **`shadow{result="overwrote"}` == 0** sustained ≥ 5–7 days; `fields_backfilled` > 0 on sparse tenants.
- [ ] No alert firings; RF-2 diagnostics empty.
- [ ] **Promotion gate:** all above hold for the full window → proceed to canary.

### 5.4 Canary checklist (7 proven-superior workloads first)
- [ ] Shadow promotion gate met.
- [ ] Set `ROLLOUT_CANONICAL_GROUNDING_TENANTS=<small allowlist>` (mode=shadow → those tenants enforce).
- [ ] Daily: overwrite=0, error/fallback/retry flat, token/cost delta within budget, latency within budget.
- [ ] Daily quality spot-check (human/second-judge) on sampled outputs.
- [ ] Sustained ≥ 5 days clean → expand cohort (5.5).

### 5.5 Expanded canary
- [ ] Canary gate met; widen allowlist; admit the remaining 6 "equal" workloads.
- [ ] No regression across all 13 workloads at scale; cost/latency stable ≥ 7–10 days → GA.

### 5.6 Rollback checklist (instant, pre-staged)
- [ ] Trigger identified (overwrite>0 / error / latency / cost / complaint).
- [ ] **Contain:** `ROLLOUT_CANONICAL_GROUNDING_KILL=1` on both surfaces → legacy immediately (no redeploy).
- [ ] Or scope down: remove tenants from `_TENANTS`, or `MODE=off`.
- [ ] Confirm `canonical_grounding_call{mode="off"}` is the only mode emitting.
- [ ] Investigate via RF-2 (trace id) + `scripts/ops/verify-canonical-grounding-ops.mjs`.
- [ ] Resume only after root cause fixed + re-certified.

### 5.7 Kill-switch checklist (drill quarterly)
- [ ] In staging, set `ROLLOUT_CANONICAL_GROUNDING_KILL=1` → verify grounding returns legacy within one request (no redeploy).
- [ ] Verify `canonical_grounding_kill{source="env-kill"}` increments.
- [ ] Verify `CACHE_KILL_OMNIVYRA_CANONICAL_CTX=1` disables cache, grounding still works (fail-open).
- [ ] Document kill→recovery time.

### 5.8 Post-deploy verification
- [ ] `/api/health/version` build == expected sha (app + worker).
- [ ] Error rate / latency flat vs pre-deploy.
- [ ] `canonical_grounding_call` visible in Prometheus; no unexpected mode.
- [ ] No new alert firings for 30 min.

### 5.9 Production acceptance (before ENFORCE GA)
- [ ] 0 overwrite, 0 cache-isolation, 0 rollout, 0 billing, 0 planner regressions over GA soak.
- [ ] Latency + cost within agreed budget at scale.
- [ ] No statistically significant quality regression (multi-run + 2nd judge/human).
- [ ] Stable shadow + canary telemetry; successful canary.

---

## 6. Incident response
| Symptom | Alert | First actions |
|---|---|---|
| Canonical overwrote a legacy value | `CanonicalGroundingOverwriteViolation` (page) | HALT promotion; `getShadowDivergenceDiagnostics()` → trace id → logs (`canonical_grounding.shadow_overwrite`); if canary/enforce, `..._KILL=1`. |
| Exceptions rising | `CanonicalGroundingErrorSpike` | Check contextAssimilationEngine sources / Redis; grounding is fail-open (returns legacy). |
| Fallback > 5% | `CanonicalGroundingFallbackSpike` | Context sources thin/failing; check cache + engine; canonical adds little → consider hold. |
| p95 latency > budget | `CanonicalGroundingLatencyRegression` | Check `assembly_ms` p95 + cache hit ratio; Redis health. |
| Cache miss > 60% | `CanonicalGroundingCacheMissHigh` | Redis degraded/killed; fail-open (latency/cost rise); check `CACHE_KILL_*`. |
| Metrics absent | `CanonicalGroundingMetricsMissing` (page) | Metrics blind — check `OBSERVABILITY_EXPORT_TOKEN`, endpoint 404, scrape config, app health. |
| Worker down | `OmnivyraWorkerMetricsMissing` (page) | Confirm Railway running + worker metrics exposed + commit parity. |
