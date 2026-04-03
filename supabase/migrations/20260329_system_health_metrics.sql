-- System health metrics table
-- Stores operational health metrics for the engagement/intelligence system

create table if not exists public.system_health_metrics (
  id           uuid primary key default gen_random_uuid(),
  component    text not null,
  metric_name  text not null,
  metric_value numeric not null,
  metric_unit  text,
  observed_at  timestamptz not null default now(),
  metadata     jsonb
);

create index if not exists idx_system_health_metrics_component
  on public.system_health_metrics (component, observed_at desc);

create index if not exists idx_system_health_metrics_name
  on public.system_health_metrics (metric_name, observed_at desc);

-- Auto-purge rows older than 30 days (keep table small)
create or replace function public.purge_old_system_health_metrics()
returns void language sql as $$
  delete from public.system_health_metrics
  where observed_at < now() - interval '30 days';
$$;
