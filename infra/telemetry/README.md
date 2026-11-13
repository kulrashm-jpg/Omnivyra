# omnivyra-telemetry (Railway service)

Relay that ships observability data to Grafana Cloud (owner ruling 2026-11-13: Grafana Cloud + email alerts).

- **Vercel logs**: Vercel Drain (Team Settings > Drains, Logs, custom endpoint, NDJSON) POSTs to `https://<this service>/vercel` with HTTP Basic auth (`vercel` / `DRAIN_INGEST_SECRET`). Vercel sends JSON/NDJSON, not the Loki push format, which is why a relay is needed.
- **Worker metrics**: scrapes the worker's `/metrics` over Railway private networking (`omnivyra.railway.internal:8080`) every 30 s with `OBSERVABILITY_EXPORT_TOKEN`, remote-writes to Grafana Cloud Prometheus.

## Service variables (names only; values live in Railway, never in git)
`DRAIN_INGEST_SECRET`, `OBSERVABILITY_EXPORT_TOKEN`, `GRAFANA_CLOUD_LOKI_URL`, `GRAFANA_CLOUD_LOKI_USER`, `GRAFANA_CLOUD_PROM_URL` (the `/api/prom` base; `/push` is appended), `GRAFANA_CLOUD_PROM_USER`, `GRAFANA_CLOUD_TOKEN` (access policy `omnivyra-prod-ingest`: logs:write + metrics:write only, 90-day expiry), optional `WORKER_METRICS_URL`.

## Railway service settings
Source: this repo, root directory `infra/telemetry`, builder Dockerfile. Public domain: yes (Vercel must reach `/vercel`). No volume.

Validated with `vector validate --no-environment` (Vector 0.46.1). Monitoring is NOT live until an end-to-end test alert reaches the alert inbox.
