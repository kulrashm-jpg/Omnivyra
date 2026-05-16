create table if not exists creator_render_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_name text not null,
  metric_value numeric not null default 1,
  audit_id text,
  tags jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_creator_render_metrics_name_time
  on creator_render_metrics(metric_name, recorded_at desc);

create index if not exists idx_creator_render_metrics_audit
  on creator_render_metrics(audit_id);

create index if not exists idx_creator_render_metrics_tags
  on creator_render_metrics using gin(tags);

alter table if exists creator_render_validation_manifests
  add column if not exists validation_phase text generated always as ((validation_manifest->>'phase')) stored;

create index if not exists idx_creator_render_validation_phase
  on creator_render_validation_manifests(validation_phase, created_at desc);

create or replace function purge_old_creator_render_metrics(retention_days integer default 30)
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  delete from creator_render_metrics
  where recorded_at < now() - make_interval(days => greatest(retention_days, 1));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
