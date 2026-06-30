-- Phase 39 — Historical Intelligence durable store.
-- One row = one company, one plugin, one point in time. Mirrors HistoricalSnapshot exactly.
-- Service-role only (written by the snapshot job, read by /api/platform/history).
create table if not exists public.platform_intelligence_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  plugin_id           text not null,
  taken_at            timestamptz not null,
  overall_score       numeric not null default 0,
  health              text not null,
  confidence          numeric not null default 0,
  freshness           jsonb not null default '{}'::jsonb,
  maturity            numeric,
  business_impact     jsonb not null default '{}'::jsonb,
  recommendation_ids  jsonb not null default '[]'::jsonb,
  module_summaries    jsonb not null default '[]'::jsonb,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_pis_company_taken    on public.platform_intelligence_snapshots (company_id, taken_at);
create index if not exists idx_pis_company_plugin    on public.platform_intelligence_snapshots (company_id, plugin_id, taken_at);
create index if not exists idx_pis_plugin_taken      on public.platform_intelligence_snapshots (plugin_id, taken_at);

alter table public.platform_intelligence_snapshots enable row level security;

-- Service role only (the snapshot job + history API run as service role).
drop policy if exists pis_service_role_all on public.platform_intelligence_snapshots;
create policy pis_service_role_all on public.platform_intelligence_snapshots
  for all to service_role using (true) with check (true);
