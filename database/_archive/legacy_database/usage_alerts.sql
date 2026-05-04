-- Threshold-based usage alerts. Signal only; no blocking, no enforcement.
-- One row per threshold per resource per org per month (80%, 95%, 100%).

create table if not exists usage_threshold_alerts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  resource_key text not null,
  year integer not null,
  month integer not null,

  threshold_percent integer not null,

  triggered_at timestamptz not null default now(),

  unique (organization_id, resource_key, year, month, threshold_percent)
);

create index if not exists idx_usage_threshold_alerts_org
  on usage_threshold_alerts(organization_id, year, month);
